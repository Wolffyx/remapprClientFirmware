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
import { readTransportIds, type Transport } from '@firmware/transport'
import type { DeviceInfo } from '@firmware/types'

import { fetchAndParseKeyboardDef, type ParsedKeyboardDef } from './keyboardDef'
import {
    getKeyboardIdCmd,
    parseKeyboardId,
    SUPPORTED_VIAL_PROTOCOLS,
} from './protocol'
import { VialKeyboardService } from './service'
import {
    QMK_DEFAULT_COLS,
    QMK_DEFAULT_ROWS,
} from '@firmware/clients/qmk/adapter'
import { cacheKey, loadCached } from '@firmware/clients/qmk/layoutSideload'
import { QmkKeyboardService } from '@firmware/clients/qmk/service'

const PROBE_DEADLINE_MS = 1500

const VIAL_DISCOVERY: Discovery = {
    hid: { usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE },
    // Vial is a VIA superset: every Vial board also passes the VIA probe, so
    // Vial must be asked first or it is silently connected as plain VIA.
    priority: 10,
}

/** What canHandle learns: enough to say "this is a Vial board", nothing more. */
interface IdentifiedVial {
    client: HidClient
    vialProtocol: number
    keyboardId: bigint
}

/** Everything connect() needs to build the service. */
interface LoadedVial extends IdentifiedVial {
    deviceInfo: DeviceInfo
    def: ParsedKeyboardDef
    layerCount: number
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

const identified = new WeakMap<Transport, IdentifiedVial>()

async function readVialLayerCount(client: HidClient): Promise<number> {
    const resp = await client.send(getLayerCountCmd(), PROBE_DEADLINE_MS)
    const n = parseLayerCount(resp)
    if (n <= 0 || n > 32) {
        throw new TransportError(`Vial reported invalid layer count: ${n}`)
    }
    return n
}

/**
 * Identification only: VIA protocol version + Vial keyboard id. Returns null
 * when the device is not a (supported) Vial board. Loading the definition is
 * connect()'s job, so a slow or broken definition can no longer masquerade as
 * "not a Vial device" and hand the board to the VIA client.
 */
async function identifyVial(
    transport: Transport,
): Promise<IdentifiedVial | null> {
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
        return { client, vialProtocol, keyboardId }
    } catch (err) {
        console.warn('[qmk-vial] identify failed, not treating as Vial', err)
        await client.close().catch(() => undefined)
        return null
    }
}

/** Definition + layer count over an identified session. Throws on failure —
 *  the caller decides how to recover; it is never a silent downgrade. */
async function loadVial(
    transport: Transport,
    id: IdentifiedVial,
): Promise<LoadedVial> {
    const { client, vialProtocol, keyboardId } = id
    // Each definition block has its own frame timeout (rawHidClient), so a
    // large definition is not cut off by one deadline over the whole transfer.
    const def = await fetchAndParseKeyboardDef(client)

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
    const ids = readTransportIds(transport)

    const deviceInfo: DeviceInfo = {
        name: def.name || transport.label || 'Vial keyboard',
        firmware: 'qmk-vial',
        firmwareVersion:
            firmwareVersion !== undefined
                ? firmwareVersion.toString()
                : `vial-${vialProtocol}`,
        serialNumber: keyboardId.toString(16),
        vid: ids.vid,
        pid: ids.pid,
    }
    return { ...id, deviceInfo, def, layerCount }
}

/**
 * The board identified as Vial but its own definition could not be read.
 * Never a silent downgrade: prefer the vial.json the user loaded for this
 * board before (full Vial service), else talk plain VIA over the same session
 * — the keymap still works — and tell the user how to get the layout back.
 */
async function connectWithoutDeviceDef(
    transport: Transport,
    id: IdentifiedVial,
    reason: string,
): Promise<KeyboardService> {
    const { client, vialProtocol, keyboardId } = id
    const ids = readTransportIds(transport)
    const layerCount = await readVialLayerCount(client)
    const baseInfo = {
        serialNumber: keyboardId.toString(16),
        vid: ids.vid,
        pid: ids.pid,
    }

    const key = cacheKey({ ...baseInfo, name: '', firmware: 'qmk-vial' })
    const saved = key ? loadCached(key) : null
    if (saved) {
        return VialKeyboardService.create({
            deviceInfo: {
                ...baseInfo,
                name: saved.name || transport.label || 'Vial keyboard',
                firmware: 'qmk-vial',
                firmwareVersion: `vial-${vialProtocol}`,
            },
            client,
            def: saved,
            layerCount,
            vialProtocol,
            keyboardId,
            connectNotices: [
                {
                    level: 'warning',
                    title: 'Using your saved vial.json',
                    description: `The board's own definition could not be read (${reason}), so the layout you loaded earlier is used instead.`,
                },
            ],
        })
    }

    return QmkKeyboardService.create({
        deviceInfo: {
            ...baseInfo,
            name: transport.label || 'Vial keyboard',
            firmware: 'qmk-via',
            firmwareVersion: `vial-${vialProtocol}`,
        },
        client,
        rows: QMK_DEFAULT_ROWS,
        cols: QMK_DEFAULT_COLS,
        layerCount,
        connectNotices: [
            {
                level: 'warning',
                title: 'Connected in VIA mode',
                description: `This Vial board's definition could not be read (${reason}). Keys can still be remapped, but the layout, encoders, macros and tap dance are unavailable. Load the board's vial.json to restore the layout.`,
            },
        ],
    })
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
            if (!identified.has(transport)) {
                const id = await identifyVial(transport)
                if (!id) return { ok: false, reason: 'not a Vial device' }
                identified.set(transport, id)
            }
            // The definition (and so the board name) is not read until
            // connect; the transport label is the best name available here.
            return {
                ok: true,
                deviceInfo: {
                    name: transport.label || 'Vial keyboard',
                    firmware: 'qmk-vial',
                },
            }
        },

        async connect(
            transport: Transport,
            signal: AbortSignal,
        ): Promise<KeyboardService> {
            let id = identified.get(transport) ?? null
            if (id) identified.delete(transport)
            else {
                id = await identifyVial(transport)
                if (!id) {
                    throw new TransportError('Vial probe failed during connect')
                }
            }
            const client = id.client
            const abortClient = (): void => {
                client.close({ abortTransport: true }).catch(() => undefined)
            }
            if (signal.aborted) {
                abortClient()
                throw signal.reason ?? new Error('aborted')
            }
            signal.addEventListener('abort', abortClient, { once: true })

            let session: LoadedVial
            try {
                session = await loadVial(transport, id)
            } catch (err) {
                console.warn('[qmk-vial] definition load failed', err)
                try {
                    return await connectWithoutDeviceDef(
                        transport,
                        id,
                        errorMessage(err),
                    )
                } catch (fallbackErr) {
                    console.warn('[qmk-vial] fallback failed', fallbackErr)
                    abortClient()
                    throw new TransportError(
                        `Vial keyboard detected, but its definition could not be read: ${errorMessage(err)}`,
                    )
                }
            }
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
