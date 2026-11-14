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

import type { Transport } from '../../transport'
import { TransportError, FragmentLostError } from '../../errors'
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
    RESP_HDR_LEN,
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

/** Where a call goes and whether it may be sent again. */
export interface CallTarget {
    targetNode?: number
    retries?: number
}

/** A call that, sent twice, leaves the device as sending it once would: a read,
 *  or a SET of an absolute value. To a node behind the dongle it rides the relay
 *  retries; to the device itself (`targetNode` 0) it goes as is. */
export function repeatable(targetNode: number): CallTarget | undefined {
    return targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined
}

/** A call that must not run twice: a procedure step, a config chunk. To a node
 *  behind the dongle it is sent once. */
export function once(targetNode: number): CallTarget | undefined {
    return targetNode ? { targetNode } : undefined
}

/** True for what a lossy relay hop throws: a reply (or a fragment of one) that
 *  never came. The request may or may not have reached the node. */
export function isLinkDrop(e: unknown): boolean {
    return (
        e instanceof FragmentLostError ||
        (e instanceof TransportError && /timeout/i.test(e.message))
    )
}

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

export interface UniversalReply {
    status: number
    data: Uint8Array
}

/** The reply to a sealed call. `sealed` is false for the bare plaintext error
 *  a device sends when it could not open the request (no session, a stale
 *  counter, tampering): the verb never ran. */
export interface SealedReply extends UniversalReply {
    sealed: boolean
}

/** A legacy sealed response, with the same `sealed` marker. */
export type SealedResponse = ControlResponse & { sealed: boolean }

/** The §19 session the RPC seals mutations with, and how to get a fresh one
 *  when the device has dropped it. */
export interface SessionBinding {
    session: RemapprSession
    /** Run the handshake again; resolves with the new session. */
    renew: () => Promise<RemapprSession>
}

