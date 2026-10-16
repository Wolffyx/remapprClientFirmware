// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import type { SensorInfo } from '../../devices/types'
import {
    buildRemapprDeviceBlob,
    decodeRemapprDeviceBlob,
    getCompiler,
    parseDeviceConfig,
    parseKeymap,
} from '../index'
import { readBlobFrames, DecodeCode } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'
import { sensorEntries } from '../compilers/remappr/sensor'

const MOUSE = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Desk mouse' },
    personality: 'mouse',
    sensor: { settings: { liftCutoff: '2mm', angleSnap: true, angleTune: -5 } },
}

// The TBL_SENSOR payload pinned by the firmware test
// tests/config_blob/src/test_sensor_decode.c (sensor 0: lift cut-off 2 mm,
// angle snap on, angle tune -5 degrees).
// prettier-ignore
const SENSOR_PAYLOAD = [
    0x03, 0x00,
    0x00, 0x10, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00,
    0x00, 0x11, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x12, 0x00, 0x00, 0xfb, 0xff, 0xff, 0xff,
]

/** The payload of table `id` in `blob`. */
function tableOf(blob: Uint8Array, id: number): number[] | undefined {
    const parsed = readBlobFrames(blob)
    const f = parsed.frames.find((x) => x.id === id)
    return f ? Array.from(blob.subarray(f.start, f.end)) : undefined
}

const setting = (
    name: string,
    over: Partial<SensorInfo['settings'][number]> = {},
): SensorInfo['settings'][number] => ({
    name,
    label: name,
    type: 'int',
    unit: '',
    advanced: false,
    default: 0,
    value: 0,
    personality: false,
    ...over,
})

const PAW: SensorInfo = {
    index: 0,
    cls: 'pointer',
    model: 'PAW3395',
    settings: [
        setting('resolution', { personality: true, min: 50, max: 26000 }),
        setting('liftCutoff', {
            type: 'enum',
            options: [
                { value: 10, label: '1 mm' },
                { value: 20, label: '2 mm' },
                { value: 0, label: 'Calibrated' },
            ],
        }),
        setting('angleSnap', { type: 'bool' }),
        setting('angleTune', { min: -30, max: 30, step: 1 }),
    ],
    procedures: [],
    metrics: [],
}

describe('TBL_SENSOR in a device document', () => {
    it('encodes the firmware golden byte for byte', () => {
        const blob = buildRemapprDeviceBlob(
            parseDeviceConfig(JSON.stringify(MOUSE)),
            {
                configVersion: 2,
            },
        )
        expect(tableOf(blob, TableId.Sensor)).toEqual(SENSOR_PAYLOAD)
        expect(
            readBlobFrames(blob).frames.find((f) => f.id === TableId.Sensor)
                ?.version,
        ).toBe(1)
    })

    it('round-trips through the decoder, an option name read back as its code', () => {
        const cfg = parseDeviceConfig(JSON.stringify(MOUSE))
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        const r = decodeRemapprDeviceBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.sensor).toEqual({
            settings: { liftCutoff: 20, angleSnap: true, angleTune: -5 },
        })
        const again = buildRemapprDeviceBlob(
            { ...cfg, sensor: r.sensor },
            { configVersion: 2 },
        )
        expect(again).toEqual(blob)
    })

    it('names a second sensor by index, and an unnamed id by hex', () => {
        const cfg = parseDeviceConfig(
            JSON.stringify({
                ...MOUSE,
                sensor: { index: 1, settings: { '0x3f': 7 } },
            }),
        )
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        expect(tableOf(blob, TableId.Sensor)).toEqual([
            0x01, 0x00, 0x01, 0x3f, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00,
        ])
        expect(decodeRemapprDeviceBlob(blob).sensor).toEqual({
            index: 1,
            settings: { '0x3f': 7 },
        })
    })

    it('writes no table without sensor values', () => {
        const blob = buildRemapprDeviceBlob(
            parseDeviceConfig(
                JSON.stringify({ ...MOUSE, sensor: { settings: {} } }),
            ),
            { configVersion: 2 },
        )
        expect(tableOf(blob, TableId.Sensor)).toBeUndefined()
        expect(decodeRemapprDeviceBlob(blob).sensor).toBeUndefined()
    })

    it('leaves out what the device would refuse, given its description', () => {
        const { entries, skipped } = sensorEntries(
            {
                resolution: 800,
                motionSync: true,
                angleTune: 45,
                liftCutoff: 'calibrated',
                angleSnap: false,
            },
            0,
            [PAW],
        )
        expect(entries).toEqual([
            { sensor: 0, id: 0x10, value: 0 },
            { sensor: 0, id: 0x11, value: 0 },
        ])
        expect(skipped.map((s) => s.key)).toEqual([
            'resolution',
            'motionSync',
            'angleTune',
        ])
        expect(
            sensorEntries({ angleSnap: true }, 1, [PAW]).skipped,
        ).toHaveLength(1)
        // Without a description only the names are resolved.
        expect(sensorEntries({ motionSync: true }, 0).entries).toEqual([
            { sensor: 0, id: 0x15, value: 1 },
        ])
        // A name and its hex are one setting: the later one wins.
        expect(sensorEntries({ angleTune: 1, '0x12': 2 }, 0).entries).toEqual([
            { sensor: 0, id: 0x12, value: 2 },
        ])
    })

    it('refuses a bad option and a section the device does not read', () => {
        const bad =
            (sensor: unknown, personality = 'mouse') =>
            () =>
                parseDeviceConfig(
                    JSON.stringify({ ...MOUSE, personality, sensor }),
                )
        expect(bad({ settings: { liftCutoff: '3mm' } })).toThrow()
        expect(bad({ settings: { angleSnap: 'on' } })).toThrow()
        expect(bad({ settings: { liftCutoff: 20 } }, 'joystick')).toThrow()
        // A name nobody registered is kept (and not compiled).
        expect(bad({ settings: { futureThing: 3 } })).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// JSON config: node.sensor.defaults and board.sensor
// ---------------------------------------------------------------------------

const keymap = (node: unknown, board?: unknown) =>
    parseKeymap(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'Track Pad', target: 'zmk' },
            keyboard: {
                id: 'track_pad',
                name: 'Track Pad',
                keys: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                ],
                hardware: {
                    transform: {
                        rows: 1,
                        columns: 2,
                        map: [
                            [0, 0],
                            [0, 1],
                        ],
                    },
                },
            },
            layers: [{ name: 'base', bindings: ['A', 'B'] }],
            node,
            ...(board ? { board } : {}),
        }),
    )

