// Pattern check: Strategy (Tier 1) — applied — RemapprIdentityStore is a
// pluggable persistence strategy (default localStorage vs an injected Electron
// file store) selected at runtime via setRemapprIdentityStore(); RemapprSession
// holds the per-direction crypto counters.
//
// §19 control-auth, ported byte-for-byte from tools/control_cli/control_auth_cli.py
// (cross-validated against firmware lib/control_auth). The flow:
//   1. host has a persisted static X25519 identity (its pubkey = bonded identity)
//   2. BEGIN (plaintext) → device returns a 32-byte ephemeral pubkey
//   3. shared = X25519(host_priv, dev_pub); salt = dev_pub || host_pub (dev FIRST);
//      key = HKDF-SHA256(ikm=shared, salt, info="remappr-ctrl-auth session v1", L=16)
//   4. FINISH (plaintext, arg = host_pub) → device bonds; both counters reset to 0
//   5. every mutating verb is sealed: 0xE1 || ctr_le32 || AES-128-CCM(...)
// AES-CCM is hand-rolled on noble's AES block (noble/ciphers dropped CCM in v2);
// it is unit-tested byte-for-byte against Python `cryptography` AESCCM.

import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { unsafe } from '@noble/ciphers/aes.js'
import {
    buildRequest,
    DIRECT_SEAL_PLAIN,
    RELAY_SEAL_PLAIN,
    RESP_HDR_LEN,
    SEAL_PLAIN,
    SEALED_TAG,
    UCH_LEN,
    UNIVERSAL_TAG,
} from './protocol'

/** Frozen HKDF info string — MUST match firmware CA_INFO_SESSION exactly. */
const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
const KEY_LEN = 16 // AES-128
const TAG_LEN = 16
const CTR_LEN = 4
const DIR_HOST_TO_DEVICE = 0
const DIR_DEVICE_TO_HOST = 1

/* ── AES-128-CCM (NIST SP 800-38C) on noble's raw AES block ─────────────── */

type AesKey = ReturnType<typeof unsafe.expandKeyLE>

function block(xk: AesKey, b: Uint8Array): Uint8Array {
    const c = Uint8Array.from(b)
    return unsafe.encryptBlock(xk, c) ?? c
}

function xor16(a: Uint8Array, b: Uint8Array): Uint8Array {
    const o = new Uint8Array(16)
    for (let i = 0; i < 16; i++) o[i] = a[i] ^ b[i]
    return o
}

// CBC-MAC over B0 || enc(AAD) || payload (zero-padded blocks); returns the
// tagLen-byte MAC T.
function cbcMac(
    xk: AesKey,
    nonce: Uint8Array,
    aad: Uint8Array,
    pt: Uint8Array,
    tagLen: number,
): Uint8Array {
    const q = 15 - nonce.length
    const b0 = new Uint8Array(16)
    const adata = aad.length > 0 ? 1 : 0
    b0[0] = (adata << 6) | (((tagLen - 2) / 2) << 3) | (q - 1)
    b0.set(nonce, 1)
    let pl = pt.length
    for (let i = 0; i < q; i++) {
        b0[15 - i] = pl & 0xff
        pl = Math.floor(pl / 256)
    }
    let y = block(xk, b0)
    if (adata) {
        // AAD length prefix: 2-byte big-endian for 0 < a < 2^16 - 2^8.
        const head = new Uint8Array([(aad.length >> 8) & 0xff, aad.length & 0xff])
        const full = new Uint8Array(head.length + aad.length)
        full.set(head, 0)
        full.set(aad, head.length)
        for (let off = 0; off < full.length; off += 16) {
            const blk = new Uint8Array(16)
            blk.set(full.subarray(off, Math.min(off + 16, full.length)))
            y = block(xk, xor16(y, blk))
        }
    }
    for (let off = 0; off < pt.length; off += 16) {
        const blk = new Uint8Array(16)
        blk.set(pt.subarray(off, Math.min(off + 16, pt.length)))
        y = block(xk, xor16(y, blk))
    }
    return y.slice(0, tagLen)
}

