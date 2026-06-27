// pattern-check: skip — thin async wrappers over the DONGLE namespace verbs
// (LIST_NODES / GET_NODE_INFO); stateless relay reads, no GoF abstraction.
//
// Multi-node enumeration (Workstream D, §5.9/§6). A ROLE_DONGLE device relays to
// the nodes bonded to it, each addressed by a short-id. These read-only verbs
// target the dongle ITSELF (target_node=0) and return the pipe↔short-id roster a
// host needs before it can address a behind-dongle node via `target_node`. A
// directly-attached (non-dongle) device answers ERR_CMD → an empty roster.

import {
    buildNodeInfoArg,
    Cmd,
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    parseNodeList,
    parseNodeRecord,
    Status,
    statusName,
    type NodeRecord,
} from './protocol'
import {
    loadOrCreateIdentity,
    RemapprSession,
    type RemapprIdentity,
} from './auth'
import type { RemapprRpc } from './rpc'

export type { NodeRecord }

/** Enumerate the nodes bonded to a dongle (DONGLE.LIST_NODES). Returns [] for a
 *  directly-attached (non-dongle) device or an empty roster. */
export async function listNodes(rpc: RemapprRpc): Promise<NodeRecord[]> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.LIST_NODES,
    )
    return reply.status === Status.OK ? parseNodeList(reply.data) : []
}

/** Fetch one node's record by short-id (DONGLE.GET_NODE_INFO), or null when the
 *  dongle doesn't know it (or the device isn't a dongle). */
export async function getNodeInfo(
    rpc: RemapprRpc,
    shortId: number,
): Promise<NodeRecord | null> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.GET_NODE_INFO,
        buildNodeInfoArg(shortId),
    )
    return reply.status === Status.OK && reply.data.length >= NODE_RECORD_LEN
        ? parseNodeRecord(reply.data)
        : null
}

// pattern-check: skip — thin async wrappers over DONGLE.OPEN_PAIR_WINDOW /
// FORGET_NODE, same shape as listNodes/getNodeInfo above; no GoF abstraction.

/** Open or close the dongle's §17 pairing window remotely (DONGLE.OPEN_PAIR_
 *  WINDOW) — the button-equivalent over USB. Returns the resulting window state
 *  (true = open). Throws on ERR_STATE (all 7 pipes already bonded) or a
 *  non-dongle device (ERR_CMD). */
export async function openPairWindow(
    rpc: RemapprRpc,
    open = true,
): Promise<boolean> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.OPEN_PAIR_WINDOW,
        new Uint8Array([open ? 1 : 0]),
    )
    if (reply.status !== Status.OK)
        throw new Error(`OPEN_PAIR_WINDOW → ${statusName(reply.status)}`)
    return reply.data.length >= 1 ? reply.data[0] !== 0 : open
}

/** Unbond a node by short-id (DONGLE.FORGET_NODE) — clears a stale dongle bond
 *  so the pipe is free to re-pair. Throws on ERR_ARG (unknown short-id) or a
 *  non-dongle device (ERR_CMD). */
export async function forgetNode(
    rpc: RemapprRpc,
    shortId: number,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.FORGET_NODE,
        new Uint8Array([shortId & 0xff, (shortId >> 8) & 0xff]),
    )
    if (reply.status !== Status.OK)
        throw new Error(
            `FORGET_NODE 0x${shortId.toString(16)} → ${statusName(reply.status)}`,
        )
}

// pattern-check: skip — handshake-over-relay mirrors the direct establishSession
// (adapter.ts) but rides callUniversalPlain + target_node; linear async flow.
/**
 * Establish a §19 control-auth session with a node behind a dongle via the
 * handshake-over-relay (§6.5). AUTH_BEGIN / AUTH_FINISH travel as plaintext
 * universal COMMON verbs addressed by `targetNode` — the node's reply carries its
 * ephemeral pubkey as a normal plaintext universal response, and the X25519 ECDH
 * is app↔node (the dongle only relays public bytes). The returned session is
 * established; mutating verbs then ride `rpc.callSealedRelay` (§6.3).
 *
 * The handshake path is firmware-complete (HW-proof pending); the relayed
 * sealed-write data plane it unlocks is firmware-gated.
 */
export async function establishNodeSession(
    rpc: RemapprRpc,
    targetNode: number,
    identity: RemapprIdentity = loadOrCreateIdentity(),
): Promise<RemapprSession> {
    const session = new RemapprSession(identity)
    const begin = await rpc.callUniversalPlain(
        Namespace.COMMON,
        Cmd.CONTROL_AUTH_BEGIN,
        undefined,
        { targetNode },
    )
    if (begin.status !== Status.OK || begin.data.length < 32)
        throw new Error(
            `node 0x${targetNode.toString(16)} AUTH_BEGIN → ${statusName(begin.status)}`,
        )
    session.derive(begin.data.subarray(0, 32))
    const finish = await rpc.callUniversalPlain(
        Namespace.COMMON,
        Cmd.CONTROL_AUTH_FINISH,
        session.hostPub,
        { targetNode },
    )
    if (finish.status !== Status.OK)
        throw new Error(
            `node 0x${targetNode.toString(16)} AUTH_FINISH → ${statusName(finish.status)}`,
        )
    session.resetCounters()
    return session
}
