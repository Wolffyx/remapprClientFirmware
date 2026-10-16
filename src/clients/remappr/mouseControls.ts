// Pattern check: Adapter (Tier 1) — applied — translates the Remappr mouse's device document (TBL_MOUSE button map, CPI) and live MOUSE / rate state into the neutral device-controls model, and edits back.
//
// What the Remappr mouse firmware lets the app change, as controls:
// - eight HID buttons, each re-mappable to report as another button or
//   nothing (TBL_MOUSE `button_map`), or bound to a DPI action instead — DPI
//   cycle / up / down or a held sniper DPI (TBL_ACTION_BINDING, kind DEVICE;
//   input-layout plan §3); button 3 (Middle) is the wheel click;
// - the sensor resolution: up to five DPI stages the DPI buttons step through
//   (TBL_MOUSE v3), or one (`cpi`);
// - the report rate, only when the firmware answers GET_RATE_LIMITS;
// - the sensor's own settings (lift-off, angle snap, …), exactly the ones its
//   sensor describes (SENSOR namespace), in the document's `sensor` section
//   (TBL_SENSOR).
// Where the controls sit comes from the mouse itself (GET_INPUT_LAYOUT) when
// its firmware reports it; otherwise the layout is the generic mouse layout.
import type { ConfigDevice, ConfigDeviceSensor } from '../../config/device'
import type { ConfigMouse, MouseButtonAction } from '../../config/types'
import { MOUSE_BUTTON_NAMES } from '../../config/deviceFields'
import { defaultLayout } from '../../devices/defaultLayout'
import type {
    ButtonBinding,
    ControlBinding,
    ControlsCatalog,
    DeviceAction,
    DeviceBindings,
    DeviceModel,
    SensorBinding,
    SensorInfo,
    SensorSettingValue,
    SensorSpec,
    WheelBinding,
} from '../../devices/types'
import {
    inputLayoutModel,
    type InputLayout,
    type InputNaming,
} from './inputLayout'
import {
    HwCap,
    InputClass,
    reportsHwCap,
    type InputLayoutEntry,
    type MotionConfig,
    type RateLimits,
} from './protocol'
import { sensorWireValue } from './sensorRegistry'

/** Control id → HID button index (bit of the button report). */
export const BUTTON_INDEX: Readonly<Record<string, number>> = {
    lmb: 0,
    rmb: 1,
    wheel: 2,
    back: 3,
    fwd: 4,
    btn5: 5,
    btn6: 6,
    btn7: 7,
}

const ACTION_PREFIX = 'btn:'
const actionOf = (i: number | null | undefined): string | null =>
    i == null ? null : `${ACTION_PREFIX}${i}`
const indexOf = (a: string | null | undefined): number | null =>
    a?.startsWith(ACTION_PREFIX) ? Number(a.slice(ACTION_PREFIX.length)) : null

const ACTION_LABELS = [
    'Left click',
    'Right click',
    'Middle click',
    ...MOUSE_BUTTON_NAMES.slice(3),
]

// DPI actions (kind DEVICE): `dev:<action>` or `dev:<action>:<dpi>`.
const DEV_PREFIX = 'dev:'
const DEV_LABELS: Readonly<
    Record<MouseButtonAction['action'], (dpi?: number) => string>
> = {
    dpiCycle: () => 'DPI cycle',
    dpiUp: () => 'DPI up',
    dpiDown: () => 'DPI down',
    dpiSet: (dpi) => `DPI ${dpi}`,
    sniper: (dpi) => `Sniper ${dpi} DPI (hold)`,
}
const STEPS: readonly MouseButtonAction[] = [
    { action: 'dpiCycle' },
    { action: 'dpiUp' },
    { action: 'dpiDown' },
]
/** Sniper DPIs offered, where the sensor can do them. */
const SNIPER_PRESETS = [200, 400, 800]
/** DPI stages the firmware keeps (TBL_MOUSE v3). */
const MAX_DPI_STAGES = 5

const devId = (a: MouseButtonAction): string =>
    `${DEV_PREFIX}${a.action}${a.dpi ? `:${a.dpi}` : ''}`

