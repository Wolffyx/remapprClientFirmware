// pattern-check: skip vitest cases over the registry lookup tables, no abstraction
import { describe, expect, it } from 'vitest'
import {
    sensorClass,
    sensorMetricKey,
    sensorSettingId,
    sensorSettingKey,
    sensorWireValue,
} from './sensorRegistry'

describe('part registry', () => {
    it('names every class the firmware registry has, others as "other"', () => {
        expect(sensorClass(1)).toBe('pointer')
        expect(sensorClass(5)).toBe('matrix')
        expect(sensorClass(6)).toBe('encoder')
        expect(sensorClass(0x7f)).toBe('other')
    })

    it('round-trips the key matrix scan settings by name', () => {
        const ids = [0x30, 0x31, 0x32]
        expect(ids.map(sensorSettingKey)).toEqual([
            'scanPeriodMs',
            'debouncePressMs',
            'debounceReleaseMs',
        ])
        expect(ids.map(sensorSettingKey).map(sensorSettingId)).toEqual(ids)
    })

    it('names the sleep, output and battery settings and battery metrics', () => {
        const ids = [0x33, 0x50, 0x51, 0x60, 0x61, 0x62]
        expect(ids.map(sensorSettingKey)).toEqual([
            'sleepScanMs',
            'sleepMode',
            'sleepDimPct',
            'batteryLowPct',
            'batteryReportMs',
            'batteryShow',
        ])
        expect(ids.map(sensorSettingKey).map(sensorSettingId)).toEqual(ids)
        expect(sensorWireValue('sleepMode', 'dim')).toBe(1)
        expect(sensorWireValue('batteryShow', 'low')).toBe(2)
        expect([0x20, 0x21, 0x22].map(sensorMetricKey)).toEqual([
            'batteryLevel',
            'batteryMv',
            'batteryCharging',
        ])
        expect(sensorClass(13)).toBe('battery')
    })

    it('keys an id it has no name for by its hex', () => {
        expect(sensorSettingKey(0x7e)).toBe('0x7e')
        expect(sensorSettingId('0x7e')).toBe(0x7e)
    })
})
