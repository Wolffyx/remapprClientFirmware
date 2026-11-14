// Pattern check: Dispatch Map (Tier 0) — applied — action kind → reader/writer maps for gamepad actions; axis/curve name↔code tables.
//
// Joystick settings (`joystick` in a device document) <-> TBL_JOYSTICK (id 28)
// and its button actions <-> TBL_ACTION_BINDING (id 17, GAMEPAD_* kinds).
// Only what differs from the defaults is read back. Byte layout mirrors firmware
// include/remappr/config_blob.h (TBL_JOYSTICK, TBL_PART, TBL_ACTION_BINDING) and
// action.h (input-layout plan §4).
//
// TBL_JOYSTICK v2 holds what an input means (its report axis) and the hat; how
// the input is read (invert, radial, curve, deadzones) is its AXES part's, in
// TBL_PART on that part's channel (docs/part-wire-v1.md §4). Which part and
// channel an input is comes from the device's own part list: inputs are
// numbered across the AXES parts in part order, each part's channels in turn
// (firmware remappr_axes_locate). Without that list the compiler writes v1,
// which the firmware still reads for one release.
import { sensorSettingKey } from '../../../clients/remappr/sensorRegistry'
import type { SensorInfo } from '../../../devices/types'
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
    type JoystickTableV2,
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

/** AXES part settings (dt-bindings/remappr/sensor.h REMAPPR_SENSOR_*). */
export const AxisSetting = {
    invert: 0x40,
    radial: 0x41,
    curve: 0x42,
    inner: 0x43,
    outer: 0x44,
} as const
const AXIS_SETTING_IDS: ReadonlySet<number> = new Set(Object.values(AxisSetting))

/** Whether TBL_PART setting `id` is an axis's shaping (the joystick's own). */
export const isAxisSetting = (id: number): boolean => AXIS_SETTING_IDS.has(id)

/** Where an analog input sits: its AXES part and the channel on it. */
export interface AxisPlace {
    part: number
    ch: number
}

/** The device's AXES parts (class analog) in part order, as input ranges. */
function axesRanges(
    sensors: readonly SensorInfo[],
): Array<{ part: number; first: number; count: number }> {
    let first = 0
    return [...sensors]
        .filter((s) => s.cls === 'analog')
        .sort((a, b) => a.index - b.index)
        .map((s) => {
            const range = { part: s.index, first, count: s.channels }
            first += s.channels
            return range
        })
}

/** Input -> its place, from the device's parts. undefined = no AXES part has it. */
export function axisPlaceOf(
    sensors: readonly SensorInfo[],
    input: number,
): AxisPlace | undefined {
    const r = axesRanges(sensors).find(
        (x) => input >= x.first && input < x.first + x.count,
    )
    return r ? { part: r.part, ch: input - r.first } : undefined
}

/** Place -> its input, from the device's parts; without them, a single AXES
 *  part is assumed (input = channel). */
function inputAt(
    place: AxisPlace,
    sensors: readonly SensorInfo[] | undefined,
): number | undefined {
    if (!sensors) return place.ch
    const r = axesRanges(sensors).find((x) => x.part === place.part)
    return r && place.ch < r.count ? r.first + place.ch : undefined
}

/** The five shaping settings of one input, as TBL_PART entries on its place.
 *  All five are written, so a board default never shows through a setting the
 *  document holds (the same set the firmware derives from a v1 entry), except
 *  one the part does not list while the document leaves it at its default:
 *  the device refuses a whole config over a setting its part lacks. */
function shapingEntries(
    a: JoystickAxisConfig,
    at: AxisPlace,
    sensors: readonly SensorInfo[],
): SensorTableEntry[] {
    const values: [number, number][] = [
        [AxisSetting.invert, a.invert ? 1 : 0],
        [AxisSetting.radial, a.radial ? 1 : 0],
        [AxisSetting.curve, CURVES.indexOf(a.curve ?? 'linear')],
        [AxisSetting.inner, a.inner ?? 0],
        [AxisSetting.outer, a.outer ?? 0],
    ]
    const listed = new Set(
        sensors.find((x) => x.index === at.part)?.settings.map((x) => x.name),
    )
    return values
        .filter(([id, value]) => value !== 0 || listed.has(sensorSettingKey(id)))
        .map(([id, value]) => ({ sensor: at.part, id, ch: at.ch, value }))
}

