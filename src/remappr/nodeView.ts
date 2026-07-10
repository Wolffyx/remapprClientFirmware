// Pattern check: Facade (Tier 1) — extended — buildNodesApi backs the
// `service.nodes` facade (sibling of keyTest/wireless/rgb): list() maps the
// DONGLE roster to firmware-neutral NodeViews, open() assembles a relayed read
// (device-info → active config → geometry) into a READ-ONLY RemapprKeyboardService
// the existing editor renders unchanged. The dongle's RPC is shared; node views
// never seal and never tear it down.
import type { NodesApi, NodeView, KeyboardService } from '../service'
import type { DeviceInfo } from '../types'

import { loadDeviceConfig } from './configRead'
import { discover } from './discovery'
import {
    clearAllBonds,
    forgetNode,
    getLinkStats,
    listNodes,
    openPairWindow,
    setDongleNkro,
    unpairRadio,
    type LinkStats,
} from './nodes'
import type { DeviceInfo as RawDeviceInfo, NodeRecord } from './protocol'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

/** "0x0007"-style short-id, for labels and node device names. */
const hexId = (shortId: number): string =>
    `0x${shortId.toString(16).padStart(4, '0')}`

/** Map a wire node record onto the firmware-neutral UI view. */
function toNodeView(r: NodeRecord): NodeView {
    return {
        id: r.shortId,
        label: `Node ${hexId(r.shortId)}`,
        personality: r.personality,
        online: r.online,
        bonded: r.bonded,
        rssi: r.rssi,
        hopCount: r.hopCount,
        isMaster: r.master,
        nodeRole: r.nodeRole,
    }
}

/** Build the client DeviceInfo for a behind-dongle node. The node has no
 *  transport of its own, so vid/pid are 0 (it's reached through the dongle). */
function nodeDeviceInfo(shortId: number, raw: RawDeviceInfo): DeviceInfo {
    return {
        name: `Remappr Node ${hexId(shortId)}`,
        firmware: 'remappr',
        firmwareVersion: `${raw.fwMajor}.${raw.fwMinor}.${raw.fwPatch}`,
        vid: 0,
        pid: 0,
    }
}

/**
 * The `nodes` facade for a Remappr device. On a dongle, `list()` returns the
 * bonded roster and `open(id)` yields a read-only view of one node; on a
 * directly-attached keyboard the roster is empty and `open` rejects.
 */
export function buildNodesApi(rpc: RemapprRpc): NodesApi {
    return {
        async list(): Promise<NodeView[]> {
            const records = await listNodes(rpc)
            return records.map(toNodeView)
        },

        async open(id: number): Promise<KeyboardService> {
            // Relayed discovery + config read, all addressed by the node short-id
            // (§6.2 universal COMMON relay). HW-proven read path.
            const discovery = await discover(rpc, { targetNode: id })
            const loaded = await loadDeviceConfig(rpc, discovery, {
                targetNode: id,
            })

            return new RemapprKeyboardService({
                rpc,
                deviceInfo: nodeDeviceInfo(id, discovery.deviceInfo),
                config: loaded.config,
                configVersion: loaded.configVersion,
                layouts: loaded.layouts,
                activeLayoutId: loaded.activeLayoutId,
                maxLayers: loaded.maxLayers,
                limits: discovery.limits,
                // No session, no keyTest, edits throw. The view borrows the
                // dongle's RPC, so it must not close it on disconnect.
                readOnly: true,
                sharesTransport: true,
            })
        },

        openPairWindow(open = true): Promise<boolean> {
            return openPairWindow(rpc, open)
        },

        forgetNode(id: number): Promise<void> {
            return forgetNode(rpc, id)
        },

        unpairRadio(id: number): Promise<void> {
            return unpairRadio(rpc, id)
        },

        clearAllBonds(): Promise<number> {
            return clearAllBonds(rpc)
        },

        setNkro(enabled?: boolean): Promise<boolean> {
            return setDongleNkro(rpc, enabled)
        },

        getLinkStats(): Promise<LinkStats> {
            return getLinkStats(rpc)
        },
    }
}
