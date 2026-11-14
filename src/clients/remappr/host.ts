// pattern-check: skip — thin async wrappers over the HOST namespace verbs, same
// idiom as mouse.ts / unicode.ts; no abstraction.
//
// Host values (include/remappr/host_values.h): the host pushes the clock, CPU
// and RAM load, the playing track, the volume, a notification or free text
// slots, and the device's screens draw them. SET_VALUE and CLEAR are mutating:
// they ride `callMutation`, sealed (§19) when the RPC holds a session. A value
// expires on the device unless it is pushed again (INT and TEXT after
// CONFIG_REMAPPR_HOST_VALUES_TTL_MS, 5 s by default; TIME after 24 h), so a host
// refreshes what GET_KEYS lists. Pass `targetNode` to relay through a dongle.

import { type DiscoveryResult, servesNamespace } from './discovery'
import {
    buildHostNumberArg,
    buildHostTextArgs,
    HostType,
    HostVerb,
    Namespace,
    parseHostKeys,
    Status,
    statusName,
} from './protocol'
import { type CallTarget, once, repeatable, type RemapprRpc } from './rpc'

/** True when the device serves the HOST namespace in a version this client
 *  decodes. */
export function servesHost(discovery: DiscoveryResult): boolean {
    return servesNamespace(discovery, Namespace.HOST)
}

/** The keys the device's screens show (HOST.GET_KEYS): what to keep pushing. */
export async function getHostKeys(rpc: RemapprRpc, targetNode = 0): Promise<number[]> {
    const reply = await rpc.callUniversalPlain(
        Namespace.HOST,
        HostVerb.GET_KEYS,
        undefined,
        repeatable(targetNode),
    )
    if (reply.status !== Status.OK)
        throw new Error(`HOST GET_KEYS → ${statusName(reply.status)}`)
    return parseHostKeys(reply.data)
}

async function setValue(rpc: RemapprRpc, arg: Uint8Array, to?: CallTarget): Promise<void> {
    const reply = await rpc.callMutation(Namespace.HOST, HostVerb.SET_VALUE, arg, to)
    if (reply.status !== Status.OK)
        throw new Error(`HOST SET_VALUE key 0x${arg[0].toString(16)} → ${statusName(reply.status)}`)
}

/** Push an INT value (an i32: a percentage, a count). */
export function setHostInt(rpc: RemapprRpc, key: number, value: number, targetNode = 0): Promise<void> {
    // An absolute value: through the dongle it may ride the relay retries.
    return setValue(rpc, buildHostNumberArg(key, HostType.INT, value), repeatable(targetNode))
}

/** Push a TIME value: local seconds since 1970 (UTC seconds plus the local
 *  offset), as the device has no time zone. */
export function setHostTime(
    rpc: RemapprRpc,
    key: number,
    localSeconds: number,
    targetNode = 0,
): Promise<void> {
    return setValue(rpc, buildHostNumberArg(key, HostType.TIME, localSeconds), repeatable(targetNode))
}

/** Push a TEXT value, cut to HOST_TEXT_MAX UTF-8 bytes, in pieces. The device
 *  takes them only in order and keeps each until the rest arrives, so a piece
 *  is never resent: a duplicate would be out of order. */
export async function setHostText(
    rpc: RemapprRpc,
    key: number,
    text: string,
    targetNode = 0,
): Promise<void> {
    for (const arg of buildHostTextArgs(key, text)) await setValue(rpc, arg, once(targetNode))
}

/** Drop every value the device holds (HOST.CLEAR). */
export async function clearHostValues(rpc: RemapprRpc, targetNode = 0): Promise<void> {
    const reply = await rpc.callMutation(Namespace.HOST, HostVerb.CLEAR, undefined, repeatable(targetNode))
    if (reply.status !== Status.OK) throw new Error(`HOST CLEAR → ${statusName(reply.status)}`)
}
