// pattern-check: skip pure encode/decode functions over the existing BlobBuilder
//
// Pointer settings (`node.mouse` in a keymap, `mouse` in a device document) <->
// TBL_MOUSE (id 8). Shared by the keymap compiler/decoder and the device
// compiler/decoder. Version 1 carries cpi, the auto-layer timeout and the
// acceleration curve; version 2 adds the axis inverts and swap, the scroll
// divisor and the button map; version 3 the DPI stages. A config is written at
// the lowest version its fields need, so firmware that only reads an older one
// still takes it. A mouse device's button actions ride TBL_ACTION_BINDING
// (id 17, kind DEVICE). Byte layout mirrors firmware
// include/remappr/config_blob.h (TBL_MOUSE, TBL_ACTION_BINDING) and action.h.
import type { ConfigMouse, MouseButtonAction } from '../../types'
import {
    ACT_DEVICE,
    type ActionBindingRecord,
    DeviceAction,
    MOUSE_BUTTON_OFF,
    MOUSE_DPI_STAGES_MAX,
    MOUSE_TBL_HDR_LEN,
    MOUSE_TBL_V2_TAIL_LEN,
    MOUSE_TBL_V3_TAIL_LEN,
    MouseFlag,
    type MouseTable,
} from './blobWriter'
import { ByteReader, type TableFrame } from './decode'

const FLAG_FIELDS: [keyof ConfigMouse, number][] = [
    ['invertX', MouseFlag.invertX],
    ['invertY', MouseFlag.invertY],
    ['invertWheel', MouseFlag.invertWheel],
    ['invertHwheel', MouseFlag.invertHwheel],
    ['swapXY', MouseFlag.swapXY],
]

const IDENTITY_MAP = [0, 1, 2, 3, 4, 5, 6, 7]

function wireMap(m: ConfigMouse): number[] {
    return (m.buttonMap ?? IDENTITY_MAP).map((to) => to ?? MOUSE_BUTTON_OFF)
}

/**
 * Settings -> TBL_MOUSE record, or undefined when they set nothing (no table:
 * the device keeps its defaults).
 */
export function mouseRecord(m: ConfigMouse): MouseTable | undefined {
    const flags = FLAG_FIELDS.reduce((acc, [k, bit]) => (m[k] ? acc | bit : acc), 0)
    const scrollDivisor = (m.scrollDivisor ?? 1) > 1 ? m.scrollDivisor! : 0
    const buttonMap = wireMap(m)
    const stages = m.dpiStages ?? []
    const stage = stages.length ? (m.dpiStage ?? 0) : 0
    const v3 = stages.length > 0
    const v2 =
        v3 ||
        flags !== 0 ||
        scrollDivisor !== 0 ||
        buttonMap.some((to, i) => to !== IDENTITY_MAP[i])
    const accel = (m.accel ?? []).map(([speedIn, multX100]) => ({
        speedIn,
        multX100,
    }))
    if (!v2 && !m.cpi && !m.autoLayerTimeoutMs && accel.length === 0) {
        return undefined
    }
    return {
        // With stages the mouse starts on its stage; cpi says the same.
        cpi: v3 ? stages[stage]! : (m.cpi ?? 0),
        autoLayerTimeoutMs: m.autoLayerTimeoutMs ?? 0,
        flags,
        accel,
        ...(v2 ? { v2: { scrollDivisor, buttonMap } } : {}),
        ...(v3 ? { v3: { stages, stage } } : {}),
    }
}

/** The DPI stages of a version-3 tail at the reader, kept only when listed. */
function readStages(r: ByteReader, out: ConfigMouse, cpi: number): void {
    const count = r.u8()
    const stage = r.u8()
    const all = Array.from({ length: MOUSE_DPI_STAGES_MAX }, () => r.u16())
    if (count === 0) return
    out.dpiStages = all.slice(0, count)
    if (stage) out.dpiStage = stage
    // cpi repeats the starting stage: keep one source of truth.
    if (cpi === out.dpiStages[stage]) delete out.cpi
}

