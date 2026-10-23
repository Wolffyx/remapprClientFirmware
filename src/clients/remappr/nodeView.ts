// Pattern check: Facade (Tier 1) — extended — buildNodesApi backs the
// `service.nodes` facade (sibling of keyTest/wireless/rgb): list() maps the
// DONGLE roster to firmware-neutral NodeViews; open() gives a mouse or a
// joystick the same service it has on its own transport, every call relayed
// to its short-id (they hold no §19 session, so their changes go plaintext),
// and a keyboard a READ-ONLY RemapprKeyboardService (its changes need the
// sealed relay session, not proven on hardware yet). The dongle's RPC is
// shared; node views never tear it down.
import type { NodesApi, NodeView, KeyboardService } from '../../service'
import type { DeviceKind } from '../../devices/types'
import type { DeviceInfo } from '../../types'
import { Personality } from '../../config/compilers/remappr/blobWriter'

import { loadDeviceConfig } from './configRead'
import { deviceKind } from './deviceKind'
import {
    buildJoystickService,
    buildMouseService,
    type DeviceSite,
} from './deviceServices'
import { discover, type DiscoveryResult } from './discovery'
import {
    changeChannels,
    clearAllBonds,
    forgetNode,
    getLinkStats,
    getPipeTable,
    listNodes,
    openPairWindow,
    setDongleNkro,
    unpairRadio,
    type ChannelChange,
    type LinkStats,
    type PipeTable,
} from './nodes'
import type { DeviceInfo as RawDeviceInfo, NodeRecord } from './protocol'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

/** "0x0007"-style short-id, for labels and node device names. */
const hexId = (shortId: number): string =>
    `0x${shortId.toString(16).padStart(4, '0')}`

/** The roster's byte is the node's personality (role.h), as RUCP §5.9 says.
 *  Only node personalities name a kind: a dongle (4) or a recovery image (3)
 *  is never a node, and a config tool reads 0. Dongles before the joystick
 *  radio leg wrote the radio device type here, which agrees for keyboard (1)
 *  and mouse (2), the only nodes they could pair. */
const KIND_BY_NODE_PERSONALITY: Readonly<Partial<Record<number, DeviceKind>>> = {
    [Personality.keyboard]: 'keyboard',
    [Personality.mouse]: 'mouse',
    [Personality.joystick]: 'joystick',
}

/** The word a node goes by in the roster and in its device name; a node of no
 *  known kind is a "Node". */
const KIND_NAME: Readonly<Record<DeviceKind, string>> = {
    keyboard: 'Keyboard',
    mouse: 'Mouse',
    joystick: 'Joystick',
    dongle: 'Dongle',
}

/** Map a wire node record onto the firmware-neutral UI view. */
function toNodeView(r: NodeRecord): NodeView {
    const kind = KIND_BY_NODE_PERSONALITY[r.personality]
    return {
        id: r.shortId,
        label: `${kind ? KIND_NAME[kind] : 'Node'} ${hexId(r.shortId)}`,
        personality: r.personality,
        ...(kind ? { kind } : {}),
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
function nodeDeviceInfo(
    shortId: number,
    raw: RawDeviceInfo,
    what = 'Node',
): DeviceInfo {
    return {
        name: `Remappr ${what} ${hexId(shortId)}`,
        firmware: 'remappr',
        firmwareVersion: `${raw.fwMajor}.${raw.fwMinor}.${raw.fwPatch}`,
        vid: 0,
        pid: 0,
    }
}

/** A mouse or joystick behind the dongle: the same service as on its own
 *  transport, every call addressed to the node's short-id. It borrows the
 *  dongle's RPC, so it never closes it. */
function nodeSite(
    rpc: RemapprRpc,
    id: number,
    discovery: DiscoveryResult,
): DeviceSite {
    const kind = KIND_NAME[deviceKind(discovery)]
    return {
        rpc,
        discovery,
        deviceInfo: nodeDeviceInfo(id, discovery.deviceInfo, kind),
        targetNode: id,
    }
}

type NodeViewOpener = (
    rpc: RemapprRpc,
    id: number,
    discovery: DiscoveryResult,
) => Promise<KeyboardService>

/** Node kinds with their own view; any other node opens as a keymap. */
const VIEW_BY_KIND: Readonly<Partial<Record<DeviceKind, NodeViewOpener>>> = {
    mouse: (rpc, id, discovery) => buildMouseService(nodeSite(rpc, id, discovery)),
    joystick: (rpc, id, discovery) =>
        buildJoystickService(nodeSite(rpc, id, discovery)),
}

/**
 * The `nodes` facade for a Remappr device. On a dongle, `list()` returns the
 * bonded roster and `open(id)` yields a view of one node; on a
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
            const openView = VIEW_BY_KIND[deviceKind(discovery)]
            if (openView) return openView(rpc, id, discovery)
            const loaded = await loadDeviceConfig(rpc, discovery, {
                targetNode: id,
            })
            // Unknown kinds open as a keymap too; only a node that says it is a
            // keyboard is named one.
            const what =
                discovery.personality?.personality === Personality.keyboard
                    ? KIND_NAME.keyboard
                    : undefined

            return new RemapprKeyboardService({
                rpc,
                deviceInfo: nodeDeviceInfo(id, discovery.deviceInfo, what),
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

        changeChannels(channels?: number[]): Promise<ChannelChange> {
            return changeChannels(
                rpc,
                channels ? { kind: 'list', channels } : { kind: 'bad' },
            )
        },

        getPipeTable(): Promise<PipeTable> {
            return getPipeTable(rpc)
        },
    }
}