export interface RemapprRpc {
    /** A legacy plaintext request → response (reads + handshake). */
    callPlain(cmd: number, arg?: Uint8Array, timeoutMs?: number): Promise<ControlResponse>
    /** A legacy sealed (0xE1) verb. Returns the opened inner response (its
     *  length found by trial), or the plaintext ERR_AUTH if the device refused
     *  the seal (`sealed` false). */
    callSealed(
        session: RemapprSession,
        cmd: number,
        arg?: Uint8Array,
        opts?: { timeoutMs?: number },
    ): Promise<SealedResponse>
    /** A namespace verb sealed for the device itself (§6.3 direct form,
     *  `[0xE2][0xE1]...`). The reply is matched by the request id inside its
     *  sealed UCH. A bare plaintext ERR_AUTH comes back with `sealed` false. */
    callSealedUniversal(
        session: RemapprSession,
        namespace: number,
        verb: number,
        arg?: Uint8Array,
        opts?: { timeoutMs?: number },
    ): Promise<SealedReply>
    /** Seal the mutations of `callWrite` / `callMutation` with this session
     *  (undefined: send them in plaintext, for a device with auth off). */
    bindSession(binding: SessionBinding | undefined): void
    /** A legacy flat mutating verb (config staging): sealed through the bound
     *  session, plaintext when none is bound. On a plaintext ERR_AUTH the
     *  session is renewed once and the verb sent again. */
    callWrite(cmd: number, arg?: Uint8Array): Promise<ControlResponse>
    /** A mutating namespace verb. To the device itself it is sealed through the
     *  bound session (renewed once on a plaintext ERR_AUTH); with no session, or
     *  to a node behind the dongle, it goes as `callUniversalPlain`. */
    callMutation(
        namespace: number,
        verb: number,
        arg?: Uint8Array,
        target?: CallTarget,
    ): Promise<UniversalReply>
    /** A direct-attach universal (0xE2) request with inbound FRAG reassembly.
     *  `retries` (default 0) re-issues the request on a transient ERR_STATE — the
     *  §10 relay-timeout a flapping 2.4 GHz link produces. Only pass it for a
     *  call that is safe to repeat (`repeatable`): a read or an absolute SET,
     *  never the AUTH handshake, a procedure step or a config chunk. */
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
        // A direct sealed reply ([0xE2][0xE1][ctr]...) has no cleartext UCH:
        // its byte 3 is counter, not flags.
        if (
            frame[0] === UNIVERSAL_TAG &&
            frame[1] !== SEALED_TAG &&
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

    // Read frames until `match` accepts one, within `timeoutMs` in all. A
    // frame it rejects (undefined) is a late reply to a request that timed
    // out earlier, or a frame of another class: it is dropped, so it can never
    // be taken as this call's answer.
    async function awaitReply<T>(
        timeoutMs: number,
        match: (frame: Uint8Array) => T | undefined,
    ): Promise<T> {
        const deadline = Date.now() + timeoutMs
        for (;;) {
            const left = deadline - Date.now()
            if (left <= 0) {
                throw new TransportError(`Remappr RPC timeout after ${timeoutMs}ms`)
            }
            const got = match(await nextFrame(left))
            if (got !== undefined) return got
        }
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
            const seq = nextSeq()
            await writeFrame(buildRequest(cmd, seq, arg))
            // A legacy reply echoes the request's cmd and seq.
            return awaitReply(timeoutMs, (f) =>
                isLegacyReply(f, cmd, seq) ? parseResponse(f) : undefined,
            )
        })
    }

    async function callSealed(
        session: RemapprSession,
        cmd: number,
        arg: Uint8Array = new Uint8Array(),
        opts: { timeoutMs?: number } = {},
    ): Promise<SealedResponse> {
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
        return exchange(async () => {
            const seq = nextSeq()
            await writeFrame(session.seal(cmd, seq, arg))
            return awaitReply<SealedResponse>(timeoutMs, (frame) => {
                // The bare header: the device could not open the request.
                if (bareStatus(frame) !== null)
                    return { ...parseResponse(frame), sealed: false }
                if (frame[0] !== SEALED_TAG) return undefined
                const inner = session.open(frame.subarray(1))
                if (inner === null) {
                    throw new TransportError('sealed reply failed authentication')
                }
                // An authentic reply to an earlier request: skip it.
                if (inner[0] !== cmd || inner[1] !== seq) return undefined
                return { ...parseResponse(inner), sealed: true }
            })
        })
    }

    // One direct sealed universal request → its reply. A sealed reply carries
    // its request id inside the AEAD, so a stale one (a late answer to an
    // earlier request) is opened and skipped. The device answers a request it
    // could not open with a bare 6-byte plaintext header (cmd 0, seq 0).
    async function callSealedUniversal(
        session: RemapprSession,
        namespace: number,
        verb: number,
        arg: Uint8Array = new Uint8Array(),
        opts: { timeoutMs?: number } = {},
    ): Promise<SealedReply> {
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
        return exchange(async () => {
            const rid = nextReqId()
            const uch = buildUch(namespace, rid)
            await writeFrame(session.sealDirect(uch, verb, nextSeq(), arg))
            return awaitReply<SealedReply>(timeoutMs, (frame) => {
                const bare = bareStatus(frame)
                if (bare !== null) return { status: bare, data: new Uint8Array(), sealed: false }
                if (frame[0] !== UNIVERSAL_TAG || frame[1] !== SEALED_TAG) return undefined
                const pt = session.openDirect(frame)
                if (pt === null) {
                    throw new TransportError('sealed reply failed authentication')
                }
                const ruch = parseUch(pt)
                if (ruch.requestId !== rid || !(ruch.flags & UchFlag.RESP)) return undefined
                const resp = parseResponse(pt.subarray(UCH_LEN))
                return { status: resp.status, data: resp.data, sealed: true }
            })
        })
    }

    let binding: SessionBinding | undefined
    let renewing: Promise<RemapprSession> | null = null

    // Re-handshake once, shared by every call that saw the session drop.
    function renewSession(b: SessionBinding, stale: RemapprSession): Promise<RemapprSession> {
        if (b.session !== stale) return Promise.resolve(b.session) // already renewed
        renewing ??= b
            .renew()
            .then((fresh) => {
                b.session = fresh
                return fresh
            })
            .finally(() => {
                renewing = null
            })
        return renewing
    }

    // Send a sealed call; when the device answers a plaintext ERR_AUTH (it has
    // lost the session: a reboot, another host's handshake), renew the session
    // and send it once more. The refused verb never ran, so a resend is safe.
    async function withSession<T extends { status: number; sealed: boolean }>(
        b: SessionBinding,
        send: (s: RemapprSession) => Promise<T>,
    ): Promise<T> {
        const used = b.session
        const first = await send(used)
        if (first.sealed || first.status !== Status.ERR_AUTH) return first
        return send(await renewSession(b, used))
    }

    async function callWrite(
        cmd: number,
        arg?: Uint8Array,
    ): Promise<ControlResponse> {
        const b = binding
        if (!b) return callPlain(cmd, arg)
        return withSession(b, (s) => callSealed(s, cmd, arg))
    }

    async function callMutation(
        namespace: number,
        verb: number,
        arg?: Uint8Array,
        target?: CallTarget,
    ): Promise<UniversalReply> {
        const b = binding
        if (!b || (target?.targetNode ?? 0) !== 0) {
            return callUniversalPlain(namespace, verb, arg, target)
        }
        const r = await withSession(b, (s) =>
            callSealedUniversal(s, namespace, verb, arg),
        )
        return { status: r.status, data: r.data }
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
            // One deadline for the whole wait: a skipped frame (stale, another
            // class) never extends it. Only a fragment of this reply's chain
            // does, to the inter-fragment wait.
            let waitMs = baseTimeout
            let deadline = Date.now() + waitMs
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const left = deadline - Date.now()
                if (left <= 0) {
                    throw new TransportError(`Remappr RPC timeout after ${waitMs}ms`)
                }
                const frame = await nextFrame(left)
                if (frame[0] !== UNIVERSAL_TAG) continue // ignore stray legacy frame
                // A direct sealed reply never answers a plaintext request: it is
                // a late one to an earlier sealed call. Its byte 1 is not a UCH.
                if (frame[1] === SEALED_TAG) continue
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
                    waitMs = Math.max(baseTimeout, FRAG_INTER_TIMEOUT_MS)
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
                if (uch.flags & UchFlag.FRAG_MORE) {
                    deadline = Date.now() + waitMs // wait for the next fragment
                    continue
                }
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
                if (!isLinkDrop(e) || attempt >= maxAttempts) throw e
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
            return awaitReply(timeoutMs, (reply) => {
                // Only a reply to this request id; a late one is dropped.
                if (reply[0] !== UNIVERSAL_TAG || reply[1] === SEALED_TAG) return undefined
                const outer = parseUch(reply, 1)
                if (outer.requestId !== rid || !(outer.flags & UchFlag.RESP)) return undefined
                // Open-failure reply (§6.3): [0xE2][UCH_outer(RESP)][plaintext
                // inner]. The node couldn't seal (no session / tamper), or the
                // dongle timed the relay out: a plaintext response follows.
                if (reply[1 + UCH_LEN] !== SEALED_TAG) {
                    return parseResponse(reply.subarray(1 + UCH_LEN))
                }
                const inner = session.openRelay(reply)
                if (inner === null) {
                    throw new TransportError('relay-sealed reply failed authentication')
                }
                return parseResponse(inner)
            })
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
        callSealedUniversal,
        bindSession(b) {
            binding = b
        },
        callWrite,
        callMutation,
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

/** True for a legacy response frame (byte 0 = the cmd, 0x01–0x7F) echoing
 *  this request's cmd and seq. */
export function isLegacyReply(frame: Uint8Array, cmd: number, seq: number): boolean {
    return frame.length >= RESP_HDR_LEN && frame[0] === cmd && frame[1] === seq
}

/** The status of the bare 6-byte header (cmd 0, seq 0, a non-zero status) a
 *  device sends where it has no trusted cmd/seq to echo — a sealed request it
 *  could not open. Null for any other frame. */
export function bareStatus(frame: Uint8Array): number | null {
    if (frame.length < RESP_HDR_LEN) return null
    if (frame[0] !== 0 || frame[1] !== 0 || frame[2] === 0) return null
    return frame[2]
}

