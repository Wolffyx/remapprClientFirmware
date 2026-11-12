// pattern-check: skip — the mouse and joystick service construction, moved out
// of adapter.ts so a node behind the dongle is built the same way as the device
// on its own transport; plain construction, no new abstraction.
//
// A mouse or a joystick has no §19 session and no keymap: it is edited through
// its settings document (COMMON config verbs) and its live verbs (MOUSE /
// SENSOR / JOYSTICK, report rate). The same service serves the device on its
// own transport and a node behind the dongle; only the site differs — which
// RPC it borrows or owns, and the short-id every call is addressed to.
import type { DeviceInfo } from '../../types'
import { type AxesLayout, axesLayout } from './axesLayout'
import { buildDeviceConfigApi } from './deviceConfig'
import type { DiscoveryResult } from './discovery'
import { readInputLayout } from './inputLayout'
import { buildJoystickApi, servesJoystick } from './joystick'
import { buildMouseMotionApi } from './mouse'
import { Namespace } from './protocol'
import { getRateLimits, setReportRate } from './reportRate'
import type { RemapprRpc } from './rpc'
import type { SensorApi } from '../../service'
import {
    buildSensorApi,
    listSensors,
    type SensorWire,
    servesSensor,
} from './sensor'
import { buildHostValuesApi, servesHost } from './hostValues'
import { buildScreensApi } from './screens'
import { RemapprMouseService } from './mouseService'
import { RemapprJoystickService } from './joystickService'

/** Where a device service talks. */
export interface DeviceSite {
    rpc: RemapprRpc
    discovery: DiscoveryResult
    deviceInfo: DeviceInfo
    /** 0 = the device on this transport; else a node's short-id behind the
     *  dongle, whose RPC the service borrows. */
    targetNode: number
    /** Close an owned transport; absent when the RPC is the dongle's. */
    closeTransport?: () => Promise<void>
}

/** Live readout period through the relay: each read is a radio round trip. */
const RELAY_POLL_MS = 250

/** The device has a config store (GET_LIMITS max_config_bytes > 0). A dongle on
 *  firmware from before the device config has none. */
export function hasConfigStore(discovery: DiscoveryResult): boolean {
    return (discovery.limits?.maxConfigBytes ?? 0) > 0
}

/** True unless the device lists its namespaces and MOUSE is not among them
 *  (firmware that predates the list serves it unconditionally). */
export function servesMouse(discovery: DiscoveryResult): boolean {
    const ns = discovery.personality?.namespaces
    return !ns?.length || ns.some((n) => n.namespace === Namespace.MOUSE)
}

/** A mouse, edited in the device editor and drawn from its own layout when it
 *  reports one. */
export async function buildMouseService(
    site: DeviceSite,
): Promise<RemapprMouseService> {
    const { rpc, discovery, deviceInfo, targetNode } = site
    const layout = await readInputLayout(
        rpc,
        discovery.personality?.namespaces,
        targetNode,
    )
    const sensor = servesSensor(discovery)
        ? buildSensorApi(rpc, { targetNode, writable: true })
        : undefined
    return new RemapprMouseService({
        deviceInfo,
        limits: discovery.limits,
        device: hasConfigStore(discovery)
            ? buildDeviceConfigApi(rpc, {
                  personality: 'mouse',
                  targetNode,
                  name: deviceInfo.name,
                  writable: true,
                  ...(sensor ? { sensors: () => sensor.getSensors() } : {}),
              })
            : undefined,
        motion: servesMouse(discovery)
            ? buildMouseMotionApi(rpc, { targetNode, writable: true })
            : undefined,
        sensor,
        ...(servesHost(discovery)
            ? {
                  hostValues: buildHostValuesApi(rpc, { targetNode }),
                  screens: buildScreensApi(sensor),
              }
            : {}),
        rate: {
            get: () => getRateLimits(rpc, targetNode),
            set: (hz) => setReportRate(rpc, hz, targetNode),
        },
        writable: true,
        hwCaps: discovery.personality?.hwCaps,
        layout,
        onTransportClosed: (cb) => rpc.onClosed(cb),
        ...(site.closeTransport ? { closeTransport: site.closeTransport } : {}),
    })
}

/** Where the device keeps its analog inputs, read once from its part list
 *  (GET_PARTS; a failed read is asked again next time). Undefined for
 *  firmware without channels (PART ns_version 0) or without AXES parts. */
function axesOf(
    rpc: RemapprRpc,
    targetNode: number,
): () => Promise<AxesLayout | undefined> {
    let pending: Promise<AxesLayout | undefined> | null = null
    const read = async (): Promise<AxesLayout | undefined> => {
        const wire: SensorWire = {}
        const parts = await listSensors(rpc, targetNode, wire)
        return (wire.nsVersion ?? 0) >= 1 ? axesLayout(parts) : undefined
    }
    return () => {
        pending ??= read().catch((e: unknown) => {
            pending = null
            throw e
        })
        return pending
    }
}

/** The settings the AXES parts list, read once (with every part's
 *  description); undefined without AXES parts. */
function settingsOf(
    sensor: SensorApi,
    axes: () => Promise<AxesLayout | undefined>,
): () => Promise<ReadonlySet<string> | undefined> {
    let pending: Promise<ReadonlySet<string> | undefined> | null = null
    const read = async (): Promise<ReadonlySet<string> | undefined> => {
        const layout = await axes()
        if (!layout) return undefined
        const ours = new Set(layout.parts.map((p) => p.part))
        const parts = await sensor.getSensors()
        return new Set(
            parts
                .filter((p) => ours.has(p.index))
                .flatMap((p) => p.settings.map((s) => s.name)),
        )
    }
    return () => {
        pending ??= read().catch((e: unknown) => {
            pending = null
            throw e
        })
        return pending
    }
}

/** A joystick, edited in the device editor and drawn from its own layout,
 *  with live calibration. */
export async function buildJoystickService(
    site: DeviceSite,
): Promise<RemapprJoystickService> {
    const { rpc, discovery, deviceInfo, targetNode } = site
    const layout = await readInputLayout(
        rpc,
        discovery.personality?.namespaces,
        targetNode,
    )
    const sensor = servesSensor(discovery)
        ? buildSensorApi(rpc, { targetNode, writable: true })
        : undefined
    const axes = sensor ? axesOf(rpc, targetNode) : undefined
    const axesSettings =
        sensor && axes ? settingsOf(sensor, axes) : undefined
    return new RemapprJoystickService({
        deviceInfo,
        limits: discovery.limits,
        device: hasConfigStore(discovery)
            ? buildDeviceConfigApi(rpc, {
                  personality: 'joystick',
                  targetNode,
                  name: deviceInfo.name,
                  writable: true,
                  ...(axes ? { axes } : {}),
              })
            : undefined,
        joystick: servesJoystick(discovery)
            ? buildJoystickApi(rpc, {
                  targetNode,
                  writable: true,
                  ...(sensor && axes ? { axes: { layout: axes, sensor } } : {}),
              })
            : undefined,
        ...(axesSettings ? { axesSettings } : {}),
        ...(servesHost(discovery)
            ? {
                  hostValues: buildHostValuesApi(rpc, { targetNode }),
                  screens: buildScreensApi(sensor),
              }
            : {}),
        writable: true,
        hwCaps: discovery.personality?.hwCaps,
        layout,
        ...(targetNode ? { pollMs: RELAY_POLL_MS } : {}),
        onTransportClosed: (cb) => rpc.onClosed(cb),
        ...(site.closeTransport ? { closeTransport: site.closeTransport } : {}),
    })
}
