// The RPC's failure paths (L3.4, L3.17): a late reply never answers the next
// call, a lost fragment is an error and not a short body, the relay retry and
// its fast fail, link limits, and a sealed reply that does not authenticate.
import { describe, expect, it } from 'vitest'
import { FragmentLostError } from '../../errors'
import type { Transport } from '../../transport'
import { establishSession } from './adapter'
import {
    buildUch,
    Cmd,
    CommonVerb,
    FRAME,
    Namespace,
    parseLinkLimits,
    SEALED_TAG,
    Status,
    UchFlag,
    UNIVERSAL_TAG,
} from './protocol'
import { createRemapprRpc, RELAY_READ_RETRIES } from './rpc'
import { SealedDevice } from './sealedDevice.fixture'

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A transport whose device answers each written frame through `onFrame`;
 *  `send(frame, delayMs)` queues a frame for the host. */
function scripted(
    onFrame: (frame: Uint8Array, send: (f: number[] | Uint8Array, delayMs?: number) => void, n: number) => void,
): Transport {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const readable = new ReadableStream<Uint8Array>({
        start: (c) => {
            controller = c
        },
    })
    const send = (f: number[] | Uint8Array, delayMs = 0): void => {
        const p = new Uint8Array(FRAME)
        p.set(f)
        if (delayMs > 0) setTimeout(() => controller.enqueue(p), delayMs)
        else controller.enqueue(p)
    }
    let n = 0
    const writable = new WritableStream<Uint8Array>({
        write: (frame) => onFrame(frame, send, n++),
    })
    return { label: 'scripted', abortController: new AbortController(), readable, writable }
}

const legacyReply = (cmd: number, seq: number, data: number[] = []): number[] => [
    cmd,
    seq,
    Status.OK,
    0,
    ...le16(data.length),
    ...data,
]
const uniReply = (ns: number, rid: number, flags: number, body: number[], frag = [0, 0]): number[] => {
    const uch = buildUch(ns, rid, 0, UchFlag.RESP | flags)
    uch[6] = frag[0]
    uch[7] = frag[1]
    return [UNIVERSAL_TAG, ...uch, ...body]
}

describe('late replies (L3.4)', () => {
    it('drops a late legacy reply instead of answering the next call with it', async () => {
        // The first reply comes after its call timed out.
        const rpc = createRemapprRpc(
            scripted((f, send, n) => send(legacyReply(f[0], f[1], [n]), n === 0 ? 40 : 0)),
        )
        await expect(rpc.callPlain(Cmd.GET_CAPABILITIES, undefined, 20)).rejects.toThrow(/timeout/)
        await sleep(60)
        const r = await rpc.callPlain(Cmd.CONTROL_AUTH_BEGIN)
        expect(r.cmd).toBe(Cmd.CONTROL_AUTH_BEGIN)
        expect([...r.data]).toEqual([1])
        await rpc.close({ abortTransport: true })
    })

    it('drops a late legacy reply with the same cmd but an old seq', async () => {
        const rpc = createRemapprRpc(
            scripted((f, send, n) => send(legacyReply(f[0], f[1], [n]), n === 0 ? 40 : 0)),
        )
        await expect(rpc.callPlain(Cmd.GET_DEVICE_INFO, undefined, 20)).rejects.toThrow(/timeout/)
        await sleep(60)
        expect([...(await rpc.callPlain(Cmd.GET_DEVICE_INFO)).data]).toEqual([1])
        await rpc.close({ abortTransport: true })
    })

    it('times out in total even when only stale frames arrive', async () => {
        const rpc = createRemapprRpc(
            scripted((_f, send) => {
                for (let i = 0; i < 5; i++) send(legacyReply(0x7e, 0, []), i * 10)
            }),
        )
        const t0 = Date.now()
        await expect(rpc.callPlain(Cmd.GET_DEVICE_INFO, undefined, 30)).rejects.toThrow(/timeout/)
        expect(Date.now() - t0).toBeLessThan(200)
        await rpc.close({ abortTransport: true })
    })

    it('drops a late universal reply by request id', async () => {
        const rpc = createRemapprRpc(
            scripted((f, send, n) => send(uniReply(f[2], f[4], 0, legacyReply(f[9], f[10], [n])), n === 0 ? 40 : 0)),
        )
        await expect(
            rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS, undefined, { timeoutMs: 20 }),
        ).rejects.toThrow(/timeout/)
        await sleep(60)
        const r = await rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS)
        expect([...r.data]).toEqual([1])
        await rpc.close({ abortTransport: true })
    })

    it('times out a universal call in total even when stale universal frames trickle in', async () => {
        // Replies to an earlier request id, one every 10 ms: none answers the
        // call, and none may restart its wait.
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                for (let i = 0; i < 12; i++) send(uniReply(f[2], (f[4] + 100) & 0xff, 0, legacyReply(f[9], f[10])), i * 10)
            }),
        )
        const t0 = Date.now()
        await expect(
            rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS, undefined, { timeoutMs: 30 }),
        ).rejects.toThrow(/timeout/)
        expect(Date.now() - t0).toBeLessThan(80)
        await rpc.close({ abortTransport: true })
    })

    it('waits per fragment once a chain starts, past the call timeout in total', async () => {
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                const rid = f[4]
                const head = [f[9], f[10], Status.OK, 0, 3, 0]
                send(uniReply(f[2], rid, UchFlag.FRAG_FIRST | UchFlag.FRAG_MORE, [...head, 1], [0, 3]))
                send(uniReply(f[2], rid, UchFlag.FRAG_MORE, [2], [1, 3]), 25)
                send(uniReply(f[2], rid, 0, [3], [2, 3]), 50)
            }),
        )
        // Each frame is padded to FRAME, so the body is the first fragment's head.
        const r = await rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS, undefined, { timeoutMs: 30 })
        expect(r.status).toBe(Status.OK)
        expect(r.data[0]).toBe(1)
        await rpc.close({ abortTransport: true })
    })

    it('drops a late legacy sealed reply by its sealed cmd and seq', async () => {
        const dev = new SealedDevice({ serve: (_ns, cmd) => ({ status: Status.OK, data: Uint8Array.of(cmd) }) })
        const rpc = createRemapprRpc(dev.transport)
        const session = await establishSession(rpc)
        // A sealed reply to an earlier request, already in flight.
        dev.staleLegacyNext = true
        const r = await rpc.callSealed(session, Cmd.COMMIT_CONFIG)
        expect(r).toMatchObject({ cmd: Cmd.COMMIT_CONFIG, sealed: true })
        await rpc.close({ abortTransport: true })
    })
})

