// Pattern check: Adapter (Tier 1) — applied — translates the Remappr joystick's device document (TBL_JOYSTICK axes, button actions) and live JOYSTICK state into the neutral device-controls model, and edits back.
//
// What the Remappr joystick firmware lets the app change, as controls
// (input-layout plan §4):
// - a button (its binding position = its place among the device's buttons)
//   reports gamepad button position + 1 by default, or any gamepad button, a
//   hat direction, an axis held at a value, or nothing (TBL_ACTION_BINDING);
// - a stick (the n-th reads analog inputs 2n and 2n + 1): the report axes it
//   moves, its deadzones, curve and Y invert (TBL_JOYSTICK), and its click;
// - a hat (its position is up, then down, left, right): what each direction
//   does, and 4- or 8-way.
// Where the controls sit comes from the joystick itself (GET_INPUT_LAYOUT).
import type { ConfigDevice } from '../../config/device'
import type {
    ConfigJoystick,
    JoystickAxisConfig,
    JoystickAxisId,
    JoystickButtonAction,
} from '../../config/types'
import { JOYSTICK_AXIS_IDS } from '../../config/compilers/remappr/joystick'
import { defaultLayout } from '../../devices/defaultLayout'
import type {
    ButtonBinding,
    ControlBinding,
    ControlInputFrame,
    ControlOption,
    ControlsCatalog,
    DeviceAction,
    DeviceBindings,
    DeviceModel,
    HatBinding,
    StickBinding,
} from '../../devices/types'
import {
    inputLayoutModel,
    type InputLayout,
    type InputNaming,
} from './inputLayout'
import {
    INPUT_NONE,
    InputClass,
    type AxisState,
    type InputLayoutEntry,
} from './protocol'

const FULL = 32767
const AXIS_LABEL: Readonly<Record<JoystickAxisId, string>> = {
    x: 'X',
    y: 'Y',
    z: 'Z',
    rx: 'Rx',
    ry: 'Ry',
    rz: 'Rz',
}
const HAT_LABELS = [
    'up',
    'up-right',
    'right',
    'down-right',
    'down',
    'down-left',
    'left',
    'up-left',
]
/** A hat's four positions in order, and the direction each holds by default. */
const HAT_FIELDS = ['up', 'down', 'left', 'right'] as const
const HAT_DEFAULT_DIRS = [0, 4, 6, 2]
const STICK_NAMES = ['Left stick', 'Right stick']
const STICK_GLYPHS = ['L3', 'R3']

// ---- ids ----------------------------------------------------------------------

const ordinal = (e: InputLayoutEntry): number =>
    e.inputId === INPUT_NONE ? 0 : e.inputId & 0xff

/** The ids the joystick's bindings use: a button by its position, a stick and
 *  a hat by their ordinal. Anything else keeps a generic id. */
export function joystickInputNaming(
    e: InputLayoutEntry,
): InputNaming | undefined {
    const n = ordinal(e)
    if (e.cls === InputClass.STICK) {
        return {
            id: `stick:${n}`,
            name: STICK_NAMES[n] ?? `Stick ${n + 1}`,
            glyph: STICK_GLYPHS[n] ?? `S${n + 1}`,
        }
    }
    if (e.cls === InputClass.HAT) {
        return { id: `hat:${n}`, name: n === 0 ? 'D-pad' : `Hat ${n + 1}` }
    }
    const button = e.cls === InputClass.BUTTON || e.cls === InputClass.KEY
    if (!button || e.position === INPUT_NONE) return undefined
    return {
        id: `btn:${e.position}`,
        name: `Button ${e.position + 1}`,
        glyph: `${e.position + 1}`,
    }
}

/** Control id → the layout entry it was drawn from. */
export function joystickInputs(
    layout: InputLayout | undefined,
): ReadonlyMap<string, InputLayoutEntry> {
    const out = new Map<string, InputLayoutEntry>()
    for (const e of layout?.entries ?? []) {
        const id = joystickInputNaming(e)?.id
        if (id && !out.has(id)) out.set(id, e)
    }
    return out
}

/** The joystick as controls: drawn as it reports itself, else a generic
 *  gamepad with nothing to bind. */
export function joystickModel(name: string, layout?: InputLayout): DeviceModel {
    if (!layout?.entries.length) return defaultLayout('gamepad', name, {})
    return inputLayoutModel(layout, {
        name,
        fallbackForm: 'gamepad',
        naming: joystickInputNaming,
    })
}

// ---- actions ------------------------------------------------------------------

const BTN = 'pad:btn:'
const HAT = 'pad:hat:'
const AXIS = 'pad:axis:'

