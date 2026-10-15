// Pattern check: Facade (Tier 1) — extended — buildNodesApi backs the
// `service.nodes` facade (sibling of keyTest/wireless/rgb): list() maps the
// DONGLE roster to firmware-neutral NodeViews, open() assembles a relayed read
// (device-info → active config → geometry) into a READ-ONLY RemapprKeyboardService
// the existing editor renders unchanged. The dongle's RPC is shared; node views
// never seal and never tear it down.
import type { NodesApi, NodeView, KeyboardService } from '../../service'
import type { DeviceKind } from '../../devices/types'
import type { DeviceInfo } from '../../types'
import { Personality } from '../../config/compilers/remappr/blobWriter'

import { loadDeviceConfig } from './configRead'
import { buildDeviceConfigApi } from './deviceConfig'
import { deviceKind } from './deviceKind'
import { discover, type DiscoveryResult } from './discovery'
import { buildMouseMotionApi } from './mouse'
import { buildJoystickApi, servesJoystick } from './joystick'
import { readInputLayout } from './inputLayout'
import {
    clearAllBonds,
    forgetNode,
    getLinkStats,
    getPipeTable,
    listNodes,
    openPairWindow,
    setDongleNkro,
    unpairRadio,
    type LinkStats,
    type PipeTable,
} from './nodes'
import type { DeviceInfo as RawDeviceInfo, NodeRecord } from './protocol'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'
import { RemapprMouseService } from './mouseService'
import { RemapprJoystickService } from './joystickService'

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

// pattern-check: skip — one more read-only view variant beside open()'s keyboard one
/** A read-only view of a mouse behind the dongle: its settings, motion state
 *  and layout read through the relay; saving and live changes need the mouse on
 *  USB. */
async function openMouseView(
    rpc: RemapprRpc,
    id: number,
    discovery: DiscoveryResult,
): Promise<KeyboardService> {
    const deviceInfo = nodeDeviceInfo(id, discovery.deviceInfo, KIND_NAME.mouse)
    const layout = await readInputLayout(
        rpc,
        discovery.personality?.namespaces,
        id,
    )
    return new RemapprMouseService({
        deviceInfo,
        limits: discovery.limits,
        device: buildDeviceConfigApi(rpc, {
            personality: 'mouse',
            targetNode: id,
            name: deviceInfo.name,
            writable: false,
        }),
        motion: buildMouseMotionApi(rpc, { targetNode: id, writable: false }),
        writable: false,
        hwCaps: discovery.personality?.hwCaps,
        layout,
        // The dongle's RPC: closing the view must not close it.
        onTransportClosed: (cb) => rpc.onClosed(cb),
    })
}

/** Live readout period through the relay: each read is a radio round trip. */
const RELAY_POLL_MS = 250

// pattern-check: skip — the joystick twin of openMouseView
/** A read-only view of a joystick behind the dongle: its settings, live state
 *  and layout read through the relay; saving and calibration need it on USB. */
async function openJoystickView(
    rpc: RemapprRpc,
    id: number,
    discovery: DiscoveryResult,
): Promise<KeyboardService> {
    const deviceInfo = nodeDeviceInfo(
        id,
        discovery.deviceInfo,
        KIND_NAME.joystick,
    )
    const layout = await readInputLayout(
        rpc,
        discovery.personality?.namespaces,
        id,
    )
    return new RemapprJoystickService({
        deviceInfo,
        limits: discovery.limits,
        device: buildDeviceConfigApi(rpc, {
            personality: 'joystick',
            targetNode: id,
            name: deviceInfo.name,
            writable: false,
        }),
        joystick: servesJoystick(discovery)
            ? buildJoystickApi(rpc, { targetNode: id, writable: false })
            : undefined,
        writable: false,
        layout,
        pollMs: RELAY_POLL_MS,
        // The dongle's RPC: closing the view must not close it.
        onTransportClosed: (cb) => rpc.onClosed(cb),
    })
}

type NodeViewOpener = (
    rpc: RemapprRpc,
    id: number,
    discovery: DiscoveryResult,
) => Promise<KeyboardService>

/** Node kinds with their own view; any other node opens as a keymap. */
const VIEW_BY_KIND: Readonly<Partial<Record<DeviceKind, NodeViewOpener>>> = {
    mouse: openMouseView,
    joystick: openJoystickView,
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

        getPipeTable(): Promise<PipeTable> {
            return getPipeTable(rpc)
        },
    }
}
