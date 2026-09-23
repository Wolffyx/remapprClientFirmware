// Pattern check: Adapter (Tier 1) — extended — extends src/firmware/qmk/adapter.ts FirmwareAdapter; Vial probe sends VIA 0xFE+GET_KEYBOARD_ID then loads on-device keyboard def.
import type {
    Discovery,
    FirmwareAdapter,
    Probe,
    ProbeHint,
} from '@firmware/adapter'
import { TransportError } from '@firmware/errors'
import {
    createHidClientFromTransport,
    type HidClient,
} from '@firmware/clients/qmk/hidClient'
import {
    getFirmwareVersionCmd,
    getLayerCountCmd,
    getProtocolVersionCmd,
    parseFirmwareVersion,
    parseLayerCount,
    parseProtocolVersion,
    VIA_USAGE,
    VIA_USAGE_PAGE,
} from '@firmware/clients/qmk/protocol'
import type { KeyboardService } from '@firmware/service'
import type { Transport } from '@firmware/transport'
import type { DeviceInfo } from '@firmware/types'

import { fetchAndParseKeyboardDef, type ParsedKeyboardDef } from './keyboardDef'
import {
    getKeyboardIdCmd,
    parseKeyboardId,
    SUPPORTED_VIAL_PROTOCOLS,
} from './protocol'
import { VialKeyboardService } from './service'

const PROBE_DEADLINE_MS = 1500
const DEF_FETCH_DEADLINE_MS = 5000

const VIAL_DISCOVERY: Discovery = {
    hid: { usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE },
    // Vial is a VIA superset: every Vial board also passes the VIA probe, so
    // Vial must be asked first or it is silently connected as plain VIA.
    priority: 10,
}

interface ProbedSession {
    client: HidClient
    deviceInfo: DeviceInfo
    def: ParsedKeyboardDef
    layerCount: number
    vialProtocol: number
    keyboardId: bigint
}

const probedSessions = new WeakMap<Transport, ProbedSession>()

async function readVialLayerCount(client: HidClient): Promise<number> {
    const resp = await client.send(getLayerCountCmd(), PROBE_DEADLINE_MS)
    const n = parseLayerCount(resp)
    if (n <= 0 || n > 32) {
        throw new TransportError(`Vial reported invalid layer count: ${n}`)
    }
    return n
}

async function probeVialSession(
    transport: Transport,
): Promise<ProbedSession | null> {
    const client = createHidClientFromTransport(transport)
    try {
        // VIA layer first — confirms framing works at all.
        const protoResp = await client.send(
            getProtocolVersionCmd(),
            PROBE_DEADLINE_MS,
        )
        parseProtocolVersion(protoResp)

        // Vial-specific: keyboard id payload.
        const idResp = await client.send(getKeyboardIdCmd(), PROBE_DEADLINE_MS)
        const { vialProtocol, keyboardId } = parseKeyboardId(idResp)
        if (!SUPPORTED_VIAL_PROTOCOLS.includes(vialProtocol as 0)) {
            await client.close().catch(() => undefined)
            return null
        }

        const def = await Promise.race([
            fetchAndParseKeyboardDef(client),
            new Promise<ParsedKeyboardDef>((_, reject) =>
                setTimeout(
                    () => reject(new TransportError('Vial def fetch timeout')),
                    DEF_FETCH_DEADLINE_MS,
                ),
            ),
        ])

        let firmwareVersion: number | undefined
        try {
            const fwResp = await client.send(
                getFirmwareVersionCmd(),
                PROBE_DEADLINE_MS,
            )
            firmwareVersion = parseFirmwareVersion(fwResp)
        } catch {
            /* optional */
        }

        const layerCount = await readVialLayerCount(client)

        const deviceInfo: DeviceInfo = {
            name: def.name || transport.label || 'Vial keyboard',
            firmware: 'qmk-vial',
            firmwareVersion:
                firmwareVersion !== undefined
                    ? firmwareVersion.toString()
                    : `vial-${vialProtocol}`,
            serialNumber: keyboardId.toString(16),
        }
        return { client, deviceInfo, def, layerCount, vialProtocol, keyboardId }
    } catch {
        await client.close().catch(() => undefined)
        return null
    }
}

export function createVialAdapter(): FirmwareAdapter {
    return {
        id: 'qmk-vial',
        category: {
            id: 'qmk',
            label: 'QMK',
            order: 20,
            // These boards can be looked up in an online VIA/QMK layout registry.
            layoutRegistry: true,
        },
        displayName: 'QMK (Vial)',
        discovery: VIAL_DISCOVERY,

        async canHandle(
            transport: Transport,
            hint?: ProbeHint,
        ): Promise<Probe> {
            if (hint && hint.transportKind !== 'hid') {
                return { ok: false, reason: 'qmk-vial requires HID transport' }
            }
            const cached = probedSessions.get(transport)
            if (cached) return { ok: true, deviceInfo: cached.deviceInfo }
            const session = await probeVialSession(transport)
            if (!session) return { ok: false, reason: 'not a Vial device' }
            probedSessions.set(transport, session)
            return { ok: true, deviceInfo: session.deviceInfo }
        },

        async connect(
            transport: Transport,
            signal: AbortSignal,
        ): Promise<KeyboardService> {
            let session = probedSessions.get(transport) ?? null
            if (session) probedSessions.delete(transport)
            else {
                session = await probeVialSession(transport)
                if (!session) {
                    throw new TransportError('Vial probe failed during connect')
                }
            }
            if (signal.aborted) {
                await session.client
                    .close({ abortTransport: true })
                    .catch(() => undefined)
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
            return VialKeyboardService.create({
                deviceInfo: session.deviceInfo,
                client: session.client,
                def: session.def,
                layerCount: session.layerCount,
                vialProtocol: session.vialProtocol,
                keyboardId: session.keyboardId,
            })
        },
    }
}

export const vialAdapter: FirmwareAdapter = createVialAdapter()
