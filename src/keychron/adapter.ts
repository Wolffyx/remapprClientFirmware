// Pattern check: Adapter (Tier 1) — extended — extends src/firmware/qmk/adapter.ts probe-cache structure for Keychron 0xA0 handshake; reuses QmkKeyboardService for keymap r/w via VIA passthrough.
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
} from '@firmware/hid/rawHidClient'
import { QmkKeyboardService, readQmkLayerCount } from '@firmware/qmk/service'
import type { KeyboardService } from '@firmware/service'
import { readTransportIds, type Transport } from '@firmware/transport'
import type { DeviceInfo } from '@firmware/types'

import {
    type FeatureFlags,
    getFirmwareVersionCmd,
    getMiscProtocolVersionCmd,
    getProtocolVersionCmd,
    getSupportFeatureCmd,
    getDefaultLayerCmd,
    parseDefaultLayer,
    KEYCHRON_PAYLOAD_SIZE,
    KEYCHRON_USAGE,
    KEYCHRON_USAGE_PAGE,
    type MiscFeatureFlags,
    getLedCountCmd,
    parseFeatureFlags,
    parseFirmwareVersion,
    parseMiscProtocolVersion,
    parseNotification,
    parseProtocolVersion,
} from './protocol'
import { keychronCodec } from './codec'

import { createAdvancedFacade, hasAdvancedFeatures } from './advanced'
import { createLayersFacade } from './layers'
import { createRgbFacade } from './rgb'
import { createWirelessFacade } from './wireless'
import { getBoardById, type KeychronBoardPreset, matchBoard } from './boards'

const PROBE_DEADLINE_MS = 1500
const KEYCHRON_VID = 0x3434

// Stand-in for a firmware that doesn't implement 0xA2 GET_SUPPORT_FEATURE.
const EMPTY_FEATURES: FeatureFlags = {
    defaultLayer: false,
    bluetooth: false,
    p24g: false,
    analogMatrix: false,
    stateNotify: false,
    dynamicDebounce: false,
    snapClick: false,
    keychronRgb: false,
    quickStart: false,
    nkro: false,
    raw: 0,
}

// VIA does not expose matrix dimensions over the protocol — clients
// load them from the per-board keyboard.json. K5 Max default = 6×21.
const DEFAULT_ROWS = 6
const DEFAULT_COLS = 21

const KEYCHRON_DISCOVERY: Discovery = {
    hid: {
        vendorIds: [KEYCHRON_VID],
        usagePage: KEYCHRON_USAGE_PAGE,
        usage: KEYCHRON_USAGE,
    },
}

interface ProbedSession {
    client: HidClient
    deviceInfo: DeviceInfo
    layerCount: number
    feats: FeatureFlags
    misc: MiscFeatureFlags | null
    miscNkro: boolean
    miscWirelessLpm: boolean
    miscDfuInfo: boolean
    rgbAvailable: boolean
}

const probedSessions = new WeakMap<Transport, ProbedSession>()

async function probeKeychronSession(
    transport: Transport,
): Promise<ProbedSession | null> {
    const client = createHidClientFromTransport(transport, {
        payloadSize: KEYCHRON_PAYLOAD_SIZE,
    })
    try {
        let proto
        try {
            const resp = await client.send(
                getProtocolVersionCmd(),
                PROBE_DEADLINE_MS,
            )
            proto = parseProtocolVersion(resp)
        } catch {
            // Not a Keychron-firmware device — release stream locks so the
            // next adapter can probe the same transport.
            await client.close().catch(() => undefined)
            return null
        }
        if (proto.protocolVersion < 0x01) {
            await client.close().catch(() => undefined)
            return null
        }

        let firmwareVersion = `kc-${proto.protocolVersion}`
        try {
            const fwResp = await client.send(
                getFirmwareVersionCmd(),
                PROBE_DEADLINE_MS,
            )
            firmwareVersion = parseFirmwareVersion(fwResp) || firmwareVersion
        } catch {
            // Optional.
        }

        // Pre-0xA2 firmwares (older wired K-series, protocol v1) don't answer
        // the feature query. Treat that as "no advertised features" instead of
        // failing the probe — the facades below detect capability by asking.
        let feats = EMPTY_FEATURES
        try {
            const featResp = await client.send(
                getSupportFeatureCmd(),
                PROBE_DEADLINE_MS,
            )
            feats = parseFeatureFlags(featResp)
        } catch {
            // Optional.
        }

        let misc: MiscFeatureFlags | null = null
        let miscNkro = false
        let miscWirelessLpm = false
        let miscDfuInfo = false
        try {
            const miscResp = await client.send(
                getMiscProtocolVersionCmd(),
                PROBE_DEADLINE_MS,
            )
            misc = parseMiscProtocolVersion(miscResp).miscFeatures
            miscNkro = misc.nkro
            miscWirelessLpm = misc.wirelessLpm
            miscDfuInfo = misc.dfuInfo
        } catch {
            // Older firmwares may not implement misc proto query.
        }

        const layerCount = await readQmkLayerCount(client)

        const ids = readTransportIds(transport)
        const deviceInfo: DeviceInfo = {
            name: transport.label || 'Keychron keyboard',
            firmware: 'keychron-qmk',
            firmwareVersion,
            vid: ids.vid,
            pid: ids.pid,
        }

        return {
            client,
            deviceInfo,
            layerCount,
            feats,
            misc,
            miscNkro,
            miscWirelessLpm,
            miscDfuInfo,
            rgbAvailable: feats.keychronRgb,
        }
    } catch (err) {
        await client.close().catch(() => undefined)
        if (err instanceof TransportError) return null
        return null
    }
}

