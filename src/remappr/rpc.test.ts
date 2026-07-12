import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Transport } from '../transport'
import { ccmOpen, ccmSeal, RemapprSession } from './auth'
import { createRemapprRpc } from './rpc'
import { discover } from './discovery'
import {
    buildUch,
    Cmd,
    CommonVerb,
    EVENT_TAG,
    EVT_INPUT,
    FRAME,
    Namespace,
    parseDeviceInfo,
    parseLimits,
    parseUch,
    SEALED_TAG,
    UCH_LEN,
    UchFlag,
    UNIVERSAL_TAG,
} from './protocol'

/* ── fake device harness ────────────────────────────────────────────────── */

function makeTransport(
    onFrame: (frame: Uint8Array, enqueue: (f: Uint8Array) => void) => void,
): Transport {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const readable = new ReadableStream<Uint8Array>({
        start: (c) => {
            controller = c
        },
    })
    const enqueue = (f: Uint8Array): void => {
        const p = new Uint8Array(FRAME)
        p.set(f.subarray(0, FRAME))
        controller.enqueue(p)
    }
    const writable = new WritableStream<Uint8Array>({
        write: (frame) => onFrame(frame, enqueue),
    })
    return {
        label: 'fake',
        abortController: new AbortController(),
        readable,
        writable,
    }
}

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const le32a = (v: number): number[] => [
    v & 0xff,
    (v >> 8) & 0xff,
    (v >> 16) & 0xff,
    (v >> 24) & 0xff,
]
// A legacy / inner response frame: [cmd, seq, status, pad, data_len u16, data].
const respFrame = (cmd: number, seq: number, status: number, data: Uint8Array): Uint8Array =>
    Uint8Array.from([cmd, seq, status, 0, ...le16(data.length), ...data])
const eventFrame = (eventId: number, payload: Uint8Array): Uint8Array =>
    Uint8Array.from([EVENT_TAG, eventId, ...le16(payload.length), ...payload])
const uniFrame = (ns: number, reqId: number, flags: number, chunk: Uint8Array): Uint8Array => {
    const uch = buildUch(ns, reqId, 0, UchFlag.RESP | flags)
    return Uint8Array.from([UNIVERSAL_TAG, ...uch, ...chunk])
}

const deviceInfoBytes = (protoMax: number, configVersion: number): Uint8Array =>
    Uint8Array.from([
        ...le16(1), // proto_min
        ...le16(protoMax), // proto_max
        ...le16(3), // schema_version
        1, 2, 3, // fw major/minor/patch
        ...le16(0x100), // hw_rev @9
        1, // has_active @11
        ...le32a(configVersion), // config_version @12
    ])
const limitsBytes = (): Uint8Array =>
    Uint8Array.from([
        ...le16(48), // max_unsealed_chunk
        ...le16(16), // max_sealed_chunk (universal path)
        ...le16(64), // transport_frame_cap
        ...le16(16), // blob_align
        ...le16(8192), // max_config_bytes
        16, // max_outstanding
        1, // supports_fragmentation
        ...le16(0x003f), // feature_bitmask lo (bits 0..5 = all Phase-2 features)
        ...le16(0x0000), // feature_bitmask hi
    ])
const personalityBytes = (): Uint8Array =>
    Uint8Array.from([
        0, // role NODE
        1, // personality KEYBOARD_NODE
        2, // proto_major
        1, // ns_count
        Namespace.COMMON, ...le16(0x7e), // one ns record
        ...le32a(0x0001a83f), // hw_caps
    ])
