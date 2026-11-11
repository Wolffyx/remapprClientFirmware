// Pattern check: Dispatch Map (Tier 0) — applied — action kind → reader/writer maps for gamepad actions; axis/curve name↔code tables.
//
// Joystick settings (`joystick` in a device document) <-> TBL_JOYSTICK (id 28)
// and its button actions <-> TBL_ACTION_BINDING (id 17, GAMEPAD_* kinds).
// Only what differs from the defaults is written and read back, so a decode ->
// encode round trip is byte-identical. Byte layout mirrors firmware
// include/remappr/config_blob.h (TBL_JOYSTICK, TBL_ACTION_BINDING) and
// action.h (input-layout plan §4).
//
// Firmware with AXES parts (docs/part-wire-v1.md §4) keeps each input's
// shaping (invert, radial, curve, deadzones) as the part's per-channel
// settings: TBL_JOYSTICK v2 then carries the report axes only and TBL_PART
// the shaping. Without the device's part list the v1 table carries both;
// that firmware still reads it for one release.
import {
    ANALOG_CLASS,
    AXIS_SETTING_IDS,
    type AxesChannel,
    type AxesLayout,
    type AxisField,
    axesLayout,
} from '../../../clients/remappr/axesLayout'
import { JOYSTICK_POSITIONS } from '../../schema'
import type {
    ConfigJoystick,
    JoystickAxisConfig,
    JoystickAxisId,
    JoystickButtonAction,
    JoystickCurve,
} from '../../types'
import {
    ACT_GAMEPAD_AXIS,
    ACT_GAMEPAD_BUTTON,
    ACT_GAMEPAD_HAT,
    ACT_NONE,
    ACT_SYSTEM,
    type ActionBindingRecord,
    JOY_AXIS_OFF,
    JOY_FLAG_INVERT,
    JOY_FLAG_RADIAL,
    JOYSTICK_TBL_AXIS_LEN,
    JOYSTICK_TBL_AXIS_LEN_V2,
    JOYSTICK_TBL_HDR_LEN,
    type JoystickTable,
    type SensorTableEntry,
    SystemAction,
} from './blobWriter'
import { ByteReader, type TableFrame } from './decode'

export const JOYSTICK_AXIS_IDS: readonly JoystickAxisId[] = [
    'x',
    'y',
    'z',
    'rx',
    'ry',
    'rz',
]
const CURVES: readonly JoystickCurve[] = [
    'linear',
    'aggressive',
    'relaxed',
    'precise',
]

/** The binding positions a joystick takes (TBL_ACTION_BINDING num_positions). */
export const JOYSTICK_ACTION_POSITIONS = JOYSTICK_POSITIONS

const axisCode = (out: JoystickAxisId | null): number =>
    out === null ? JOY_AXIS_OFF : JOYSTICK_AXIS_IDS.indexOf(out)

/** Settings -> TBL_JOYSTICK record, or undefined when they set nothing. */
export function joystickRecord(j: ConfigJoystick): JoystickTable | undefined {
    const axes = j.axes ?? []
    if (j.hatWays === undefined && axes.length === 0) return undefined
    return {
        hatWays: j.hatWays ?? 0,
        axes: axes.map((a) => ({
            input: a.input,
            out: axisCode(a.out),
            flags:
                (a.invert ? JOY_FLAG_INVERT : 0) |
                (a.radial ? JOY_FLAG_RADIAL : 0),
            curve: CURVES.indexOf(a.curve ?? 'linear'),
            inner: a.inner ?? 0,
            outer: a.outer ?? 0,
        })),
    }
}

/** A joystick's settings as tables: TBL_JOYSTICK, and the TBL_PART entries
 *  that hold its inputs' shaping (none for a v1 table). */
export interface JoystickTables {
    table?: JoystickTable
    parts: SensorTableEntry[]
}

/** Input `a`'s whole shaping as AXES part settings (an input the table names
 *  takes its shaping from the config alone, as a v1 entry did). */
function shapingEntries(
    a: JoystickAxisConfig,
    at: AxesChannel,
): SensorTableEntry[] {
    const values: Record<AxisField, number> = {
        invert: a.invert ? 1 : 0,
        radial: a.radial ? 1 : 0,
        curve: CURVES.indexOf(a.curve ?? 'linear'),
        inner: a.inner ?? 0,
        outer: a.outer ?? 0,
    }
    return (Object.keys(values) as AxisField[]).map((f) => ({
        sensor: at.part,
        id: AXIS_SETTING_IDS[f],
        ch: at.ch,
        value: values[f],
    }))
}

