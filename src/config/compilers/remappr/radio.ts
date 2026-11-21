// The node's 2.4 GHz link settings (`node.radio`) <-> TBL_RADIO (id 26). Shared
// by the keymap compiler (index.ts) and decoder (decode.ts); the mouse's device
// document will use it too. Byte layout mirrors firmware
// include/remappr/radio_settings.h.
import type { ConfigRadioSettings } from '../../types'
import { ByteReader } from './decode'
import { RADIO_FLAG_AUTO_PAIR, RadioSet, type RadioTableRecord } from './blobWriter'

/**
 * Settings -> TBL_RADIO record, or undefined when the settings set nothing: an
 * absent table already means "build defaults", so an empty section emits none
 * and the blob stays byte-identical to one without it.
 */
export function radioRecord(s: ConfigRadioSettings): RadioTableRecord | undefined {
    const fields: [unknown, number][] = [
        [s.autoPair, RadioSet.autoPair],
        [s.keepaliveMs, RadioSet.keepalive],
        [s.inputRepeats, RadioSet.inputRepeats],
        [s.beaconLossMs, RadioSet.beaconLoss],
    ]
    const set = fields.reduce((acc, [v, bit]) => (v === undefined ? acc : acc | bit), 0)
    if (set === 0) return undefined
    return {
        set,
        autoPair: s.autoPair ?? false,
        inputRepeats: s.inputRepeats ?? 0,
        keepaliveMs: s.keepaliveMs ?? 0,
        beaconLossMs: s.beaconLossMs ?? 0,
    }
}

/**
 * TBL_RADIO payload at @p start -> settings, keeping only the fields the set
 * mask names (so decode -> encode is byte-identical). The caller checks the
 * frame holds at least RADIO_TBL_LEN bytes. Ranges are not re-checked; parse
 * the result with RadioSettingsSchema for that.
 */
export function readRadio(bytes: Uint8Array, start: number): ConfigRadioSettings {
    const r = new ByteReader(bytes)
    r.seek(start)
    const set = r.u16()
    const flags = r.u8()
    const repeats = r.u8()
    const keepalive = r.u16()
    const beaconLoss = r.u16()
    const out: ConfigRadioSettings = {}
    if (set & RadioSet.autoPair) out.autoPair = (flags & RADIO_FLAG_AUTO_PAIR) !== 0
    if (set & RadioSet.inputRepeats) out.inputRepeats = repeats
    if (set & RadioSet.keepalive) out.keepaliveMs = keepalive
    if (set & RadioSet.beaconLoss) out.beaconLossMs = beaconLoss
    return out
}
