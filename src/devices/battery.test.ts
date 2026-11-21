// pattern-check: skip vitest cases over the battery helpers
import { describe, expect, it } from 'vitest'
import { batteryFromReadings, batteryLowPct, batteryPart, isBatteryLow } from './battery'
import type { SensorInfo } from './types'

const part = (cls: string, settings: { name: string; value: number }[] = []) =>
    ({ index: 1, cls, model: 'x', channels: 1, io: [], settings, procedures: [], metrics: [] }) as unknown as SensorInfo

describe('battery helpers', () => {
    it('finds the battery part and its low threshold', () => {
        const batt = part('battery', [{ name: 'batteryLowPct', value: 15 }])
        expect(batteryPart([part('pointer'), batt])).toBe(batt)
        expect(batteryPart([part('pointer')])).toBeUndefined()
        expect(batteryLowPct(batt)).toBe(15)
        expect(batteryLowPct(part('battery'))).toBeUndefined()
    })

    it('reads the charge and charging from the readings', () => {
        const r = (name: string, value: number) => ({ name, value, max: 100 })
        expect(batteryFromReadings([r('batteryLevel', 73), r('batteryCharging', 1)])).toEqual({
            level: 73,
            charging: true,
        })
        expect(batteryFromReadings([r('batteryLevel', 9)])).toEqual({ level: 9, charging: false })
        expect(batteryFromReadings([r('batteryMv', 3700)])).toBeUndefined()
    })

    it('is low at or below the threshold, never while charging', () => {
        expect(isBatteryLow({ level: 15, charging: false }, 15)).toBe(true)
        expect(isBatteryLow({ level: 16, charging: false }, 15)).toBe(false)
        expect(isBatteryLow({ level: 5, charging: true }, 15)).toBe(false)
    })
})
