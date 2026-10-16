// Pattern check: no GoF pattern (-) — rejected — pure encode/decode functions for TBL_SENSOR entries, mirroring joystick.ts / radio.ts.
//
// Sensor settings by registry name (a device document's `sensor` section, a
// JSON config's `node.sensor.defaults`) <-> TBL_SENSOR (id 29) entries. Byte
// layout mirrors firmware include/remappr/config_blob.h and
// lib/config_blob/decode_sensor.c (sensor-settings plan §4).
//
// The device validates TBL_SENSOR strictly at VALIDATE_CONFIG: one entry for a
// sensor it does not have, a setting its adapter does not list, a
// personality's setting or a value out of range refuses the whole config. So
// when the device's own description is at hand (`sensors`), every entry is
// checked against it first and one that would be refused is left out (the
// document keeps it). Without it, only the names are resolved.
import {
    sensorWireValue,
    registrySetting,
    sensorSettingId,
    sensorSettingKey,
} from '../../../clients/remappr/sensorRegistry'
import type { SensorInfo, SensorSettingInfo } from '../../../devices/types'
import type { ConfigDeviceSensor } from '../../device'
import type { ConfigSensorValue } from '../../types'
import {
    SENSOR_TBL_ENTRY_LEN,
    SENSOR_TBL_HDR_LEN,
    type SensorTableEntry,
} from './blobWriter'
import { ByteReader } from './decode'

/** A setting that was not compiled, and why. */
export interface SensorSkip {
    key: string
    reason: string
}

/** Why `value` would be refused by `s`, or null. */
function refusal(s: SensorSettingInfo, value: number): string | null {
    if (s.personality)
        return 'set by the device itself, not as a sensor setting'
    if (s.type === 'bool')
        return value === 0 || value === 1 ? null : 'not a boolean'
    if (s.type === 'enum') {
        return s.options?.some((o) => o.value === value)
            ? null
            : 'not one of its options'
    }
    const inRange =
        (s.min === undefined || value >= s.min) &&
        (s.max === undefined || value <= s.max)
    return inRange ? null : `outside ${s.min}..${s.max}`
}

/** Why setting `id` with `value` would not reach sensor `index`, or null. */
function deviceRefusal(
    sensors: readonly SensorInfo[],
    index: number,
    id: number,
    value: number,
): string | null {
    const sensor = sensors.find((s) => s.index === index)
    if (!sensor) return `the device has no sensor ${index}`
    const s = sensor.settings.find((x) => x.name === sensorSettingKey(id))
    return s ? refusal(s, value) : 'the sensor does not have it'
}

/**
 * Settings by name -> TBL_SENSOR entries for sensor `index`. A name that maps
 * to no id, an option name the setting does not have, or (with `sensors`) a
 * value the device would refuse is skipped. Two keys for one id (a name and
 * its hex) keep the later one.
 */
export function sensorEntries(
    values: Readonly<Record<string, ConfigSensorValue>> | undefined,
    index: number,
    sensors?: readonly SensorInfo[],
): { entries: SensorTableEntry[]; skipped: SensorSkip[] } {
    const byId = new Map<number, SensorTableEntry>()
    const skipped: SensorSkip[] = []
    for (const [key, raw] of Object.entries(values ?? {})) {
        const id = sensorSettingId(key)
        const value = sensorWireValue(key, raw)
        if (id === undefined || value === undefined) {
            skipped.push({ key, reason: 'not a sensor setting or option name' })
            continue
        }
        const refused = sensors && deviceRefusal(sensors, index, id, value)
        if (refused) {
            skipped.push({ key, reason: refused })
            continue
        }
        byId.set(id, { sensor: index, id, value })
    }
    return { entries: [...byId.values()], skipped }
}

/** A device document's `sensor` section -> TBL_SENSOR entries. */
export function deviceSensorEntries(
    sensor: ConfigDeviceSensor | undefined,
    sensors?: readonly SensorInfo[],
): { entries: SensorTableEntry[]; skipped: SensorSkip[] } {
    return sensorEntries(sensor?.settings, sensor?.index ?? 0, sensors)
}

/**
 * TBL_SENSOR payload in [start, end) -> the first sensor's settings by name
 * (a BOOL the registry knows as a boolean, everything else as its number).
 * A document holds one sensor's settings, so entries for any other sensor
 * are not read back. Returns an error message for a frame too short for its
 * count.
 */
export function readSensorTable(
    bytes: Uint8Array,
    start: number,
    end: number,
): ConfigDeviceSensor | string {
    if (end - start < SENSOR_TBL_HDR_LEN) return 'sensor table header truncated'
    const r = new ByteReader(bytes)
    r.seek(start)
    const count = r.u8()
    r.u8() // reserved
    if (start + SENSOR_TBL_HDR_LEN + count * SENSOR_TBL_ENTRY_LEN > end) {
        return 'sensor table truncated'
    }
    let index: number | undefined
    const settings: Record<string, ConfigSensorValue> = {}
    for (let i = 0; i < count; i++) {
        const sensor = r.u8()
        const id = r.u8()
        r.u16() // reserved
        const value = r.u32() | 0
        index ??= sensor
        if (sensor !== index) continue
        const bool = registrySetting(id)?.type === 'bool'
        settings[sensorSettingKey(id)] = bool ? value !== 0 : value
    }
    if (index === undefined) return {}
    return index ? { index, settings } : { settings }
}
