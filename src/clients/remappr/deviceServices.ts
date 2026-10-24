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
import { buildDeviceConfigApi } from './deviceConfig'
import type { DiscoveryResult } from './discovery'
import { readInputLayout } from './inputLayout'
import { buildJoystickApi, servesJoystick } from './joystick'
import { buildMouseMotionApi } from './mouse'
import { Namespace } from './protocol'
import { getRateLimits, setReportRate } from './reportRate'
import type { RemapprRpc } from './rpc'
import { buildSensorApi, servesSensor } from './sensor'
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
    return new RemapprJoystickService({
        deviceInfo,
        limits: discovery.limits,
        device: hasConfigStore(discovery)
            ? buildDeviceConfigApi(rpc, {
                  personality: 'joystick',
                  targetNode,
                  name: deviceInfo.name,
                  writable: true,
              })
            : undefined,
        joystick: servesJoystick(discovery)
            ? buildJoystickApi(rpc, { targetNode, writable: true })
            : undefined,
        writable: true,
        hwCaps: discovery.personality?.hwCaps,
        layout,
        ...(targetNode ? { pollMs: RELAY_POLL_MS } : {}),
        onTransportClosed: (cb) => rpc.onClosed(cb),
        ...(site.closeTransport ? { closeTransport: site.closeTransport } : {}),
    })
}
