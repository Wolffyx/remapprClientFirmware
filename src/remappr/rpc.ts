// Pattern check: Adapter (Tier 1) — applied — wraps RpcTransport byte streams as
// the Remappr control client (4-class byte-0 demux + inbound FRAG reassembly),
// mirroring src/hid/rawHidClient.ts. Observer (Tier 1) — applied — subscribeInput
// runs a background pump that fans 0xE0 INPUT events out to listeners.
//
// The Remappr control channel is synchronous request→response per owner (like the
// Python control_cli `xfer`): the host writes one frame and reads the next
// non-event reply. Byte 0 demuxes the four frame classes: 0xE0 event,
// 0xE1 sealed reply, 0xE2 universal, 0x01–0x7F legacy response. Universal reads
// reassemble inbound FRAG chains per request_id; the host never emits fragments.

import type { Transport } from '../transport'
import { TransportError, FragmentLostError } from '../errors'
import { RemapprSession } from './auth'
import {
    buildRequest,
    buildUch,
    buildUniversal,
    CommonVerb,
    type ControlResponse,
    EVENT_TAG,
    EVT_CLASS_ROLE,
    EVT_INPUT,
    EVT_ROLE,
    FRAG_INTER_TIMEOUT_MS,
    FRAG_REASSEMBLY_CAP,
    FRAME,
    type InputEvent,
    type RoleEvent,
    Namespace,
    parseEvent,
    parseInputEvent,
    parseResponse,
    parseRoleEvent,
    parseUch,
    parseUchEvent,
    PLAINTEXT_CMDS,
    SEALED_TAG,
    Status,
    UchFlag,
    UCH_LEN,
    UCH_REQ_FIRE_AND_FORGET,
    UNIVERSAL_TAG,
} from './protocol'

const DEFAULT_TIMEOUT_MS = 1500
const MAX_ACC_BYTES = 1024 * 1024
// A relayed read (targetNode > 0) can hit the transient §10 ERR_STATE / a dropped
// packet. Pause this long between retries — short, since a lost packet recovers
// on the next TDMA cycle (this is not the seconds-long link-flap case).
const RELAY_RETRY_BACKOFF_MS = 100
// A valid relayed node reply lands in ~100 ms; don't wait the dongle's full 1 s
// §10 ERR_STATE on a dropped packet. Fast-fail the read here and retry — a late
// reply for the abandoned request_id is dropped by the rid filter, so it's safe.
const RELAY_READ_TIMEOUT_MS = 500

/** Default retry budget for an idempotent relayed read over a flapping link. At
 *  ~87 %/attempt (bench-measured) 4 retries clears a multi-chunk read (layout)
 *  well past 99 %. Pass as `callUniversalPlain(..., { retries: RELAY_READ_RETRIES })`. */
export const RELAY_READ_RETRIES = 4

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

export interface UniversalReply {
    status: number
    data: Uint8Array
}

