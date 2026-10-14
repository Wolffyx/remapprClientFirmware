// Pattern check: Dispatch Map (Tier 0) — applied — class/shape/form → control kind, shape, name and shell are tables keyed by the wire enum, not branches.
//
// GET_INPUT_LAYOUT (INPUT namespace, firmware docs/input-layout-joystick-plan.md
// §2): where every input of a Remappr device sits, read from the device and
// turned into the neutral DeviceModel, so the device editor draws it as built
// instead of a generic arrangement.
import { FORM_KIND } from '../../devices/defaultLayout'
import {
    STOCK_FLIGHTSTICK,
    STOCK_GAMEPAD,
    STOCK_MOUSE,
} from '../../devices/stockLayouts'
import type {
    ControlKind,
    ControlShape,
    DeviceControl,
    DeviceForm,
    DeviceModel,
    DeviceShell,
} from '../../devices/types'
import {
    INPUT_NONE,
    InputVerb,
    Namespace,
    parseInputLayoutPage,
    Status,
    statusName,
    type InputLayoutEntry,
    type InputLayoutPage,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

/** A device's whole input layout, every page read. */
export interface InputLayout {
    /** enum remappr_input_form; 0 = from the personality. */
    readonly form: number
    readonly entries: readonly InputLayoutEntry[]
}

/** The device serves GET_INPUT_LAYOUT: its personality map lists INPUT. Older
 *  firmware never does, so there is no "absent list = served" fallback. */
export function servesInputLayout(
    namespaces: readonly { namespace: number }[] | undefined,
): boolean {
    return !!namespaces?.some((n) => n.namespace === Namespace.INPUT)
}

const u16le = (v: number): Uint8Array =>
    Uint8Array.of(v & 0xff, (v >> 8) & 0xff)

/** One page; a relayed page that lost a fragment is re-read (idempotent). */
async function readPage(
    rpc: RemapprRpc,
    start: number,
    targetNode: number,
): Promise<InputLayoutPage> {
    const attempts = targetNode ? RELAY_READ_RETRIES + 1 : 1
    let lastError: unknown
    for (let i = 0; i < attempts; i++) {
        const reply = await rpc.callUniversalPlain(
            Namespace.INPUT,
            InputVerb.GET_INPUT_LAYOUT,
            u16le(start),
            { targetNode, retries: targetNode ? RELAY_READ_RETRIES : 0 },
        )
        if (reply.status !== Status.OK)
            throw new Error(`GET_INPUT_LAYOUT → ${statusName(reply.status)}`)
        try {
            return parseInputLayoutPage(reply.data)
        } catch (err) {
            lastError = err // truncated: a fragment was lost on the relay
        }
    }
    throw lastError
}

/** The device's layout when it serves one; undefined when it does not, or when
 *  the read fails — the caller then draws its generic layout. A missing layout
 *  is not a reason to refuse the connection. */
export async function readInputLayout(
    rpc: RemapprRpc,
    namespaces: readonly { namespace: number }[] | undefined,
    targetNode = 0,
): Promise<InputLayout | undefined> {
    if (!servesInputLayout(namespaces)) return undefined
    try {
        return await fetchInputLayout(rpc, targetNode)
    } catch {
        return undefined // drawn generic; the device still connects
    }
}

/** Read every page of the device's input layout. `targetNode` addresses a
 *  node behind the dongle. Throws when the device does not serve it. */
export async function fetchInputLayout(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<InputLayout> {
    const entries: InputLayoutEntry[] = []
    let form = 0
    let start = 0
    for (let guard = 0; guard < 512; guard++) {
        const page = await readPage(rpc, start, targetNode)
        form = page.form
        entries.push(...page.entries)
        start = page.start + page.entries.length
        if (page.entries.length === 0 || start >= page.total) break
    }
    return { form, entries }
}

// ---------------------------------------------------------------------------
// Layout → DeviceModel
// ---------------------------------------------------------------------------

/** Per class (enum remappr_input_class, by value): the control kind, the shape
 *  when the device leaves it to the class, and the generic name. */
const CLASSES: readonly {
    kind: ControlKind
    shape: ControlShape
    name: string
}[] = [
    { kind: 'button', shape: 'key', name: 'Key' },
    { kind: 'button', shape: 'round', name: 'Button' },
    { kind: 'encoder', shape: 'knob', name: 'Encoder' },
    { kind: 'wheel', shape: 'wheel', name: 'Wheel' },
    { kind: 'sensor', shape: 'sensor', name: 'Sensor' },
    { kind: 'stick', shape: 'stick', name: 'Stick' },
    { kind: 'trigger', shape: 'trigger', name: 'Trigger' },
    { kind: 'hat', shape: 'hat', name: 'Hat' },
    { kind: 'axis', shape: 'ring', name: 'Axis' },
    { kind: 'axis', shape: 'pill', name: 'Slider' },
]

/** enum remappr_input_shape by value; 0 (auto) = the class default. */
const SHAPES: readonly (ControlShape | null)[] = [
    null,
    'key',
    'round',
    'pill',
    'stick',
    'dpad',
    'hat',
    'trigger',
    'triggerSide',
    'wheel',
    'ring',
    'knob',
    'sensor',
    'mouseL',
    'mouseR',
]

/** enum remappr_input_form by value; 0 = from the personality. */
const FORMS: readonly (DeviceForm | null)[] = [
    null,
    'keyboard',
    'macropad',
    'mouse',
    'gamepad',
    'flightstick',
]

const PLATE: DeviceShell = { type: 'plate', pad: 0.3 }
const SHELLS: Readonly<Record<DeviceForm, DeviceShell>> = {
    keyboard: PLATE,
    macropad: PLATE,
    mouse: STOCK_MOUSE.shell,
    gamepad: STOCK_GAMEPAD.shell,
    flightstick: STOCK_FLIGHTSTICK.shell,
}

/** A personality's own id and name for an input, so controls keep the ids its
 *  bindings already use. */
export interface InputNaming {
    readonly id: string
    readonly name: string
    readonly glyph?: string
}

export interface InputModelOptions {
    readonly name: string
    /** The form when the device leaves it to the personality (form 0). */
    readonly fallbackForm: DeviceForm
    /** Ids/names for inputs the personality knows; undefined = generic. */
    readonly naming?: (entry: InputLayoutEntry) => InputNaming | undefined
}

const U = 100 // centi-units per key unit
const round = (v: number): number => Math.round(v * 1e4) / 1e4

/** Key-unit geometry. The device rotates about a pivot; a control rotates
 *  about its own centre, so the centre moves to where the pivot turn puts it. */
function placement(
    e: InputLayoutEntry,
): Pick<DeviceControl, 'x' | 'y' | 'w' | 'h' | 'r'> {
    const w = (e.w || U) / U
    const h = (e.h || U) / U
    if (e.rot === 0) return { x: e.x / U, y: e.y / U, w, h }
    const deg = e.rot / 100
    const a = (deg * Math.PI) / 180
    const px = e.rotx / U
    const py = e.roty / U
    const dx = e.x / U + w / 2 - px
    const dy = e.y / U + h / 2 - py
    // Clockwise on a y-down canvas.
    const cx = px + dx * Math.cos(a) - dy * Math.sin(a)
    const cy = py + dx * Math.sin(a) + dy * Math.cos(a)
    return { x: round(cx - w / 2), y: round(cy - h / 2), w, h, r: deg }
}

/** The generic id: the device's stable input id, else its position. */
function genericId(e: InputLayoutEntry, index: number): string {
    if (e.inputId !== INPUT_NONE) return `in:${e.inputId}`
    if (e.position !== INPUT_NONE) return `pos:${e.position}`
    return `idx:${index}`
}

/** The device's input layout as a DeviceModel (not defaulted). Inputs of a
 *  class this client does not know are left out. */
export function inputLayoutModel(
    layout: InputLayout,
    opts: InputModelOptions,
): DeviceModel {
    const form = FORMS[layout.form] ?? opts.fallbackForm
    const known = layout.entries.filter((e) => CLASSES[e.cls])
    const perClass = new Map<number, number>()
    for (const e of known) perClass.set(e.cls, (perClass.get(e.cls) ?? 0) + 1)

    const seen = new Map<number, number>()
    const ids = new Set<string>()
    const controls = known.map((e, i): DeviceControl => {
        const cls = CLASSES[e.cls]!
        const ordinal = seen.get(e.cls) ?? 0
        seen.set(e.cls, ordinal + 1)
        const own = opts.naming?.(e)
        const named = own && !ids.has(own.id) ? own : undefined
        const id = named?.id ?? genericId(e, i)
        ids.add(id)
        const single = (perClass.get(e.cls) ?? 0) === 1
        return {
            id,
            name:
                named?.name ??
                (single ? cls.name : `${cls.name} ${ordinal + 1}`),
            kind: cls.kind,
            shape: SHAPES[e.shape] ?? cls.shape,
            ...placement(e),
            ...(named?.glyph ? { glyph: named.glyph } : {}),
        }
    })
    return {
        kind: FORM_KIND[form],
        form,
        name: opts.name,
        shell: SHELLS[form],
        controls,
    }
}
