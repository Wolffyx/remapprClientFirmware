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
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    parseNodeList,
    parseNodeRecord,
    Status,
    type NodeRecord,
} from './protocol'
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
