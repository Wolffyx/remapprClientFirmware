// pattern-check: skip — COMMON report-rate verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import { getRateLimits, setReportRate } from './reportRate'
import { Cmd, Namespace, Status } from './protocol'
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

// 8-byte rate-limits reply: version | supportedMask | u16 usb | u16 radio | u16 current.
function lim(
    mask: number,
    usb: number,
    radio: number,
    current: number,
    version = 1,
): Uint8Array {
    const b = new Uint8Array(8)
    const dv = new DataView(b.buffer)
    b[0] = version
    b[1] = mask
    dv.setUint16(2, usb, true)
    dv.setUint16(4, radio, true)
    dv.setUint16(6, current, true)
    return b
}

describe('report-rate control (COMMON namespace)', () => {
    it('getRateLimits decodes caps + supported steps + current', async () => {
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.COMMON)
            expect(verb).toBe(Cmd.GET_RATE_LIMITS)
            // mask 0x0F = 125/250/500/1000; USB-FS 1000 cap, no radio, at 500
            return { status: Status.OK, data: lim(0x0f, 1000, 0, 500) }
        })
        expect(await getRateLimits(rpc)).toEqual({
            supported: [125, 250, 500, 1000],
            usbCapHz: 1000,
            radioCapHz: 0,
            currentHz: 500,
        })
    })

    it('setReportRate encodes u16 LE, relays, returns the applied echo', async () => {
        let seen: Uint8Array | undefined
        let opts: { targetNode?: number } | undefined
        const rpc = fakeRpc(async (_ns, verb, arg, o) => {
            expect(verb).toBe(Cmd.SET_REPORT_RATE)
            seen = arg
            opts = o
            return { status: Status.OK, data: new Uint8Array([0xe8, 0x03]) } // 1000
        })
        const applied = await setReportRate(rpc, 4000, 7)
        expect([...seen!]).toEqual([0xa0, 0x0f]) // 4000 LE
        expect(opts).toMatchObject({ targetNode: 7 })
        expect(applied).toBe(1000) // device clamped 4000 -> 1000
    })

    it('rejects short / unknown-version replies and ERR_CMD/ERR_ARG', async () => {
        const short = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array(4),
        }))
        await expect(getRateLimits(short)).rejects.toThrow(/short/)
        const badVersion = fakeRpc(async () => ({
            status: Status.OK,
            data: lim(0, 0, 0, 0, 9),
        }))
        await expect(getRateLimits(badVersion)).rejects.toThrow(/version/)
        const noRate = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(getRateLimits(noRate)).rejects.toThrow(/GET_RATE_LIMITS/)
        const tooLow = fakeRpc(async () => ({
            status: Status.ERR_ARG,
            data: new Uint8Array(),
        }))
        await expect(setReportRate(tooLow, 100)).rejects.toThrow(
            /SET_REPORT_RATE/,
        )
    })
})
