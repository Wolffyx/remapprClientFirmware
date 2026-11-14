import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
    ccmOpen,
    ccmSeal,
    loadOrCreateIdentity,
    RemapprSession,
    ReplayedReplyError,
    setRemapprIdentityStore,
} from './auth'
import {
    buildRequest,
    buildUch,
    Cmd,
    DIRECT_SEAL_PLAIN,
    Namespace,
    SEALED_TAG,
    UCH_LEN,
    UNIVERSAL_TAG,
} from './protocol'

const hex = (s: string): Uint8Array =>
    Uint8Array.from(s.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
const toHex = (u: Uint8Array): string =>
    Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
const le32 = (v: number): Uint8Array => {
    const o = new Uint8Array(4)
    new DataView(o.buffer).setUint32(0, v, true)
    return o
}
const concat = (...ps: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(ps.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of ps) {
        out.set(p, o)
        o += p.length
    }
    return out
}
const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
// 13-byte nonce: dir(1) || ctr_le32(4) || 0×8.
const nonce = (dir: number, ctr: number): Uint8Array =>
    concat(Uint8Array.of(dir), le32(ctr), new Uint8Array(8))

describe('AES-128-CCM (firmware control_auth parity)', () => {
    // Known-answer vector computed with Python `cryptography` AESCCM (the lib the
    // firmware reference CLI uses), tag_length=16, 13-byte nonce.
    it('matches the Python cryptography known-answer vector', () => {
        const key = hex('00112233445566778899aabbccddeeff')
        const nz = hex('00000000000000000000000011')
        const aad = hex('07000000')
        const pt = new TextEncoder().encode('remappr ccm test vector!')
        expect(toHex(ccmSeal(key, nz, aad, pt))).toBe(
            'b4da0ba637e3fcc421ca78c5fb159e32bd61b202ef519a9b3e05bed7030ca35902c3b8b2b1a01a41',
        )
    })

    it('open() inverts seal() and rejects a tampered tag', () => {
        const key = hex('0f0e0d0c0b0a09080706050403020100')
        const nz = hex('010203040506070809000102aa')
        const aad = hex('deadbeef')
        const pt = new TextEncoder().encode('hello')
        const sealed = ccmSeal(key, nz, aad, pt)
        expect(ccmOpen(key, nz, aad, sealed)).toEqual(pt)
        const bad = sealed.slice()
        bad[bad.length - 1] ^= 0x01
        expect(ccmOpen(key, nz, aad, bad)).toBeNull()
    })
})

describe('RemapprSession handshake + sealed channel', () => {
    it('derives the same key as the device and seals host→device verbs', () => {
        const hostPriv = x25519.utils.randomSecretKey()
        const hostPub = x25519.getPublicKey(hostPriv)
        const devPriv = x25519.utils.randomSecretKey()
        const devPub = x25519.getPublicKey(devPriv)

        const session = new RemapprSession({ priv: hostPriv, pub: hostPub })
        session.derive(devPub)

        // Device independently derives the session key (salt = devPub || hostPub).
        const devKey = hkdf(
            sha256,
            x25519.getSharedSecret(devPriv, hostPub),
            concat(devPub, hostPub),
            INFO,
            16,
        )

        // Host seals a mutating verb; the device opens it (dir 0, counter 0).
        const env = session.seal(Cmd.WRITE_CONFIG_CHUNK, 5, hex('aabbcc'))
        expect(env[0]).toBe(SEALED_TAG)
        expect(env.length).toBe(64) // 1 tag + 4 ctr + 43 padded + 16 mac
        const ctr = new DataView(env.buffer, env.byteOffset).getUint32(1, true)
        expect(ctr).toBe(0)
        const opened = ccmOpen(
            devKey,
            nonce(0, ctr),
            env.subarray(1, 5),
            env.subarray(5),
        )
        expect(opened).not.toBeNull()
        const inner = buildRequest(Cmd.WRITE_CONFIG_CHUNK, 5, hex('aabbcc'))
        expect(opened!.subarray(0, inner.length)).toEqual(inner)
    })

    it('opens a device→host sealed reply', () => {
        const hostPriv = x25519.utils.randomSecretKey()
        const hostPub = x25519.getPublicKey(hostPriv)
        const devPriv = x25519.utils.randomSecretKey()
        const devPub = x25519.getPublicKey(devPriv)
        const session = new RemapprSession({ priv: hostPriv, pub: hostPub })
        session.derive(devPub)
        const devKey = hkdf(
            sha256,
            x25519.getSharedSecret(devPriv, hostPub),
            concat(devPub, hostPub),
            INFO,
            16,
        )
        // Device seals a 6-byte OK ack (cmd, seq, status, pad, data_len=0), dir 1.
        const ack = Uint8Array.of(Cmd.COMMIT_CONFIG, 9, 0, 0, 0, 0)
        const replyCt = ccmSeal(devKey, nonce(1, 0), le32(0), ack)
        const envelope = concat(le32(0), replyCt) // bytes after the 0xE1 tag
        const opened = session.open(envelope)
        expect(opened).toEqual(ack)
    })

    // Play the device: derive its session key for a fresh host session.
    function pair(): { session: RemapprSession; devKey: Uint8Array } {
        const hostPriv = x25519.utils.randomSecretKey()
        const hostPub = x25519.getPublicKey(hostPriv)
        const devPriv = x25519.utils.randomSecretKey()
        const devPub = x25519.getPublicKey(devPriv)
        const session = new RemapprSession({ priv: hostPriv, pub: hostPub })
        session.derive(devPub)
        const devKey = hkdf(
            sha256,
            x25519.getSharedSecret(devPriv, hostPub),
            concat(devPub, hostPub),
            INFO,
            16,
        )
        return { session, devKey }
    }
    // What the report carries after the tag(s): ctr || ct || tag, zero-padded.
    const onWire = (env: Uint8Array, room: number): Uint8Array => {
        const out = new Uint8Array(room)
        out.set(env)
        return out
    }

    it('opens a sealed reply that carries data, at its real length (L3.5)', () => {
        const { session, devKey } = pair()
        // A 6-byte header + 10 data bytes; the caller never says how long.
        const data = Uint8Array.from({ length: 10 }, (_, i) => 0xa0 + i)
        const resp = concat(Uint8Array.of(Cmd.GET_DEVICE_INFO, 3, 0, 0, 10, 0), data)
        const env = concat(le32(0), ccmSeal(devKey, nonce(1, 0), le32(0), resp))
        expect(session.open(onWire(env, 63))).toEqual(resp)
    })

    it('refuses a replayed sealed reply (device→host counter must rise)', () => {
        const { session, devKey } = pair()
        const ack = (ctr: number): Uint8Array =>
            onWire(
                concat(
                    le32(ctr),
                    ccmSeal(devKey, nonce(1, ctr), le32(ctr), Uint8Array.of(Cmd.COMMIT_CONFIG, 1, 0, 0, 0, 0)),
                ),
                63,
            )
        const captured = ack(0)
        expect(session.open(captured)).not.toBeNull()
        expect(() => session.open(captured)).toThrow(ReplayedReplyError)
        expect(session.open(ack(1))).not.toBeNull()
        // A skipped counter is fine (a lost reply); going back is not.
        expect(session.open(ack(5))).not.toBeNull()
        expect(() => session.open(ack(4))).toThrow(/replayed/)
    })

    it('starts the reply counter over on a new handshake', () => {
        const { session, devKey } = pair()
        const env = onWire(
            concat(le32(0), ccmSeal(devKey, nonce(1, 0), le32(0), Uint8Array.of(1, 1, 0, 0, 0, 0))),
            63,
        )
        expect(session.open(env)).not.toBeNull()
        session.resetCounters()
        expect(session.open(env)).not.toBeNull()
    })

    it('returns null for a reply under another key', () => {
        const { session } = pair()
        const other = new Uint8Array(16).fill(3)
        const env = concat(le32(0), ccmSeal(other, nonce(1, 0), le32(0), Uint8Array.of(1, 1, 0, 0, 0, 0)))
        expect(session.open(onWire(env, 63))).toBeNull()
    })

    it('seals the direct universal form and opens its reply (L3.1)', () => {
        const { session, devKey } = pair()
        const uch = buildUch(Namespace.SENSOR, 9)
        const frame = session.sealDirect(uch, 0x03, 4, hex('0102'))
        expect(frame).toHaveLength(64)
        expect(frame[0]).toBe(UNIVERSAL_TAG)
        expect(frame[1]).toBe(SEALED_TAG)
        // The device opens env = frame[2..]: 42 bytes of UCH || inner.
        const ctr = new DataView(frame.buffer, frame.byteOffset).getUint32(2, true)
        const pt = ccmOpen(devKey, nonce(0, ctr), frame.subarray(2, 6), frame.subarray(6))
        expect(pt).not.toBeNull()
        expect(pt!).toHaveLength(DIRECT_SEAL_PLAIN)
        expect(pt!.subarray(0, UCH_LEN)).toEqual(uch)
        expect(pt!.subarray(UCH_LEN, UCH_LEN + 6)).toEqual(buildRequest(0x03, 4, hex('0102')))

        // Reply: [0xE2][0xE1][ctr]AEAD(UCH(RESP) || 6-byte ack)[tag] + zero pad.
        const respPt = concat(buildUch(Namespace.SENSOR, 9, 0, 0x01), Uint8Array.of(0x03, 4, 0, 0, 0, 0))
        const reply = onWire(
            concat(Uint8Array.of(UNIVERSAL_TAG, SEALED_TAG), le32(0), ccmSeal(devKey, nonce(1, 0), le32(0), respPt)),
            64,
        )
        expect(session.openDirect(reply)).toEqual(respPt)
    })

    it('refuses a direct frame too big for the report', () => {
        const { session } = pair()
        expect(() => session.sealDirect(buildUch(1, 1), 1, 1, new Uint8Array(31))).toThrow(/64-byte/)
    })

    it('increments the host counter per sealed verb', () => {
        const id = { priv: x25519.utils.randomSecretKey(), pub: new Uint8Array(32) }
        const s = new RemapprSession({ priv: id.priv, pub: x25519.getPublicKey(id.priv) })
        s.derive(x25519.getPublicKey(x25519.utils.randomSecretKey()))
        const e0 = s.seal(Cmd.SET_RGB, 1, new Uint8Array())
        const e1 = s.seal(Cmd.SET_RGB, 2, new Uint8Array())
        expect(new DataView(e0.buffer, e0.byteOffset).getUint32(1, true)).toBe(0)
        expect(new DataView(e1.buffer, e1.byteOffset).getUint32(1, true)).toBe(1)
    })
})

describe('identity store (Strategy)', () => {
    it('persists a generated identity through an injected store', () => {
        let saved: Uint8Array | null = null
        setRemapprIdentityStore({
            load: () => saved,
            save: (p) => {
                saved = p
            },
        })
        const a = loadOrCreateIdentity()
        expect(a.priv.length).toBe(32)
        expect(a.pub.length).toBe(32)
        expect(saved).not.toBeNull()
        // A second load returns the same persisted identity.
        const b = loadOrCreateIdentity()
        expect(b.priv).toEqual(a.priv)
        expect(b.pub).toEqual(a.pub)
    })
})