export interface RemapprRpc {
    /** A legacy plaintext request → response (reads + handshake). */
    callPlain(cmd: number, arg?: Uint8Array, timeoutMs?: number): Promise<ControlResponse>
    /** A sealed (mutating) verb. `expectedDataLen` sizes the reply CCM span
     *  (0 for acks). Returns the opened inner response, or the plaintext
     *  ERR_AUTH if the device refused the seal. */
    callSealed(
        session: RemapprSession,
        cmd: number,
        arg?: Uint8Array,
        opts?: { expectedDataLen?: number; timeoutMs?: number },
    ): Promise<ControlResponse>
    /** A direct-attach universal (0xE2) request with inbound FRAG reassembly.
     *  `retries` (default 0) re-issues the request on a transient ERR_STATE — the
     *  §10 relay-timeout a flapping 2.4 GHz link produces. Only pass it for
     *  idempotent reads (never the AUTH handshake or a mutation). */
    callUniversalPlain(
        namespace: number,
        verb: number,
        arg?: Uint8Array,
        opts?: { targetNode?: number; timeoutMs?: number; retries?: number },
    ): Promise<UniversalReply>
    /** A sealed (mutating) verb relayed to a node behind a dongle (§6.3 outer-UCH
     *  form). The session must have been established with that node (handshake over
     *  the relay, §6.5). HW-proof-pending — the relay data plane is firmware-gated. */
    callSealedRelay(
        session: RemapprSession,
        namespace: number,
        verb: number,
        arg: Uint8Array | undefined,
        opts: { targetNode: number; timeoutMs?: number },
    ): Promise<ControlResponse>
    /** Subscribe to live 0xE0 INPUT events (Key-Test). Starts the read pump. */
    subscribeInput(cb: (e: InputEvent) => void): () => void
    /** Subscribe to RUCP cluster role-transition events (§N4b-3): sends
     *  SUBSCRIBE_EVENTS(ROLE), fans UCH(EVENT) frames to `cb`, and the returned
     *  disposer removes the listener + sends UNSUBSCRIBE when the last one goes. */
    subscribeRole(cb: (e: RoleEvent) => void): Promise<() => Promise<void>>
    onClosed(cb: (reason?: unknown) => void): () => void
    close(opts?: { abortTransport?: boolean }): Promise<void>
}