const ACTION_ID: {
    [K in JoystickButtonAction['action']]: (
        a: Extract<JoystickButtonAction, { action: K }>,
    ) => string | null
} = {
    none: () => null,
    button: (a) => `${BTN}${a.button}`,
    hat: (a) => `${HAT}${a.dir}`,
    axis: (a) => `${AXIS}${a.axis}:${a.value}`,
}

/** A gamepad action as a catalog id (null = nothing, Disabled). */
export function actionId(a: JoystickButtonAction): string | null {
    return (ACTION_ID[a.action] as (x: JoystickButtonAction) => string | null)(
        a,
    )
}

/** A catalog id back to the action; null (Disabled) is "none". Undefined for
 *  an id this adapter does not know. */
export function parseActionId(
    id: string | null,
): JoystickButtonAction | undefined {
    if (id === null) return { action: 'none' }
    if (id.startsWith(BTN))
        return { action: 'button', button: Number(id.slice(BTN.length)) }
    if (id.startsWith(HAT))
        return { action: 'hat', dir: Number(id.slice(HAT.length)) }
    if (!id.startsWith(AXIS)) return undefined
    const [axis, value] = id.slice(AXIS.length).split(':')
    if (!(axis! in AXIS_LABEL)) return undefined
    return {
        action: 'axis',
        axis: axis as JoystickAxisId,
        value: Number(value),
    }
}

function axisLabel(
    a: Extract<JoystickButtonAction, { action: 'axis' }>,
): string {
    const name = AXIS_LABEL[a.axis]
    if (Math.abs(a.value) === FULL) return `${name} ${a.value > 0 ? '+' : '−'}`
    return `${name} ${Math.round((a.value * 100) / FULL)}%`
}

function axisActions(j: ConfigJoystick | undefined): DeviceAction[] {
    const holds = JOYSTICK_AXIS_IDS.flatMap((axis) =>
        [FULL, -FULL].map((value) => ({
            action: 'axis' as const,
            axis,
            value,
        })),
    )
    const bound = (j?.buttonActions ?? []).filter(
        (a): a is Extract<JoystickButtonAction, { action: 'axis' }> =>
            a?.action === 'axis',
    )
    const byId = new Map([...holds, ...bound].map((a) => [actionId(a)!, a]))
    return [...byId].map(([id, a]) => ({
        id,
        label: axisLabel(a),
        group: 'axis',
        category: 'pad' as const,
    }))
}

// ---- outputs ------------------------------------------------------------------

const STICK_OUTPUTS: readonly [JoystickAxisId | null, JoystickAxisId | null][] =
    [
        ['x', 'y'],
        ['rx', 'ry'],
        ['z', 'rz'],
        [null, null],
    ]
const outId = (x: JoystickAxisId | null, y: JoystickAxisId | null): string =>
    `${x ?? 'off'}:${y ?? 'off'}`
const outLabel = (
    x: JoystickAxisId | null,
    y: JoystickAxisId | null,
): string =>
    x === null && y === null
        ? 'Off'
        : `${x ? AXIS_LABEL[x] : 'off'} / ${y ? AXIS_LABEL[y] : 'off'}`

function stickOutputs(
    j: ConfigJoystick | undefined,
    inputs: ReadonlyMap<string, InputLayoutEntry>,
): ControlOption[] {
    const bound = [...inputs.keys()]
        .filter((id) => id.startsWith('stick:'))
        .map((id) => stickAxes(j, Number(id.slice(6))))
        .map(([x, y]) => [x.out, y.out] as const)
    const byId = new Map(
        [...STICK_OUTPUTS, ...bound].map(([x, y]) => [
            outId(x, y),
            outLabel(x, y),
        ]),
    )
    return [...byId].map(([id, label]) => ({ id, label }))
}

/** What the joystick can be set to. */
export function joystickCatalog(
    j: ConfigJoystick | undefined,
    inputs: ReadonlyMap<string, InputLayoutEntry>,
): ControlsCatalog {
    return {
        groups: [
            { id: 'pad', label: 'Gamepad buttons', category: 'pad' },
            { id: 'hat', label: 'Hat', category: 'pad' },
            { id: 'axis', label: 'Axes', category: 'pad' },
        ],
        actions: [
            ...Array.from({ length: 32 }, (_, i) => ({
                id: `${BTN}${i + 1}`,
                label: `Button ${i + 1}`,
                group: 'pad',
                category: 'pad' as const,
            })),
            ...HAT_LABELS.map((label, dir) => ({
                id: `${HAT}${dir}`,
                label: `Hat ${label}`,
                group: 'hat',
                category: 'pad' as const,
            })),
            ...axisActions(j),
        ],
        outputs: { stick: stickOutputs(j, inputs) },
        fields: {
            button: ['a'],
            stick: ['out', 'inner', 'outer', 'curve', 'invY', 'click'],
            hat: ['up', 'down', 'left', 'right', 'ways'],
        },
    }
}

