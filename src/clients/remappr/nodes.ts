// pattern-check: skip — thin async wrappers over the DONGLE namespace verbs
// (LIST_NODES / GET_NODE_INFO); stateless relay reads, no GoF abstraction.
//
// Multi-node enumeration (Workstream D, §5.9/§6). A ROLE_DONGLE device relays to
// the nodes bonded to it, each addressed by a short-id. These read-only verbs
// target the dongle ITSELF (target_node=0) and return the pipe↔short-id roster a
// host needs before it can address a behind-dongle node via `target_node`. A
// directly-attached (non-dongle) device answers ERR_CMD → an empty roster.

import {
    buildChangeChannelsArg,
    buildNodeInfoArg,
    Cmd,
    CommonVerb,
    DongleVerb,
    ENTER_BOOTLOADER_ARG,
    Namespace,
    NODE_RECORD_LEN,
    parseChannelChange,
    parseClusterDiag,
    parseErrorCounters,
    parseLinkStats,
    parseNodeList,
    parseNodeRecord,
    parsePipeTable,
    Status,
    statusName,
    type ChannelChange,
    type ChannelChangeRequest,
    type ClusterDiag,
    type ErrorCounters,
    type LinkStats,
    type NodeRecord,
    type PipeTable,
    type RelayStats,
} from './protocol'
import {
    loadOrCreateIdentity,
    RemapprSession,
    type RemapprIdentity,
} from './auth'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

export type {
    ChannelChange,
    ChannelChangeRequest,
    ErrorCounters,
    LinkStats,
    NodeRecord,
    PipeTable,
    RelayStats,
}

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

// pattern-check: skip — thin async wrapper over DONGLE.CLEAR_ALL_BONDS, same
// shape as forgetNode above; no GoF abstraction.
/** Wipe the dongle's entire bond table (DONGLE.CLEAR_ALL_BONDS) — the recovery
 *  for a table full of stale bonds that FORGET_NODE can't reach (an incomplete
 *  bond has no short-id). Returns the number of pipes actually unbonded. Throws
 *  on a non-dongle device (ERR_CMD). */
export async function clearAllBonds(rpc: RemapprRpc): Promise<number> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.CLEAR_ALL_BONDS,
    )
    if (reply.status !== Status.OK)
        throw new Error(`CLEAR_ALL_BONDS → ${statusName(reply.status)}`)
    return reply.data.length >= 1 ? reply.data[0] : 0
}

// pattern-check: skip — thin async wrapper over DONGLE.GET_LINK_STATS, same
// shape as the wrappers above; no GoF abstraction.
/** Read the dongle's §16 radio link stats (DONGLE.GET_LINK_STATS): the live
 *  hop map with its per-channel packet-error window, each channel's last
 *  verdict and the map generation counter. Idempotent read. Throws on a
 *  non-dongle device (ERR_CMD). */
export async function getLinkStats(rpc: RemapprRpc): Promise<LinkStats> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.GET_LINK_STATS,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_LINK_STATS → ${statusName(reply.status)}`)
    return parseLinkStats(reply.data)
}

// pattern-check: skip — thin async wrapper over DONGLE.CHANGE_CHANNELS, same
// shape as the wrappers above; no GoF abstraction.
/** Move every node behind the dongle to new channels (DONGLE.CHANGE_CHANNELS):
 *  the failing ones replaced, or an explicit map. The dongle rolls it out one
 *  slot at a time; poll getLinkStats().changeInProgress. Throws while a
 *  roll-out runs (ERR_STATE) or on a refused list (ERR_ARG). Not repeatable. */
export async function changeChannels(
    rpc: RemapprRpc,
    req: ChannelChangeRequest,
): Promise<ChannelChange> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.CHANGE_CHANNELS,
        buildChangeChannelsArg(req),
    )
    if (reply.status !== Status.OK)
        throw new Error(`CHANGE_CHANNELS → ${statusName(reply.status)}`)
    return parseChannelChange(reply.data)
}

// pattern-check: skip — thin async wrapper over DONGLE.SET_NKRO, same shape as
// the wrappers above; no GoF abstraction.
/** Set (or query, when `enabled` is omitted) the dongle's keystroke routing
 *  (DONGLE.SET_NKRO): true = the NKRO interface, false = the boot 6KRO
 *  interface (default, BIOS-safe). Persists across dongle reboots. Returns the
 *  current state. Throws on a non-dongle device (ERR_CMD). */
export async function setDongleNkro(
    rpc: RemapprRpc,
    enabled?: boolean,
): Promise<boolean> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.SET_NKRO,
        enabled === undefined ? undefined : new Uint8Array([enabled ? 1 : 0]),
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_NKRO → ${statusName(reply.status)}`)
    return reply.data.length >= 1 ? reply.data[0] !== 0 : false
}

