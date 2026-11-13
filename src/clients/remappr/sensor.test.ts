// pattern-check: skip — SENSOR namespace verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import type { DiscoveryResult } from './discovery'
import {
    buildSensorRunArg,
    buildSensorSetArg,
    Namespace,
    parseSensorIoPage,
    parseSensorSuggestions,
    parseSensorApplied,
    parseSensorMetrics,
    parseSensorProcedure,
    parseSensorSetting,
    parseSensorsPage,
    parseSensorStatus,
    SensorVerb,
    Status,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'
import { buildSensorApi, describeSensors, sensorIo, servesSensor } from './sensor'

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

// The firmware goldens (tests/sensor_settings/src/test_wire.c).
// prettier-ignore
const SENSORS = new Uint8Array([
    0x01, 0x02, 0x02,
    0x00, 0x01, 0x95, 0x33, 0x05, 0x01, 0x02,
    0x08, ...ascii('FAKE3395'),
    0x01, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x04, ...ascii('BARE'),
])
// prettier-ignore
const ANGLE_TUNE = new Uint8Array([
    0x01, 0x12, 0x02, 0x00, 0x03,
    0xf4, 0xff, 0xff, 0xff, // value -12
    0x00, 0x00, 0x00, 0x00, // default 0
    0xe2, 0xff, 0xff, 0xff, // min -30
    0x1e, 0x00, 0x00, 0x00, // max 30
    0x01, 0x00, 0x00, 0x00, // step 1
    0x0a, ...ascii('Angle tune'),
])
// prettier-ignore
const LIFT = new Uint8Array([
    0x01, 0x10, 0x03, 0x02, 0x00,
    0x14, 0x00, 0x00, 0x00, // value 2 mm
    0x0a, 0x00, 0x00, 0x00, // default 1 mm
    0x03, 0x0a, 0x14, 0x00, // 1 mm, 2 mm, calibrated
    0x04, 0x01, // calibrated gated by lift calibration
    0x04, ...ascii('Lift'),
])
// prettier-ignore
const SNAP = new Uint8Array([
    0x01, 0x11, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x04, ...ascii('Snap'),
])
const PROC = new Uint8Array([
    0x01,
    0x01,
    0x02,
    0x01,
    0x08,
    ...ascii('Lift cal'),
])
/** An 8-byte status (firmware before the flags byte). */
const STATUS = new Uint8Array([0x01, 0x01, 0x02, 0xb0, 0x04, 0xb8, 0x0b, 0x00])
/** Idle with a stored result: the 9th byte's bit0 is HAS_RESULT. */
const STORED = new Uint8Array([0x01, 0x00, 0x00, 0, 0, 0, 0, 0x00, 0x01])
// prettier-ignore
const METRICS = new Uint8Array([
    0x01, 0x02,
    0x01, 0x96, 0x00, 0x00, 0x00, 0xb6, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
])
const APPLIED = new Uint8Array([0x20, 0x03, 0x00, 0x00])

describe('sensor wire (SENSOR namespace)', () => {
    it('parses GET_SENSORS byte for byte', () => {
        expect(parseSensorsPage(SENSORS)).toEqual({
            total: 2,
            sensors: [
                {
                    index: 0,
                    cls: 1,
                    modelId: 0x3395,
                    channels: 1,
                    settings: 5,
                    procedures: 1,
                    metrics: 2,
                    io: 0,
                    name: 'FAKE3395',
                },
                {
                    index: 1,
                    cls: 3,
                    modelId: 1,
                    channels: 1,
                    settings: 0,
                    procedures: 0,
                    metrics: 0,
                    io: 0,
                    name: 'BARE',
                },
            ],
        })
        expect(() => parseSensorsPage(SENSORS.subarray(0, 12))).toThrow()
        expect(() => parseSensorsPage(new Uint8Array([3, 0, 0]))).toThrow()
    })

    it('parses each setting type byte for byte', () => {
        expect(parseSensorSetting(ANGLE_TUNE)).toEqual({
            id: 0x12,
            type: 2,
            flags: 0,
            unit: 3,
            ch: 0,
            value: -12,
            dflt: 0,
            min: -30,
            max: 30,
            step: 1,
            name: 'Angle tune',
        })
        expect(parseSensorSetting(LIFT)).toEqual({
            id: 0x10,
            type: 3,
            flags: 2,
            unit: 0,
            ch: 0,
            value: 20,
            dflt: 10,
            options: [10, 20, 0],
            gatedMask: 4,
            procedure: 1,
            name: 'Lift',
        })
        expect(parseSensorSetting(SNAP)).toMatchObject({
            id: 0x11,
            type: 1,
            value: 1,
            name: 'Snap',
        })
        expect(() => parseSensorSetting(LIFT.subarray(0, 18))).toThrow()
    })

    it('parses a procedure, its status, the readings and an applied value', () => {
        expect(parseSensorProcedure(PROC)).toEqual({
            id: 1,
            phases: 2,
            flags: 1,
            name: 'Lift cal',
        })
        expect(parseSensorStatus(STATUS)).toEqual({
            state: 1,
            phase: 2,
            progress: 1200,
            total: 3000,
            result: 0,
        })
        expect(parseSensorStatus(STATUS)).not.toHaveProperty('flags')
        expect(parseSensorStatus(STORED)).toEqual({
            state: 0,
            phase: 0,
            progress: 0,
            total: 0,
            result: 0,
            flags: 1,
        })
        expect(parseSensorMetrics(METRICS)).toEqual([
            { id: 1, value: 150, max: 182 },
            { id: 2, value: 0, max: 1 },
        ])
        expect(parseSensorApplied(APPLIED)).toBe(800)
        expect(buildSensorSetArg(0, 0x12, -5, 0, 0)).toEqual(
            new Uint8Array([0x00, 0x12, 0xfb, 0xff, 0xff, 0xff]),
        )
    })
})

// The PART v1 goldens (firmware tests/part_settings/src/test_wire.c).
// prettier-ignore
const PARTS_V2 = new Uint8Array([
    0x02, 0x02, 0x02,
    0x00, 0x01, 0x95, 0x33, 0x01, 0x05, 0x01, 0x02, 0x00,
    0x08, ...ascii('FAKE3395'),
    0x01, 0x03, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x04, ...ascii('BARE'),
])
// prettier-ignore
const ANGLE_TUNE_V2 = new Uint8Array([
    0x02, 0x12, 0x02, 0x00, 0x03, 0x00,
    0xf4, 0xff, 0xff, 0xff,
    0x00, 0x00, 0x00, 0x00,
    0xe2, 0xff, 0xff, 0xff,
    0x1e, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x0a, ...ascii('Angle tune'),
])
// prettier-ignore
const IO = new Uint8Array([
    0x01, 0x02, 0x02,
    0x02, 0x00, 0x06, 0x00, 0x0c, 0x00, 0x00, 0x00,
    0x84, 0x00, 0x01, 0x00, 0x80, 0x00, 0x40, 0x00,
])
// prettier-ignore
const SUGGEST = new Uint8Array([
    0x01, 0x02,
    0x43, 0x07, 0x00, 0x00, 0x00,
    0x44, 0x03, 0x00, 0x00, 0x00,
])

describe('part wire (PART namespace v1)', () => {
    it('parses GET_PARTS with channels and IO counts', () => {
        expect(parseSensorsPage(PARTS_V2).sensors[0]).toEqual({
            index: 0,
            cls: 1,
            modelId: 0x3395,
            channels: 1,
            settings: 5,
            procedures: 1,
            metrics: 2,
            io: 0,
            name: 'FAKE3395',
        })
        expect(parseSensorsPage(PARTS_V2).sensors[1]!.name).toBe('BARE')
        expect(() => parseSensorsPage(PARTS_V2.subarray(0, 14))).toThrow()
    })

    it('parses a setting with its channel', () => {
        expect(parseSensorSetting(ANGLE_TUNE_V2)).toEqual({
            id: 0x12,
            type: 2,
            flags: 0,
            unit: 3,
            ch: 0,
            value: -12,
            dflt: 0,
            min: -30,
            max: 30,
            step: 1,
            name: 'Angle tune',
        })
        const ch3 = ANGLE_TUNE_V2.slice()
        ch3[5] = 3
        expect(parseSensorSetting(ch3).ch).toBe(3)
    })

    it('parses IO and suggestions', () => {
        expect(parseSensorIoPage(IO)).toEqual({
            total: 2,
            io: [
                { kind: 0x02, firstCh: 0, count: 6, flags: 0, a: 12, b: 0 },
                { kind: 0x84, firstCh: 0, count: 1, flags: 0, a: 128, b: 64 },
            ],
        })
        expect(parseSensorSuggestions(SUGGEST)).toEqual([
            { id: 0x43, value: 7 },
            { id: 0x44, value: 3 },
        ])
    })

    it('marks WAKE inputs with their latency, never an output', () => {
        const key = { kind: 0x01, firstCh: 0, count: 4, flags: 0x80, a: 0, b: 10 }
        expect(sensorIo(key)).toMatchObject({ kind: 'key', wake: { latencyMs: 10 } })
        expect(sensorIo({ ...key, flags: 0 })).not.toHaveProperty('wake')
        expect(sensorIo({ ...key, kind: 0x84, b: 64 })).not.toHaveProperty('wake')
    })

    it('builds SET and RUN args with a channel', () => {
        expect(buildSensorSetArg(0, 0x43, 9, 2)).toEqual(
            new Uint8Array([0x00, 0x43, 0x02, 0x09, 0x00, 0x00, 0x00]),
        )
        expect(buildSensorRunArg(1, 2, 0, 0xff)).toEqual(
            new Uint8Array([1, 2, 0, 0xff]),
        )
        expect(buildSensorRunArg(1, 2, 0, 0, 0)).toEqual(new Uint8Array([1, 2, 0]))
    })
})

// ---------------------------------------------------------------------------

interface Call {
    ns: number
    verb: number
    arg: number[]
    opts?: { targetNode?: number; retries?: number }
}

/** One sensor with the three settings above, the lift calibration and two
 *  readings — plus a setting id this client has no name for. */
// prettier-ignore
const UNKNOWN = new Uint8Array([
    0x01, 0x3f, 0x02, 0x01, 0x01,
    0x05, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x06, ...ascii('Future'),
])
const SETTINGS = [LIFT, SNAP, ANGLE_TUNE, UNKNOWN]
// prettier-ignore
const ONE_SENSOR = new Uint8Array([
    0x01, 0x01, 0x01,
    0x00, 0x01, 0x95, 0x33, 0x04, 0x01, 0x02,
    0x07, ...ascii('PAW3395'),
])

function fakeRpc(over?: (c: Call) => UniversalReply | undefined) {
    const calls: Call[] = []
    const ok = (data: Uint8Array): UniversalReply => ({
        status: Status.OK,
        data,
    })
    const rpc = {
        callUniversalPlain: (
            ns: number,
            verb: number,
            arg?: Uint8Array,
            opts?: Call['opts'],
        ) => {
            const c: Call = { ns, verb, arg: [...(arg ?? [])], opts }
            calls.push(c)
            const o = over?.(c)
            if (o) return Promise.resolve(o)
            switch (verb) {
                case SensorVerb.GET_SENSORS:
                    return Promise.resolve(ok(ONE_SENSOR))
                case SensorVerb.GET_SETTING:
                    return Promise.resolve(ok(SETTINGS[c.arg[1]!]!))
                case SensorVerb.GET_PROCEDURE:
                    return Promise.resolve(ok(PROC))
                case SensorVerb.GET_METRICS:
                    return Promise.resolve(ok(METRICS))
                case SensorVerb.SET_SETTING:
                    return Promise.resolve(ok(APPLIED.slice(0, 4)))
                default:
                    return Promise.resolve(ok(STATUS))
            }
        },
    } as unknown as RemapprRpc
    return { rpc, calls }
}

describe('SensorApi', () => {
    it('serves only when the personality map lists the namespace', () => {
        const d = (ns: number[]) =>
            ({
                personality: {
                    namespaces: ns.map((namespace) => ({ namespace })),
                },
            }) as unknown as DiscoveryResult
        expect(servesSensor(d([Namespace.MOUSE, Namespace.SENSOR]))).toBe(true)
        expect(servesSensor(d([Namespace.MOUSE]))).toBe(false)
        expect(servesSensor({} as DiscoveryResult)).toBe(false)
    })

    it('describes a sensor by registry names, labels and types', async () => {
        const { rpc, calls } = fakeRpc()
        const [s] = await describeSensors(rpc)
        expect(calls.every((c) => c.ns === Namespace.SENSOR)).toBe(true)
        expect(s).toMatchObject({ index: 0, cls: 'pointer', model: 'PAW3395' })
        expect(s!.settings.map((x) => x.name)).toEqual([
            'liftCutoff',
            'angleSnap',
            'angleTune',
            '0x3f',
        ])
        expect(s!.settings[0]).toMatchObject({
            label: 'Lift-off distance',
            type: 'enum',
            value: 20,
            default: 10,
            options: [
                { value: 10, label: '1 mm' },
                { value: 20, label: '2 mm' },
                { value: 0, label: 'Calibrated', needs: 'liftCalibration' },
            ],
        })
        expect(s!.settings[1]).toMatchObject({
            type: 'bool',
            value: true,
            default: false,
        })
        expect(s!.settings[2]).toMatchObject({
            unit: 'deg',
            min: -30,
            max: 30,
            step: 1,
            value: -12,
        })
        // An id the registry does not have: the device's own name, advanced.
        expect(s!.settings[3]).toMatchObject({
            label: 'Future',
            unit: 'ms',
            advanced: true,
            personality: false,
        })
        expect(s!.procedures).toEqual([
            expect.objectContaining({
                name: 'liftCalibration',
                hasResult: true,
                phases: expect.arrayContaining([expect.any(String)]),
            }),
        ])
        expect(s!.metrics).toEqual([
            { name: 'surfaceQuality', label: 'Surface quality', max: 182 },
            { name: 'lifted', label: 'Lifted', max: 1 },
        ])
    })

    it('describes without readings while a procedure holds the sensor', async () => {
        const { rpc } = fakeRpc((c) =>
            c.verb === SensorVerb.GET_METRICS
                ? { status: Status.ERR_STATE, data: new Uint8Array() }
                : undefined,
        )
        const [s] = await describeSensors(rpc)
        expect(s!.metrics).toEqual([])
    })

    it('sets by name and resolves to the value the hardware took', async () => {
        const { rpc, calls } = fakeRpc()
        const api = buildSensorApi(rpc, { writable: true })
        expect(await api.setSetting(0, 'angleTune', -5)).toBe(800)
        expect(calls.at(-1)).toMatchObject({
            verb: SensorVerb.SET_SETTING,
            arg: [0x00, 0x12, 0xfb, 0xff, 0xff, 0xff],
        })
        expect(await api.setSetting(0, 'angleSnap', true)).toBe(true)
        expect(calls.at(-1)!.arg.slice(0, 3)).toEqual([0x00, 0x11, 0x01])
        await api.setSetting(0, '0x3f', 7)
        expect(calls.at(-1)!.arg[1]).toBe(0x3f)
        await expect(api.setSetting(0, 'nope', 1)).rejects.toThrow('nope')
    })

    it('runs a procedure step by step', async () => {
        const { rpc, calls } = fakeRpc()
        const api = buildSensorApi(rpc, { writable: true })
        expect(await api.runProcedure(0, 'liftCalibration', 'next')).toEqual({
            state: 'running',
            phase: 2,
            progress: 1200,
            total: 3000,
            ok: true,
        })
        expect(calls.at(-1)).toMatchObject({
            verb: SensorVerb.RUN_PROCEDURE,
            arg: [0, 1, 1],
        })
        expect(await api.getMetrics(0)).toEqual([
            { name: 'surfaceQuality', value: 150, max: 182 },
            { name: 'lifted', value: 0, max: 1 },
        ])
    })

    it('says whether a result is stored, when the firmware tells', async () => {
        const reply = (data: Uint8Array) =>
            fakeRpc((c) =>
                c.verb === SensorVerb.GET_PROCEDURE_STATUS
                    ? { status: Status.OK, data }
                    : undefined,
            ).rpc
        const status = (data: Uint8Array) =>
            buildSensorApi(reply(data), { writable: true }).getProcedureStatus(
                0,
                'liftCalibration',
            )
        expect(await status(STORED)).toMatchObject({
            state: 'idle',
            hasResult: true,
        })
        expect(
            await status(new Uint8Array([...STORED.subarray(0, 8), 0x00])),
        ).toMatchObject({ hasResult: false })
        expect(await status(STATUS)).not.toHaveProperty('hasResult')
    })

    it('surfaces a refusal by its status', async () => {
        const { rpc } = fakeRpc((c) =>
            c.verb === SensorVerb.SET_SETTING
                ? { status: Status.ERR_STATE, data: new Uint8Array() }
                : undefined,
        )
        const api = buildSensorApi(rpc, { writable: true })
        await expect(api.setSetting(0, 'liftCutoff', 0)).rejects.toThrow(
            'ERR_STATE',
        )
    })

    it('relays reads and changes to a node behind the dongle', async () => {
        const { rpc, calls } = fakeRpc()
        const api = buildSensorApi(rpc, { targetNode: 2, writable: true })
        await api.getSensors()
        expect(
            calls.every(
                (c) => c.opts?.targetNode === 2 && (c.opts.retries ?? 0) > 0,
            ),
        ).toBe(true)
        calls.length = 0
        await api.setSetting(0, 'angleSnap', true)
        await api.runProcedure(0, 'liftCalibration', 'begin')
        const [set, run] = calls
        // An absolute value may be sent again; a procedure step never is.
        expect(set!.verb).toBe(SensorVerb.SET_SETTING)
        expect(set!.opts?.targetNode).toBe(2)
        expect(set!.opts?.retries ?? 0).toBeGreaterThan(0)
        expect(run!.verb).toBe(SensorVerb.RUN_PROCEDURE)
        expect(run!.opts?.targetNode).toBe(2)
        expect(run!.opts?.retries ?? 0).toBe(0)
    })

    it('keeps the reads and refuses every change when read-only', async () => {
        const { rpc } = fakeRpc()
        const api = buildSensorApi(rpc, { targetNode: 2, writable: false })
        await api.getSensors()
        await expect(api.setSetting(0, 'angleSnap', true)).rejects.toThrow(
            'Read-only',
        )
        await expect(
            api.runProcedure(0, 'liftCalibration', 'begin'),
        ).rejects.toThrow('Read-only')
    })
})

describe('SensorApi on a PART v1 device', () => {
    // prettier-ignore
    const AXES = new Uint8Array([
        0x02, 0x01, 0x01,
        0x00, 0x04, 0x01, 0x00, 0x02, 0x01, 0x01, 0x00, 0x00,
        0x04, ...ascii('Axes'),
    ])
    // Centre deadzone, PER_CHANNEL; the value is the asked channel's * 10.
    const inner = (ch: number) =>
        // prettier-ignore
        new Uint8Array([
            0x02, 0x43, 0x02, 0x08, 0x05, ch,
            ch * 10, 0, 0, 0, 5, 0, 0, 0,
            0, 0, 0, 0, 99, 0, 0, 0, 1, 0, 0, 0,
            0x05, ...ascii('Inner'),
        ])
    // prettier-ignore
    const CAL = new Uint8Array([0x01, 0x02, 0x02, 0x03, 0x03, ...ascii('Cal')])

    function v1Rpc() {
        return fakeRpc((c) => {
            const ok = (data: Uint8Array) => ({ status: Status.OK, data })
            if (c.verb === SensorVerb.GET_SENSORS) return ok(AXES)
            if (c.verb === SensorVerb.GET_SETTING) return ok(inner(c.arg[2] ?? 0))
            if (c.verb === SensorVerb.GET_PROCEDURE) return ok(CAL)
            if (c.verb === SensorVerb.GET_PROCEDURE_RESULT) return ok(SUGGEST)
            return undefined
        })
    }

    it('reads a per-channel setting on every channel', async () => {
        const { rpc, calls } = v1Rpc()
        const [s] = await describeSensors(rpc)
        expect(s).toMatchObject({ cls: 'analog', channels: 2, io: [] })
        expect(s!.settings[0]).toMatchObject({
            name: 'deadzoneInner',
            perChannel: true,
            value: 0,
            channels: [
                { value: 0, default: 5 },
                { value: 10, default: 5 },
            ],
        })
        const reads = calls.filter((c) => c.verb === SensorVerb.GET_SETTING)
        expect(reads.map((c) => c.arg)).toEqual([
            [0, 0],
            [0, 0, 1],
        ])
        expect(s!.procedures[0]).toMatchObject({ perChannel: true, hasResult: true })
    })

    it('sets, runs and reads suggestions with a channel', async () => {
        const { rpc, calls } = v1Rpc()
        const api = buildSensorApi(rpc, { writable: true })
        await api.setSetting(0, 'deadzoneInner', 9, 1)
        expect(calls.at(-1)).toMatchObject({
            verb: SensorVerb.SET_SETTING,
            arg: [0, 0x43, 1, 9, 0, 0, 0],
        })
        await api.runProcedure(0, 'axisCalibration', 'undo', 'all')
        expect(calls.at(-1)).toMatchObject({
            verb: SensorVerb.RUN_PROCEDURE,
            arg: [0, 2, 4, 0xff],
        })
        expect(await api.getSuggestions(0, 'axisCalibration', 1)).toEqual([
            { name: 'deadzoneInner', value: 7 },
            { name: 'deadzoneOuter', value: 3 },
        ])
        expect(calls.at(-1)!.arg).toEqual([0, 2, 1])
    })

    it('asks a v0 device nothing it cannot answer', async () => {
        const { rpc, calls } = fakeRpc()
        const api = buildSensorApi(rpc, { writable: true })
        expect(await api.getSuggestions(0, 'liftCalibration')).toEqual([])
        expect(calls.some((c) => c.verb === SensorVerb.GET_PROCEDURE_RESULT)).toBe(
            false,
        )
    })
})