const DEFAULTS = {
    sensor: {
        defaults: {
            liftCutoff: '2mm',
            angleSnap: true,
            angleTune: -5,
        },
    },
}

describe('node.sensor.defaults', () => {
    it('takes registry names with values their type allows', () => {
        expect(() => keymap(DEFAULTS)).not.toThrow()
        expect(() => keymap({ sensor: { defaults: { liftOff: 20 } } })).toThrow(
            /not a sensor setting name/,
        )
        expect(() =>
            keymap({ sensor: { defaults: { performanceMode: 'turbo' } } }),
        ).toThrow(/not an option of performanceMode/)
        expect(() =>
            keymap({ sensor: { defaults: { '0x3f': 1 } } }),
        ).not.toThrow()
    })

    it('reaches the keymap blob as TBL_SENSOR for the first sensor', () => {
        const res = getCompiler('remappr').compile(keymap(DEFAULTS))
        const blob = res.files.find((f) => f.content instanceof Uint8Array)
            ?.content as Uint8Array
        expect(tableOf(blob, TableId.Sensor)).toEqual(SENSOR_PAYLOAD)
    })

    it('is built into the board as remappr,setting-defaults on board.sensor', () => {
        const res = getCompiler('remappr-board').compile(
            keymap(DEFAULTS, {
                controller: 'nrf52840dk/nrf52840',
                matrix: {
                    rows: ['&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)'],
                    cols: [
                        '&gpio0 5 GPIO_ACTIVE_HIGH',
                        '&gpio0 6 GPIO_ACTIVE_HIGH',
                    ],
                },
                sensor: {
                    part: 'pixart,paw3395',
                    bus: 'arduino_spi',
                    cs: '&gpio1 12 GPIO_ACTIVE_LOW',
                    motion: '&gpio1 10 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)',
                    reset: '&gpio1 11 GPIO_ACTIVE_LOW',
                },
            }),
        )
        const ov = String(
            res.files.find((f) => f.filename.endsWith('.overlay'))!.content,
        )
        expect(ov).toContain('#include <dt-bindings/remappr/sensor.h>')
        expect(ov).toContain('&arduino_spi {')
        expect(ov).toContain('cs-gpios = <&gpio1 12 GPIO_ACTIVE_LOW>;')
        expect(ov).toContain('remappr_sensor: paw3395@0 {')
        expect(ov).toContain('compatible = "pixart,paw3395";')
        expect(ov).toContain('spi-max-frequency = <8000000>;')
        expect(ov).toContain(
            'motion-gpios = <&gpio1 10 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>;',
        )
        expect(ov).toContain('reset-gpios = <&gpio1 11 GPIO_ACTIVE_LOW>;')
        expect(ov).toContain('zephyr,axis-x = <INPUT_REL_X>;')
        expect(ov).toMatch(
            /remappr,setting-defaults = <\s+REMAPPR_SENSOR_LIFT_CUTOFF 20\s+REMAPPR_SENSOR_ANGLE_SNAP 1\s+REMAPPR_SENSOR_ANGLE_TUNE \(-5\)\s+>;/,
        )
    })

    it('emits no sensor node without board.sensor', () => {
        const res = getCompiler('remappr-board').compile(keymap(DEFAULTS))
        const ov = String(
            res.files.find((f) => f.filename.endsWith('.overlay'))!.content,
        )
        expect(ov).not.toContain('remappr,setting-defaults')
        expect(ov).not.toContain('dt-bindings/remappr/sensor.h')
    })
})
