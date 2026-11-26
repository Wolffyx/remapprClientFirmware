// pattern-check: skip — test-only fake of the firmware §19 sealed control path.
//
// A device on a fake transport that seals the way subsys/remappr/control and
// lib/control_auth do: the legacy 0xE1 form, the direct universal form
// ([0xE2][0xE1]...) and the relayed form ([0xE2][UCH][0xE1]...). It opens a
// request at the length the frame implies (env_len), seals each reply at its
// real length (no padding; the report zero-fills the rest), keeps both
// counters, and answers a request it cannot open with the bare 6-byte
// ERR_AUTH header. Knobs make it drop its session, replay a reply or answer a
// stale request first, as the audit's failure cases need.
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Transport } from '../../transport'
import { ccmOpen, ccmSeal } from './auth'
import {
    buildUch,
    Cmd,
    FRAME,
    Namespace,
    SEALED_TAG,
    Status,
    UCH_LEN,
    UchFlag,
    UNIVERSAL_TAG,
} from './protocol'

export type Reply = { status: number; data: Uint8Array }

/** Which wire form a request came in. */
export type Form = 'plain' | 'legacy-sealed' | 'universal' | 'direct-sealed' | 'relay-sealed'

export interface Served {
    form: Form
    /** Namespace (undefined on the legacy flat path). */
    ns?: number
    cmd: number
    target?: number
}

export interface SealedDeviceOpts {
    /** Answers every inner verb but the handshake. */
    serve: (ns: number | undefined, cmd: number, arg: Uint8Array) => Reply
    /** The device→host counter right after a handshake (the firmware's is 0;
     *  a higher one puts set bits where a UCH flags byte would be). */
    firstTxCtr?: number
}

const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const le32 = (v: number): Uint8Array => {
    const o = new Uint8Array(4)
    new DataView(o.buffer).setUint32(0, v >>> 0, true)
    return o
}
const u32 = (b: Uint8Array, off: number): number =>
    new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, true)
const nonce = (dir: number, ctr: number): Uint8Array => {
    const n = new Uint8Array(13)
    n[0] = dir
    n.set(le32(ctr), 1)
    return n
}
const resp = (cmd: number, seq: number, r: Reply): Uint8Array =>
    Uint8Array.from([cmd, seq, r.status, 0, ...le16(r.data.length), ...r.data])
const bare = (): Uint8Array => Uint8Array.of(0, 0, Status.ERR_AUTH, 0, 0, 0)

export class SealedDevice {
    readonly transport: Transport
    /** Every request the device ran, in order. */
    readonly served: Served[] = []
    handshakes = 0
    /** Refuse every sealed request (a device bonded to another host). */
    refuseSealed = false
    /** Send the previous sealed reply again instead of the next one. */
    replayNext = false
    /** Before the next direct sealed reply, send a sealed one for another
     *  request id (a late answer to an earlier request). */
    staleNext = false
    /** Before the next legacy sealed reply, send a sealed one for an earlier
     *  cmd/seq. */
    staleLegacyNext = false
    /** Flip a ciphertext bit in the next sealed reply. */
    corruptNext = false

    private readonly devPriv = x25519.utils.randomSecretKey()
    private key: Uint8Array | null = null
    private tx = 0
    private rxLast = -1
    private lastSealed: Uint8Array | null = null
    private enqueue!: (f: Uint8Array) => void

    constructor(private readonly opts: SealedDeviceOpts) {
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const readable = new ReadableStream<Uint8Array>({
            start: (c) => {
                controller = c
            },
        })
        this.enqueue = (f) => {
            const p = new Uint8Array(FRAME)
            p.set(f.subarray(0, FRAME))
            controller.enqueue(p)
        }
        const writable = new WritableStream<Uint8Array>({
            write: (frame) => this.onFrame(frame),
        })
        this.transport = {
            label: 'sealed-fake',
            abortController: new AbortController(),
            readable,
            writable,
        }
    }

    /** The device forgets its session (a reboot, another host's BEGIN). */
    dropSession(): void {
        this.key = null
    }

    private onFrame(frame: Uint8Array): void {
        if (frame[0] === SEALED_TAG) return this.legacySealed(frame)
        if (frame[0] === UNIVERSAL_TAG && frame[1] === SEALED_TAG)
            return this.directSealed(frame)
        if (frame[0] === UNIVERSAL_TAG && frame[1 + UCH_LEN] === SEALED_TAG)
            return this.relaySealed(frame)
        if (frame[0] === UNIVERSAL_TAG) return this.universal(frame)
        this.legacy(frame)
    }

    /* ── handshake ─────────────────────────────────────────────────────── */

    private handshake(cmd: number, arg: Uint8Array): Reply | null {
        if (cmd === Cmd.CONTROL_AUTH_BEGIN) {
            this.key = null
            return { status: Status.OK, data: x25519.getPublicKey(this.devPriv) }
        }
        if (cmd !== Cmd.CONTROL_AUTH_FINISH) return null
        const devPub = x25519.getPublicKey(this.devPriv)
        const hostPub = arg.subarray(0, 32)
        const shared = x25519.getSharedSecret(this.devPriv, hostPub)
        this.key = hkdf(sha256, shared, Uint8Array.from([...devPub, ...hostPub]), INFO, 16)
        this.tx = this.opts.firstTxCtr ?? 0
        this.rxLast = -1
        this.handshakes++
        return { status: Status.OK, data: new Uint8Array() }
    }

    /* ── crypto ────────────────────────────────────────────────────────── */

