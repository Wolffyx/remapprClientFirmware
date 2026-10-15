// pattern-check: skip — JOYSTICK namespace verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import { buildJoystickApi, getAxisConfig, getAxisState } from './joystick'
import {
    JoystickVerb,
    Namespace,
    parseAxisConfig,
    parseAxisState,
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
    0x01, 0x01, 0x00, 0x08, 0x05, 0x00, 0x00, 0xd0, 0x07, 0xff, 0x0f,
])

describe('joystick wire (JOYSTICK namespace)', () => {
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
                },
                {
                    out: 1,
                    flags: 1,
                    curve: 0,
                    inner: 8,
                    outer: 5,
                    min: 0,
                    centre: 2000,
                    max: 4095,
                },
            ],
        })
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
        await api.setAxisMap(1, null, true)
        await api.setDeadzone(0, 10, 5)
        expect(seen).toEqual([
            [JoystickVerb.CALIBRATE, [0xff, 2]],
            [JoystickVerb.CALIBRATE, [1, 0]],
            [JoystickVerb.SET_AXIS_MAP, [1, 0xff, 1]],
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