// ---- document → bindings ------------------------------------------------------

const defaultAxis = (input: number): JoystickAxisConfig => ({
    input,
    out: JOYSTICK_AXIS_IDS[input] ?? null,
})

function axisOf(
    j: ConfigJoystick | undefined,
    input: number,
): JoystickAxisConfig {
    return j?.axes?.find((a) => a.input === input) ?? defaultAxis(input)
}

/** The n-th stick's X and Y inputs. */
function stickAxes(
    j: ConfigJoystick | undefined,
    n: number,
): [JoystickAxisConfig, JoystickAxisConfig] {
    return [axisOf(j, 2 * n), axisOf(j, 2 * n + 1)]
}

/** What position `p` does by default: a hat direction for a hat's positions,
 *  else button p + 1. */
function defaultAction(
    p: number,
    hats: ReadonlyMap<number, number>,
): JoystickButtonAction {
    const dir = hats.get(p)
    if (dir !== undefined) return { action: 'hat', dir }
    return { action: 'button', button: p + 1 }
}

/** Every hat position → the direction it holds by default. */
function hatPositions(
    inputs: ReadonlyMap<string, InputLayoutEntry>,
): Map<number, number> {
    const out = new Map<number, number>()
    for (const [id, e] of inputs) {
        if (!id.startsWith('hat:') || e.position === INPUT_NONE) continue
        HAT_DEFAULT_DIRS.forEach((dir, k) => out.set(e.position + k, dir))
    }
    return out
}

function positionAction(
    j: ConfigJoystick | undefined,
    p: number,
    hats: ReadonlyMap<number, number>,
): string | null {
    return actionId(j?.buttonActions?.[p] ?? defaultAction(p, hats))
}

type BindingFor = (
    j: ConfigJoystick | undefined,
    e: InputLayoutEntry,
    id: string,
    hats: ReadonlyMap<number, number>,
) => ControlBinding

const BINDINGS: Readonly<Record<string, BindingFor>> = {
    btn: (j, e, _id, hats): ButtonBinding => ({
        a: positionAction(j, e.position, hats),
    }),
    stick: (j, e, id, hats): StickBinding => {
        const [x, y] = stickAxes(j, Number(id.slice(6)))
        return {
            out: outId(x.out, y.out),
            inner: x.inner ?? 0,
            outer: x.outer ?? 0,
            curve: x.curve ?? 'linear',
            invY: !!y.invert,
            click:
                e.position === INPUT_NONE
                    ? null
                    : positionAction(j, e.position, hats),
        }
    },
    hat: (j, e, _id, hats): HatBinding => {
        const dir = (k: number): string | null =>
            positionAction(j, e.position + k, hats)
        return {
            up: dir(0),
            down: dir(1),
            left: dir(2),
            right: dir(3),
            ul: null,
            ur: null,
            dl: null,
            dr: null,
            ways: j?.hatWays ?? 8,
        }
    },
}

const kindOf = (id: string): string => id.split(':')[0]!

/** The document's joystick section as control bindings. */
export function joystickBindings(
    j: ConfigJoystick | undefined,
    inputs: ReadonlyMap<string, InputLayoutEntry>,
): DeviceBindings {
    const hats = hatPositions(inputs)
    const out: Record<string, ControlBinding> = {}
    for (const [id, e] of inputs)
        out[id] = BINDINGS[kindOf(id)]!(j, e, id, hats)
    return out
}

// ---- bindings → document ------------------------------------------------------

const sameAction = (
    a: JoystickButtonAction,
    b: JoystickButtonAction,
): boolean => JSON.stringify(a) === JSON.stringify(b)

/** `j` with position `p` doing `id`; the default is stored as nothing. */
function withAction(
    j: ConfigJoystick,
    p: number,
    id: string | null,
    hats: ReadonlyMap<number, number>,
): ConfigJoystick {
    const a = parseActionId(id)
    if (!a || p === INPUT_NONE) return j
    const list = [...(j.buttonActions ?? [])]
    while (list.length <= p) list.push(null)
    list[p] = sameAction(a, defaultAction(p, hats)) ? null : a
    while (list.length && list[list.length - 1] === null) list.pop()
    return { ...j, buttonActions: list.length ? list : undefined }
}