// CTR keystream block A_i (i = 0 reserved for the tag, 1.. for payload).
function ctrBlock(xk: AesKey, nonce: Uint8Array, i: number): Uint8Array {
    const q = 15 - nonce.length
    const ctr = new Uint8Array(16)
    ctr[0] = q - 1
    ctr.set(nonce, 1)
    let v = i
    for (let j = 0; j < q; j++) {
        ctr[15 - j] = v & 0xff
        v = Math.floor(v / 256)
    }
    return block(xk, ctr)
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
}

/** Seal: returns ciphertext || tag (length = pt.length + tagLen). */
export function ccmSeal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    pt: Uint8Array,
    tagLen = TAG_LEN,
): Uint8Array {
    const xk = unsafe.expandKeyLE(key)
    const t = cbcMac(xk, nonce, aad, pt, tagLen)
    const s0 = ctrBlock(xk, nonce, 0)
    const out = new Uint8Array(pt.length + tagLen)
    for (let off = 0, i = 1; off < pt.length; off += 16, i++) {
        const s = ctrBlock(xk, nonce, i)
        for (let j = 0; j < 16 && off + j < pt.length; j++)
            out[off + j] = pt[off + j] ^ s[j]
    }
    for (let j = 0; j < tagLen; j++) out[pt.length + j] = t[j] ^ s0[j]
    return out
}

/** Open: verifies the tag and returns the plaintext, or null on auth failure. */
export function ccmOpen(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    sealed: Uint8Array,
    tagLen = TAG_LEN,
): Uint8Array | null {
    if (sealed.length < tagLen) return null
    const xk = unsafe.expandKeyLE(key)
    const ctLen = sealed.length - tagLen
    const pt = new Uint8Array(ctLen)
    for (let off = 0, i = 1; off < ctLen; off += 16, i++) {
        const s = ctrBlock(xk, nonce, i)
        for (let j = 0; j < 16 && off + j < ctLen; j++)
            pt[off + j] = sealed[off + j] ^ s[j]
    }
    const t = cbcMac(xk, nonce, aad, pt, tagLen)
    const s0 = ctrBlock(xk, nonce, 0)
    const u = new Uint8Array(tagLen)
    for (let j = 0; j < tagLen; j++) u[j] = sealed[ctLen + j] ^ s0[j]
    return equal(t, u) ? pt : null
}

/* ── identity store (Strategy) ──────────────────────────────────────────── */

export interface RemapprIdentity {
    priv: Uint8Array // 32-byte X25519 secret
    pub: Uint8Array // 32-byte X25519 public (the bonded identity)
}

export interface RemapprIdentityStore {
    /** The persisted 32-byte private key, or null if none yet. */
    load(): Uint8Array | null
    save(priv: Uint8Array): void
}

const STORE_KEY = 'remappr.identity.v1'
const toHex = (u: Uint8Array): string =>
    Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string): Uint8Array =>
    Uint8Array.from(s.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [])

// Default: localStorage in the browser, an in-memory fallback elsewhere (so
// Node/tests don't throw). Electron injects a file-backed store via the setter.
function defaultStore(): RemapprIdentityStore {
    let mem: Uint8Array | null = null
    const ls: Storage | null =
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as { localStorage?: Storage }).localStorage !==
            'undefined'
            ? (globalThis as { localStorage: Storage }).localStorage
            : null
    return {
        load() {
            if (ls) {
                const v = ls.getItem(STORE_KEY)
                return v ? fromHex(v) : null
            }
            return mem
        },
        save(priv) {
            if (ls) ls.setItem(STORE_KEY, toHex(priv))
            else mem = priv
        },
    }
}

let identityStore: RemapprIdentityStore = defaultStore()

/** Inject the identity persistence strategy (e.g. an Electron file store). */
export function setRemapprIdentityStore(store: RemapprIdentityStore): void {
    identityStore = store
}

/** Load the persisted host identity, generating + saving one on first use. */
export function loadOrCreateIdentity(): RemapprIdentity {
    let priv = identityStore.load()
    if (!priv || priv.length !== 32) {
        priv = x25519.utils.randomSecretKey()
        identityStore.save(priv)
    }
    return { priv, pub: x25519.getPublicKey(priv) }
}

/* ── session ────────────────────────────────────────────────────────────── */

const le32 = (v: number): Uint8Array => {
    const o = new Uint8Array(4)
    new DataView(o.buffer).setUint32(0, v >>> 0, true)
    return o
}

