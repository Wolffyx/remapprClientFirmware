// Pattern check: no GoF pattern (-) — rejected — discover() is a short linear
// negotiation (device-info → personality-map → limits); plain async control flow.
//
// §7.7 host discovery state machine. The first call is always the unchanged
// 16-byte legacy GET_DEVICE_INFO (no 0xE2) — that is how proto_max is learned.
// proto_max < 2 means a v1 device: stay on the legacy flat protocol. proto_max
// >= 2 unlocks the universal discovery verbs (GET_PERSONALITY_MAP, GET_LIMITS).

import {
    Cmd,
    CommonVerb,
    type DeviceInfo,
    KNOWN_NS_VERSION,
    type Limits,
    type Manifest,
    Namespace,
    parseDeviceInfo,
    parseLimits,
    parseManifest,
    parsePersonalityMap,
    type PersonalityMap,
    Status,
    statusName,
} from './protocol'
import { type RemapprRpc, RELAY_READ_RETRIES } from './rpc'

// pattern-check: skip — a numeric tuning constant; DiscoveryResult below is
// pre-existing (unchanged), not a new interface.
/** Bootstrap timeout for the legacy GET_DEVICE_INFO probe. A directly-attached
 *  keyboard answers it in milliseconds; a dongle has no legacy dispatcher and
 *  drops it, so a long wait there is pure latency. Keep it short — on timeout the
 *  probe falls back to the universal COMMON verb (which both a keyboard and a
 *  dongle answer), so a slow keyboard is not misclassified, only delayed by one
 *  extra round trip. This is what makes connecting to a dongle feel instant
 *  instead of ~1.5 s. */
const LEGACY_PROBE_TIMEOUT_MS = 400

export interface DiscoveryResult {
    protoMax: number
    deviceInfo: DeviceInfo
    /** Present on proto_max >= 2 (role / personality / hw caps). */
    personality?: PersonalityMap
    /** Present on proto_max >= 2 (chunk + frame + pipelining limits). */
    limits?: Limits
    /** Resolved device role (enum remappr_role) from the personality map, or
     *  undefined on a v1 device. The adapter branches the connect path on it
     *  (a dongle skips auth/config and lands on its node roster). */
    role?: number
    /** GET_MANIFEST, where the COMMON verb mask lists it: each namespace's
     *  ns_version and verbs. Undefined on older firmware and on the dongle. */
    manifest?: Manifest
}

/** True when the device serves `namespace` (its personality map lists it) and
 *  no newer ns_version than this client decodes (the manifest, where the
 *  device has one, says which). A namespace whose layouts changed is treated
 *  as absent rather than misread. */
export function servesNamespace(discovery: DiscoveryResult, namespace: number): boolean {
    const listed = discovery.personality?.namespaces.some((n) => n.namespace === namespace)
    if (!listed) return false
    const desc = discovery.manifest?.namespaces.find((n) => n.namespace === namespace)
    if (!desc) return true
    const known = KNOWN_NS_VERSION[namespace]
    return known === undefined || desc.nsVersion <= known
}

/** The ns_version the device reports for `namespace`, if its manifest says. */
export function nsVersionOf(discovery: DiscoveryResult, namespace: number): number | undefined {
    return discovery.manifest?.namespaces.find((n) => n.namespace === namespace)?.nsVersion
}

/**
 * Run the discovery negotiation against a connected RPC. Reads GET_DEVICE_INFO;
 * on a proto-v2 device it additionally reads the universal personality map and
 * limits. A discovery verb that errors is treated as absent (left undefined)
 * rather than failing the whole probe.
 *
 * `opts.targetNode` (default 0 = the directly-attached endpoint) addresses a node
 * behind a dongle: GET_DEVICE_INFO then rides the universal plaintext relay path
 * (§6.2) instead of the direct legacy frame, and every discovery verb carries the
 * node's short-id as `target_node`.
 */
