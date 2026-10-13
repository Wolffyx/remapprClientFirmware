// pattern-check: skip pure encode/decode functions over the existing BlobBuilder
//
// Pointer settings (`node.mouse` in a keymap, `mouse` in a device document) <->
// TBL_MOUSE (id 8). Shared by the keymap compiler/decoder and the device
// compiler/decoder. Version 1 carries cpi, the auto-layer timeout and the
// acceleration curve; version 2 adds the axis inverts and swap, the scroll
// divisor and the button map. A config that uses no version-2 field is written
// as version 1, so firmware that only reads version 1 still takes it. Byte
// layout mirrors firmware include/remappr/config_blob.h (TBL_MOUSE).
import type { ConfigMouse } from '../../types'
import {
    MOUSE_BUTTON_OFF,
    MOUSE_TBL_HDR_LEN,
    MOUSE_TBL_V2_TAIL_LEN,
    MouseFlag,
    type MouseTable,
} from './blobWriter'
import { ByteReader } from './decode'

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
    const v2 =
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
        cpi: m.cpi ?? 0,
        autoLayerTimeoutMs: m.autoLayerTimeoutMs ?? 0,
        flags,
        accel,
        ...(v2 ? { v2: { scrollDivisor, buttonMap } } : {}),
    }
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
    const tail = version >= 2 ? MOUSE_TBL_V2_TAIL_LEN : 0
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
    return out
}