// 13-byte nonce: dir(1) || ctr_le32(4) || 0×8.
function makeNonce(dir: number, ctr: number): Uint8Array {
    const n = new Uint8Array(13)
    n[0] = dir
    n.set(le32(ctr), 1)
    return n
}

function concat(parts: Uint8Array[]): Uint8Array {
    const len = parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(len)
    let off = 0
    for (const p of parts) {
        out.set(p, off)
        off += p.length
    }
    return out
}

/**
 * A sealed reply whose device→host counter is not above the last one this
 * session accepted: a captured reply played back (e.g. an old COMMIT "OK").
 */
export class ReplayedReplyError extends Error {
    constructor(
        readonly counter: number,
        readonly last: number,
    ) {
        super(`replayed sealed reply (counter ${counter}, last ${last})`)
        this.name = 'ReplayedReplyError'
    }
}

/**
 * One control-auth session. Created with the host identity; the caller drives
 * BEGIN/FINISH over plaintext RPC and feeds the device ephemeral pubkey to
 * `derive()` (which resets both counters), then seals verbs.
 *
 * Replies are opened by trial length: the device seals exactly its response
 * (no padding) and the report pads it with zeros, so the true ciphertext length
 * is not on the wire. Each length from the smallest possible reply up is tried;
 * only the real one passes the 16-byte tag. The device→host counter must rise
 * strictly within the session, so a replayed reply is refused.
 */
export class RemapprSession {
    private key: Uint8Array | null = null
    private txCtr = 0
    private rxLast = -1

    constructor(private readonly identity: RemapprIdentity) {}

    get hostPub(): Uint8Array {
        return this.identity.pub
    }

    get isEstablished(): boolean {
        return this.key !== null
    }

    /** Derive the session key from the device's BEGIN ephemeral pubkey. */
    derive(devicePub: Uint8Array): void {
        const shared = x25519.getSharedSecret(this.identity.priv, devicePub)
        const salt = concat([devicePub, this.identity.pub]) // device FIRST
        this.key = hkdf(sha256, shared, salt, INFO, KEY_LEN)
        this.resetCounters()
    }

    /** Both counters reset after a successful FINISH. */
    resetCounters(): void {
        this.txCtr = 0
        this.rxLast = -1
    }

    /** Seal a mutating verb → wire frame `0xE1 || ctr_le32 || ct || tag`. */
    seal(cmd: number, seq: number, arg: Uint8Array): Uint8Array {
        const inner = buildRequest(cmd, seq, arg)
        if (inner.length > SEAL_PLAIN)
            throw new Error('remappr sealed frame exceeds the 64-byte report')
        return concat([Uint8Array.of(SEALED_TAG), this.envelope(inner, SEAL_PLAIN)])
    }

    /**
     * Seal a namespace verb for the device itself (§6.3 direct form, target 0):
     * `[0xE2][0xE1][ctr]AEAD(UCH || inner)[tag]`. There is no cleartext UCH;
     * the sealed one carries the namespace and request id. `UCH || inner` is
     * padded to DIRECT_SEAL_PLAIN so the frame fills the report.
     */
    sealDirect(
        uch: Uint8Array,
        cmd: number,
        seq: number,
        arg: Uint8Array,
    ): Uint8Array {
        const pt = concat([uch, buildRequest(cmd, seq, arg)])
        if (pt.length > DIRECT_SEAL_PLAIN)
            throw new Error('remappr sealed frame exceeds the 64-byte report')
        return concat([
            Uint8Array.of(UNIVERSAL_TAG, SEALED_TAG),
            this.envelope(pt, DIRECT_SEAL_PLAIN),
        ])
    }

    /**
     * Open a legacy sealed reply envelope (the bytes after the 0xE1 tag) and
     * return the inner response frame. Null when no length authenticates;
     * throws ReplayedReplyError on a replayed counter.
     */
    open(envelope: Uint8Array): Uint8Array | null {
        return this.openEnvelope(envelope, RESP_HDR_LEN)
    }

    /**
     * Open a direct sealed universal reply `[0xE2][0xE1][ctr]AEAD(UCH ||
     * inner)[tag]` and return `UCH || inner` (the caller matches the request
     * id in the sealed UCH). Null when it does not authenticate.
     */
    openDirect(frame: Uint8Array): Uint8Array | null {
        if (frame[0] !== UNIVERSAL_TAG || frame[1] !== SEALED_TAG) return null
        return this.openEnvelope(frame.subarray(2), UCH_LEN + RESP_HDR_LEN)
    }

