// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; concrete ZMK adapter with BLE discovery + canHandle probe + connect.
import {
    call_rpc,
    create_rpc_connection,
    RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client'
import type { Transport } from '@firmware/transport'

import type {
    Discovery,
    FirmwareAdapter,
    Probe,
    ProbeHint,
} from '@firmware/adapter'
import type { KeyboardService } from '@firmware/service'
import type { DeviceInfo } from '@firmware/types'

import { ZMK_CHAR_UUID, ZMK_SERVICE_UUID } from './ble/constants'
import { ZmkKeyboardService } from './service'

const PROBE_DEADLINE_MS = 750

const ZMK_DISCOVERY: Discovery = {
    ble: {
        serviceUuid: ZMK_SERVICE_UUID,
        charUuid: ZMK_CHAR_UUID,
    },
    serial: {},
}

interface ZmkDeviceInfoPayload {
    name: string
    serialNumber?: Uint8Array
}

interface ProbedSession {
    connection: RpcConnection
    deviceInfo: DeviceInfo
}

// Transport ReadableStream/WritableStream are locked by create_rpc_connection's
// pipeThrough/pipeTo. They cannot be re-piped. So when canHandle succeeds we
// must keep the same RpcConnection alive and hand it to connect — otherwise the
// second create_rpc_connection throws "Cannot pipe a locked stream".
const probedSessions = new WeakMap<Transport, ProbedSession>()

function decodeSerial(serial?: Uint8Array): string | undefined {
    if (!serial || serial.length === 0) return undefined
    return Array.from(serial)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

function buildDeviceInfo(payload: ZmkDeviceInfoPayload): DeviceInfo {
    return {
        name: payload.name,
        firmware: 'zmk',
        serialNumber: decodeSerial(payload.serialNumber),
    }
}

async function probeDeviceInfo(
    connection: RpcConnection,
    deadlineMs: number,
): Promise<ZmkDeviceInfoPayload | undefined> {
    return await Promise.race([
        call_rpc(connection, { core: { getDeviceInfo: true } })
            .then(
                (r) =>
                    r?.core?.getDeviceInfo as ZmkDeviceInfoPayload | undefined,
            )
            .catch(() => undefined),
        new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), deadlineMs),
        ),
    ])
}

export const zmkAdapter: FirmwareAdapter = {
    id: 'zmk',
    category: { id: 'zmk', label: 'ZMK', order: 10 },
    displayName: 'ZMK',
    discovery: ZMK_DISCOVERY,

    async canHandle(transport: Transport, hint?: ProbeHint): Promise<Probe> {
        // ZMK speaks proto-RPC over serial/BLE byte streams. Skip HID so we
        // do not lock another adapter's HID streams with create_rpc_connection.
        if (hint && hint.transportKind === 'hid') {
            return { ok: false, reason: 'zmk does not use HID transport' }
        }
        const cached = probedSessions.get(transport)
        if (cached) return { ok: true, deviceInfo: cached.deviceInfo }

        const connection = create_rpc_connection(transport)
        const payload = await probeDeviceInfo(connection, PROBE_DEADLINE_MS)
        if (!payload) {
            transport.abortController.abort()
            return { ok: false, reason: 'no response within deadline' }
        }
        const deviceInfo = buildDeviceInfo(payload)
        probedSessions.set(transport, { connection, deviceInfo })
        return { ok: true, deviceInfo }
    },

    async connect(
        transport: Transport,
        signal: AbortSignal,
    ): Promise<KeyboardService> {
        const cached = probedSessions.get(transport)
        if (cached) {
            probedSessions.delete(transport)
            if (signal.aborted) {
                transport.abortController.abort(signal.reason)
                throw signal.reason ?? new Error('aborted')
            }
            signal.addEventListener(
                'abort',
                () => transport.abortController.abort(signal.reason),
                { once: true },
            )
            return new ZmkKeyboardService(cached.connection, cached.deviceInfo)
        }

        const connection = create_rpc_connection(transport, { signal })
        const payload = await probeDeviceInfo(connection, PROBE_DEADLINE_MS)
        if (!payload) {
            throw new Error('Failed to fetch device info from ZMK device')
        }
        return new ZmkKeyboardService(connection, buildDeviceInfo(payload))
    },
}