/** An axis entry without its default fields, or null when it is the default. */
function minimalAxis(a: JoystickAxisConfig): JoystickAxisConfig | null {
    const out: JoystickAxisConfig = { input: a.input, out: a.out }
    if (a.invert) out.invert = true
    if (a.curve && a.curve !== 'linear') out.curve = a.curve
    if (a.inner) out.inner = a.inner
    if (a.outer) out.outer = a.outer
    const isDefault =
        Object.keys(out).length === 2 && out.out === defaultAxis(a.input).out
    return isDefault ? null : out
}

function withAxis(j: ConfigJoystick, a: JoystickAxisConfig): ConfigJoystick {
    const rest = (j.axes ?? []).filter((x) => x.input !== a.input)
    const next = minimalAxis(a)
    const axes = (next ? [...rest, next] : rest).sort(
        (p, q) => p.input - q.input,
    )
    return { ...j, axes: axes.length ? axes : undefined }
}

const parseOut = (v: string | undefined): JoystickAxisId | null =>
    v && v in AXIS_LABEL ? (v as JoystickAxisId) : null

type ApplyFor = (
    j: ConfigJoystick,
    e: InputLayoutEntry,
    id: string,
    b: ControlBinding,
    hats: ReadonlyMap<number, number>,
) => ConfigJoystick

const APPLY: Readonly<Record<string, ApplyFor>> = {
    btn: (j, e, _id, b, hats) =>
        withAction(j, e.position, (b as ButtonBinding).a, hats),
    stick: (j, e, id, b, hats) => {
        const s = b as StickBinding
        const [x, y] = stickAxes(j, Number(id.slice(6)))
        const [xo, yo] = s.out.split(':')
        const shape = { curve: s.curve, inner: s.inner, outer: s.outer }
        const both = withAxis(
            withAxis(j, { ...x, ...shape, out: parseOut(xo) }),
            { ...y, ...shape, out: parseOut(yo), invert: s.invY },
        )
        return withAction(both, e.position, s.click, hats)
    },
    hat: (j, e, _id, b, hats) => {
        const h = b as HatBinding
        const dirs = HAT_FIELDS.reduce(
            (acc, f, k) => withAction(acc, e.position + k, h[f], hats),
            j,
        )
        return { ...dirs, hatWays: h.ways === 4 ? 4 : undefined }
    },
}

/** `j` without its undefined fields, or undefined when nothing is left. */
function compact(j: ConfigJoystick): ConfigJoystick | undefined {
    const out = Object.fromEntries(
        Object.entries(j).filter(([, v]) => v !== undefined),
    ) as ConfigJoystick
    return Object.keys(out).length ? out : undefined
}

/** `doc` with control `id` bound to `binding`. Unknown controls are ignored. */
export function applyJoystickBinding(
    doc: ConfigDevice,
    inputs: ReadonlyMap<string, InputLayoutEntry>,
    id: string,
    binding: ControlBinding,
): ConfigDevice {
    const e = inputs.get(id)
    const apply = APPLY[kindOf(id)]
    if (!e || !apply) return doc
    const next = apply(doc.joystick ?? {}, e, id, binding, hatPositions(inputs))
    return { ...doc, joystick: compact(next) }
}

// ---- live input ---------------------------------------------------------------

/** The hat value 0..7 (8 centred) as a direction, y down. */
function hatVector(hat: number): { x: number; y: number } {
    if (hat > 7) return { x: 0, y: 0 }
    const a = (hat * Math.PI) / 4
    return { x: Math.round(Math.sin(a)) || 0, y: -Math.round(Math.cos(a)) || 0 }
}

/** A GET_AXIS_STATE reading as an input frame: a button is down while the
 *  gamepad button it reports is, a stick reads its two inputs' values. */
export function joystickFrame(
    state: AxisState,
    bindings: DeviceBindings,
): ControlInputFrame {
    const pressed = new Set<string>()
    const analog: Record<string, ControlInputFrame['analog'][string]> = {}
    const down = (id: string | null | undefined): boolean => {
        const a = parseActionId(id ?? null)
        return (
            a?.action === 'button' &&
            ((state.buttons >>> (a.button - 1)) & 1) === 1
        )
    }
    for (const [id, b] of Object.entries(bindings)) {
        const kind = kindOf(id)
        if (kind === 'btn' && down((b as ButtonBinding).a)) pressed.add(id)
        if (kind === 'stick') {
            const n = Number(id.slice(6))
            const v = (i: number): number =>
                (state.inputs[i]?.value ?? 0) / FULL
            analog[id] = { x: v(2 * n), y: v(2 * n + 1) }
            if (down((b as StickBinding).click)) pressed.add(id)
        }
        if (kind === 'hat') analog[id] = hatVector(state.hat)
    }
    return { pressed, analog }
}
