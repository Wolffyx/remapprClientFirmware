// pattern-check: skip — facade wires HidClient send into AdvancedApi; data marshalling only
//
// Keychron "Advanced Mode" surface: debounce, report rate, snap-click and the
// quick-start flag. Each method is attached only when the misc-feature mask
// advertises it, so the renderer can gate the panel by `service.advanced` and the
// individual rows by which methods exist.
import type { HidClient } from '@firmware/hid/rawHidClient'
import type { AdvancedApi, AdvancedDebounce } from '@firmware/service'

import type { FeatureFlags, MiscFeatureFlags } from './protocol'
import {
    getDebounceCmd,
    getReportRateCmd,
    getSnapClickCmd,
    parseDebounce,
    parseReportRate,
    parseSnapClick,
    setDebounceCmd,
    setReportRateCmd,
    setSnapClickCmd,
    snapClickSaveCmd,
} from './protocol'

export function createAdvancedFacade(
    client: HidClient,
    misc: MiscFeatureFlags,
    feats: FeatureFlags,
): AdvancedApi {
    const api: AdvancedApi = {
        quickStart: feats.quickStart || misc.quickStart,
    }

    if (misc.debounce) {
        api.getDebounce = async (): Promise<AdvancedDebounce> => {
            const resp = await client.send(getDebounceCmd())
            return parseDebounce(resp)
        }
        api.setDebounce = async (cfg: AdvancedDebounce): Promise<void> => {
            await client.send(setDebounceCmd(cfg))
        }
    }

    if (misc.reportRate) {
        api.getReportRate = async (): Promise<number> => {
            const resp = await client.send(getReportRateCmd())
            return parseReportRate(resp)
        }
        api.setReportRate = async (value: number): Promise<void> => {
            await client.send(setReportRateCmd(value))
        }
    }

    if (misc.snapClick) {
        api.getSnapClick = async (): Promise<boolean> => {
            const resp = await client.send(getSnapClickCmd())
            return parseSnapClick(resp)
        }
        api.setSnapClick = async (enabled: boolean): Promise<void> => {
            await client.send(setSnapClickCmd(enabled))
            // Snap-click has a dedicated SAVE — persist after every set.
            await client.send(snapClickSaveCmd())
        }
    }

    return api
}

/** True when any Advanced-Mode control is available for this firmware. */
export function hasAdvancedFeatures(
    misc: MiscFeatureFlags,
    feats: FeatureFlags,
): boolean {
    return (
        misc.debounce ||
        misc.reportRate ||
        misc.snapClick ||
        feats.quickStart ||
        misc.quickStart
    )
}