const inputEventBytes = (pressed: boolean, inputId: number): Uint8Array =>
    Uint8Array.from([
        (0 << 4) | (pressed ? 0x08 : 0) | 0, // kind=key, pressed, seq=0
        0, // src
        ...le16(inputId),
        ...le16(0x1234), // ts
    ])

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('createRemapprRpc — legacy plaintext', () => {
    it('round-trips GET_DEVICE_INFO', async () => {
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                if (frame[0] === Cmd.GET_DEVICE_INFO)
                    enqueue(respFrame(frame[0], frame[1], 0, deviceInfoBytes(2, 7)))
            }),
        )
        const r = await rpc.callPlain(Cmd.GET_DEVICE_INFO)
        expect(r.status).toBe(0)
        const di = parseDeviceInfo(r.data)
        expect(di.protoMax).toBe(2)
        expect(di.configVersion).toBe(7)
        await rpc.close({ abortTransport: true })
    })

    it('demuxes an interleaved 0xE0 input event from the response', async () => {
        let got: { inputId: number; pressed: boolean } | null = null
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                // An event arrives just before the response — must not be
                // mistaken for the reply, and must still fire the listener.
                enqueue(eventFrame(EVT_INPUT, inputEventBytes(true, 42)))
                enqueue(respFrame(frame[0], frame[1], 0, new Uint8Array()))
            }),
        )
        rpc.subscribeInput((e) => {
            got = { inputId: e.inputId, pressed: e.pressed }
        })
        const r = await rpc.callPlain(Cmd.GET_LAYER_STATE)
        expect(r.status).toBe(0)
        expect(got).toEqual({ inputId: 42, pressed: true })
        await rpc.close({ abortTransport: true })
    })
})

describe('createRemapprRpc — universal (0xE2)', () => {
    it('reads a single-frame GET_LIMITS reply', async () => {
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                expect(frame[0]).toBe(UNIVERSAL_TAG)
                const uch = parseUch(frame, 1)
                const innerVerb = frame[1 + UCH_LEN]
                if (innerVerb === CommonVerb.GET_LIMITS) {
                    const inner = respFrame(innerVerb, frame[1 + UCH_LEN + 1], 0, limitsBytes())
                    enqueue(uniFrame(Namespace.COMMON, uch.requestId, 0, inner))
                }
            }),
        )
        const reply = await rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_LIMITS)
        expect(reply.status).toBe(0)
        const lim = parseLimits(reply.data)
        expect(lim.maxSealedChunk).toBe(16)
        expect(lim.blobAlign).toBe(16)
        expect(lim.supportsFragmentation).toBe(true)
        expect(lim.featureBitmask).toBe(0x3f)
        await rpc.close({ abortTransport: true })
    })

    it('reassembles a multi-fragment (FRAG) reply', async () => {
        const big = Uint8Array.from({ length: 100 }, (_, i) => (i * 7) & 0xff)
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                const uch = parseUch(frame, 1)
                const inner = respFrame(frame[1 + UCH_LEN], 0, 0, big) // 106 bytes
                // Non-last fragment must be a full 55-byte chunk so concatenation
                // is exact; the last carries the remainder.
                const c1 = inner.subarray(0, 55)
                const c2 = inner.subarray(55)
                enqueue(
                    uniFrame(
                        Namespace.COMMON,
                        uch.requestId,
                        UchFlag.FRAG_FIRST | UchFlag.FRAG_MORE,
                        c1,
                    ),
                )
                enqueue(uniFrame(Namespace.COMMON, uch.requestId, 0, c2))
            }),
        )
        const reply = await rpc.callUniversalPlain(Namespace.COMMON, CommonVerb.GET_MANIFEST)
        expect(reply.status).toBe(0)
        expect(reply.data.length).toBe(100)
        expect(Array.from(reply.data)).toEqual(Array.from(big))
        await rpc.close({ abortTransport: true })
    })
})