/** A catalog id back to the button action, or null for any other id. */
function devAction(id: string | null | undefined): MouseButtonAction | null {
    if (!id?.startsWith(DEV_PREFIX)) return null
    const [action, dpi] = id.slice(DEV_PREFIX.length).split(':')
    if (!(action! in DEV_LABELS)) return null
    const a = action as MouseButtonAction['action']
    return dpi ? { action: a, dpi: Number(dpi) } : { action: a }
}

/** The DPI actions to offer: the steps, the sniper presets in range, and any
 *  the document already binds (so a bound value always has a label). */
function dpiActions(
    min: number,
    max: number,
    mouse: ConfigMouse | undefined,
): DeviceAction[] {
    const sniper = SNIPER_PRESETS.filter((d) => d >= min && d <= max).map(
        (dpi): MouseButtonAction => ({ action: 'sniper', dpi }),
    )
    const bound = (mouse?.buttonActions ?? []).filter(
        (a): a is MouseButtonAction => !!a,
    )
    const byId = new Map(
        [...STEPS, ...sniper, ...bound].map((a) => [devId(a), a] as const),
    )
    return [...byId].map(([id, a]) => ({
        id,
        label: DEV_LABELS[a.action](a.dpi),
        group: 'dpi',
        category: 'mouse' as const,
    }))
}

/** HID button index → control id. */
const ID_BY_INDEX: Readonly<Record<number, string>> = Object.fromEntries(
    Object.entries(BUTTON_INDEX).map(([id, i]) => [i, id]),
)
const GLYPHS: Readonly<Record<string, string>> = { lmb: 'L', rmb: 'R' }

/** The ids the mouse's bindings use, for the inputs it reports: a button by
 *  its HID index, the wheel and the sensor. Anything else keeps a generic id. */
export function mouseInputNaming(e: InputLayoutEntry): InputNaming | undefined {
    if (e.cls === InputClass.WHEEL) return { id: 'wheel', name: 'Scroll wheel' }
    if (e.cls === InputClass.SENSOR) return { id: 'sensor', name: 'Sensor' }
    if (e.cls !== InputClass.BUTTON) return undefined
    const id = ID_BY_INDEX[e.position]
    // The middle button's id is the wheel's (its click); a bare one stays generic.
    if (!id || id === 'wheel') return undefined
    const label = MOUSE_BUTTON_NAMES[e.position]!
    const glyph = GLYPHS[id]
    return {
        id,
        name: e.position < 5 ? `${label} button` : label,
        ...(glyph ? { glyph } : {}),
    }
}

/** The mouse as controls. Drawn as it reports itself (`layout`, from
 *  GET_INPUT_LAYOUT) when it does; otherwise eight buttons (the middle one is
 *  the wheel), and the sensor unless the device reports it has no pointer
 *  (`hwCaps`, GET_PERSONALITY_MAP; 0 / absent = not reported, keep it). */
export function mouseModel(
    name: string,
    hwCaps?: number,
    layout?: InputLayout,
): DeviceModel {
    if (layout?.entries.length) {
        return inputLayoutModel(layout, {
            name,
            fallbackForm: 'mouse',
            naming: mouseInputNaming,
        })
    }
    return defaultLayout('mouse', name, {
        buttons: 8,
        wheel: true,
        sensor: reportsHwCap(hwCaps, HwCap.POINTER) ?? true,
    })
}

/** The sensor that moves the pointer: the first of class pointer, else the
 *  first the device has. */
export function pointerSensor(
    sensors: readonly SensorInfo[] | null | undefined,
): SensorInfo | null {
    return sensors?.find((s) => s.cls === 'pointer') ?? sensors?.[0] ?? null
}

/** What the sensor describes, for the catalog: its own settings (the DPI and
 *  rate it takes from the mouse are not among them), procedures, readings,
 *  and its index. */