/**
 * Settings -> TBL_JOYSTICK and the shaping's TBL_PART entries. With `axes`
 * (the device's AXES parts) and every configured input among them, a v2 table
 * plus part entries; otherwise the v1 table alone.
 */
export function joystickTables(
    j: ConfigJoystick,
    axes?: AxesLayout,
): JoystickTables {
    const v1 = joystickRecord(j)
    if (!v1) return { parts: [] }
    const at = axes ? v1.axes.map((a) => axes.locate(a.input)) : []
    if (!axes || at.some((x) => !x)) return { table: v1, parts: [] }
    return {
        table: { ...v1, version: 2 },
        parts: (j.axes ?? []).flatMap((a, i) => shapingEntries(a, at[i]!)),
    }
}

function readAxis(r: ByteReader): JoystickAxisConfig {
    const input = r.u8()
    const out = r.u8()
    const flags = r.u8()
    const curve = r.u8()
    const inner = r.u8()
    const outer = r.u8()
    r.u16() // reserved
    const a: JoystickAxisConfig = {
        input,
        out: JOYSTICK_AXIS_IDS[out] ?? null,
    }
    if (flags & JOY_FLAG_INVERT) a.invert = true
    if (flags & JOY_FLAG_RADIAL) a.radial = true
    if (curve) a.curve = CURVES[curve] ?? 'linear'
    if (inner) a.inner = inner
    if (outer) a.outer = outer
    return a
}

/** A v2 entry: the input and its report axis. */
function readAxisV2(r: ByteReader): JoystickAxisConfig {
    const input = r.u8()
    return { input, out: JOYSTICK_AXIS_IDS[r.u8()] ?? null }
}

/**
 * TBL_JOYSTICK payload in [start, end) (table `version` 1 or 2) -> settings,
 * keeping only what differs from the defaults. A v2 table names the report
 * axes only (withAxisParts adds the shaping). Returns an error message for a
 * frame too short for its count.
 */
export function readJoystickTable(
    bytes: Uint8Array,
    start: number,
    end: number,
    version = 1,
): ConfigJoystick | string {
    if (end - start < JOYSTICK_TBL_HDR_LEN)
        return 'joystick table header truncated'
    const r = new ByteReader(bytes)
    r.seek(start)
    const hatWays = r.u8()
    const count = r.u8()
    const len = version === 2 ? JOYSTICK_TBL_AXIS_LEN_V2 : JOYSTICK_TBL_AXIS_LEN
    if (start + JOYSTICK_TBL_HDR_LEN + count * len > end) {
        return 'joystick table truncated'
    }
    const out: ConfigJoystick = {}
    if (hatWays === 4 || hatWays === 8) out.hatWays = hatWays
    const read = version === 2 ? readAxisV2 : readAxis
    const axes = Array.from({ length: count }, () => read(r))
    if (axes.length) out.axes = axes
    return out
}

/** The setting each axis-shaping registry id holds. */
const FIELD_BY_ID: ReadonlyMap<number, AxisField> = new Map(
    (Object.entries(AXIS_SETTING_IDS) as [AxisField, number][]).map(
        ([f, id]) => [id, f],
    ),
)

/** A shaping value onto an input's settings, when it differs from the
 *  default (as readAxis keeps a v1 entry's). */
const PUT_FIELD: {
    readonly [F in AxisField]: (a: JoystickAxisConfig, v: number) => void
} = {
    invert: (a, v) => {
        if (v) a.invert = true
    },
    radial: (a, v) => {
        if (v) a.radial = true
    },
    curve: (a, v) => {
        if (v) a.curve = CURVES[v] ?? 'linear'
    },
    inner: (a, v) => {
        if (v) a.inner = v
    },
    outer: (a, v) => {
        if (v) a.outer = v
    },
}

/** Where the entries' parts put their channels when the device's own layout
 *  is not at hand: each part as many channels as its highest one names (one
 *  part, the usual joystick, is then exact). */
function layoutOfEntries(
    entries: readonly SensorTableEntry[],
): AxesLayout | undefined {
    const channels = new Map<number, number>()
    for (const e of entries) {
        const n = Math.max(channels.get(e.sensor) ?? 0, (e.ch ?? 0) + 1)
        channels.set(e.sensor, n)
    }
    return axesLayout(
        [...channels].map(([index, n]) => ({
            index,
            cls: ANALOG_CLASS,
            channels: n,
        })),
    )
}

/**
 * A v2 table's settings with the shaping the TBL_PART `entries` hold for the
 * inputs it names (`axes`: the device's AXES parts, else inferred from the
 * entries). Entries of any other setting, or for an input the table does not
 * name, are left out.
 */
