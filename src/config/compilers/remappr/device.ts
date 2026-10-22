// pattern-check: skip pure encode/decode functions over the existing BlobBuilder
//
// Device config document (config/device.ts) <-> RMBC blob. A device blob holds
// TBL_PERSONALITY (which device it is for) and that device's own tables; no
// keymap tables. The firmware refuses a blob whose personality is not its own,
// so the personality is always emitted. The dongle reads TBL_DONGLE (id 25);
// the mouse reads TBL_MOUSE (id 8), its button actions from TBL_ACTION_BINDING
// (id 17), TBL_RADIO (id 26) and its sensor's TBL_SENSOR (id 29); the joystick reads TBL_JOYSTICK (id 28) and
// its button actions from TBL_ACTION_BINDING. Byte layout mirrors
// firmware include/remappr/config_blob.h, lib/config_blob/decode_dongle.c and
// include/remappr/radio_settings.h.
import type { SensorInfo } from '../../../devices/types'
import type { ConfigDevice, ConfigDeviceSensor, DongleSettings } from '../../device'
import type {
    ConfigJoystick,
    ConfigMouse,
    ConfigRadioSettings,
} from '../../types'
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
import {
    MOUSE_ACTION_POSITIONS,
    mouseActionRecords,
    mouseRecord,
    readMouseActions,
    readMouseTable,
} from './mouse'
import { radioRecord, readRadio } from './radio'
import { deviceSensorEntries, readSensorTable } from './sensor'
import {
    JOYSTICK_ACTION_POSITIONS,
    joystickActionRecords,
    joystickRecord,
    readJoystickActions,
    readJoystickTable,
} from './joystick'

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

function addJoystick(builder: BlobBuilder, j: ConfigJoystick): void {
    const table = joystickRecord(j)
    if (table) builder.joystickTable(table)
    const actions = joystickActionRecords(j)
    if (actions.length) {
        builder.actionBindingTable(JOYSTICK_ACTION_POSITIONS, actions)
    }
}

/**
 * Device config -> RMBC blob. `configVersion` must be above the device's active
 * one (the firmware refuses a stale commit). The config is assumed validated
 * (parseDeviceConfig / DeviceConfigSchema). `sensors`, the device's own
 * description of its sensors, leaves out a sensor setting it would refuse
 * (compilers/remappr/sensor.ts); the document keeps it.
 */
export function buildRemapprDeviceBlob(
    config: ConfigDevice,
    opts: { configVersion: number; sensors?: readonly SensorInfo[] },
): Uint8Array {
    const builder = new BlobBuilder().personalityTable(
        Personality[config.personality],
    )
    if (config.dongle) addDongle(builder, config.dongle)
    const mouse = config.mouse ? mouseRecord(config.mouse) : undefined
    if (mouse) builder.mouseTable(mouse)
    const actions = config.mouse ? mouseActionRecords(config.mouse) : []
    if (actions.length) builder.actionBindingTable(MOUSE_ACTION_POSITIONS, actions)
    const radio = config.radio ? radioRecord(config.radio) : undefined
    if (radio) builder.radioTable(radio)
    const sensor = deviceSensorEntries(config.sensor, opts.sensors).entries
    if (sensor.length) builder.sensorTable(sensor)
    if (config.joystick) addJoystick(builder, config.joystick)
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
    /** The joystick's settings (a joystick blob with TBL_JOYSTICK or button
     *  actions). */
    joystick?: ConfigJoystick
    /** The sensor's settings (a mouse blob that carries TBL_SENSOR). */
    sensor?: ConfigDeviceSensor
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
    [Personality.joystick]: 'joystick',
}

type Frames = (id: number) => TableFrame | undefined
type DeviceTables = Pick<
    DeviceDecodeResult,
    'dongle' | 'mouse' | 'radio' | 'joystick' | 'sensor'
>

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
        if (mt.version < 1 || mt.version > 3) return DecodeCode.TABLE_VER
        const m = readMouseTable(bytes, mt.start, mt.end, mt.version)
        if (typeof m === 'string') return DecodeCode.TABLE_FRAME
        out.mouse = m
    }
    const at = table(TableId.ActionBinding)
    if (at) {
        if (at.version !== 1) return DecodeCode.TABLE_VER
        const buttonActions = readMouseActions(bytes, at)
        if (typeof buttonActions === 'string') return DecodeCode.TABLE_FRAME
        if (buttonActions) out.mouse = { ...out.mouse, buttonActions }
    }
    const rt = table(TableId.Radio)
    if (rt) {
        if (rt.version !== 1) return DecodeCode.TABLE_VER
        if (rt.end - rt.start < RADIO_TBL_LEN) return DecodeCode.TABLE_FRAME
        out.radio = readRadio(bytes, rt.start)
    }
    const st = table(TableId.Sensor)
    if (st) {
        if (st.version < 1 || st.version > 2) return DecodeCode.TABLE_VER
        const sensor = readSensorTable(bytes, st.start, st.end)
        if (typeof sensor === 'string') return DecodeCode.TABLE_FRAME
        if (sensor.settings) out.sensor = sensor
    }
    return out
}

function decodeJoystickTables(
    bytes: Uint8Array,
    table: Frames,
): DeviceTables | DecodeCodeValue {
    let joystick: ConfigJoystick | undefined
    const jt = table(TableId.Joystick)
    if (jt) {
        if (jt.version !== 1) return DecodeCode.TABLE_VER
        const j = readJoystickTable(bytes, jt.start, jt.end)
        if (typeof j === 'string') return DecodeCode.TABLE_FRAME
        joystick = j
    }
    const at = table(TableId.ActionBinding)
    if (at) {
        if (at.version !== 1) return DecodeCode.TABLE_VER
        const buttonActions = readJoystickActions(bytes, at)
        if (typeof buttonActions === 'string') return DecodeCode.TABLE_FRAME
        if (buttonActions) joystick = { ...joystick, buttonActions }
    }
    return joystick ? { joystick } : {}
}

const TABLES_BY_PERSONALITY: Record<
    DevicePersonality,
    (bytes: Uint8Array, table: Frames) => DeviceTables | DecodeCodeValue
> = {
    dongle: decodeDongleTables,
    mouse: decodeMouseTables,
    joystick: decodeJoystickTables,
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