export function createRemapprRpc(transport: Transport): RemapprRpc {
    const reader = transport.readable.getReader()
    const writer = transport.writable.getWriter()

    let closed = false
    let acc = new Uint8Array()
    let queue: Promise<unknown> = Promise.resolve()
    const closedListeners = new Set<(reason?: unknown) => void>()
    const inputListeners = new Set<(e: InputEvent) => void>()
    const roleListeners = new Set<(e: RoleEvent) => void>()

    // The single outstanding non-event response waiter (synchronous channel),
    // plus a buffer for non-event frames that arrive before a waiter is armed
    // (a reply enqueued during write(), or FRAG fragments arriving in a burst).
    let respWaiter: {
        resolve: (f: Uint8Array) => void
        reject: (e: Error) => void
    } | null = null
    const respBuffer: Uint8Array[] = []

    function fireClosed(reason?: unknown): void {
        if (closed) return
        closed = true
        if (respWaiter) {
            respWaiter.reject(new TransportError('Remappr RPC closed'))
            respWaiter = null
        }
        for (const cb of closedListeners) {
            try {
                cb(reason)
            } catch {
                /* ignore */
            }
        }
    }

    transport.abortController.signal.addEventListener(
        'abort',
        () => fireClosed(transport.abortController.signal.reason),
        { once: true },
    )

    function routeFrame(frame: Uint8Array): void {
        if (frame[0] === EVENT_TAG) {
            const evt = parseEvent(frame)
            if (evt.eventId === EVT_INPUT && evt.payload.length >= 6) {
                const ie = parseInputEvent(evt.payload)
                for (const cb of inputListeners) {
                    try {
                        cb(ie)
                    } catch {
                        /* ignore */
                    }
                }
            }
            return // events never satisfy a response waiter
        }
        if (
            frame[0] === UNIVERSAL_TAG &&
            frame.length > UCH_LEN + 1 &&
            (frame[3] & UchFlag.EVENT) !== 0
        ) {
            const evt = parseUchEvent(frame)
            if (evt.eventId === EVT_ROLE && evt.payload.length >= 4) {
                const re = parseRoleEvent(evt.payload)
                for (const cb of roleListeners) {
                    try {
                        cb(re)
                    } catch {
                        /* ignore */
                    }
                }
            }
            return // an unsolicited event never satisfies a response waiter
        }
        if (respWaiter) {
            const w = respWaiter
            respWaiter = null
            w.resolve(frame)
        } else {
            respBuffer.push(frame) // arm-before-consume race / FRAG burst
        }
    }

    function ingest(value: Uint8Array): boolean {
        if (acc.length + value.length > MAX_ACC_BYTES) {
            fireClosed('acc-overflow')
            return false
        }
        const merged = new Uint8Array(acc.length + value.length)
        merged.set(acc, 0)
        merged.set(value, acc.length)
        acc = merged
        while (acc.length >= FRAME) {
            routeFrame(acc.slice(0, FRAME))
            acc = acc.slice(FRAME)
        }
        return true
    }

    async function pump(): Promise<void> {
        while (!closed) {
            let result: ReadableStreamReadResult<Uint8Array>
            try {
                result = await reader.read()
            } catch (err) {
                if (!closed) fireClosed(err)
                return
            }
            if (result.done) {
                fireClosed('eof')
                return
            }
            if (result.value && result.value.length > 0) {
                if (!ingest(result.value)) return
            }
        }
    }
    void pump()

    function nextFrame(timeoutMs: number): Promise<Uint8Array> {
        return new Promise<Uint8Array>((resolve, reject) => {
            const buffered = respBuffer.shift()
            if (buffered) {
                resolve(buffered)
                return
            }
            if (closed) {
                reject(new TransportError('Remappr RPC closed'))
                return
            }
            const timer = setTimeout(() => {
                if (respWaiter) respWaiter = null
                reject(new TransportError(`Remappr RPC timeout after ${timeoutMs}ms`))
            }, timeoutMs)
            respWaiter = {
                resolve: (f) => {
                    clearTimeout(timer)
                    resolve(f)
                },
                reject: (e) => {
                    clearTimeout(timer)
                    reject(e)
                },
            }
        })
    }

    async function writeFrame(frame: Uint8Array): Promise<void> {
        const padded = frame.length === FRAME ? frame : new Uint8Array(FRAME)
        if (frame.length !== FRAME) padded.set(frame.subarray(0, FRAME))
        await writer.write(padded)
    }

    // Serialize every exchange — the device handles one control request per owner.
    function exchange<T>(fn: () => Promise<T>): Promise<T> {
        const work = queue.catch(() => undefined).then(() => {
            if (closed) throw new TransportError('Remappr RPC closed')
            return fn()
        })
        queue = work.catch(() => undefined)
        return work
    }

    let seq = 0
    const nextSeq = (): number => (seq = (seq + 1) & 0xff)
    let reqId = 0
    const nextReqId = (): number => (reqId = (reqId + 1) % UCH_REQ_FIRE_AND_FORGET)

    async function callPlain(
        cmd: number,
        arg: Uint8Array = new Uint8Array(),
        timeoutMs = DEFAULT_TIMEOUT_MS,
    ): Promise<ControlResponse> {
        return exchange(async () => {
            await writeFrame(buildRequest(cmd, nextSeq(), arg))
            const frame = await nextFrame(timeoutMs)
            return parseResponse(frame)
        })
    }

    async function callSealed(
        session: RemapprSession,
        cmd: number,
        arg: Uint8Array = new Uint8Array(),
        opts: { expectedDataLen?: number; timeoutMs?: number } = {},
    ): Promise<ControlResponse> {
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
        return exchange(async () => {
            await writeFrame(session.seal(cmd, nextSeq(), arg))
            const frame = await nextFrame(timeoutMs)
            if (frame[0] !== SEALED_TAG) {
                // Plaintext reply — a gated verb the device refused (ERR_AUTH).
                return parseResponse(frame)
            }
            const inner = session.open(frame.subarray(1), opts.expectedDataLen ?? 0)
            if (inner === null) {
                throw new TransportError('sealed reply failed authentication')
            }
            return parseResponse(inner)
        })
    }

    // One universal (0xE2) request → reassembled reply. Serialized by exchange().
    async function universalRoundTrip(
        namespace: number,
        verb: number,
        arg: Uint8Array,
        target: number,
        baseTimeout: number,
    ): Promise<UniversalReply> {
        return exchange(async () => {
            const rid = nextReqId()
            const inner = buildRequest(verb, nextSeq(), arg)
            await writeFrame(buildUniversal(namespace, rid, inner, target))

            let assembled = new Uint8Array(0)
            let inChain = false
            let expIdx = 0 // next expected frag index in the active chain (§4.2)
            let chainCnt = 0 // frag_count from FRAG_FIRST; 0 = legacy (no seq)
            let timeout = baseTimeout
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const frame = await nextFrame(timeout)
                if (frame[0] !== UNIVERSAL_TAG) continue // ignore stray legacy frame
                if (frame[1] === SEALED_TAG) {
                    throw new TransportError('sealed universal reply not supported here')
                }
                const uch = parseUch(frame, 1)
                if (uch.requestId !== rid) continue // a reply to an earlier request
                if (!(uch.flags & UchFlag.RESP)) {
                    throw new TransportError('universal reply missing RESP flag')
                }
                const chunk = frame.subarray(1 + UCH_LEN)
                const fragBits = uch.flags & (UchFlag.FRAG_FIRST | UchFlag.FRAG_MORE)
                if (!inChain && fragBits === 0) {
                    if (uch.fragCount > 0 && uch.fragIndex !== 0) {
                        // Seq present, no chain, no FRAG flags: FRAG_FIRST was lost.
                        throw new FragmentLostError(
                            `FRAG chain start lost (got fragment ${uch.fragIndex} of ${uch.fragCount})`,
                        )
                    }
                    assembled = chunk.slice() // single-frame reply
                    break
                }
                if (uch.flags & UchFlag.FRAG_FIRST) {
                    assembled = new Uint8Array(0) // (re)start; chunk appended below
                    inChain = true
                    expIdx = 0
                    chainCnt = uch.fragCount
                    timeout = Math.max(baseTimeout, FRAG_INTER_TIMEOUT_MS)
                } else if (!inChain) {
                    continue // stray FRAG_MORE without a FRAG_FIRST
                }
                // Per-fragment seq (§4.2): a hole in the index means a fragment was
                // dropped in transit — surface it so an idempotent read re-requests
                // instead of reassembling a silently truncated body.
                if (chainCnt > 0) {
                    if (uch.fragIndex !== expIdx) {
                        throw new FragmentLostError(
                            `FRAG gap: expected fragment ${expIdx}, got ${uch.fragIndex} of ${chainCnt}`,
                        )
                    }
                    expIdx++
                }
                const merged = new Uint8Array(assembled.length + chunk.length)
                merged.set(assembled, 0)
                merged.set(chunk, assembled.length)
                assembled = merged
                if (assembled.length > FRAG_REASSEMBLY_CAP) {
                    throw new TransportError('universal reply exceeds reassembly cap')
                }
                if (uch.flags & UchFlag.FRAG_MORE) continue
                if (chainCnt > 0 && expIdx !== chainCnt) {
                    throw new FragmentLostError(
                        `FRAG chain ended early: ${expIdx} of ${chainCnt} fragments`,
                    )
                }
                break // FRAG_MORE clear → last fragment
            }
            const resp = parseResponse(assembled)
            return { status: resp.status, data: resp.data }
        })
    }

    async function callUniversalPlain(
        namespace: number,
        verb: number,
        arg: Uint8Array = new Uint8Array(),
        opts: { targetNode?: number; timeoutMs?: number; retries?: number } = {},
    ): Promise<UniversalReply> {
        const target = opts.targetNode ?? 0
        // Retry only the transient §10 ERR_STATE / dropped-packet timeout, and only
        // when the caller opted in — the read is idempotent. A relayed retriable
        // read fast-fails (RELAY_READ_TIMEOUT_MS) so a dropped packet costs ~0.5 s,
        // not the dongle's 1 s ERR_STATE; the handshake/direct keep the long wait.
        const wantsRetry = (opts.retries ?? 0) > 0
        const baseTimeout =
            opts.timeoutMs ??
            (wantsRetry && target > 0 ? RELAY_READ_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
        const maxAttempts = wantsRetry ? (opts.retries as number) + 1 : 1
        for (let attempt = 1; ; attempt++) {
            try {
                const reply = await universalRoundTrip(
                    namespace,
                    verb,
                    arg,
                    target,
                    baseTimeout,
                )
                if (reply.status !== Status.ERR_STATE || attempt >= maxAttempts) {
                    return reply
                }
            } catch (e) {
                // A reply frame (or a FRAG continuation) lost on a flapping relay
                // makes nextFrame() reject with a timeout. Retry that transient
                // like ERR_STATE; rethrow a closed transport or a spent budget.
                const retriable =
                    e instanceof FragmentLostError ||
                    (e instanceof TransportError && /timeout/i.test(e.message))
                if (!retriable || attempt >= maxAttempts) throw e
            }
            await delay(RELAY_RETRY_BACKOFF_MS)
        }
    }

    async function callSealedRelay(
        session: RemapprSession,
        namespace: number,
        verb: number,
        arg: Uint8Array = new Uint8Array(),
        opts: { targetNode: number; timeoutMs?: number },
    ): Promise<ControlResponse> {
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
        return exchange(async () => {
            const rid = nextReqId()
            const uch = buildUch(namespace, rid, opts.targetNode)
            await writeFrame(session.sealRelay(uch, verb, nextSeq(), arg))
            const reply = await nextFrame(timeoutMs)
            if (reply[0] !== UNIVERSAL_TAG) {
                throw new TransportError('expected a universal reply to a relayed seal')
            }
            // Open-failure reply (§6.3): [0xE2][UCH_outer(RESP)][plaintext inner].
            // The node couldn't seal (no session / tamper), so the inner is a bare
            // plaintext response after the outer UCH.
            if (reply[1 + UCH_LEN] !== SEALED_TAG) {
                return parseResponse(reply.subarray(1 + UCH_LEN))
            }
            const inner = session.openRelay(reply)
            if (inner === null) {
                throw new TransportError('relay-sealed reply failed authentication')
            }
            return parseResponse(inner)
        })
    }

    function subscribeInput(cb: (e: InputEvent) => void): () => void {
        inputListeners.add(cb)
        return () => inputListeners.delete(cb)
    }

    async function subscribeRole(
        cb: (e: RoleEvent) => void,
    ): Promise<() => Promise<void>> {
        const mask = new Uint8Array(4)
        new DataView(mask.buffer).setUint32(0, EVT_CLASS_ROLE, true)
        await callUniversalPlain(
            Namespace.COMMON,
            CommonVerb.SUBSCRIBE_EVENTS,
            mask,
        )
        roleListeners.add(cb)
        return async () => {
            roleListeners.delete(cb)
            if (roleListeners.size === 0) {
                try {
                    await callUniversalPlain(
                        Namespace.COMMON,
                        CommonVerb.UNSUBSCRIBE,
                        mask,
                    )
                } catch {
                    /* best-effort unsubscribe */
                }
            }
        }
    }

    async function close(opts: { abortTransport?: boolean } = {}): Promise<void> {
        if (closed && !opts.abortTransport) {
            releaseLocks()
            return
        }
        fireClosed('close')
        if (opts.abortTransport && !transport.abortController.signal.aborted) {
            transport.abortController.abort('remappr-rpc.close')
            await Promise.resolve()
        }
        releaseLocks()
    }

    function releaseLocks(): void {
        try {
            reader.releaseLock()
        } catch {
            /* held by pump or already released */
        }
        try {
            writer.releaseLock()
        } catch {
            /* already released */
        }
    }

    return {
        callPlain,
        callSealed,
        callUniversalPlain,
        callSealedRelay,
        subscribeInput,
        subscribeRole,
        onClosed(cb) {
            if (closed) {
                cb()
                return () => undefined
            }
            closedListeners.add(cb)
            return () => closedListeners.delete(cb)
        },
        close,
    }
}

/** True when a verb may be sent over the plaintext path (no seal required). */
export function isPlaintextCmd(cmd: number): boolean {
    return PLAINTEXT_CMDS.has(cmd)
}