// pattern-check: skip — thin async wrappers over DONGLE.GET_PIPE_TABLE /
// COMMON.GET_ERROR_COUNTERS, same shape as the wrappers above.
/** Read the dongle's raw radio pipe table (DONGLE.GET_PIPE_TABLE): every pipe
 *  1..7 bonded or not, plus the pairing-window state — the diagnosis view
 *  behind listNodes (incomplete bonds, stuck pairing reservations, §6.4
 *  control leases). Idempotent read. Throws on a non-dongle device (ERR_CMD). */
export async function getPipeTable(rpc: RemapprRpc): Promise<PipeTable> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.GET_PIPE_TABLE,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_PIPE_TABLE → ${statusName(reply.status)}`)
    return parsePipeTable(reply.data)
}

/** Reboot the dongle into its own bootloader (DONGLE.ENTER_BOOTLOADER) so new
 *  firmware can be loaded over the bootloader's USB DFU. The dongle drops off
 *  USB ~200 ms after the reply. Throws ERR_CMD on a board that has no
 *  software way into its bootloader. */
export async function enterDongleBootloader(rpc: RemapprRpc): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.DONGLE,
        DongleVerb.ENTER_BOOTLOADER,
        ENTER_BOOTLOADER_ARG,
    )
    if (reply.status !== Status.OK)
        throw new Error(`ENTER_BOOTLOADER → ${statusName(reply.status)}`)
}

/** Read a device's §20 error counters (COMMON.GET_ERROR_COUNTERS): radio MIC
 *  failures, unACKed-uplink channel fails, and link resyncs — free-running
 *  since boot. Pass `targetNode` to relay the read to a node behind a dongle
 *  (retried on the transient §10 relay ERR_STATE). Throws where the firmware
 *  has no counter source wired (ERR_CMD). */
export async function getErrorCounters(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<ErrorCounters> {
    const reply = await rpc.callUniversalPlain(
        Namespace.COMMON,
        CommonVerb.GET_ERROR_COUNTERS,
        undefined,
        targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_ERROR_COUNTERS → ${statusName(reply.status)}`)
    return parseErrorCounters(reply.data)
}

// pattern-check: skip — thin async relay read wrapper mirroring getErrorCounters
/** Fetch cluster diagnostics (COMMON.GET_CLUSTER_DIAG, §N4b-3): this node's
 *  cluster role plus each node-bus peer's advertised role status (N4b-2 HELLO
 *  caps + HEARTBEAT tail). Pass `targetNode` to relay the read to a node behind a
 *  dongle (retried on the transient §10 relay ERR_STATE). Throws where the
 *  firmware has no cluster-diag source wired (ERR_CMD). */
export async function getClusterDiag(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<ClusterDiag> {
    const reply = await rpc.callUniversalPlain(
        Namespace.COMMON,
        CommonVerb.GET_CLUSTER_DIAG,
        undefined,
        targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_CLUSTER_DIAG → ${statusName(reply.status)}`)
    return parseClusterDiag(reply.data)
}

// pattern-check: skip — orchestrates establishNodeSession + one callSealedRelay;
// linear async flow, same idiom as the wrappers above, no GoF abstraction.
/**
 * Tell a behind-dongle node to forget its dongle bond and re-arm for a fresh
 * pair (COMMON.UNPAIR_RADIO, owner-sealed §19, P1). Establishes a §19 node
 * session over the relay, then sends the sealed verb; the node drops its bond
 * and re-arms, and the dongle reuses that node's pipe on the re-pair (no leak).
 * Throws on a failed handshake or a non-OK seal. NOTE: the relayed sealed data
 * plane is HW-proof-pending (firmware-gated); the firmware verb is HW-proven.
 */
export async function unpairRadio(
    rpc: RemapprRpc,
    targetNode: number,
    identity: RemapprIdentity = loadOrCreateIdentity(),
): Promise<void> {
    const session = await establishNodeSession(rpc, targetNode, identity)
    const reply = await rpc.callSealedRelay(
        session,
        Namespace.COMMON,
        Cmd.UNPAIR_RADIO,
        undefined,
        { targetNode },
    )
    if (reply.status !== Status.OK)
        throw new Error(
            `UNPAIR_RADIO 0x${targetNode.toString(16)} → ${statusName(reply.status)}`,
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
