// pattern-check: skip — §6.3 relay-seal codec + §6.5 handshake test fixtures.
//
// Self-consistent crypto: a host session seals/opens the §6.3 relay frames; the
// "node" side is reconstructed in-test from the SAME independently-derived session
// key (the AEAD + HKDF derivation themselves are Python-validated in auth.test.ts).
// This pins the relay FRAMING (outer UCH, 0xE2/0xE1, pad-to-34, full-UCH bind);
// the relay data plane stays firmware HW-proof-pending.
import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ccmOpen, ccmSeal, RemapprSession, type RemapprIdentity } from './auth'
import { establishNodeSession } from './nodes'
import {
    buildRequest,
    buildUch,
    Cmd,
    Namespace,
    parseResponse,
    RELAY_SEAL_PLAIN,
    SEALED_TAG,
    Status,
    UCH_LEN,
    UNIVERSAL_TAG,
} from './protocol'
import type { RemapprRpc } from './rpc'

const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
const hostPriv = new Uint8Array(32).fill(7)
const devPriv = new Uint8Array(32).fill(9)
const hostIdentity = (): RemapprIdentity => ({
    priv: hostPriv,
    pub: x25519.getPublicKey(hostPriv),
})

const le32 = (v: number): Uint8Array => {
    const o = new Uint8Array(4)
    new DataView(o.buffer).setUint32(0, v >>> 0, true)
    return o
}
const nonce = (dir: number, ctr: number): Uint8Array => {
    const n = new Uint8Array(13)
    n[0] = dir
    n.set(le32(ctr), 1)
    return n
}
const u32le = (b: Uint8Array, off: number): number =>
    new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, true)

// Reproduce the session key the host derives, so the test can play the node.
function sessionAndKey(): { session: RemapprSession; key: Uint8Array } {
    const identity = hostIdentity()
    const session = new RemapprSession(identity)
    const devPub = x25519.getPublicKey(devPriv)
    session.derive(devPub)
    session.resetCounters()
    const shared = x25519.getSharedSecret(hostPriv, devPub)
    const salt = new Uint8Array([...devPub, ...identity.pub])
    return { session, key: hkdf(sha256, shared, salt, INFO, 16) }
}

