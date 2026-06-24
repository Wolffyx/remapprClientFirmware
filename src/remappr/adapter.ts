// Pattern check: Adapter (Tier 1) — extended — remapprAdapter implements the
// FirmwareAdapter contract (probe-cache + control-auth handshake + connect),
// sibling of keychronAdapter / mockAdapter. canHandle probes GET_DEVICE_INFO and
// caches the open RPC; connect consumes it, runs the §19 auth handshake, reads +
// decodes the active config, fetches geometry, and builds the keyboard service.
import type {
    Discovery,
    FirmwareAdapter,
    Probe,
    ProbeHint,
} from '../adapter'
import { TransportError } from '../errors'
import type { KeyboardService } from '../service'
import { readTransportIds, type Transport } from '../transport'
import type { DeviceInfo } from '../types'
import { loadOrCreateIdentity, RemapprSession } from './auth'
import { loadDeviceConfig } from './configRead'
import { discover, type DiscoveryResult } from './discovery'
import { buildNodesApi } from './nodeView'
import {
    BLE_CONTROL_CHAR_UUID,
    BLE_SERVICE_UUID,
    Cmd,
    type DeviceInfo as RawDeviceInfo,
    parseCapabilities,
    Status,
    statusName,
    USB_USAGE,
    USB_USAGE_PAGE,
    USB_VID,
} from './protocol'
import { createRemapprRpc, type RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

const PROBE_TIMEOUT_MS = 1000

const REMAPPR_DISCOVERY: Discovery = {
    hid: {
        vendorIds: [USB_VID],
        usagePage: USB_USAGE_PAGE,
        usage: USB_USAGE,
    },
    ble: {
        serviceUuid: BLE_SERVICE_UUID,
        charUuid: BLE_CONTROL_CHAR_UUID,
    },
}

interface ProbedRemappr {
    rpc: RemapprRpc
    discovery: DiscoveryResult
    deviceInfo: DeviceInfo
    capBits: number
}

const probedSessions = new WeakMap<Transport, ProbedRemappr>()

/** Map the raw 16-byte GET_DEVICE_INFO record onto the client DeviceInfo. */
function toClientDeviceInfo(
    raw: RawDeviceInfo,
    transport: Transport,
): DeviceInfo {
    const ids = readTransportIds(transport)
    return {
        name: 'Remappr Keyboard',
        firmware: 'remappr',
        firmwareVersion: `${raw.fwMajor}.${raw.fwMinor}.${raw.fwPatch}`,
        vid: ids.vid,
        pid: ids.pid,
    }
}

/** Open an RPC and negotiate the device. Returns null (releasing the stream
 *  locks) when the transport is not a Remappr node. */
async function probeRemappr(transport: Transport): Promise<ProbedRemappr | null> {
    const rpc = createRemapprRpc(transport)
    try {
        const discovery = await discover(rpc)
        let capBits = 0
        try {
            const caps = await rpc.callPlain(
                Cmd.GET_CAPABILITIES,
                undefined,
                PROBE_TIMEOUT_MS,
            )
            if (caps.status === Status.OK) capBits = parseCapabilities(caps.data)
        } catch {
            /* capabilities are optional on older firmware */
        }
        return {
            rpc,
            discovery,
            deviceInfo: toClientDeviceInfo(discovery.deviceInfo, transport),
            capBits,
        }
    } catch {
        await rpc.close({ abortTransport: true }).catch(() => undefined)
        return null
    }
}

/** Run the §19 control-auth handshake (plaintext BEGIN/FINISH) over the RPC. */
async function establishSession(rpc: RemapprRpc): Promise<RemapprSession> {
    const session = new RemapprSession(loadOrCreateIdentity())
    const begin = await rpc.callPlain(Cmd.CONTROL_AUTH_BEGIN)
    if (begin.status !== Status.OK || begin.data.length < 32) {
        throw new TransportError(`auth BEGIN failed: ${statusName(begin.status)}`)
    }
    session.derive(begin.data.subarray(0, 32))
    const finish = await rpc.callPlain(Cmd.CONTROL_AUTH_FINISH, session.hostPub)
    if (finish.status !== Status.OK) {
        throw new TransportError(`auth FINISH failed: ${statusName(finish.status)}`)
    }
    session.resetCounters()
    return session
}

export const remapprAdapter: FirmwareAdapter = {
    id: 'remappr',
    displayName: 'Remappr',
    discovery: REMAPPR_DISCOVERY,

    async canHandle(transport: Transport, hint?: ProbeHint): Promise<Probe> {
        if (hint && hint.transportKind === 'serial') {
            return { ok: false, reason: 'remappr requires HID or BLE transport' }
        }
        const cached = probedSessions.get(transport)
        if (cached) return { ok: true, deviceInfo: cached.deviceInfo }

        const probed = await probeRemappr(transport)
        if (!probed) return { ok: false, reason: 'not a Remappr device' }
        probedSessions.set(transport, probed)
        return { ok: true, deviceInfo: probed.deviceInfo }
    },

    async connect(
        transport: Transport,
        signal: AbortSignal,
    ): Promise<KeyboardService> {
        let probed = probedSessions.get(transport) ?? null
        if (probed) {
            probedSessions.delete(transport)
        } else {
            probed = await probeRemappr(transport)
            if (!probed) {
                throw new TransportError('Remappr probe failed during connect')
            }
        }
        const { rpc, discovery, deviceInfo } = probed

        if (signal.aborted) {
            await rpc.close({ abortTransport: true }).catch(() => undefined)
            throw signal.reason ?? new Error('aborted')
        }
        signal.addEventListener(
            'abort',
            () => {
                rpc.close({ abortTransport: true }).catch(() => undefined)
            },
            { once: true },
        )

        try {
            const session = await establishSession(rpc)

            const loaded = await loadDeviceConfig(rpc, discovery)

            return new RemapprKeyboardService({
                rpc,
                session,
                deviceInfo,
                config: loaded.config,
                configVersion: loaded.configVersion,
                layouts: loaded.layouts,
                activeLayoutId: loaded.activeLayoutId,
                maxLayers: loaded.maxLayers,
                limits: discovery.limits,
                // A dongle relays to bonded nodes; a direct keyboard returns an
                // empty roster. Read-only views today (relayed-write HW-pending).
                nodes: buildNodesApi(rpc),
            })
        } catch (err) {
            await rpc.close({ abortTransport: true }).catch(() => undefined)
            throw err
        }
    },
}
