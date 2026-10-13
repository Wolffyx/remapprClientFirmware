// pattern-check: skip — MOUSE namespace verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import {
    buildMouseMotionApi,
    getMotionConfig,
    setAccelProfile,
    setDpi,
    setScrollMode,
} from './mouse'
import { MouseVerb, Namespace, Status } from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

function fakeRpc(
    handler: (
        ns: number,
        verb: number,
        arg?: Uint8Array,
        opts?: { targetNode?: number },
    ) => Promise<UniversalReply>,
): RemapprRpc {
    return { callUniversalPlain: handler } as unknown as RemapprRpc
}

// 12-byte motion-config reply.
function cfg(
    min: number,
    max: number,
    step: number,
    dpi: number,
    accel: number,
    scroll: number,
    version = 1,
): Uint8Array {
    const b = new Uint8Array(12)
    const dv = new DataView(b.buffer)
    b[0] = version
    dv.setUint16(2, min, true)
    dv.setUint16(4, max, true)
    dv.setUint16(6, step, true)
    dv.setUint16(8, dpi, true)
    b[10] = accel
    b[11] = scroll
    return b
}

describe('mouse motion control (MOUSE namespace)', () => {
    it('getMotionConfig decodes the 12-byte frame', async () => {
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.MOUSE)
            expect(verb).toBe(MouseVerb.GET_MOTION_CONFIG)
            return { status: Status.OK, data: cfg(400, 3200, 100, 800, 2, 1) }
        })
        expect(await getMotionConfig(rpc)).toEqual({
            dpiMin: 400,
            dpiMax: 3200,
            dpiStep: 100,
            dpi: 800,
            accelProfile: 2,
            scrollMode: 1,
        })
    })

    it('setDpi encodes u16 LE and relays with targetNode', async () => {
        let seen: Uint8Array | undefined
        let opts: { targetNode?: number } | undefined
        const rpc = fakeRpc(async (_ns, verb, arg, o) => {
            expect(verb).toBe(MouseVerb.SET_DPI)
            seen = arg
            opts = o
            return { status: Status.OK, data: new Uint8Array() }
        })
        await setDpi(rpc, 0x0320, 7)
        expect([...seen!]).toEqual([0x20, 0x03])
        expect(opts).toMatchObject({ targetNode: 7 })
    })

    it('setAccelProfile / setScrollMode encode one byte', async () => {
        const seen: Array<[number, number]> = []
        const rpc = fakeRpc(async (_ns, verb, arg) => {
            seen.push([verb, arg![0]])
            return { status: Status.OK, data: new Uint8Array() }
        })
        await setAccelProfile(rpc, 3)
        await setScrollMode(rpc, 2)
        expect(seen).toEqual([
            [MouseVerb.SET_ACCEL_PROFILE, 3],
            [MouseVerb.SET_SCROLL_MODE, 2],
        ])
    })

    it('rejects short / unknown-version replies and ERR_CMD/ERR_ARG', async () => {
        const short = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array(4),
        }))
        await expect(getMotionConfig(short)).rejects.toThrow(/short/)
        const badVersion = fakeRpc(async () => ({
            status: Status.OK,
            data: cfg(0, 0, 0, 0, 0, 0, 9),
        }))
        await expect(getMotionConfig(badVersion)).rejects.toThrow(/version/)
        const noPointer = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(getMotionConfig(noPointer)).rejects.toThrow(
            /GET_MOTION_CONFIG/,
        )
        const outOfRange = fakeRpc(async () => ({
            status: Status.ERR_ARG,
            data: new Uint8Array(),
        }))
        await expect(setDpi(outOfRange, 99999)).rejects.toThrow(/SET_DPI/)
    })
})

describe('buildMouseMotionApi', () => {
    it('relays every verb to the node it was built for', async () => {
        const seen: Array<[number, number | undefined]> = []
        const rpc = fakeRpc(async (_ns, verb, _arg, o) => {
            seen.push([verb, o?.targetNode])
            return verb === MouseVerb.GET_MOTION_CONFIG
                ? { status: Status.OK, data: cfg(100, 3200, 100, 800, 1, 0) }
                : { status: Status.OK, data: new Uint8Array() }
        })
        const api = buildMouseMotionApi(rpc, { targetNode: 2, writable: true })
        expect((await api.getConfig()).dpi).toBe(800)
        await api.setDpi(1600)
        await api.setAccelProfile(0)
        await api.setScrollMode(1)
        expect(seen).toEqual([
            [MouseVerb.GET_MOTION_CONFIG, 2],
            [MouseVerb.SET_DPI, 2],
            [MouseVerb.SET_ACCEL_PROFILE, 2],
            [MouseVerb.SET_SCROLL_MODE, 2],
        ])
    })

    it('reads but refuses live changes when read-only', async () => {
        const verbs: number[] = []
        const rpc = fakeRpc(async (_ns, verb) => {
            verbs.push(verb)
            return { status: Status.OK, data: cfg(100, 3200, 100, 800, 1, 0) }
        })
        const api = buildMouseMotionApi(rpc, { targetNode: 2, writable: false })
        expect(api.writable).toBe(false)
        await api.getConfig()
        await expect(api.setDpi(1600)).rejects.toThrow(/Read-only/)
        await expect(api.setAccelProfile(0)).rejects.toThrow(/Read-only/)
        await expect(api.setScrollMode(1)).rejects.toThrow(/Read-only/)
        expect(verbs).toEqual([MouseVerb.GET_MOTION_CONFIG])
    })
})