export async function discover(
    rpc: RemapprRpc,
    opts: { targetNode?: number } = {},
): Promise<DiscoveryResult> {
    const target = opts.targetNode ?? 0

    let diData: Uint8Array
    if (target === 0) {
        try {
            diData = (
                await rpc.callPlain(
                    Cmd.GET_DEVICE_INFO,
                    undefined,
                    LEGACY_PROBE_TIMEOUT_MS,
                )
            ).data
        } catch {
            // No legacy dispatcher answered (a dongle drops non-0xE2 frames):
            // fall back to the universal COMMON discovery verb addressed to the
            // device itself (§7.2). A dongle replies here as a ROLE_DONGLE device.
            const r = await rpc.callUniversalPlain(
                Namespace.COMMON,
                Cmd.GET_DEVICE_INFO,
                undefined,
                { targetNode: 0 },
            )
            if (r.status !== Status.OK)
                throw new Error(
                    `GET_DEVICE_INFO → ${statusName(r.status)}`,
                )
            diData = r.data
        }
    } else {
        // Relayed: legacy verbs keep their number under COMMON, so GET_DEVICE_INFO
        // travels universal-framed to the node (§6.2) rather than direct.
        const r = await rpc.callUniversalPlain(
            Namespace.COMMON,
            Cmd.GET_DEVICE_INFO,
            undefined,
            { targetNode: target, retries: RELAY_READ_RETRIES },
        )
        if (r.status !== Status.OK)
            throw new Error(
                `node 0x${target.toString(16)} GET_DEVICE_INFO → ${statusName(r.status)}`,
            )
        diData = r.data
    }
    const deviceInfo = parseDeviceInfo(diData)
    if (deviceInfo.protoMax < 2) {
        return { protoMax: deviceInfo.protoMax, deviceInfo }
    }

    let personality: PersonalityMap | undefined
    let limits: Limits | undefined
    try {
        const pm = await rpc.callUniversalPlain(
            Namespace.COMMON,
            CommonVerb.GET_PERSONALITY_MAP,
            undefined,
            { targetNode: target, retries: RELAY_READ_RETRIES },
        )
        if (pm.status === Status.OK) personality = parsePersonalityMap(pm.data)
    } catch {
        /* universal personality unavailable — leave undefined */
    }
    try {
        const lim = await rpc.callUniversalPlain(
            Namespace.COMMON,
            CommonVerb.GET_LIMITS,
            undefined,
            { targetNode: target, retries: RELAY_READ_RETRIES },
        )
        if (lim.status === Status.OK) limits = parseLimits(lim.data)
    } catch {
        /* universal limits unavailable — leave undefined */
    }

    const manifest = await readManifest(rpc, target, personality)

    return {
        protoMax: deviceInfo.protoMax,
        deviceInfo,
        personality,
        limits,
        role: personality?.role,
        ...(manifest ? { manifest } : {}),
    }
}

/** GET_MANIFEST, only where the COMMON verb mask lists it (bit N = opcode N):
 *  a dongle and older firmware do not serve it, and asking would cost a
 *  timeout. A failed read leaves it undefined, like the other discovery
 *  verbs. */
async function readManifest(
    rpc: RemapprRpc,
    target: number,
    personality: PersonalityMap | undefined,
): Promise<Manifest | undefined> {
    const common = personality?.namespaces.find((n) => n.namespace === Namespace.COMMON)
    if (!common || !(common.verbMask & (1 << CommonVerb.GET_MANIFEST))) return undefined
    try {
        const r = await rpc.callUniversalPlain(
            Namespace.COMMON,
            CommonVerb.GET_MANIFEST,
            undefined,
            target ? { targetNode: target, retries: RELAY_READ_RETRIES } : undefined,
        )
        return r.status === Status.OK ? parseManifest(r.data) : undefined
    } catch {
        return undefined // manifest unavailable — gate on the personality map alone
    }
}
