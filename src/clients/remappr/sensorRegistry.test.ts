// pattern-check: skip vitest cases over the registry lookup tables, no abstraction
import { describe, expect, it } from 'vitest'
import { getCompiler, parseKeymap } from '../../config'
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

    it('names eager press, deadband and the display settings (L3.14)', () => {
        const ids = [0x34, 0x45, 0x70, 0x71, 0x72]
        expect(ids.map(sensorSettingKey)).toEqual([
            'eagerPress',
            'deadband',
            'brightness',
            'invert',
            'rotation',
        ])
        expect(ids.map(sensorSettingKey).map(sensorSettingId)).toEqual(ids)
        expect(sensorWireValue('rotation', 'deg270')).toBe(3)
        expect(sensorWireValue('eagerPress', true)).toBe(1)
    })
})

describe('node.sensor.defaults by the new names (L3.14)', () => {
    const keymap = (defaults: Record<string, unknown>) =>
        parseKeymap(
            JSON.stringify({
                schemaVersion: 1,
                kind: 'remappr.keymap',
                meta: { name: 'Pad', target: 'zmk' },
                keyboard: {
                    id: 'pad',
                    name: 'Pad',
                    keys: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
                    hardware: { transform: { rows: 1, columns: 2, map: [[0, 0], [0, 1]] } },
                },
                layers: [{ name: 'base', bindings: ['A', 'B'] }],
                node: { sensor: { defaults } },
                board: {
                    controller: 'nrf52840dk/nrf52840',
                    matrix: {
                        rows: ['&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)'],
                        cols: ['&gpio0 5 GPIO_ACTIVE_HIGH', '&gpio0 6 GPIO_ACTIVE_HIGH'],
                    },
                    sensor: {
                        part: 'pixart,paw3395',
                        bus: 'arduino_spi',
                        cs: '&gpio1 12 GPIO_ACTIVE_LOW',
                        motion: '&gpio1 10 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)',
                        reset: '&gpio1 11 GPIO_ACTIVE_LOW',
                    },
                },
            }),
        )

    it('takes eagerPress and the display names, and builds them into the board', () => {
        const doc = keymap({ eagerPress: true, deadband: 4, brightness: 80, invert: false, rotation: 'deg90' })
        const res = getCompiler('remappr-board').compile(doc)
        const ov = String(res.files.find((f) => f.filename.endsWith('.overlay'))!.content)
        expect(ov).toMatch(
            /remappr,setting-defaults = <\s+REMAPPR_SENSOR_EAGER_PRESS 1\s+REMAPPR_SENSOR_DEADBAND 4\s+REMAPPR_SENSOR_BRIGHTNESS 80\s+REMAPPR_SENSOR_INVERT 0\s+REMAPPR_SENSOR_ROTATION 1\s+>;/,
        )
    })
})
