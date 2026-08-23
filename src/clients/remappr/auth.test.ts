import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
    ccmOpen,
    ccmSeal,
    loadOrCreateIdentity,
    RemapprSession,
    setRemapprIdentityStore,
} from './auth'
import { buildRequest, Cmd, SEALED_TAG } from './protocol'

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
        const opened = session.open(envelope, 0)
        expect(opened).toEqual(ack)
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
