// Idle / sleep / off timeouts (`node.power`, a device config's `power`) <->
// TBL_POWER (id 30). Shared by the keymap compiler (index.ts), its decoder
// (decode.ts) and the device compiler (device.ts). Byte layout mirrors firmware
// include/remappr/power.h.
import type { ConfigPowerSettings } from '../../types'
import { ByteReader } from './decode'
import { PowerSet, type PowerTableRecord } from './blobWriter'

/**
 * Settings -> TBL_POWER record, or undefined when the settings set nothing: an
 * absent table already means "build defaults", so an empty section emits none.
 */
export function powerRecord(s: ConfigPowerSettings): PowerTableRecord | undefined {
    const fields: [unknown, number][] = [
        [s.idleMs, PowerSet.idle],
        [s.sleepMs, PowerSet.sleep],
        [s.offMs, PowerSet.off],
    ]
    const set = fields.reduce((acc, [v, bit]) => (v === undefined ? acc : acc | bit), 0)
    if (set === 0) return undefined
    return { set, idleMs: s.idleMs ?? 0, sleepMs: s.sleepMs ?? 0, offMs: s.offMs ?? 0 }
}

/**
 * TBL_POWER payload at @p start -> settings, keeping only the fields the set
 * mask names (decode -> encode is byte-identical). The caller checks the frame
 * holds at least POWER_TBL_LEN bytes; bytes past it are a later version's and
 * skipped. Ranges are not re-checked; parse with PowerSettingsSchema for that.
 */
export function readPower(bytes: Uint8Array, start: number): ConfigPowerSettings {
    const r = new ByteReader(bytes)
    r.seek(start)
    const set = r.u16()
    r.u8() // flags, reserved
    r.u8()
    const idle = r.u32()
    const sleep = r.u32()
    const off = r.u32()
    const out: ConfigPowerSettings = {}
    if (set & PowerSet.idle) out.idleMs = idle
    if (set & PowerSet.sleep) out.sleepMs = sleep
    if (set & PowerSet.off) out.offMs = off
    return out
}
