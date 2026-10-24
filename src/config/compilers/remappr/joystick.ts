// Pattern check: Dispatch Map (Tier 0) — applied — action kind → reader/writer maps for gamepad actions; axis/curve name↔code tables.
//
// Joystick settings (`joystick` in a device document) <-> TBL_JOYSTICK (id 28)
// and its button actions <-> TBL_ACTION_BINDING (id 17, GAMEPAD_* kinds).
// Only what differs from the defaults is written and read back, so a decode ->
// encode round trip is byte-identical. Byte layout mirrors firmware
// include/remappr/config_blob.h (TBL_JOYSTICK, TBL_ACTION_BINDING) and
// action.h (input-layout plan §4).
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
    JOYSTICK_TBL_HDR_LEN,
    type JoystickTable,
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

/**
 * TBL_JOYSTICK payload in [start, end) -> settings, keeping only what differs
 * from the defaults. Returns an error message for a frame too short for its
 * count.
 */
export function readJoystickTable(
    bytes: Uint8Array,
    start: number,
    end: number,
): ConfigJoystick | string {
    if (end - start < JOYSTICK_TBL_HDR_LEN)
        return 'joystick table header truncated'
    const r = new ByteReader(bytes)
    r.seek(start)
    const hatWays = r.u8()
    const count = r.u8()
    if (start + JOYSTICK_TBL_HDR_LEN + count * JOYSTICK_TBL_AXIS_LEN > end) {
        return 'joystick table truncated'
    }
    const out: ConfigJoystick = {}
    if (hatWays === 4 || hatWays === 8) out.hatWays = hatWays
    const axes = Array.from({ length: count }, () => readAxis(r))
    if (axes.length) out.axes = axes
    return out
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
