// pattern-check: skip — test wiring: drives the shared FirmwareAdapter contract
// against a fake Remappr device (real legacy handshake + sealed verbs + decoded
// config), plus Remappr-specific end-to-end checks (read/decode, sealed commit,
// Key-Test events). No hardware.
import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { runContractSuite } from '../__tests__/contract'
import type { Transport } from '../transport'
import { parseKeymap } from '../config'
import { buildRemapprBlob } from '../config/compilers/remappr'
import {
    DecodeCode,
    decodeRemapprBlob,
} from '../config/compilers/remappr/decode'

import { remapprAdapter } from './adapter'
import { RemapprKeyboardService } from './service'
import { supportsConfigEditing } from './configEditing'
import { ccmOpen, ccmSeal } from './auth'
import { REMAPPR_KIND_KEYPRESS, REMAPPR_KIND_TRANSPARENT } from './actions'
import {
    buildUch,
    Cmd,
    CommonVerb,
    DongleVerb,
    EVENT_TAG,
    EVT_INPUT,
    FRAME,
    KeyboardVerb,
    Namespace,
    parseUch,
    SEAL_PLAIN,
    SEALED_TAG,
    Status,
    UCH_LEN,
    UchFlag,
    UNIVERSAL_TAG,
} from './protocol'

/* ── seed config + blob (the device's "active" config) ──────────────────── */

const SEED_VERSION = 5

