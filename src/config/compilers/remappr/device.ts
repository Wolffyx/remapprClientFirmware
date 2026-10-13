// pattern-check: skip pure encode/decode functions over the existing BlobBuilder
//
// Device config document (config/device.ts) <-> RMBC blob. A device blob holds
// TBL_PERSONALITY (which device it is for) and that device's own tables; no
// keymap tables. The firmware refuses a blob whose personality is not its own,
// so the personality is always emitted. The dongle reads TBL_DONGLE (id 25);
// the mouse reads TBL_MOUSE (id 8) and TBL_RADIO (id 26). Byte layout mirrors
// firmware include/remappr/config_blob.h, lib/config_blob/decode_dongle.c and
// include/remappr/radio_settings.h.
import type { ConfigDevice, DongleSettings } from '../../device'
import type { ConfigMouse, ConfigRadioSettings } from '../../types'
import {
    BLOB_READER_VERSION,
    BlobBuilder,
    DONGLE_FLAG_NKRO,
    DONGLE_TBL_LEN,
    DongleSet,
    Personality,
    RADIO_TBL_LEN,
    TableId,
} from './blobWriter'
import {
    ByteReader,
    DecodeCode,
    type DecodeCodeValue,
    readBlobFrames,
    type TableFrame,
} from './decode'
import { mouseRecord, readMouseTable } from './mouse'
import { radioRecord, readRadio } from './radio'

type DevicePersonality = ConfigDevice['personality']

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

function addDongle(builder: BlobBuilder, d: DongleSettings): void {
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
    if (config.dongle) addDongle(builder, config.dongle)
    const mouse = config.mouse ? mouseRecord(config.mouse) : undefined
    if (mouse) builder.mouseTable(mouse)
    const radio = config.radio ? radioRecord(config.radio) : undefined
    if (radio) builder.radioTable(radio)
    return builder.finalize(
        config.schemaVersion,
        BLOB_READER_VERSION,
        opts.configVersion,
    )
}

export interface DeviceDecodeResult {
    code: DecodeCodeValue
    /** Which device the blob is for, present iff `code === OK`. */
    personality?: DevicePersonality
    /** The dongle's settings (a dongle blob). */
    dongle?: DongleSettings
    /** The mouse's pointer settings (a mouse blob that carries TBL_MOUSE). */
    mouse?: ConfigMouse
    /** The mouse's radio settings (a mouse blob that carries TBL_RADIO). */
    radio?: ConfigRadioSettings
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

const PERSONALITY_BY_CODE: Record<number, DevicePersonality> = {
    [Personality.dongle]: 'dongle',
    [Personality.mouse]: 'mouse',
}

type Frames = (id: number) => TableFrame | undefined
type DeviceTables = Pick<DeviceDecodeResult, 'dongle' | 'mouse' | 'radio'>

function decodeDongleTables(
    bytes: Uint8Array,
    table: Frames,
): DeviceTables | DecodeCodeValue {
    const dt = table(TableId.Dongle)
    if (!dt) return { dongle: {} }
    if (dt.version !== 1) return DecodeCode.TABLE_VER
    if (dt.end - dt.start < DONGLE_TBL_LEN) return DecodeCode.TABLE_FRAME
    return { dongle: readDongle(bytes, dt.start) }
}

function decodeMouseTables(
    bytes: Uint8Array,
    table: Frames,
): DeviceTables | DecodeCodeValue {
    const out: DeviceTables = {}
    const mt = table(TableId.Mouse)
    if (mt) {
        if (mt.version < 1 || mt.version > 2) return DecodeCode.TABLE_VER
        const m = readMouseTable(bytes, mt.start, mt.end, mt.version)
        if (typeof m === 'string') return DecodeCode.TABLE_FRAME
        out.mouse = m
    }
    const rt = table(TableId.Radio)
    if (rt) {
        if (rt.version !== 1) return DecodeCode.TABLE_VER
        if (rt.end - rt.start < RADIO_TBL_LEN) return DecodeCode.TABLE_FRAME
        out.radio = readRadio(bytes, rt.start)
    }
    return out
}

const TABLES_BY_PERSONALITY: Record<
    DevicePersonality,
    (bytes: Uint8Array, table: Frames) => DeviceTables | DecodeCodeValue
> = {
    dongle: decodeDongleTables,
    mouse: decodeMouseTables,
}

/**
 * RMBC blob -> device settings (e.g. read back from a device). Checks the
 * header like the firmware, requires a device personality (DecodeCode.DEVICE
 * for a keyboard or unknown one, MISSING when it names none) and well-framed
 * tables. Ranges are not re-checked here; parse the result with the schemas
 * for that.
 */
export function decodeRemapprDeviceBlob(bytes: Uint8Array): DeviceDecodeResult {
    const parsed = readBlobFrames(bytes)
    if (parsed.code !== DecodeCode.OK) return { code: parsed.code }
    const table: Frames = (id) => parsed.frames.find((f) => f.id === id)

    const pers = table(TableId.Personality)
    if (!pers || pers.end <= pers.start) return { code: DecodeCode.MISSING }
    if (pers.version !== 1) return { code: DecodeCode.TABLE_VER }
    const personality = PERSONALITY_BY_CODE[bytes[pers.start]]
    if (!personality) return { code: DecodeCode.DEVICE }

    const tables = TABLES_BY_PERSONALITY[personality](bytes, table)
    if (typeof tables === 'number') return { code: tables }
    return {
        code: DecodeCode.OK,
        personality,
        ...tables,
        configVersion: parsed.configVersion,
    }
}
