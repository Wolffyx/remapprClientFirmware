// pattern-check: skip — output-feedback verb fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import { hapticPulse, setDisplay } from './feedback'
import {
    buildDisplayArg,
    buildHapticArg,
    DISPLAY_TEXT_MAX,
    LightingVerb,
    Namespace,
    Status,
} from './protocol'
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

describe('output feedback (LIGHTING namespace)', () => {
    it('hapticPulse encodes {effect, intensity, u16 duration LE}', async () => {
        let seen: Uint8Array | undefined
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.LIGHTING)
            expect(verb).toBe(LightingVerb.HAPTIC_PULSE)
            seen = arg
            return { status: Status.OK, data: new Uint8Array() }
        })
        await hapticPulse(rpc, 2, 200, 0x0304)
        expect([...seen!]).toEqual([2, 200, 0x04, 0x03])
    })

    it('setDisplay encodes {slot, flags, len, utf8 text} + relays', async () => {
        let seen: Uint8Array | undefined
        let opts: { targetNode?: number } | undefined
        const rpc = fakeRpc(async (_ns, verb, arg, o) => {
            expect(verb).toBe(LightingVerb.SET_DISPLAY)
            seen = arg
            opts = o
            return { status: Status.OK, data: new Uint8Array() }
        })
        await setDisplay(rpc, 1, 'Hi', { clear: true, invert: true, targetNode: 7 })
        expect([...seen!]).toEqual([1, 0x03, 2, 0x48, 0x69])
        expect(opts).toMatchObject({ targetNode: 7 })
    })

    it('buildDisplayArg rejects text beyond the 30-byte wire cap (utf8)', () => {
        expect(() => buildDisplayArg(0, 'x'.repeat(DISPLAY_TEXT_MAX + 1))).toThrow(
            /too long/,
        )
        // 16 × '€' is 16 chars but 48 UTF-8 bytes — the byte length governs.
        expect(() => buildDisplayArg(0, '€'.repeat(16))).toThrow(/too long/)
        expect(buildDisplayArg(0, '€'.repeat(10))).toHaveLength(3 + 30)
    })

    it('buildHapticArg clamps into the wire layout', () => {
        expect([...buildHapticArg(0, 0, 0)]).toEqual([0, 0, 0, 0])
        expect([...buildHapticArg(1, 255, 65535)]).toEqual([1, 255, 0xff, 0xff])
    })

    it('surfaces ERR_CMD (handler not wired on the node)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(hapticPulse(rpc, 0, 0, 0)).rejects.toThrow(/HAPTIC_PULSE/)
        await expect(setDisplay(rpc, 0, 'x')).rejects.toThrow(/SET_DISPLAY/)
    })
})