// Built through parseKeymap (surface → normalized canonical) so the compiler
// gets the matrix/defaults it expects — the same path the decode test proves.
const SEED_CONFIG = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Remappr Test", "target": "zmk" },
    "keyboard": { "id": "rt", "name": "Remappr Test",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
    "layers": [
        { "name": "base", "bindings": ["A", "B", {"type":"transparent"}, "D"] },
        { "name": "fn", "bindings": [
            {"type":"transparent"}, {"type":"transparent"},
            {"type":"transparent"}, {"type":"transparent"}] }
    ]
}`)

const SEED_BLOB = buildRemapprBlob(SEED_CONFIG, {
    configVersion: SEED_VERSION,
}).blob

/* ── byte helpers (mirror rpc.test.ts) ──────────────────────────────────── */

const INFO = new TextEncoder().encode('remappr-ctrl-auth session v1')
const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const le32 = (v: number): number[] => [
    v & 0xff,
    (v >> 8) & 0xff,
    (v >> 16) & 0xff,
    (v >> 24) & 0xff,
]
const nonce = (dir: number, ctr: number): Uint8Array => {
    const n = new Uint8Array(13)
    n[0] = dir
    new DataView(n.buffer).setUint32(1, ctr, true)
    return n
}
const respFrame = (
    cmd: number,
    seq: number,
    status: number,
    data: Uint8Array,
): Uint8Array =>
    Uint8Array.from([cmd, seq, status, 0, ...le16(data.length), ...data])
const eventFrame = (eventId: number, payload: Uint8Array): Uint8Array =>
    Uint8Array.from([EVENT_TAG, eventId, ...le16(payload.length), ...payload])
const deviceInfoBytes = (protoMax: number, configVersion: number): Uint8Array =>
    Uint8Array.from([
        ...le16(1), // proto_min
        ...le16(protoMax), // proto_max
        ...le16(1), // schema_version
        1,
        2,
        3, // fw major/minor/patch
        ...le16(0x100), // hw_rev @9
        1, // has_active @11
        ...le32(configVersion), // config_version @12
    ])
const inputEventBytes = (pressed: boolean, inputId: number): Uint8Array =>
    Uint8Array.from([
        (0 << 4) | (pressed ? 0x08 : 0) | 0, // kind=key, pressed, seq=0
        0, // src
        ...le16(inputId),
        ...le16(0x1234), // ts
    ])
const uniFrame = (
    ns: number,
    reqId: number,
    flags: number,
    chunk: Uint8Array,
): Uint8Array => {
    const uch = buildUch(ns, reqId, 0, UchFlag.RESP | flags)
    return Uint8Array.from([UNIVERSAL_TAG, ...uch, ...chunk])
}
const limitsBytes = (): Uint8Array =>
    Uint8Array.from([
        ...le16(48),
        ...le16(16),
        ...le16(64),
        ...le16(16),
        ...le16(8192),
        16,
        1,
        ...le16(0x003f), // feature_bitmask lo (§7.4.1 Phase-2 features)
        ...le16(0x0000), // feature_bitmask hi
    ])
const personalityBytes = (): Uint8Array =>
    Uint8Array.from([
        0, // role NODE
        1, // personality KEYBOARD_NODE
        2, // proto_major
        1, // ns_count
        Namespace.COMMON,
        ...le16(0x7e),
        ...le32(0x0001a83f),
    ])
const boundsBytes = (numPositions: number): Uint8Array =>
    Uint8Array.from([8, 2, ...le16(numPositions)]) // max=8, active=2
// One GET_KEY_LAYOUT chunk: ≤2 positions/frame (16 B each) so it fits in 64 B.
const keyLayoutChunkBytes = (
    total: number,
    start: number,
    count: number,
): Uint8Array => {
    const out: number[] = [...le16(total), ...le16(start), count]
    for (let i = 0; i < count; i++) {
        const idx = start + i
        out.push(
            ...le16(0), // keycode
            ...le16(idx * 100), // x
            ...le16(0), // y
            ...le16(100), // w
            ...le16(100), // h
            ...le16(0), // rot
            ...le16(0), // rotx
            ...le16(0), // roty
        )
    }
    return Uint8Array.from(out)
}

/* ── fake Remappr device ────────────────────────────────────────────────── */

interface FakeRemappr {
    transport: Transport
    pushInput: (inputId: number, pressed: boolean) => void
    getCommitted: () => Uint8Array | null
}

function makeFakeRemappr(opts: { protoMax?: number } = {}): FakeRemappr {
    const protoMax = opts.protoMax ?? 1
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

    const devPriv = x25519.utils.randomSecretKey()
    const devPub = x25519.getPublicKey(devPriv)
    let devKey: Uint8Array | null = null
    let devTx = 0
    let staged: number[] = []
    let committed: Uint8Array | null = null

    const onFrame = (frame: Uint8Array): void => {
        const b0 = frame[0]
        if (b0 === Cmd.GET_DEVICE_INFO) {
            enqueue(
                respFrame(b0, frame[1], 0, deviceInfoBytes(protoMax, SEED_VERSION)),
            )
            return
        }
        if (b0 === Cmd.GET_CAPABILITIES) {
            enqueue(respFrame(b0, frame[1], Status.ERR_CMD, new Uint8Array()))
            return
        }
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
        if (b0 === Cmd.READ_CONFIG_CHUNK) {
            const dv = new DataView(
                frame.buffer,
                frame.byteOffset,
                frame.byteLength,
            )
            const offset = dv.getUint32(4, true)
            const want = dv.getUint16(8, true)
            const slice = SEED_BLOB.subarray(
                offset,
                Math.min(offset + want, SEED_BLOB.length),
            )
            enqueue(respFrame(b0, frame[1], 0, slice))
            return
        }
        if (b0 === UNIVERSAL_TAG) {
            const uch = parseUch(frame, 1)
            const verb = frame[1 + UCH_LEN]
            const seq = frame[1 + UCH_LEN + 1]
            let data: Uint8Array | null = null
            if (uch.namespace === Namespace.COMMON) {
                if (verb === CommonVerb.GET_PERSONALITY_MAP) data = personalityBytes()
                else if (verb === CommonVerb.GET_LIMITS) data = limitsBytes()
            } else if (uch.namespace === Namespace.KEYBOARD) {
                if (verb === KeyboardVerb.GET_KEYMAP_BOUNDS) {
                    data = boundsBytes(4)
                } else if (verb === KeyboardVerb.GET_KEY_LAYOUT) {
                    const argOff = 1 + UCH_LEN + 4
                    const start = frame[argOff] | (frame[argOff + 1] << 8)
                    data = keyLayoutChunkBytes(4, start, Math.min(2, 4 - start))
                }
            }
            if (data) {
                enqueue(
                    uniFrame(
                        uch.namespace,
                        uch.requestId,
                        0,
                        respFrame(verb, seq, 0, data),
                    ),
                )
            }
            return
        }
        if (b0 === SEALED_TAG && devKey) {
            const env = frame.subarray(1)
            const ctr = new DataView(
                env.buffer,
                env.byteOffset,
                env.byteLength,
            ).getUint32(0, true)
            const inner = ccmOpen(
                devKey,
                nonce(0, ctr),
                env.subarray(0, 4),
                env.subarray(4, 4 + SEAL_PLAIN + 16),
            )
            if (!inner) return
            const cmd = inner[0]
            const seq = inner[1]
            const argLen = inner[2] | (inner[3] << 8)
            if (cmd === Cmd.WRITE_CONFIG_BEGIN) staged = []
            if (cmd === Cmd.WRITE_CONFIG_CHUNK) {
                for (let i = 0; i < argLen; i++) staged.push(inner[4 + i])
            }
            if (cmd === Cmd.COMMIT_CONFIG) committed = Uint8Array.from(staged)
            const ack = respFrame(cmd, seq, 0, new Uint8Array())
            const ct = ccmSeal(devKey, nonce(1, devTx), Uint8Array.from(le32(devTx)), ack)
            enqueue(Uint8Array.from([SEALED_TAG, ...le32(devTx), ...ct]))
            devTx++
            return
        }
    }

    const writable = new WritableStream<Uint8Array>({
        write: (frame) => onFrame(frame),
    })

    return {
        transport: {
            label: 'remappr-fake',
            abortController: new AbortController(),
            readable,
            writable,
        },
        pushInput: (inputId, pressed) =>
            enqueue(eventFrame(EVT_INPUT, inputEventBytes(pressed, inputId))),
        getCommitted: () => committed,
    }
}

/** A transport that answers every request with an empty error → discovery's
 *  parseDeviceInfo throws → canHandle rejects (fast, no timeout). */
function makeMismatch(): Transport {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const readable = new ReadableStream<Uint8Array>({
        start: (c) => {
            controller = c
        },
    })
    const writable = new WritableStream<Uint8Array>({
        write: (frame) => {
            const p = new Uint8Array(FRAME)
            p.set(
                respFrame(frame[0] ?? 0, frame[1] ?? 0, Status.ERR_CMD, new Uint8Array()),
            )
            controller.enqueue(p)
        },
    })
    return {
        label: 'serial://not-remappr',
        abortController: new AbortController(),
        readable,
        writable,
    }
}

/* ── fake Remappr dongle ────────────────────────────────────────────────────
 * A dongle has no legacy dispatcher (it drops/ERRs non-0xE2 frames) and no auth
 * or config of its own; it answers the DONGLE namespace (LIST_NODES). The adapter
 * must detect it and take the roster path — skipping the §19 handshake. */
function makeFakeDongle(): {
    transport: Transport
    sawAuth: () => boolean
} {
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
    let sawAuth = false

    const onFrame = (frame: Uint8Array): void => {
        const b0 = frame[0]
        if (b0 === Cmd.CONTROL_AUTH_BEGIN || b0 === Cmd.CONTROL_AUTH_FINISH) {
            sawAuth = true // a dongle is never handshaken; record + drop
            return
        }
        if (b0 === Cmd.GET_DEVICE_INFO) {
            // Legacy flat frame: no on-board dispatcher → ERR_CMD (empty), so the
            // host's parseDeviceInfo throws and the adapter falls back to a
            // LIST_NODES probe (matches an un-self-identifying dongle).
            enqueue(respFrame(b0, frame[1], Status.ERR_CMD, new Uint8Array()))
            return
        }
        if (b0 === UNIVERSAL_TAG) {
            const uch = parseUch(frame, 1)
            const verb = frame[1 + UCH_LEN]
            const seq = frame[1 + UCH_LEN + 1]
            if (
                uch.namespace === Namespace.DONGLE &&
                verb === DongleVerb.LIST_NODES
            ) {
                // OK + empty roster (no bonded nodes yet).
                enqueue(
                    uniFrame(
                        uch.namespace,
                        uch.requestId,
                        0,
                        respFrame(verb, seq, 0, new Uint8Array()),
                    ),
                )
            }
            return
        }
    }

    const writable = new WritableStream<Uint8Array>({
        write: (frame) => onFrame(frame),
    })
    return {
        transport: {
            label: 'remappr-dongle-fake',
            abortController: new AbortController(),
            readable,
            writable,
        },
        sawAuth: () => sawAuth,
    }
}

/* ── shared adapter contract ────────────────────────────────────────────── */

runContractSuite('remappr', {
    makeAdapter: () => remapprAdapter,
    makeMatchingTransport: () => makeFakeRemappr().transport,
    makeMismatchingTransport: () => makeMismatch(),
    transportKind: 'hid',
    autoUnlock: false,
})

/* ── Remappr-specific end-to-end ────────────────────────────────────────── */

async function connectFake(fake: FakeRemappr) {
    const ctrl = new AbortController()
    return remapprAdapter.connect(fake.transport, ctrl.signal)
}

describe('RemapprKeyboardService — live config round-trip', () => {
    it('reads + decodes the active blob into neutral layers', async () => {
        const svc = await connectFake(makeFakeRemappr())
        const km = await svc.getKeymap()
        // Blob carries no layer names → decoder synthesizes them; assert count.
        expect(km.layers).toHaveLength(2)
        expect(km.layers[0].keys).toHaveLength(4)
        expect(km.layers[0].keys[0].kind).toBe(REMAPPR_KIND_KEYPRESS)
        expect(km.layers[0].keys[2].kind).toBe(REMAPPR_KIND_TRANSPARENT)
        expect(km.layers[0].keys[3].kind).toBe(REMAPPR_KIND_KEYPRESS)
        await svc.disconnect()
    })

    it('exposes device limits + the config-editing surface (feature gate + demo parity)', async () => {
        // GET_LIMITS is a proto-v2 (universal path) fetch.
        const svc = await connectFake(makeFakeRemappr({ protoMax: 2 }))
        // Regression: deps.limits used to be dropped, leaving service.limits
        // undefined — so the config-blob editors' `feature="limits"` gate stayed
        // dark on real devices. Assert it now flows through from GET_LIMITS.
        expect(svc.limits?.featureBitmask).toBe(0x3f)
        // The same guard the editors use accepts a real device (as it does the mock).
        expect(supportsConfigEditing(svc)).toBe(true)
        await svc.disconnect()
    })

    it('commits a sealed blob the device can decode (version bumped)', async () => {
        const fake = makeFakeRemappr()
        const svc = await connectFake(fake)
        const km = await svc.getKeymap()
        await svc.setKey(
            km.layers[0].id,
            2,
            svc.buildKeyAction(REMAPPR_KIND_TRANSPARENT, []),
        )
        expect(svc.hasPendingChanges()).toBe(true)
        await svc.commit()
        expect(svc.hasPendingChanges()).toBe(false)

        const pushed = fake.getCommitted()
        expect(pushed).not.toBeNull()
        const decoded = decodeRemapprBlob(pushed!)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.configVersion).toBe(SEED_VERSION + 1)
        await svc.disconnect()
    })

    it('commits config-blob defaults edits so the pushed blob carries them', async () => {
        const fake = makeFakeRemappr()
        const svc = (await connectFake(fake)) as RemapprKeyboardService
        await svc.getKeymap()

        // Concrete-service API (not on the generic KeyboardService interface).
        expect(svc.hasPendingChanges()).toBe(false)
        svc.setConfigDefaults({
            capsWordIdleMs: 500,
            stickyReleaseDefaultMs: 250,
            matrixPollPeriodMs: 2,
        })
        expect(svc.hasPendingChanges()).toBe(true)
        // Read path merges staged edits over device truth.
        expect(svc.getConfigDefaults().capsWordIdleMs).toBe(500)

        await svc.commit()
        expect(svc.hasPendingChanges()).toBe(false)

        // The v3 LAYER timing tail in the pushed blob must round-trip the edits.
        const decoded = decodeRemapprBlob(fake.getCommitted()!)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config?.defaults?.capsWordIdleMs).toBe(500)
        expect(decoded.config?.defaults?.stickyReleaseDefaultMs).toBe(250)
        expect(decoded.config?.defaults?.matrixPollPeriodMs).toBe(2)
        await svc.disconnect()
    })

    it('discardChanges drops staged config-blob defaults edits', async () => {
        const fake = makeFakeRemappr()
        const svc = (await connectFake(fake)) as RemapprKeyboardService
        await svc.getKeymap()

        svc.setConfigDefaults({ capsWordIdleMs: 999 })
        expect(svc.hasPendingChanges()).toBe(true)
        await svc.discardChanges()
        expect(svc.hasPendingChanges()).toBe(false)
        // Staged edit is gone → read path falls back to device truth.
        expect(svc.getConfigDefaults().capsWordIdleMs).not.toBe(999)
        await svc.disconnect()
    })

    it('streams Key-Test matrix state from 0xE0 INPUT events', async () => {
        const fake = makeFakeRemappr()
        const svc = await connectFake(fake)
        const states: Set<number>[] = []
        const off = svc.keyTest!.onMatrixState((s) => states.push(s))
        fake.pushInput(7, true)
        fake.pushInput(7, false)
        await new Promise((r) => setTimeout(r, 0))
        expect(states.length).toBeGreaterThanOrEqual(2)
        expect([...states[0]]).toContain(7)
        expect(states[states.length - 1].has(7)).toBe(false)
        off()
        await svc.disconnect()
    })

    it('negotiates a proto-v2 device and fetches the real physical layout', async () => {
        const svc = await connectFake(makeFakeRemappr({ protoMax: 2 }))
        const { layouts } = await svc.getPhysicalLayouts()
        expect(layouts).toHaveLength(1)
        // GET_KEY_LAYOUT served 4 positions → the real layout, not the grid.
        expect(layouts[0].name).toBe('Remappr')
        expect(layouts[0].keys).toHaveLength(4)
        expect(layouts[0].keys[1].x).toBe(100)
        await svc.disconnect()
    })

    it('a keyboard takes the editor path (kind is not dongle)', async () => {
        const svc = await connectFake(makeFakeRemappr())
        expect(svc.kind).not.toBe('dongle')
        await svc.disconnect()
    })
})

describe('RemapprAdapter — dongle connect (lands on the node roster)', () => {
    it('detects a dongle, skips auth/config, and exposes the roster', async () => {
        const dongle = makeFakeDongle()
        const svc = await remapprAdapter.connect(
            dongle.transport,
            new AbortController().signal,
        )
        // Roster path: dongle kind, dongle name, a nodes facade, no keymap edits.
        expect(svc.kind).toBe('dongle')
        expect(svc.deviceInfo.name).toBe('Remappr Dongle')
        expect(svc.nodes).toBeDefined()
        expect(await svc.nodes!.list()).toEqual([])
        expect(svc.capabilities.readOnly).toBe(true)
        // A dongle is never handshaken (§7.2): the §19 BEGIN/FINISH never ran.
        expect(dongle.sawAuth()).toBe(false)
        await svc.disconnect()
    })
})