export function withAxisParts(
    j: ConfigJoystick,
    entries: readonly SensorTableEntry[],
    axes?: AxesLayout,
): ConfigJoystick {
    const shaping = entries.filter((e) => FIELD_BY_ID.has(e.id))
    const layout = axes ?? layoutOfEntries(shaping)
    if (!j.axes || !layout || shaping.length === 0) return j
    const out = j.axes.map((a) => ({ ...a }))
    for (const e of shaping) {
        const input = layout.inputOf(e.sensor, e.ch ?? 0)
        const a = out.find((x) => x.input === input)
        if (a) PUT_FIELD[FIELD_BY_ID.get(e.id)!](a, e.value)
    }
    return { ...j, axes: out }
}

// ---------------------------------------------------------------------------
// Button actions <-> TBL_ACTION_BINDING (a joystick device blob)
// ---------------------------------------------------------------------------

type Wire = Pick<ActionBindingRecord, 'kind' | 'code' | 'arg0'>

const TO_WIRE: {
    [K in JoystickButtonAction['action']]: (
        a: Extract<JoystickButtonAction, { action: K }>,
    ) => Wire
} = {
    none: () => ({ kind: ACT_NONE, code: 0, arg0: 0 }),
    button: (a) => ({ kind: ACT_GAMEPAD_BUTTON, code: a.button, arg0: 0 }),
    hat: (a) => ({ kind: ACT_GAMEPAD_HAT, code: a.dir, arg0: 0 }),
    axis: (a) => ({
        kind: ACT_GAMEPAD_AXIS,
        code: JOYSTICK_AXIS_IDS.indexOf(a.axis),
        arg0: a.value & 0xffff,
    }),
    batteryShow: () => ({
        kind: ACT_SYSTEM,
        code: SystemAction.battery_show,
        arg0: 0,
    }),
    unpair: () => ({ kind: ACT_SYSTEM, code: SystemAction.unpair, arg0: 0 }),
}

function toWire(a: JoystickButtonAction): Wire {
    return (TO_WIRE[a.action] as (x: JoystickButtonAction) => Wire)(a)
}

/** The button actions as TBL_ACTION_BINDING records (none = no table). */
export function joystickActionRecords(
    j: ConfigJoystick,
): ActionBindingRecord[] {
    return (j.buttonActions ?? []).flatMap((a, position) =>
        a ? [{ position, ...toWire(a), arg1: 0 }] : [],
    )
}

/** The SYSTEM verbs a joystick button binds, by their code. */
const SYSTEM_FROM_WIRE: Readonly<Record<number, JoystickButtonAction>> = {
    [SystemAction.battery_show]: { action: 'batteryShow' },
    [SystemAction.unpair]: { action: 'unpair' },
}

const FROM_WIRE: Readonly<
    Record<number, (code: number, arg0: number) => JoystickButtonAction | null>
> = {
    [ACT_NONE]: () => ({ action: 'none' }),
    [ACT_GAMEPAD_BUTTON]: (code) =>
        code >= 1 && code <= 32 ? { action: 'button', button: code } : null,
    [ACT_GAMEPAD_HAT]: (code) =>
        code <= 7 ? { action: 'hat', dir: code } : null,
    [ACT_GAMEPAD_AXIS]: (code, arg0) => {
        const axis = JOYSTICK_AXIS_IDS[code]
        const value = arg0 >= 0x8000 ? arg0 - 0x10000 : arg0
        return axis ? { action: 'axis', axis, value } : null
    },
    [ACT_SYSTEM]: (code) => SYSTEM_FROM_WIRE[code] ?? null,
}

/**
 * TBL_ACTION_BINDING of a joystick blob -> its button actions by position, or
 * undefined when it binds none this client knows (a record of another kind or
 * past the positions is left out). Returns an error message for a frame too
 * short for its count.
 */
export function readJoystickActions(
    bytes: Uint8Array,
    t: TableFrame,
): ConfigJoystick['buttonActions'] | string {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    r.u16() // num_positions
    if (t.start + 4 + count * 10 > t.end) return 'action table truncated'
    const out: Array<JoystickButtonAction | null> = []
    for (let i = 0; i < count; i++) {
        const position = r.u16()
        const kind = r.u8()
        r.u8() // reserved
        const code = r.u16()
        const arg0 = r.u16()
        r.u16() // arg1
        const action = FROM_WIRE[kind]?.(code, arg0)
        if (!action || position >= JOYSTICK_ACTION_POSITIONS) continue
        while (out.length < position) out.push(null)
        out[position] = action
    }
    return out.some(Boolean) ? out : undefined
}
