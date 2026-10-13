// pattern-check: skip pure encode/decode functions over the existing BlobBuilder
//
// Device config document (config/device.ts) <-> RMBC blob. A device blob holds
// TBL_PERSONALITY (which device it is for) and that device's own table; no
// keymap tables. The firmware refuses a blob whose personality is not its own,
// so the personality is always emitted. Today: the dongle (TBL_DONGLE, id 25).
// Byte layout mirrors firmware include/remappr/config_blob.h and
// lib/config_blob/decode_dongle.c.
import type { ConfigDevice, DongleSettings } from '../../device'
import {
    BLOB_READER_VERSION,
    BlobBuilder,
    DONGLE_FLAG_NKRO,
    DONGLE_TBL_LEN,
    DongleSet,
    Personality,
    TableId,
} from './blobWriter'
import {
    ByteReader,
    DecodeCode,
    type DecodeCodeValue,
    readBlobFrames,
} from './decode'

function dongleSetBits(d: DongleSettings): number {
    const fields: [unknown, number][] = [
        [d.nkro, DongleSet.nkro],
        [d.pairWindowMs, DongleSet.pairWindow],
        [d.pairDoneReplayMs, DongleSet.pairDoneReplay],
        [d.failsafeMs, DongleSet.failsafe],
        [d.rosterLiveMs, DongleSet.rosterLive],
        [d.hidSubmitTimeoutMs, DongleSet.hidSubmit],
    ]
    return fields.reduce((set, [v, bit]) => (v === undefined ? set : set | bit), 0)
}

/**
 * Device config -> RMBC blob. `configVersion` must be above the device's active
 * one (the firmware refuses a stale commit). The config is assumed validated
 * (parseDeviceConfig / DeviceConfigSchema).
 */
export function buildRemapprDeviceBlob(
    config: ConfigDevice,
    opts: { configVersion: number },
): Uint8Array {
    const builder = new BlobBuilder().personalityTable(
        Personality[config.personality],
    )
    const d = config.dongle
    if (d) {
        builder.dongleTable({
            set: dongleSetBits(d),
            nkro: d.nkro ?? false,
            hidSubmitTimeoutMs: d.hidSubmitTimeoutMs ?? 0,
            pairWindowMs: d.pairWindowMs ?? 0,
            pairDoneReplayMs: d.pairDoneReplayMs ?? 0,
            failsafeMs: d.failsafeMs ?? 0,
            rosterLiveMs: d.rosterLiveMs ?? 0,
        })
    }
    return builder.finalize(
        config.schemaVersion,
        BLOB_READER_VERSION,
        opts.configVersion,
    )
}

export interface DeviceDecodeResult {
    code: DecodeCodeValue
    /** The decoded settings, present iff `code === OK`. */
    dongle?: DongleSettings
    /** The blob's config_version, present on OK. */
    configVersion?: number
}

function readDongle(bytes: Uint8Array, start: number): DongleSettings {
    const r = new ByteReader(bytes)
    r.seek(start)
    const set = r.u16()
    const flags = r.u8()
    const hidSubmit = r.u8()
    const pairWindow = r.u32()
    const pairDoneReplay = r.u16()
    const failsafe = r.u16()
    const rosterLive = r.u16()
    const pick = (bit: number, v: number): number | undefined =>
        set & bit ? v : undefined
    const out: DongleSettings = {
        nkro: set & DongleSet.nkro ? (flags & DONGLE_FLAG_NKRO) !== 0 : undefined,
        pairWindowMs: pick(DongleSet.pairWindow, pairWindow),
        pairDoneReplayMs: pick(DongleSet.pairDoneReplay, pairDoneReplay),
        failsafeMs: pick(DongleSet.failsafe, failsafe),
        rosterLiveMs: pick(DongleSet.rosterLive, rosterLive),
        hidSubmitTimeoutMs: pick(DongleSet.hidSubmit, hidSubmit),
    }
    // Drop unset keys so a decode -> encode round trip is byte-identical.
    for (const k of Object.keys(out) as (keyof DongleSettings)[]) {
        if (out[k] === undefined) delete out[k]
    }
    return out
}

/**
 * RMBC blob -> dongle settings (e.g. read back from a device). Checks the header
 * like the firmware, requires the dongle personality (DecodeCode.DEVICE when the
 * blob is for another device, MISSING when it names none) and a well-framed
 * TBL_DONGLE when present. Ranges are not re-checked here; parse the result
 * with DongleSettingsSchema for that.
 */
export function decodeRemapprDeviceBlob(bytes: Uint8Array): DeviceDecodeResult {
    const parsed = readBlobFrames(bytes)
    if (parsed.code !== DecodeCode.OK) return { code: parsed.code }
    const table = (id: number) => parsed.frames.find((f) => f.id === id)

    const pers = table(TableId.Personality)
    if (!pers || pers.end <= pers.start) return { code: DecodeCode.MISSING }
    if (pers.version !== 1) return { code: DecodeCode.TABLE_VER }
    if (bytes[pers.start] !== Personality.dongle) return { code: DecodeCode.DEVICE }

    const dt = table(TableId.Dongle)
    if (dt && dt.version !== 1) return { code: DecodeCode.TABLE_VER }
    if (dt && dt.end - dt.start < DONGLE_TBL_LEN)
        return { code: DecodeCode.TABLE_FRAME }
    return {
        code: DecodeCode.OK,
        dongle: dt ? readDongle(bytes, dt.start) : {},
        configVersion: parsed.configVersion,
    }
}