/**
 * TBL_MOUSE payload in [start, end) -> settings, keeping only what differs from
 * the defaults (so decode -> encode is byte-identical). Returns an error
 * message instead for a frame too short for its point count or tail.
 */
export function readMouseTable(
    bytes: Uint8Array,
    start: number,
    end: number,
    version: number,
): ConfigMouse | string {
    if (end - start < MOUSE_TBL_HDR_LEN) return 'mouse table header truncated'
    const r = new ByteReader(bytes)
    r.seek(start)
    const cpi = r.u16()
    const autoLayerTimeoutMs = r.u16()
    const count = r.u8()
    const flags = r.u8()
    const tail =
        (version >= 2 ? MOUSE_TBL_V2_TAIL_LEN : 0) +
        (version >= 3 ? MOUSE_TBL_V3_TAIL_LEN : 0)
    if (start + MOUSE_TBL_HDR_LEN + count * 4 + tail > end) {
        return 'mouse table truncated'
    }
    const out: ConfigMouse = {}
    if (cpi) out.cpi = cpi
    if (autoLayerTimeoutMs) out.autoLayerTimeoutMs = autoLayerTimeoutMs
    const accel: Array<[number, number]> = []
    for (let i = 0; i < count; i++) accel.push([r.u16(), r.u16()])
    if (accel.length) out.accel = accel
    if (version < 2) return out

    for (const [k, bit] of FLAG_FIELDS) {
        if (flags & bit) (out as Record<string, unknown>)[k] = true
    }
    const div = r.u8()
    r.u8() // reserved
    if (div > 1) out.scrollDivisor = div
    const map = Array.from({ length: 8 }, () => r.u8())
    if (map.some((to, i) => to !== IDENTITY_MAP[i])) {
        out.buttonMap = map.map((to) => (to === MOUSE_BUTTON_OFF ? null : to))
    }
    if (version >= 3) readStages(r, out, cpi)
    return out
}

// ---------------------------------------------------------------------------
// Button actions <-> TBL_ACTION_BINDING (a mouse device blob)
// ---------------------------------------------------------------------------

/** The mouse's buttons are the binding positions (HID button index). */
export const MOUSE_ACTION_POSITIONS = 8

const NAME_BY_CODE = Object.fromEntries(
    Object.entries(DeviceAction).map(([name, code]) => [code, name]),
) as Record<number, MouseButtonAction['action']>

/** The button actions as TBL_ACTION_BINDING records (none = no table). */
export function mouseActionRecords(m: ConfigMouse): ActionBindingRecord[] {
    return (m.buttonActions ?? []).flatMap((a, position) =>
        a
            ? [
                  {
                      position,
                      kind: ACT_DEVICE,
                      code: DeviceAction[a.action],
                      arg0: a.dpi ?? 0,
                      arg1: 0,
                  },
              ]
            : [],
    )
}

/**
 * TBL_ACTION_BINDING of a mouse blob -> its eight button actions, or undefined
 * when it binds none this client knows (a record of another kind or position
 * is left out). Returns an error message for a frame too short for its count.
 */
export function readMouseActions(
    bytes: Uint8Array,
    t: TableFrame,
): ConfigMouse['buttonActions'] | string {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    r.u16() // num_positions
    if (t.start + 4 + count * 10 > t.end) return 'action table truncated'
    const out: Array<MouseButtonAction | null> = Array(MOUSE_ACTION_POSITIONS).fill(null)
    for (let i = 0; i < count; i++) {
        const position = r.u16()
        const kind = r.u8()
        r.u8() // reserved
        const code = r.u16()
        const dpi = r.u16()
        r.u16() // arg1
        const action = NAME_BY_CODE[code]
        if (kind !== ACT_DEVICE || !action || position >= MOUSE_ACTION_POSITIONS) {
            continue
        }
        out[position] = dpi ? { action, dpi } : { action }
    }
    return out.some(Boolean) ? out : undefined
}