describe('relay-sealed frame codec (§6.3)', () => {
    it('seals a request into the [0xE2][UCH][0xE1][ctr]AEAD[tag] 64-byte form', () => {
        const { session, key } = sessionAndKey()
        const uch = buildUch(Namespace.COMMON, 5, 7) // ns COMMON, reqId 5, node 7
        const blob = Uint8Array.from({ length: 16 }, (_, i) => i + 1)
        const frame = session.sealRelay(uch, Cmd.WRITE_CONFIG_CHUNK, 1, blob)

        // §6.3 layout + the radio-budget 64-byte frame.
        expect(frame).toHaveLength(64)
        expect(frame[0]).toBe(UNIVERSAL_TAG)
        expect(frame.subarray(1, 1 + UCH_LEN)).toEqual(uch)
        expect(frame[1 + UCH_LEN]).toBe(SEALED_TAG)
        const ctr = u32le(frame, 1 + UCH_LEN + 1)
        expect(ctr).toBe(0) // first seal after reset

        // The node opens it with the shared key (host→device direction); the
        // sealed inner UCH must equal the cleartext outer (the §6.3 bind).
        const sealed = frame.subarray(1 + UCH_LEN + 1 + 4)
        const pt = ccmOpen(key, nonce(0, ctr), frame.subarray(10, 14), sealed)
        expect(pt).not.toBeNull()
        expect(pt!).toHaveLength(RELAY_SEAL_PLAIN)
        expect(pt!.subarray(0, UCH_LEN)).toEqual(uch)
        const inner = pt!.subarray(UCH_LEN)
        expect(inner[0]).toBe(Cmd.WRITE_CONFIG_CHUNK)
        expect(inner.subarray(4, 4 + 16)).toEqual(blob) // arg = the blob chunk
    })

    it('advances the per-direction counter across seals', () => {
        const { session } = sessionAndKey()
        const uch = buildUch(Namespace.COMMON, 1, 7)
        const a = session.sealRelay(uch, Cmd.COMMIT_CONFIG, 1, new Uint8Array())
        const b = session.sealRelay(uch, Cmd.COMMIT_CONFIG, 2, new Uint8Array())
        expect(u32le(a, 10)).toBe(0)
        expect(u32le(b, 10)).toBe(1)
    })

    it('opens a node reply and enforces the full-UCH bind', () => {
        const { session, key } = sessionAndKey()
        const uch = buildUch(Namespace.COMMON, 5, 7, 0x01 /* RESP */)
        // The node seals its reply device→host: AEAD(pad(UCH || inner_resp, 34)).
        const innerResp = buildRequest(Cmd.WRITE_CONFIG_CHUNK, 1, new Uint8Array())
        const pt = new Uint8Array(RELAY_SEAL_PLAIN)
        pt.set(uch)
        pt.set(innerResp, uch.length)
        const ct = ccmSeal(key, nonce(1, 0), le32(0), pt)
        const reply = new Uint8Array([
            UNIVERSAL_TAG,
            ...uch,
            SEALED_TAG,
            ...le32(0),
            ...ct,
        ])

        const opened = session.openRelay(reply)
        expect(opened).not.toBeNull()
        expect(parseResponse(opened!).cmd).toBe(Cmd.WRITE_CONFIG_CHUNK)

        // Flip a byte of the cleartext outer UCH → the sealed inner no longer
        // matches (and the AEAD tag breaks) → rejected.
        const tampered = reply.slice()
        tampered[1] ^= 0xff
        expect(session.openRelay(tampered)).toBeNull()
    })

    it('rejects an oversized relay frame at seal time', () => {
        const { session } = sessionAndKey()
        const uch = buildUch(Namespace.COMMON, 1, 7)
        const tooBig = new Uint8Array(32) // 8 (UCH) + 4 + 32 > 34
        expect(() =>
            session.sealRelay(uch, Cmd.WRITE_CONFIG_CHUNK, 1, tooBig),
        ).toThrow(/radio budget/)
    })
})

describe('handshake over the relay (§6.5)', () => {
    it('runs plaintext BEGIN/FINISH to a node and establishes the session', async () => {
        const devPub = x25519.getPublicKey(devPriv)
        const calls: { verb: number; target: number }[] = []
        const rpc = {
            callUniversalPlain: async (
                _ns: number,
                verb: number,
                _arg?: Uint8Array,
                opts?: { targetNode?: number },
            ) => {
                calls.push({ verb, target: opts?.targetNode ?? 0 })
                if (verb === Cmd.CONTROL_AUTH_BEGIN)
                    return { status: Status.OK, data: devPub }
                if (verb === Cmd.CONTROL_AUTH_FINISH)
                    return { status: Status.OK, data: new Uint8Array() }
                return { status: Status.ERR_CMD, data: new Uint8Array() }
            },
        } as unknown as RemapprRpc

        const session = await establishNodeSession(rpc, 7, hostIdentity())
        expect(session.isEstablished).toBe(true)
        expect(calls.map((c) => c.verb)).toEqual([
            Cmd.CONTROL_AUTH_BEGIN,
            Cmd.CONTROL_AUTH_FINISH,
        ])
        expect(calls.every((c) => c.target === 7)).toBe(true)
    })

    it('throws when the node refuses BEGIN', async () => {
        const rpc = {
            callUniversalPlain: async () => ({
                status: Status.ERR_AUTH,
                data: new Uint8Array(),
            }),
        } as unknown as RemapprRpc
        await expect(establishNodeSession(rpc, 7, hostIdentity())).rejects.toThrow(
            /AUTH_BEGIN/,
        )
    })
})
