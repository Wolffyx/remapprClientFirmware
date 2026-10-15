// pattern-check: skip — JOYSTICK namespace verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import { buildJoystickApi, getAxisConfig, getAxisState } from './joystick'
import {
    JoystickVerb,
    Namespace,
    parseAxisConfig,
    parseAxisState,
    parseCalSuggestion,
    Status,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

function fakeRpc(
    handler: (
        ns: number,
        verb: number,
        arg?: Uint8Array,
    ) => Promise<UniversalReply>,
): RemapprRpc {
    return { callUniversalPlain: handler } as unknown as RemapprRpc
}

// The firmware goldens (tests/control/src/test_control.c
// test_joystick_axis_state_golden / test_joystick_axis_config_golden).
// prettier-ignore
const STATE = new Uint8Array([
    0x01, 0x02,
    0x00, 0x08, 0x00, 0x00,
    0xa0, 0x0f, 0xff, 0x7f,
    0x11, 0x00, 0x00, 0x00,
    0x02,
])
// prettier-ignore
const CONFIG = new Uint8Array([
    0x01, 0x08, 0x02,
    0x00, 0x00, 0x01, 0x08, 0x05, 0x64, 0x00, 0x00, 0x08, 0xa0, 0x0f,
    0x01, 0x03, 0x00, 0x08, 0x05, 0x00, 0x00, 0xd0, 0x07, 0xff, 0x0f,
    0x0c, 0x01,
    0xff, 0x00,
])
/** The same from firmware before the noise filter: the entries only. */
const CONFIG_V1_ENTRIES = CONFIG.subarray(0, 3 + 2 * 11)

// The firmware golden (tests/control/src/test_control.c
// test_joystick_finish_replies_the_suggestion): input 0 suggests inner 4 % /
// outer 6 %, input 1 measured nothing.
const SUGGEST = new Uint8Array([0x01, 0x02, 0x04, 0x06, 0xff, 0xff])

describe('joystick wire (JOYSTICK namespace)', () => {
    it('parses the FINISH suggestion byte for byte', () => {
        expect(parseCalSuggestion(SUGGEST)).toEqual([
            { inner: 4, outer: 6 },
            { inner: null, outer: null },
        ])
        // The other steps, and older firmware, reply nothing.
        expect(parseCalSuggestion(new Uint8Array())).toEqual([])
        expect(() => parseCalSuggestion(SUGGEST.subarray(0, 4))).toThrow()
        expect(() => parseCalSuggestion(new Uint8Array([2, 0]))).toThrow()
    })

    it('returns what FINISH measured', async () => {
        const rpc = fakeRpc(async () => ({ status: Status.OK, data: SUGGEST }))
        const api = buildJoystickApi(rpc, { writable: true })
        expect(await api.calibrate('finish')).toHaveLength(2)
    })

    it('parses GET_AXIS_STATE byte for byte', () => {
        expect(parseAxisState(STATE)).toEqual({
            inputs: [
                { raw: 2048, value: 0 },
                { raw: 4000, value: 32767 },
            ],
            buttons: 0x11,
            hat: 2,
        })
    })

    it('parses GET_AXIS_CONFIG byte for byte', () => {
        expect(parseAxisConfig(CONFIG)).toEqual({
            hatWays: 8,
            axes: [
                {
                    out: 0,
                    flags: 0,
                    curve: 1,
                    inner: 8,
                    outer: 5,
                    min: 100,
                    centre: 2048,
                    max: 4000,
                    fuzz: 12,
                    canUndo: true,
                },
                {
                    out: 1,
                    flags: 3,
                    curve: 0,
                    inner: 8,
                    outer: 5,
                    min: 0,
                    centre: 2000,
                    max: 4095,
                    fuzz: 255,
                    canUndo: false,
                },
            ],
        })
    })

    it('reads the noise filter and undo from the tail, when there is one', () => {
        const [a, b] = parseAxisConfig(CONFIG).axes
        expect([a?.fuzz, a?.canUndo]).toEqual([12, true])
        expect([b?.fuzz, b?.canUndo]).toEqual([255, false])
        const old = parseAxisConfig(CONFIG_V1_ENTRIES).axes[0]
        expect(old).not.toHaveProperty('fuzz')
        expect(old).not.toHaveProperty('canUndo')
    })

    it('refuses a short or unknown reply', () => {
        expect(() => parseAxisState(STATE.subarray(0, 10))).toThrow()
        expect(() =>
            parseAxisState(new Uint8Array([2, 0, 0, 0, 0, 0, 0])),
        ).toThrow()
        expect(() => parseAxisConfig(CONFIG.subarray(0, 20))).toThrow()
    })

    it('reads over the JOYSTICK namespace', async () => {
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.JOYSTICK)
            const data = verb === JoystickVerb.GET_AXIS_STATE ? STATE : CONFIG
            return { status: Status.OK, data }
        })
        expect((await getAxisState(rpc)).hat).toBe(2)
        expect((await getAxisConfig(rpc)).axes).toHaveLength(2)
    })

    it('encodes calibrate, the axis map and the deadzones', async () => {
        const seen: [number, number[]][] = []
        const rpc = fakeRpc(async (_ns, verb, arg) => {
            seen.push([verb, Array.from(arg ?? [])])
            return { status: Status.OK, data: new Uint8Array() }
        })
        const api = buildJoystickApi(rpc, { writable: true })
        await api.calibrate('finish')
        await api.calibrate('begin', 1)
        await api.calibrate('undo')
        await api.setAxisMap(1, null, { invert: true })
        await api.setAxisMap(0, 0, { invert: false, radial: true })
        await api.setDeadzone(0, 10, 5)
        expect(seen).toEqual([
            [JoystickVerb.CALIBRATE, [0xff, 2]],
            [JoystickVerb.CALIBRATE, [1, 0]],
            [JoystickVerb.CALIBRATE, [0xff, 5]],
            [JoystickVerb.SET_AXIS_MAP, [1, 0xff, 1]],
            [JoystickVerb.SET_AXIS_MAP, [0, 0, 2]],
            [JoystickVerb.SET_DEADZONE, [0, 10, 5]],
        ])
    })

    it('names the status of a refused step', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_STATE,
            data: new Uint8Array(),
        }))
        await expect(
            buildJoystickApi(rpc, { writable: true }).calibrate('finish'),
        ).rejects.toThrow(/ERR_STATE/)
    })

    it('keeps the reads and rejects changes when read-only', async () => {
        const rpc = fakeRpc(async () => ({ status: Status.OK, data: STATE }))
        const api = buildJoystickApi(rpc, { writable: false })
        expect((await api.getState()).buttons).toBe(0x11)
        await expect(api.calibrate('begin')).rejects.toThrow(/Read-only/)
        await expect(api.setDeadzone(0, 1, 1)).rejects.toThrow(/Read-only/)
    })
})
