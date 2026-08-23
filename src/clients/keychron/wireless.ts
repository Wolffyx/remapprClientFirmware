// pattern-check: skip — facade wires HidClient send + state-notify push frames into WirelessApi; data marshalling only
import type { HidClient } from '@firmware/hid/rawHidClient'
import type {
    WirelessApi,
    WirelessLpm,
    WirelessModuleInfo,
    WirelessStatus,
} from '@firmware/service'

import type { FeatureFlags, KeychronNotification } from './protocol'
import {
    dfuModuleLabel,
    factoryResetCmd,
    getDfuInfoCmd,
    getNkroCmd,
    getWirelessLpmCmd,
    parseDfuInfo,
    parseNkro,
    parseWirelessLpm,
    setNkroCmd,
    setWirelessLpmCmd,
} from './protocol'

export interface WirelessFacadeOpts {
    feats: FeatureFlags
    miscNkro: boolean
    miscDfuInfo?: boolean
}

export interface WirelessFacade {
    api: WirelessApi
    onNotification: (n: KeychronNotification) => void
}

export function createWirelessFacade(
    client: HidClient,
    opts: WirelessFacadeOpts,
): WirelessFacade {
    const statusListeners = new Set<(s: WirelessStatus) => void>()
    let lastStatus: WirelessStatus = { transport: 'usb' }

    function emit(next: WirelessStatus): void {
        lastStatus = next
        for (const cb of statusListeners) {
            try {
                cb(next)
            } catch {
                /* ignore */
            }
        }
    }

    const api: WirelessApi = {
        async getLpm(): Promise<WirelessLpm> {
            const resp = await client.send(getWirelessLpmCmd())
            return parseWirelessLpm(resp)
        },
        async setLpm(cfg: WirelessLpm): Promise<void> {
            await client.send(setWirelessLpmCmd(cfg))
        },
        async getStatus(): Promise<WirelessStatus> {
            return lastStatus
        },
        onStatusChanged(cb: (s: WirelessStatus) => void): () => void {
            statusListeners.add(cb)
            return () => statusListeners.delete(cb)
        },
        factoryReset: async (): Promise<void> => {
            await client.send(factoryResetCmd())
        },
    }

    if (opts.miscNkro) {
        api.getNkro = async (): Promise<boolean> => {
            const resp = await client.send(getNkroCmd())
            return parseNkro(resp)
        }
        api.setNkro = async (enabled: boolean): Promise<void> => {
            await client.send(setNkroCmd(enabled))
        }
    }

    if (opts.miscDfuInfo) {
        api.getModuleInfo = async (): Promise<WirelessModuleInfo> => {
            const resp = await client.send(getDfuInfoCmd())
            const info = parseDfuInfo(resp)
            return {
                label: dfuModuleLabel(info),
                moduleType: info.moduleType,
                versionMajor: info.versionMajor,
                versionMinor: info.versionMinor,
                versionPatch: info.versionPatch,
            }
        }
    }

    return {
        api,
        onNotification(n) {
            // Firmware does not currently push BT-slot/battery deltas as
            // distinct frames over USB raw HID — those travel inside the
            // wireless module's own status reports. Until that surface is
            // exposed, we keep `lastStatus` static and only re-emit on
            // notable lifecycle events (e.g. factory-reset returns the
            // device to its boot state, USB host).
            if (n.kind === 'factory-reset') {
                emit({ transport: 'usb' })
            }
        },
    }
}
