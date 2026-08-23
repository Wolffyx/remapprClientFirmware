// Pattern check: Adapter (Tier 1) — extended — extends src/firmware/qmk/adapter.ts FirmwareAdapter; real VIA HID probe (id_get_protocol_version) + connect builds QmkKeyboardService.
import { readTransportIds, type Transport } from '@firmware/transport'

import type {
    Discovery,
    FirmwareAdapter,
    Probe,
    ProbeHint,
} from '@firmware/adapter'
import type { KeyboardService } from '@firmware/service'
import type { DeviceInfo } from '@firmware/types'
import { TransportError } from '@firmware/errors'

import { createHidClientFromTransport, type HidClient } from './hidClient'
import {
    getFirmwareVersionCmd,
    getProtocolVersionCmd,
    parseFirmwareVersion,
    parseProtocolVersion,
    VIA_USAGE,
    VIA_USAGE_PAGE,
} from './protocol'
import { QmkKeyboardService, readQmkLayerCount } from './service'
import { cacheKey, loadCached } from './layoutSideload'
import type { ParsedKeyboardDef } from '@firmware/kle/parser'

const PROBE_DEADLINE_MS = 750

// VIA does not expose matrix dimensions over the protocol — clients normally
// load them from the per-board keyboard.json shipped alongside VIA. Phase 3
// accepts a sensible split-keyboard default; Vial discovery (Phase 4) will
// replace this with real per-device introspection.
const DEFAULT_ROWS = 5
const DEFAULT_COLS = 14

const QMK_DISCOVERY: Discovery = {
    hid: {
        usagePage: VIA_USAGE_PAGE,
        usage: VIA_USAGE,
    },
}

interface ProbedSession {
    client: HidClient
    deviceInfo: DeviceInfo
    layerCount: number
}

const probedSessions = new WeakMap<Transport, ProbedSession>()

function resolveLayoutDefFromCache(
    deviceInfo: DeviceInfo,
): ParsedKeyboardDef | null {
    const key = cacheKey(deviceInfo)
    if (!key) return null
    return loadCached(key)
}

async function probeViaSession(
    transport: Transport,
): Promise<ProbedSession | null> {
    const client = createHidClientFromTransport(transport)
    try {
        const protoResp = await client.send(
            getProtocolVersionCmd(),
            PROBE_DEADLINE_MS,
        )
        const protocolVersion = parseProtocolVersion(protoResp)

        let firmwareVersion: number | undefined
        try {
            const fwResp = await client.send(
                getFirmwareVersionCmd(),
                PROBE_DEADLINE_MS,
            )
            firmwareVersion = parseFirmwareVersion(fwResp)
        } catch {
            // Optional — some VIA-compatible firmwares omit it.
        }

        const layerCount = await readQmkLayerCount(client)

        const ids = readTransportIds(transport)
        const deviceInfo: DeviceInfo = {
            name: transport.label || 'QMK keyboard',
            firmware: 'qmk-via',
            firmwareVersion:
                firmwareVersion !== undefined
                    ? firmwareVersion.toString()
                    : `via-${protocolVersion}`,
            vid: ids.vid,
            pid: ids.pid,
        }

        return { client, deviceInfo, layerCount }
    } catch (err) {
        await client.close().catch(() => undefined)
        if (err instanceof TransportError) return null
        return null
    }
}

export interface QmkAdapterOptions {
    rows?: number
    cols?: number
}

export function createQmkAdapter(
    opts: QmkAdapterOptions = {},
): FirmwareAdapter {
    const rows = opts.rows ?? DEFAULT_ROWS
    const cols = opts.cols ?? DEFAULT_COLS

    return {
        id: 'qmk-via',
        category: {
            id: 'qmk',
            label: 'QMK',
            order: 20,
            // These boards can be looked up in an online VIA/QMK layout registry.
            layoutRegistry: true,
        },
        displayName: 'QMK (VIA)',
        discovery: QMK_DISCOVERY,

        async canHandle(
            transport: Transport,
            hint?: ProbeHint,
        ): Promise<Probe> {
            // VIA only speaks HID. Skip serial/BLE byte streams so we do not
            // pollute another adapter's transport with a 32-byte VIA frame.
            if (hint && hint.transportKind !== 'hid') {
                return { ok: false, reason: 'qmk-via requires HID transport' }
            }
            const cached = probedSessions.get(transport)
            if (cached) return { ok: true, deviceInfo: cached.deviceInfo }

            const session = await probeViaSession(transport)
            if (!session) {
                return { ok: false, reason: 'not a VIA HID device' }
            }
            probedSessions.set(transport, session)
            return { ok: true, deviceInfo: session.deviceInfo }
        },

        async connect(
            transport: Transport,
            signal: AbortSignal,
        ): Promise<KeyboardService> {
            let session = probedSessions.get(transport) ?? null
            if (session) {
                probedSessions.delete(transport)
            } else {
                session = await probeViaSession(transport)
                if (!session) {
                    throw new TransportError(
                        'QMK/VIA probe failed during connect',
                    )
                }
            }

            if (signal.aborted) {
                await session.client.close().catch(() => undefined)
                throw signal.reason ?? new Error('aborted')
            }
            signal.addEventListener(
                'abort',
                () => {
                    session!.client
                        .close({ abortTransport: true })
                        .catch(() => undefined)
                },
                { once: true },
            )

            const def = resolveLayoutDefFromCache(session.deviceInfo)
            return QmkKeyboardService.create({
                deviceInfo: session.deviceInfo,
                client: session.client,
                rows,
                cols,
                layerCount: session.layerCount,
                def: def ?? undefined,
            })
        },
    }
}

export const qmkAdapter: FirmwareAdapter = createQmkAdapter()

export { DEFAULT_ROWS as QMK_DEFAULT_ROWS, DEFAULT_COLS as QMK_DEFAULT_COLS }