describe('FRAG loss and the relay retry (L3.17)', () => {
    it('reports a fragment gap instead of a short body', async () => {
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                const rid = f[4]
                send(uniReply(f[2], rid, UchFlag.FRAG_FIRST | UchFlag.FRAG_MORE, [f[9], f[10], 0, 0, 80, 0, 1], [0, 3]))
                send(uniReply(f[2], rid, 0, [3], [2, 3])) // fragment 1 never came
            }),
        )
        await expect(rpc.callUniversalPlain(Namespace.KEYBOARD, 0x10)).rejects.toThrow(FragmentLostError)
        await rpc.close({ abortTransport: true })
    })

    it('reports a chain whose first fragment was lost', async () => {
        const rpc = createRemapprRpc(scripted((f, send) => send(uniReply(f[2], f[4], 0, [9], [1, 2]))))
        await expect(rpc.callUniversalPlain(Namespace.KEYBOARD, 0x10)).rejects.toThrow(/start lost/)
        await rpc.close({ abortTransport: true })
    })

    it('retries a relayed read on ERR_STATE, then returns the reply', async () => {
        let sent = 0
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                sent++
                const status = sent < 3 ? Status.ERR_STATE : Status.OK
                send(uniReply(f[2], f[4], 0, [f[9], f[10], status, 0, 1, 0, 7]))
            }),
        )
        const r = await rpc.callUniversalPlain(Namespace.COMMON, Cmd.GET_DEVICE_INFO, undefined, {
            targetNode: 3,
            retries: RELAY_READ_RETRIES,
        })
        expect(r.status).toBe(Status.OK)
        expect(sent).toBe(3)
        await rpc.close({ abortTransport: true })
    })

    it('fast-fails a lost relayed reply and retries it', async () => {
        let sent = 0
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                if (++sent === 1) return // the reply is lost on the radio
                send(uniReply(f[2], f[4], 0, [f[9], f[10], Status.OK, 0, 0, 0]))
            }),
        )
        const t0 = Date.now()
        const r = await rpc.callUniversalPlain(Namespace.COMMON, Cmd.GET_DEVICE_INFO, undefined, {
            targetNode: 3,
            retries: 1,
        })
        expect(r.status).toBe(Status.OK)
        expect(Date.now() - t0).toBeLessThan(1500) // the 500 ms relay timeout, not 1.5 s
        await rpc.close({ abortTransport: true })
    })

    it('sends a mutation to a node once, never retried', async () => {
        let sent = 0
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                sent++
                send(uniReply(f[2], f[4], 0, [f[9], f[10], Status.ERR_STATE, 0, 0, 0]))
            }),
        )
        const r = await rpc.callMutation(Namespace.SENSOR, 0x04, undefined, { targetNode: 3 })
        expect(r.status).toBe(Status.ERR_STATE)
        expect(sent).toBe(1)
        await rpc.close({ abortTransport: true })
    })
})

describe('link limits and sealed failures (L3.17)', () => {
    it('parses GET_LINK_LIMITS and refuses a short reply', () => {
        const knob = [5, 0, 0, 0, 100, 0, 0, 0] // u32 min, u32 max
        expect(parseLinkLimits(Uint8Array.from([1, ...knob]))).toEqual([{ knob: 0, min: 5, max: 100 }])
        expect(() => parseLinkLimits(Uint8Array.from([2, ...knob]))).toThrow(/too short/)
        expect(() => parseLinkLimits(new Uint8Array())).toThrow(/empty/)
    })

    it('throws on a direct sealed reply that does not authenticate', async () => {
        const dev = new SealedDevice({ serve: () => ({ status: Status.OK, data: new Uint8Array() }) })
        const rpc = createRemapprRpc(dev.transport)
        const session = await establishSession(rpc)
        dev.corruptNext = true
        await expect(rpc.callSealedUniversal(session, Namespace.SENSOR, 0x03)).rejects.toThrow(
            /failed authentication/,
        )
        await rpc.close({ abortTransport: true })
    })

    it('does not take a direct sealed reply for a plaintext call', async () => {
        const rpc = createRemapprRpc(
            scripted((f, send) => {
                send([UNIVERSAL_TAG, SEALED_TAG, 9, 9, 9, 9]) // a late sealed reply
                send(uniReply(f[2], f[4], 0, [f[9], f[10], Status.OK, 0, 0, 0]))
            }),
        )
        const r = await rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS)
        expect(r.status).toBe(Status.OK)
        await rpc.close({ abortTransport: true })
    })
})
