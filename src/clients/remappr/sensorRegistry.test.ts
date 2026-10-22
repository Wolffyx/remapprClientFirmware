// pattern-check: skip vitest cases over the registry lookup tables, no abstraction
import { describe, expect, it } from 'vitest'
import {
    sensorClass,
    sensorSettingId,
    sensorSettingKey,
} from './sensorRegistry'

describe('part registry', () => {
    it('names every class the firmware registry has, others as "other"', () => {
        expect(sensorClass(1)).toBe('pointer')
        expect(sensorClass(5)).toBe('matrix')
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

    it('keys an id it has no name for by its hex', () => {
        expect(sensorSettingKey(0x7e)).toBe('0x7e')
        expect(sensorSettingId('0x7e')).toBe(0x7e)
    })
})
