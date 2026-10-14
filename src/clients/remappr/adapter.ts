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
} from '../../adapter'
import { TransportError } from '../../errors'
import type { KeyboardService } from '../../service'
import { readTransportIds, type Transport } from '../../transport'
import type { DeviceKind } from '../../devices/types'
import type { DeviceInfo } from '../../types'
import { loadOrCreateIdentity, RemapprSession } from './auth'
import { loadDeviceConfig, makeKeylessConfig } from './configRead'
import { buildDeviceConfigApi } from './deviceConfig'
import { deviceKind } from './deviceKind'
import { discover, type DiscoveryResult } from './discovery'
import { buildMouseMotionApi } from './mouse'
import { readInputLayout } from './inputLayout'
import { warmRemapprIdentity } from './identity'
import { buildClusterApi } from './clusterView'
import { buildNodesApi } from './nodeView'
import { buildUnicodeApi } from './unicodeView'
import {
    BLE_CONTROL_CHAR_UUID,
    BLE_SERVICE_UUID,
    Cap,
    Cmd,
    type DeviceInfo as RawDeviceInfo,
    DongleVerb,
    Namespace,
    parseCapabilities,
    Role,
    Status,
    statusName,
    USB_USAGE,
    USB_USAGE_PAGE,
    USB_VID,
} from './protocol'
import { createRemapprRpc, type RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'
import { RemapprMouseService } from './mouseService'
import { getRateLimits, setReportRate } from './reportRate'

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
    // This app's primary firmware: it must win the single-filter Electron HID
    // path (VID 0x1209 / usage page 0xFF00) regardless of chunk load order.
    priority: 100,
}

interface ProbedRemappr {
    rpc: RemapprRpc
    discovery: DiscoveryResult
    deviceInfo: DeviceInfo
    /** GET_CAPABILITIES bitmask, or null when the firmware predates the verb
     *  (capability unknown — assume features like auth are present). */
    capBits: number | null
    /** What the device is (see deviceKind): a dongle hub, a mouse (no keymap,
     *  a device document config and live motion controls) or a keyboard. */
    kind: DeviceKind
}

const probedSessions = new WeakMap<Transport, ProbedRemappr>()

const DEVICE_NAMES: Readonly<Record<DeviceKind, string>> = {
    keyboard: 'Remappr Keyboard',
    dongle: 'Remappr Dongle',
    mouse: 'Remappr Mouse',
    joystick: 'Remappr Joystick',
}

/** Map the raw 16-byte GET_DEVICE_INFO record onto the client DeviceInfo. */
function toClientDeviceInfo(
    raw: RawDeviceInfo,
    transport: Transport,
    kind: DeviceKind,
): DeviceInfo {
    const ids = readTransportIds(transport)
    return {
        name: DEVICE_NAMES[kind],
        firmware: 'remappr',
        firmwareVersion: `${raw.fwMajor}.${raw.fwMinor}.${raw.fwPatch}`,
        vid: ids.vid,
        pid: ids.pid,
    }
}

/** Detect a dongle that does NOT self-identify via COMMON discovery (older
 *  firmware serves only the DONGLE namespace). A LIST_NODES probe that answers OK
 *  marks it a dongle; synthesize a minimal discovery result with role = DONGLE.
 *  Throws when the device is not a dongle (the caller then reports "not Remappr").*/
async function probeDongleFallback(rpc: RemapprRpc): Promise<DiscoveryResult> {
    const r = await rpc.callUniversalPlain(Namespace.DONGLE, DongleVerb.LIST_NODES)
    if (r.status !== Status.OK) {
        throw new TransportError('not a Remappr dongle (LIST_NODES refused)')
    }
    return {
        protoMax: 2,
        role: Role.DONGLE,
        deviceInfo: {
            protoMin: 1,
            protoMax: 2,
            schemaVersion: 0,
            fwMajor: 0,
            fwMinor: 0,
            fwPatch: 0,
            hwRev: 0,
            hasActive: false,
            configVersion: 0,
        },
    }
}

/** The device has a config store (GET_LIMITS max_config_bytes > 0). A dongle on
 *  firmware from before the device config has none. */
function hasConfigStore(discovery: DiscoveryResult): boolean {
    return (discovery.limits?.maxConfigBytes ?? 0) > 0
}

// pattern-check: skip — builds the two keyless service variants this adapter
// constructs; plain construction, no new abstraction.
/** The dongle's own service: its node roster and its settings. No §19 session;
 *  it owns its transport and rejects keymap edits. */
function buildDongleService(
    rpc: RemapprRpc,
    probed: ProbedRemappr,
): RemapprKeyboardService {
    const { discovery, deviceInfo } = probed
    const device = hasConfigStore(discovery)
        ? buildDeviceConfigApi(rpc, {
              personality: 'dongle',
              name: deviceInfo.name,
              writable: true,
          })
        : undefined
    return new RemapprKeyboardService({
        rpc,
        deviceInfo,
        config: makeKeylessConfig(deviceInfo.name),
        configVersion: discovery.deviceInfo.configVersion,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 0,
        limits: discovery.limits,
        readOnly: true,
        kind: 'dongle',
        device,
        nodes: buildNodesApi(rpc),
    })
}