describe('createRemapprRpc — sealed channel (full handshake)', () => {
    it('handshakes and round-trips a sealed mutating verb', async () => {
        const devPriv = x25519.utils.randomSecretKey()
        const devPub = x25519.getPublicKey(devPriv)
        const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
        const nonce = (dir: number, ctr: number): Uint8Array => {
            const n = new Uint8Array(13)
            n[0] = dir
            new DataView(n.buffer).setUint32(1, ctr, true)
            return n
        }
        let devKey: Uint8Array | null = null
        let devTx = 0

        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                const b0 = frame[0]
                if (b0 === Cmd.CONTROL_AUTH_BEGIN) {
                    enqueue(respFrame(b0, frame[1], 0, devPub))
                    return
                }
                if (b0 === Cmd.CONTROL_AUTH_FINISH) {
                    const argLen = frame[2] | (frame[3] << 8)
                    const hostPub = frame.subarray(4, 4 + argLen)
                    const shared = x25519.getSharedSecret(devPriv, hostPub)
                    const salt = new Uint8Array(64)
                    salt.set(devPub, 0)
                    salt.set(hostPub, 32)
                    devKey = hkdf(sha256, shared, salt, INFO, 16)
                    devTx = 0
                    enqueue(respFrame(b0, frame[1], 0, new Uint8Array()))
                    return
                }
                if (b0 === SEALED_TAG && devKey) {
                    const env = frame.subarray(1)
                    const ctr = new DataView(env.buffer, env.byteOffset).getUint32(0, true)
                    const inner = ccmOpen(
                        devKey,
                        nonce(0, ctr),
                        env.subarray(0, 4),
                        env.subarray(4, 4 + 43 + 16),
                    )
                    if (!inner) return
                    const ack = respFrame(inner[0], inner[1], 0, new Uint8Array())
                    const ct = ccmSeal(devKey, nonce(1, devTx), Uint8Array.from(le32a(devTx)), ack)
                    enqueue(Uint8Array.from([SEALED_TAG, ...le32a(devTx), ...ct]))
                    devTx++
                }
            }),
        )

        const hostPriv = x25519.utils.randomSecretKey()
        const session = new RemapprSession({
            priv: hostPriv,
            pub: x25519.getPublicKey(hostPriv),
        })
        const begin = await rpc.callPlain(Cmd.CONTROL_AUTH_BEGIN)
        session.derive(begin.data)
        const finish = await rpc.callPlain(Cmd.CONTROL_AUTH_FINISH, session.hostPub)
        expect(finish.status).toBe(0)
        session.resetCounters()

        const r = await rpc.callSealed(session, Cmd.COMMIT_CONFIG, new Uint8Array())
        expect(r.status).toBe(0)
        expect(r.cmd).toBe(Cmd.COMMIT_CONFIG)
        await rpc.close({ abortTransport: true })
    })
})

describe('discover()', () => {
    it('negotiates a proto-v2 device (personality + limits)', async () => {
        let universalCalls = 0
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                if (frame[0] === Cmd.GET_DEVICE_INFO) {
                    enqueue(respFrame(frame[0], frame[1], 0, deviceInfoBytes(2, 5)))
                    return
                }
                if (frame[0] === UNIVERSAL_TAG) {
                    universalCalls++
                    const uch = parseUch(frame, 1)
                    const verb = frame[1 + UCH_LEN]
                    const data =
                        verb === CommonVerb.GET_PERSONALITY_MAP
                            ? personalityBytes()
                            : limitsBytes()
                    enqueue(uniFrame(Namespace.COMMON, uch.requestId, 0, respFrame(verb, 0, 0, data)))
                }
            }),
        )
        const d = await discover(rpc)
        expect(d.protoMax).toBe(2)
        expect(d.personality?.personality).toBe(1)
        expect(d.limits?.maxSealedChunk).toBe(16)
        expect(universalCalls).toBe(2)
        await rpc.close({ abortTransport: true })
    })

    it('stays legacy on a proto-v1 device (no universal calls)', async () => {
        let universalCalls = 0
        const rpc = createRemapprRpc(
            makeTransport((frame, enqueue) => {
                if (frame[0] === UNIVERSAL_TAG) universalCalls++
                if (frame[0] === Cmd.GET_DEVICE_INFO)
                    enqueue(respFrame(frame[0], frame[1], 0, deviceInfoBytes(1, 1)))
            }),
        )
        const d = await discover(rpc)
        expect(d.protoMax).toBe(1)
        expect(d.personality).toBeUndefined()
        expect(d.limits).toBeUndefined()
        expect(universalCalls).toBe(0)
        await rpc.close({ abortTransport: true })
    })
})