export interface KeychronAdapterOptions {
    rows?: number
    cols?: number
    encoders?: number
    boardId?: string
}

function resolveBoardPreset(
    opts: KeychronAdapterOptions,
    label: string,
): KeychronBoardPreset | null {
    if (opts.boardId) return getBoardById(opts.boardId)
    return matchBoard(label)
}

export function createKeychronAdapter(
    opts: KeychronAdapterOptions = {},
): FirmwareAdapter {
    const fallbackRows = opts.rows ?? DEFAULT_ROWS
    const fallbackCols = opts.cols ?? DEFAULT_COLS
    const fallbackEncoders = opts.encoders ?? 0

    return {
        id: 'keychron-qmk',
        displayName: 'Keychron (QMK)',
        discovery: KEYCHRON_DISCOVERY,

        async canHandle(
            transport: Transport,
            hint?: ProbeHint,
        ): Promise<Probe> {
            if (hint && hint.transportKind !== 'hid') {
                return {
                    ok: false,
                    reason: 'keychron-qmk requires HID transport',
                }
            }
            const cached = probedSessions.get(transport)
            if (cached) return { ok: true, deviceInfo: cached.deviceInfo }

            const session = await probeKeychronSession(transport)
            if (!session) {
                return { ok: false, reason: 'not a Keychron QMK device' }
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
                session = await probeKeychronSession(transport)
                if (!session) {
                    throw new TransportError(
                        'Keychron QMK probe failed during connect',
                    )
                }
            }

            if (signal.aborted) {
                await session.client.close().catch(() => undefined)
                throw signal.reason ?? new Error('aborted')
            }
            const sessionRef = session
            signal.addEventListener(
                'abort',
                () => {
                    sessionRef.client
                        .close({ abortTransport: true })
                        .catch(() => undefined)
                },
                { once: true },
            )

            // The 0xA2 feature word is unreliable on some firmwares (reports all
            // false). Trust the 0xA7 misc mask: if it advertises wireless LPM the
            // board is wireless-capable, regardless of the bluetooth/p24g bits.
            const wirelessCapable =
                session.miscWirelessLpm ||
                session.feats.bluetooth ||
                session.feats.p24g
            const wirelessFacade = wirelessCapable
                ? createWirelessFacade(session.client, {
                      feats: session.feats,
                      miscNkro: session.miscNkro,
                      miscDfuInfo: session.miscDfuInfo,
                  })
                : null

            // Don't trust the 0xA2 RGB feature bit alone — some firmwares leave
            // it clear yet still answer the 0xA8 RGB group. Probe GET_LED_COUNT
            // and attach the facade if the keyboard responds.
            let rgbAvailable = session.rgbAvailable
            if (!rgbAvailable) {
                try {
                    await session.client.send(
                        getLedCountCmd(),
                        PROBE_DEADLINE_MS,
                    )
                    rgbAvailable = true
                } catch {
                    /* no Keychron RGB group on this board */
                }
            }
            const rgb = rgbAvailable
                ? createRgbFacade(session.client)
                : undefined

            console.info('[keychron] connected', {
                firmwareVersion: session.deviceInfo.firmwareVersion,
                rgbBit: session.feats.keychronRgb,
                rgbAvailable,
                feats: session.feats,
                misc: session.misc,
            })

            // Same story as the RGB bit: some firmwares leave the
            // DEFAULT_LAYER feature bit clear yet still answer 0xA3. Ask the
            // board directly so the editor can auto-select the hardware layer
            // (Mac/Win DIP position) the way Keychron Launcher does.
            let defaultLayerAvailable = session.feats.defaultLayer
            if (!defaultLayerAvailable) {
                try {
                    const resp = await session.client.send(
                        getDefaultLayerCmd(),
                        PROBE_DEADLINE_MS,
                    )
                    parseDefaultLayer(resp)
                    defaultLayerAvailable = true
                } catch {
                    /* no default-layer query on this board */
                }
            }
            const layersFacade = defaultLayerAvailable
                ? createLayersFacade(session.client)
                : null

            const advanced =
                session.misc && hasAdvancedFeatures(session.misc, session.feats)
                    ? createAdvancedFacade(
                          session.client,
                          session.misc,
                          session.feats,
                      )
                    : undefined

            // State-notify pump: subscribe to unsolicited frames and fan
            // them out to facades that care. Boards with an empty 0xA2 word
            // still push frames, so attach whenever a consumer exists rather
            // than trusting the STATE_NOTIFY bit alone.
            if (session.feats.stateNotify || wirelessFacade || layersFacade) {
                session.client.subscribe((frame) => {
                    const n = parseNotification(frame)
                    wirelessFacade?.onNotification(n)
                    layersFacade?.onNotification(n)
                })
            }

            const preset = resolveBoardPreset(opts, transport.label ?? '')
            const rows = opts.rows ?? preset?.rows ?? fallbackRows
            const cols = opts.cols ?? preset?.cols ?? fallbackCols
            const encoders =
                opts.encoders ?? preset?.encoders ?? fallbackEncoders
            if (preset) {
                session.deviceInfo = {
                    ...session.deviceInfo,
                    name: preset.displayName,
                }
            }

            return QmkKeyboardService.create({
                deviceInfo: session.deviceInfo,
                client: session.client,
                rows,
                cols,
                layerCount: session.layerCount,
                capabilitiesOverride: {
                    notifications: session.feats.stateNotify,
                    exportFormats: ['via.json'],
                    encoders,
                },
                wireless: wirelessFacade?.api,
                rgb,
                advanced,
                layerControl: layersFacade?.api,
                codec: keychronCodec,
            })
        },
    }
}

export const keychronAdapter: FirmwareAdapter = createKeychronAdapter()