/** True unless the device lists its namespaces and MOUSE is not among them
 *  (firmware that predates the list serves it unconditionally). */
export function servesMouse(discovery: DiscoveryResult): boolean {
    const ns = discovery.personality?.namespaces
    return !ns?.length || ns.some((n) => n.namespace === Namespace.MOUSE)
}

/** A mouse on its own transport: edited in the device editor, drawn from its
 *  own layout when it reports one. */
async function buildMouseService(
    rpc: RemapprRpc,
    probed: ProbedRemappr,
): Promise<RemapprMouseService> {
    const { discovery, deviceInfo } = probed
    const layout = await readInputLayout(rpc, discovery.personality?.namespaces)
    return new RemapprMouseService({
        deviceInfo,
        limits: discovery.limits,
        device: hasConfigStore(discovery)
            ? buildDeviceConfigApi(rpc, {
                  personality: 'mouse',
                  name: deviceInfo.name,
                  writable: true,
              })
            : undefined,
        motion: servesMouse(discovery)
            ? buildMouseMotionApi(rpc, { writable: true })
            : undefined,
        rate: {
            get: () => getRateLimits(rpc),
            set: (hz) => setReportRate(rpc, hz),
        },
        writable: true,
        hwCaps: discovery.personality?.hwCaps,
        layout,
        onTransportClosed: (cb) => rpc.onClosed(cb),
        closeTransport: () =>
            rpc.close({ abortTransport: true }).catch(() => undefined),
    })
}

/** Open an RPC and negotiate the device. Returns null (releasing the stream
 *  locks) when the transport is not a Remappr node. */
async function probeRemappr(transport: Transport): Promise<ProbedRemappr | null> {
    const rpc = createRemapprRpc(transport)
    try {
        let discovery: DiscoveryResult
        try {
            discovery = await discover(rpc)
        } catch {
            // Not a self-identifying device. It may still be a dongle running
            // older firmware that serves only the DONGLE namespace — last resort,
            // probe LIST_NODES (throws here when it is not a dongle either).
            discovery = await probeDongleFallback(rpc)
        }
        const kind = deviceKind(discovery)

        // GET_CAPABILITIES is a keyboard verb on the legacy path; a dongle drops
        // it (and would cost a probe-timeout), and a mouse has no use for it.
        let capBits: number | null = null
        if (kind === 'keyboard') {
            try {
                const caps = await rpc.callPlain(
                    Cmd.GET_CAPABILITIES,
                    undefined,
                    PROBE_TIMEOUT_MS,
                )
                if (caps.status === Status.OK)
                    capBits = parseCapabilities(caps.data)
            } catch {
                /* capabilities are optional on older firmware */
            }
        }
        return {
            rpc,
            discovery,
            deviceInfo: toClientDeviceInfo(
                discovery.deviceInfo,
                transport,
                kind,
            ),
            capBits,
            kind,
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
    category: { id: 'remappr', label: 'Remappr', order: 30 },

    // Warm the persisted §19 host identity before the first handshake — a
    // regenerated identity is rejected by an already-bonded node (ERR_AUTH).
    prepare: warmRemapprIdentity,

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
        const { rpc, discovery, deviceInfo, kind, capBits } = probed

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
            // A dongle or a mouse has no auth session and no keymap (§7.2): skip
            // the §19 handshake and keymap load. The dongle surfaces its node
            // roster, the mouse its motion controls, both their own settings.
            if (kind === 'dongle') return buildDongleService(rpc, probed)
            if (kind === 'mouse') return await buildMouseService(rpc, probed)

            // §19 is capability-gated: a dev/no-auth firmware (CAP_AUTH clear)
            // takes plaintext writes, so skip the handshake entirely there. A
            // null capBits means the firmware predates GET_CAPABILITIES —
            // assume auth is present (the pre-capability behavior).
            const session =
                capBits === null || (capBits & Cap.AUTH) !== 0
                    ? await establishSession(rpc)
                    : undefined

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
                // Cluster diagnostics only when the firmware wired a source and
                // advertised it (Cap.CLUSTER_DIAG). A null capBits means a
                // pre-capability firmware with no cluster diagnostics → omit.
                cluster:
                    capBits !== null && (capBits & Cap.CLUSTER_DIAG) !== 0
                        ? buildClusterApi(rpc)
                        : undefined,
                // §5.2-E: only where the firmware wired unicode ops and said so
                // (Cap.UNICODE). The verbs answer ERR_CMD otherwise, and a null
                // capBits is a firmware that predates them entirely → omit.
                unicode:
                    capBits !== null && (capBits & Cap.UNICODE) !== 0
                        ? buildUnicodeApi(rpc)
                        : undefined,
            })
        } catch (err) {
            await rpc.close({ abortTransport: true }).catch(() => undefined)
            throw err
        }
    },
}
