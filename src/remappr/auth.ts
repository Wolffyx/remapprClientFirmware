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
    RELAY_SEAL_PLAIN,
    SEAL_PLAIN,
    SEALED_TAG,
    UCH_LEN,
    UNIVERSAL_TAG,
} from './protocol'

/** Frozen HKDF info string — MUST match firmware CA_INFO_SESSION exactly. */
const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
const KEY_LEN = 16 // AES-128
const TAG_LEN = 16
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
 * One control-auth session. Created with the host identity; the caller drives
 * BEGIN/FINISH over plaintext RPC and feeds the device ephemeral pubkey to
 * `derive()`. After a successful FINISH, call `established()` and seal verbs.
 */
export class RemapprSession {
    private key: Uint8Array | null = null
    private txCtr = 0

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
    }

    /** Counters reset to 0 after a successful FINISH. */
    resetCounters(): void {
        this.txCtr = 0
    }

    /** Seal a mutating verb → wire frame `0xE1 || ctr_le32 || ct || tag`. */
    seal(cmd: number, seq: number, arg: Uint8Array): Uint8Array {
        if (!this.key) throw new Error('remappr session not established')
        const inner = buildRequest(cmd, seq, arg)
        const padded = new Uint8Array(Math.max(inner.length, SEAL_PLAIN))
        padded.set(inner)
        const ctr = this.txCtr++
        const ctrBytes = le32(ctr)
        const ct = ccmSeal(this.key, makeNonce(DIR_HOST_TO_DEVICE, ctr), ctrBytes, padded)
        return concat([Uint8Array.of(SEALED_TAG), ctrBytes, ct])
    }

    /**
     * Open a device reply envelope (the bytes after the 0xE1 tag). The device
     * seals exactly the inner response (6-byte header + `expectedDataLen`), so
     * the caller states how many data bytes it expects. Returns the inner
     * plaintext frame, or null if authentication fails.
     */
    open(envelope: Uint8Array, expectedDataLen = 0): Uint8Array | null {
        if (!this.key) throw new Error('remappr session not established')
        const ctr = new DataView(
            envelope.buffer,
            envelope.byteOffset,
            envelope.byteLength,
        ).getUint32(0, true)
        const innerLen = 6 + expectedDataLen
        const sealed = envelope.subarray(4, 4 + innerLen + TAG_LEN)
        return ccmOpen(
            this.key,
            makeNonce(DIR_DEVICE_TO_HOST, ctr),
            envelope.subarray(0, 4),
            sealed,
        )
    }

    /**
     * Seal a mutating verb for the dongle→node RELAY path (§6.3):
     * `[0xE2][UCH_outer][0xE1][ctr]AEAD(UCH || inner)[tag]`. The cleartext outer
     * UCH lets the dongle route on target_node; the identical UCH sealed inside
     * binds the address app↔node (the node returns ERR_AUTH on any mismatch).
     * `UCH || inner` is padded to RELAY_SEAL_PLAIN so the forwarded radio frame is
     * a full 64 bytes and the node derives the matching plaintext length from
     * `env_len`. Same key / per-direction counter / nonce / AAD as the legacy
     * seal. HW-proof-pending: byte layout per §6.3/§9.1, not yet validated against
     * the firmware relay decoder (the relay data plane is firmware-gated).
     */
    sealRelay(
        uch: Uint8Array,
        cmd: number,
        seq: number,
        arg: Uint8Array,
    ): Uint8Array {
        if (!this.key) throw new Error('remappr session not established')
        const inner = buildRequest(cmd, seq, arg)
        if (uch.length + inner.length > RELAY_SEAL_PLAIN)
            throw new Error('remappr relay frame exceeds the 64-byte radio budget')
        const pt = new Uint8Array(RELAY_SEAL_PLAIN)
        pt.set(uch, 0)
        pt.set(inner, uch.length)
        const ctr = this.txCtr++
        const ctrBytes = le32(ctr)
        const ct = ccmSeal(
            this.key,
            makeNonce(DIR_HOST_TO_DEVICE, ctr),
            ctrBytes,
            pt,
        )
        return concat([
            Uint8Array.of(UNIVERSAL_TAG),
            uch,
            Uint8Array.of(SEALED_TAG),
            ctrBytes,
            ct,
        ])
    }

    /**
     * Open a node's relay-sealed reply (§6.3):
     * `[0xE2][UCH_outer(RESP)][0xE1][ctr]AEAD(UCH_inner || inner_resp)[tag]`. The
     * reply AEAD-plaintext is the same fixed RELAY_SEAL_PLAIN size. Verifies the
     * sealed inner UCH equals the cleartext outer (the host half of the §6.3
     * full-UCH bind) and returns the inner response frame (trailing pad included;
     * parseResponse trims by its data_len), or null on auth / UCH-mismatch failure.
     */
    openRelay(frame: Uint8Array): Uint8Array | null {
        if (!this.key) throw new Error('remappr session not established')
        if (frame[0] !== UNIVERSAL_TAG || frame[1 + UCH_LEN] !== SEALED_TAG)
            return null
        const outerUch = frame.subarray(1, 1 + UCH_LEN)
        const ctrOff = 1 + UCH_LEN + 1
        const dv = new DataView(
            frame.buffer,
            frame.byteOffset,
            frame.byteLength,
        )
        const ctr = dv.getUint32(ctrOff, true)
        const sealedOff = ctrOff + 4
        const sealed = frame.subarray(
            sealedOff,
            sealedOff + RELAY_SEAL_PLAIN + TAG_LEN,
        )
        const pt = ccmOpen(
            this.key,
            makeNonce(DIR_DEVICE_TO_HOST, ctr),
            frame.subarray(ctrOff, ctrOff + 4),
            sealed,
        )
        if (pt === null) return null
        // §6.3 full-UCH bind: the sealed inner UCH must equal the routed outer.
        if (!equal(pt.subarray(0, UCH_LEN), outerUch)) return null
        return pt.subarray(UCH_LEN)
    }
}