    // env = ctr || ct || tag over the rest of the report: plain_len =
    // env_len − 20, as control_auth_open derives it.
    private open(env: Uint8Array): Uint8Array | null {
        if (!this.key || this.refuseSealed) return null
        const ctr = u32(env, 0)
        if (ctr <= this.rxLast) return null
        const pt = ccmOpen(this.key, nonce(0, ctr), env.subarray(0, 4), env.subarray(4))
        if (pt) this.rxLast = ctr
        return pt
    }

    // ctr || AEAD(pt) || tag, exactly pt.length + 20 bytes.
    private seal(pt: Uint8Array): Uint8Array {
        const ctr = this.tx++
        return Uint8Array.from([...le32(ctr), ...ccmSeal(this.key!, nonce(1, ctr), le32(ctr), pt)])
    }

    private sendSealed(frame: Uint8Array): void {
        if (this.corruptNext) {
            this.corruptNext = false
            const bad = Uint8Array.from(frame)
            bad[frame[0] === SEALED_TAG ? 5 : 6] ^= 0x01
            this.enqueue(bad)
            return
        }
        if (this.replayNext && this.lastSealed) {
            this.replayNext = false
            this.enqueue(this.lastSealed)
            return
        }
        this.lastSealed = frame
        this.enqueue(frame)
    }

    /* ── forms ─────────────────────────────────────────────────────────── */

    private inner(pt: Uint8Array): { cmd: number; seq: number; arg: Uint8Array } {
        const len = pt[2] | (pt[3] << 8)
        return { cmd: pt[0], seq: pt[1], arg: pt.subarray(4, 4 + len) }
    }

    private legacy(frame: Uint8Array): void {
        const { cmd, seq, arg } = this.inner(frame)
        const hs = this.handshake(cmd, arg)
        if (hs) return this.enqueue(resp(cmd, seq, hs))
        this.served.push({ form: 'plain', cmd })
        this.enqueue(resp(cmd, seq, this.opts.serve(undefined, cmd, arg)))
    }

    private legacySealed(frame: Uint8Array): void {
        const pt = this.open(frame.subarray(1))
        if (!pt) return this.enqueue(bare())
        const { cmd, seq, arg } = this.inner(pt)
        this.served.push({ form: 'legacy-sealed', cmd })
        if (this.staleLegacyNext) {
            this.staleLegacyNext = false
            const old = resp(Cmd.GET_DEVICE_INFO, (seq + 255) & 0xff, { status: Status.OK, data: new Uint8Array() })
            this.enqueue(Uint8Array.from([SEALED_TAG, ...this.seal(old)]))
        }
        const out = resp(cmd, seq, this.opts.serve(undefined, cmd, arg))
        this.sendSealed(Uint8Array.from([SEALED_TAG, ...this.seal(out)]))
    }

    private universal(frame: Uint8Array): void {
        const ns = frame[2]
        const rid = frame[4]
        const target = frame[5] | (frame[6] << 8)
        const { cmd, seq, arg } = this.inner(frame.subarray(1 + UCH_LEN))
        const hs = ns === Namespace.COMMON ? this.handshake(cmd, arg) : null
        const r = hs ?? this.opts.serve(ns, cmd, arg)
        if (!hs) this.served.push({ form: 'universal', ns, cmd, target })
        const uch = buildUch(ns, rid, target, UchFlag.RESP)
        this.enqueue(Uint8Array.from([UNIVERSAL_TAG, ...uch, ...resp(cmd, seq, r)]))
    }

    private directSealed(frame: Uint8Array): void {
        const pt = this.open(frame.subarray(2))
        if (!pt) return this.enqueue(bare())
        const ns = pt[1]
        const rid = pt[3]
        const { cmd, seq, arg } = this.inner(pt.subarray(UCH_LEN))
        this.served.push({ form: 'direct-sealed', ns, cmd })
        if (this.staleNext) {
            this.staleNext = false
            const stale = Uint8Array.from([
                ...buildUch(ns, (rid + 200) % 255, 0, UchFlag.RESP),
                ...resp(cmd, seq, { status: Status.ERR_STATE, data: new Uint8Array() }),
            ])
            this.enqueue(Uint8Array.from([UNIVERSAL_TAG, SEALED_TAG, ...this.seal(stale)]))
        }
        const out = Uint8Array.from([
            ...buildUch(ns, rid, 0, UchFlag.RESP),
            ...resp(cmd, seq, this.opts.serve(ns, cmd, arg)),
        ])
        this.sendSealed(Uint8Array.from([UNIVERSAL_TAG, SEALED_TAG, ...this.seal(out)]))
    }

    private relaySealed(frame: Uint8Array): void {
        const outer = frame.subarray(1, 1 + UCH_LEN)
        const pt = this.open(frame.subarray(1 + UCH_LEN + 1))
        const echo = Uint8Array.from(outer)
        echo[2] = UchFlag.RESP
        if (!pt || !pt.subarray(0, UCH_LEN).every((b, i) => b === outer[i])) {
            return this.enqueue(Uint8Array.from([UNIVERSAL_TAG, ...echo, ...bare()]))
        }
        const ns = pt[1]
        const target = pt[4] | (pt[5] << 8)
        const { cmd, seq, arg } = this.inner(pt.subarray(UCH_LEN))
        this.served.push({ form: 'relay-sealed', ns, cmd, target })
        const out = Uint8Array.from([...echo, ...resp(cmd, seq, this.opts.serve(ns, cmd, arg))])
        this.sendSealed(Uint8Array.from([UNIVERSAL_TAG, ...echo, SEALED_TAG, ...this.seal(out)]))
    }
}