    /**
     * Seal a mutating verb for the dongle→node RELAY path (§6.3):
     * `[0xE2][UCH_outer][0xE1][ctr]AEAD(UCH || inner)[tag]`. The cleartext outer
     * UCH lets the dongle route on target_node; the identical UCH sealed inside
     * binds the address app↔node (the node returns ERR_AUTH on any mismatch).
     * `UCH || inner` is padded to RELAY_SEAL_PLAIN so the forwarded radio frame is
     * a full 64 bytes and the node derives the matching plaintext length from
     * `env_len`. Same key / per-direction counter / nonce / AAD as the legacy
     * seal.
     */
    sealRelay(
        uch: Uint8Array,
        cmd: number,
        seq: number,
        arg: Uint8Array,
    ): Uint8Array {
        const pt = concat([uch, buildRequest(cmd, seq, arg)])
        if (pt.length > RELAY_SEAL_PLAIN)
            throw new Error('remappr relay frame exceeds the 64-byte radio budget')
        return concat([
            Uint8Array.of(UNIVERSAL_TAG),
            uch,
            Uint8Array.of(SEALED_TAG),
            this.envelope(pt, RELAY_SEAL_PLAIN),
        ])
    }

    /**
     * Open a node's relay-sealed reply (§6.3):
     * `[0xE2][UCH_outer(RESP)][0xE1][ctr]AEAD(UCH_inner || inner_resp)[tag]`.
     * The node seals exactly `UCH || inner_resp` (14 bytes for an ack), so the
     * length is found by trial like every sealed reply. Verifies the sealed
     * inner UCH equals the cleartext outer (the host half of the §6.3 full-UCH
     * bind) and returns the inner response frame, or null on auth /
     * UCH-mismatch failure.
     */
    openRelay(frame: Uint8Array): Uint8Array | null {
        if (frame[0] !== UNIVERSAL_TAG || frame[1 + UCH_LEN] !== SEALED_TAG)
            return null
        const outerUch = frame.subarray(1, 1 + UCH_LEN)
        const pt = this.openEnvelope(
            frame.subarray(1 + UCH_LEN + 1),
            UCH_LEN + RESP_HDR_LEN,
        )
        if (pt === null) return null
        // §6.3 full-UCH bind: the sealed inner UCH must equal the routed outer.
        if (!equal(pt.subarray(0, UCH_LEN), outerUch)) return null
        return pt.subarray(UCH_LEN)
    }

    /** `ctr || AEAD(pt zero-padded to padTo) || tag`, host→device. */
    private envelope(pt: Uint8Array, padTo: number): Uint8Array {
        if (!this.key) throw new Error('remappr session not established')
        const padded = new Uint8Array(padTo)
        padded.set(pt)
        const ctr = this.txCtr++
        const ctrBytes = le32(ctr)
        const ct = ccmSeal(this.key, makeNonce(DIR_HOST_TO_DEVICE, ctr), ctrBytes, padded)
        return concat([ctrBytes, ct])
    }

    /**
     * Authenticate `ctr || ct || tag || zero pad` by trial length, from
     * `minLen` plaintext bytes up to what the envelope can hold. On success the
     * counter becomes the new floor and the plaintext is returned.
     */
    private openEnvelope(envelope: Uint8Array, minLen: number): Uint8Array | null {
        if (!this.key) throw new Error('remappr session not established')
        if (envelope.length < CTR_LEN + minLen + TAG_LEN) return null
        const ctrBytes = envelope.subarray(0, CTR_LEN)
        const ctr = new DataView(
            ctrBytes.buffer,
            ctrBytes.byteOffset,
            CTR_LEN,
        ).getUint32(0, true)
        if (ctr <= this.rxLast) throw new ReplayedReplyError(ctr, this.rxLast)
        const nonce = makeNonce(DIR_DEVICE_TO_HOST, ctr)
        const body = envelope.subarray(CTR_LEN)
        for (let n = minLen; n + TAG_LEN <= body.length; n++) {
            const pt = ccmOpen(this.key, nonce, ctrBytes, body.subarray(0, n + TAG_LEN))
            if (pt === null) continue
            this.rxLast = ctr
            return pt
        }
        return null
    }
}