/** What a joystick document compiles to: a TBL_JOYSTICK v2 and its shaping
 *  as TBL_PART entries, or (without the device's parts) a legacy v1 table. */
export type JoystickRecords =
    | { version: 2; table: JoystickTableV2; parts: SensorTableEntry[] }
    | { version: 1; table: JoystickTable; parts: [] }

function legacyRecord(j: ConfigJoystick): JoystickTable {
    return {
        hatWays: j.hatWays ?? 0,
        axes: (j.axes ?? []).map((a) => ({
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

/**
 * Settings -> TBL_JOYSTICK (+ TBL_PART shaping), or undefined when they set
 * nothing. v2 needs `sensors` (the device's parts) to place every input; when
 * any input has no place, the whole table is written as v1 so no shaping is
 * lost.
 */
export function joystickRecords(
    j: ConfigJoystick,
    sensors?: readonly SensorInfo[],
): JoystickRecords | undefined {
    const axes = j.axes ?? []
    if (j.hatWays === undefined && axes.length === 0) return undefined
    const places = axes.map((a) => (sensors ? axisPlaceOf(sensors, a.input) : undefined))
    if (places.some((p) => p === undefined)) {
        return { version: 1, table: legacyRecord(j), parts: [] }
    }
    return {
        version: 2,
        table: {
            hatWays: j.hatWays ?? 0,
            axes: axes.map((a) => ({ input: a.input, out: axisCode(a.out) })),
        },
        parts: axes.flatMap((a, i) => shapingEntries(a, places[i]!, sensors!)),
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

function readAxisV2(r: ByteReader): JoystickAxisConfig {
    const input = r.u8()
    return { input, out: JOYSTICK_AXIS_IDS[r.u8()] ?? null }
}

/**
 * TBL_JOYSTICK payload (version 1 or 2) in [start, end) -> settings, keeping
 * only what differs from the defaults. A v2 table carries no shaping; apply
 * the TBL_PART entries with applyAxisShaping. Returns an error message for a
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
    const r = new ByteReader(bytes, end)
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

const SHAPING_FROM_WIRE: Readonly<
    Record<number, (a: JoystickAxisConfig, v: number) => void>
> = {
    [AxisSetting.invert]: (a, v) => {
        if (v) a.invert = true
    },
    [AxisSetting.radial]: (a, v) => {
        if (v) a.radial = true
    },
    [AxisSetting.curve]: (a, v) => {
        if (v && CURVES[v]) a.curve = CURVES[v]
    },
    [AxisSetting.inner]: (a, v) => {
        if (v) a.inner = v
    },
    [AxisSetting.outer]: (a, v) => {
        if (v) a.outer = v
    },
}

/**
 * The AXES shaping in TBL_PART `entries` onto `j`'s axes (a v2 table). An input
 * with shaping but no TBL_JOYSTICK entry gets one on its default axis. An entry
 * whose place maps to no input (by `sensors`, the device's parts) is left out.
 */
export function applyAxisShaping(
    j: ConfigJoystick,
    entries: readonly SensorTableEntry[],
    sensors?: readonly SensorInfo[],
): ConfigJoystick {
    const axes = (j.axes ?? []).map((a) => ({ ...a }))
    const axisOf = (input: number): JoystickAxisConfig => {
        const found = axes.find((a) => a.input === input)
        if (found) return found
        const added: JoystickAxisConfig = { input, out: JOYSTICK_AXIS_IDS[input] ?? null }
        axes.push(added)
        return added
    }
    for (const e of entries) {
        const apply = SHAPING_FROM_WIRE[e.id] as
            | ((a: JoystickAxisConfig, v: number) => void)
            | undefined
        if (!apply) continue
        const input = inputAt({ part: e.sensor, ch: e.ch ?? 0 }, sensors)
        if (input === undefined) continue
        apply(axisOf(input), e.value)
    }
    return axes.length === 0 ? j : { ...j, axes }
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
    [ACT_SYSTEM]: (code) =>
        code === SystemAction.battery_show ? { action: 'batteryShow' } : null,
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
    const r = ByteReader.frame(bytes, t)
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
