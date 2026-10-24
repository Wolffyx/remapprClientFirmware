// The battery of a device, read from its battery part (class `battery`): the
// charge and charging come from the part's readings, the low threshold from
// its own setting. Firmware-neutral: any device whose firmware describes a
// battery part has one, nothing here names a firmware.
import type { BatteryState, SensorApi, SensorReading } from '../service'
import type { SensorInfo } from './types'

/** The device's battery part, if it describes one. */
export const batteryPart = (
    sensors: readonly SensorInfo[] | null | undefined,
): SensorInfo | undefined => sensors?.find((s) => s.cls === 'battery')

/** The charge at or below which the device counts its battery as low (the
 *  part's `batteryLowPct`), or undefined when the part does not say. */
export function batteryLowPct(part: SensorInfo): number | undefined {
    const v = part.settings.find((s) => s.name === 'batteryLowPct')?.value
    return typeof v === 'number' ? v : undefined
}

/** A battery part's readings -> its state, or undefined without a level. */
export function batteryFromReadings(
    readings: readonly SensorReading[],
): BatteryState | undefined {
    const level = readings.find((r) => r.name === 'batteryLevel')?.value
    if (level === undefined) return undefined
    const charging = readings.find((r) => r.name === 'batteryCharging')?.value
    return { level, charging: (charging ?? 0) !== 0 }
}

/** Read the battery part's state now. */
export async function readBattery(
    api: SensorApi,
    part: SensorInfo,
): Promise<BatteryState | undefined> {
    return batteryFromReadings(await api.getMetrics(part.index))
}

/** Low = at or below the threshold and not charging. */
export const isBatteryLow = (b: BatteryState, lowPct: number): boolean =>
    !b.charging && b.level <= lowPct