function sensorSpecParts(
    sensor: SensorInfo | null | undefined,
): Pick<SensorSpec, 'settings' | 'procedures' | 'metrics' | 'index'> {
    const settings = (sensor?.settings ?? [])
        .filter((s) => !s.personality)
        .map(({ value: _value, personality: _p, ...spec }) => spec)
    return {
        settings,
        procedures: sensor?.procedures ?? [],
        metrics: sensor?.metrics ?? [],
        ...(sensor ? { index: sensor.index } : {}),
    }
}

/** What the mouse can be set to: report-as-button actions, DPI actions, the
 *  CPI range and what its sensor describes. `mouse` is the document, for the
 *  DPI values it binds. */
export function mouseCatalog(
    motion: MotionConfig | null,
    rates: RateLimits | null,
    mouse?: ConfigMouse,
    sensor?: SensorInfo | null,
): ControlsCatalog {
    const poll = rates && rates.supported.length > 0
    const dpiMin = motion?.dpiMin || 100
    const dpiMax = motion?.dpiMax || 26000
    const parts = sensorSpecParts(sensor)
    return {
        groups: [
            { id: 'mouse', label: 'Mouse buttons', category: 'mouse' },
            { id: 'dpi', label: 'DPI', category: 'mouse' },
        ],
        actions: [
            ...ACTION_LABELS.map((label, i) => ({
                id: `${ACTION_PREFIX}${i}`,
                label,
                group: 'mouse',
                category: 'mouse' as const,
            })),
            ...dpiActions(dpiMin, dpiMax, mouse),
        ],
        outputs: {},
        fields: {
            button: ['a'],
            wheel: ['click'],
            sensor: [
                'stages',
                ...(poll ? (['poll'] as const) : []),
                ...(parts.settings.length ? (['settings'] as const) : []),
            ],
        },
        sensor: {
            dpiMin,
            dpiMax,
            dpiStep: motion?.dpiStep || 100,
            maxStages: MAX_DPI_STAGES,
            pollRates: poll ? rates.supported : [],
            ...parts,
        },
    }
}

/** The document's sensor values as a binding's: an option name becomes its
 *  code; one the registry cannot resolve is left out (the document keeps it). */
export function sensorBindingSettings(
    sensor: ConfigDeviceSensor | undefined,
): Record<string, SensorSettingValue> {
    const out: Record<string, SensorSettingValue> = {}
    for (const [key, v] of Object.entries(sensor?.settings ?? {})) {
        if (typeof v !== 'string') {
            out[key] = v
            continue
        }
        const code = sensorWireValue(key, v)
        if (code !== undefined) out[key] = code
    }
    return out
}

/** What physical button `i` reports as (identity when the map is unset). */
function mappedTo(mouse: ConfigMouse | undefined, i: number): number | null {
    const map = mouse?.buttonMap
    if (!map) return i
    const v = map[i]
    return v === undefined ? i : v
}

/** Button `i`'s action id: its DPI action, else the button it reports as. */
function buttonAction(
    mouse: ConfigMouse | undefined,
    i: number,
): string | null {
    const dev = mouse?.buttonActions?.[i]
    return dev ? devId(dev) : actionOf(mappedTo(mouse, i))
}

/** The document's mouse and sensor sections as control bindings. */
export function mouseBindings(
    mouse: ConfigMouse | undefined,
    motion: MotionConfig | null,
    rates: RateLimits | null,
    sensor?: ConfigDeviceSensor,
): DeviceBindings {
    const out: Record<string, ControlBinding> = {}
    for (const [id, i] of Object.entries(BUTTON_INDEX)) {
        if (id === 'wheel') continue
        out[id] = { a: buttonAction(mouse, i) } satisfies ButtonBinding
    }
    out.wheel = {
        up: null,
        down: null,
        click: buttonAction(mouse, BUTTON_INDEX.wheel!),
        tl: null,
        tr: null,
        lines: mouse?.scrollDivisor ?? 1,
        smooth: false,
        freeSpin: false,
    } satisfies WheelBinding
    out.sensor = {
        stages: mouse?.dpiStages ?? [mouse?.cpi ?? motion?.dpi ?? 800],
        active: mouse?.dpiStages ? (mouse.dpiStage ?? 0) : 0,
        poll: rates?.currentHz ?? 1000,
        settings: sensorBindingSettings(sensor),
    } satisfies SensorBinding
    return out
}

const IDENTITY = [0, 1, 2, 3, 4, 5, 6, 7]

/** `map` with button `i` reporting as `to`; dropped when it is the identity. */
function remap(
    map: ConfigMouse['buttonMap'],
    i: number,
    to: number | null,
): ConfigMouse['buttonMap'] {
    const next = [...(map ?? IDENTITY)]
    next[i] = to
    return next.every((v, j) => v === IDENTITY[j]) ? undefined : next
}

/** `mouse` without its undefined fields (the document stays minimal). */
function compact(mouse: ConfigMouse): ConfigMouse | undefined {
    const out = Object.fromEntries(
        Object.entries(mouse).filter(([, v]) => v !== undefined),
    ) as ConfigMouse
    return Object.keys(out).length ? out : undefined
}

/** `list` with button `i`'s action set (null = none); dropped when empty. */
function withAction(
    list: ConfigMouse['buttonActions'],
    i: number,
    a: MouseButtonAction | null,
): ConfigMouse['buttonActions'] {
    const next = [...(list ?? IDENTITY.map(() => null))]
    next[i] = a
    return next.some(Boolean) ? next : undefined
}

/** One stage is plain `cpi`; more are the DPI stages (TBL_MOUSE v3). */
function sensorFields(b: SensorBinding): Partial<ConfigMouse> {
    const stages = b.stages.slice(0, MAX_DPI_STAGES)
    if (stages.length <= 1) {
        return { cpi: stages[0], dpiStages: undefined, dpiStage: undefined }
    }
    const stage = Math.min(Math.max(b.active, 0), stages.length - 1)
    return {
        cpi: undefined,
        dpiStages: [...stages],
        dpiStage: stage || undefined,
    }
}

/** The binding's sensor values as the document's section: `index` names the
 *  sensor (left out for the first); no values, no section. A setting the
 *  binding does not name but the document does (one the device does not
 *  describe, so the editor never showed it) is kept. */
function sensorSection(
    prev: ConfigDeviceSensor | undefined,
    settings: SensorBinding['settings'],
    index: number,
    shown: ReadonlySet<string> | undefined,
): ConfigDeviceSensor | undefined {
    const kept = Object.entries(prev?.settings ?? {}).filter(
        ([k]) => shown !== undefined && !shown.has(k),
    )
    const all = { ...Object.fromEntries(kept), ...settings }
    if (Object.keys(all).length === 0) return undefined
    return index ? { index, settings: all } : { settings: all }
}

/** `doc` with control `id` bound to `binding`. Unknown controls are ignored.
 *  A DPI action leaves the button's map entry at the identity, so removing
 *  the action later gives the button back. `sensor` is the sensor the
 *  binding's settings belong to (its index and the settings it describes). */
export function applyMouseBinding(
    doc: ConfigDevice,
    id: string,
    binding: ControlBinding,
    sensor?: SensorInfo | null,
): ConfigDevice {
    const withMouse = (mouse: ConfigMouse): ConfigDevice => ({
        ...doc,
        mouse: compact(mouse),
    })
    if (id === 'sensor') {
        const b = binding as SensorBinding
        const shown = sensor
            ? new Set(sensor.settings.map((s) => s.name))
            : undefined
        const { sensor: _prev, ...rest } = withMouse({
            ...doc.mouse,
            ...sensorFields(b),
        })
        const section = sensorSection(
            doc.sensor,
            b.settings ?? {},
            sensor?.index ?? doc.sensor?.index ?? 0,
            shown,
        )
        return section ? { ...rest, sensor: section } : rest
    }
    const i = BUTTON_INDEX[id]
    if (i === undefined) return doc
    const a =
        id === 'wheel'
            ? (binding as WheelBinding).click
            : (binding as ButtonBinding).a
    const dev = devAction(a)
    return withMouse({
        ...doc.mouse,
        buttonActions: withAction(doc.mouse?.buttonActions, i, dev),
        buttonMap: remap(doc.mouse?.buttonMap, i, dev ? i : indexOf(a)),
    })
}
