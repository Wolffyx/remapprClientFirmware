// pattern-check: skip — thin facade impl wrapping HidClient.send calls; data marshalling only
import type { HidClient } from '@firmware/hid/rawHidClient'
import type { HsvColor, IndicatorConfig, RgbApi } from '@firmware/service'
import { createRgbMatrixEffectFacade } from '@firmware/clients/via/rgbMatrix'

import {
    buildIndicatorsPayload,
    getIndicatorsConfigCmd,
    getLedCountCmd,
    getLedIndexCmd,
    getMixedEffectCmd,
    getMixedRegionsCmd,
    getPerKeyColorCmd,
    getPerKeyTypeCmd,
    LED_IDX_BATCH_MAX,
    NO_LED,
    parseIndicatorsConfig,
    parseLedCount,
    parseLedIndexMap,
    parseMixedEffect,
    parseMixedRegions,
    parsePerKeyColor,
    parsePerKeyType,
    rgbSaveCmd,
    setIndicatorsConfigCmd,
    setMixedEffectCmd,
    setMixedRegionsCmd,
    setPerKeyColorCmd,
    setPerKeyTypeCmd,
} from './protocol'

// pattern-check: skip — extends existing Facade; composes via rgbMatrix effect into keychron RgbApi
export function createRgbFacade(client: HidClient): RgbApi {
    // Global effect (mode/brightness/speed/colour) rides stock VIA's custom
    // RGB-matrix channel, not the Keychron 0xA8 group — compose it in.
    const effect = createRgbMatrixEffectFacade(client)
    return {
        effectCatalog: effect.effectCatalog,
        getEffect: () => effect.getEffect(),
        setEffect: (state) => effect.setEffect(state),
        async getLedCount(): Promise<number> {
            const resp = await client.send(getLedCountCmd())
            return parseLedCount(resp)
        },
        async getIndicators(): Promise<IndicatorConfig> {
            const resp = await client.send(getIndicatorsConfigCmd())
            return parseIndicatorsConfig(resp)
        },
        async setIndicators(cfg: IndicatorConfig): Promise<void> {
            await client.send(
                setIndicatorsConfigCmd(
                    buildIndicatorsPayload(cfg.disabled, cfg.color),
                ),
            )
        },
        async save(): Promise<void> {
            // Persist both the Keychron 0xA8 state (per-key/mixed/indicators)
            // and the VIA matrix channel (global effect) to EEPROM.
            await client.send(rgbSaveCmd())
            await effect.saveEffect()
        },
        async getPerKeyEffectMode(): Promise<number | null> {
            // PER_KEY_RGB and MIXED_RGB are custom RGB-matrix effects registered
            // LAST in the firmware enum (keychron common rgb_matrix_kb.inc:
            // RGB_MATRIX_EFFECT(PER_KEY_RGB) then (MIXED_RGB)). The VIA
            // definition's effect menu omits them, so a literal index (e.g. the
            // catalog length) is wrong — the firmware enables more built-ins than
            // VIA lists. QMK clamps an out-of-range mode to RGB_MATRIX_EFFECT_MAX
            // − 1, so writing a saturated mode and reading it back yields
            // MIXED_RGB's index; PER_KEY_RGB is the effect immediately before it.
            try {
                const cur = await effect.getEffect()
                await effect.setEffect({ ...cur, mode: 0xff })
                const maxMode = (await effect.getEffect()).mode
                return maxMode >= 1 ? maxMode - 1 : null
            } catch {
                return null
            }
        },
        async getPerKeyType(): Promise<number> {
            const resp = await client.send(getPerKeyTypeCmd())
            return parsePerKeyType(resp)
        },
        async setPerKeyType(type: number): Promise<void> {
            await client.send(setPerKeyTypeCmd(type))
        },
        async getPerKeyColors(
            startLed: number,
            count: number,
        ): Promise<HsvColor[]> {
            const resp = await client.send(getPerKeyColorCmd(startLed, count))
            return parsePerKeyColor(resp, count)
        },
        async setPerKeyColors(
            startLed: number,
            colors: HsvColor[],
        ): Promise<void> {
            await client.send(setPerKeyColorCmd(startLed, colors))
        },
        async getLedIndexMap(keyCount: number): Promise<number[]> {
            // canvas idx → LED idx via RGB_SUB.GET_LED_IDX (0x06). Falls back to
            // identity (LED order == layout order) on any read error or if the
            // returned map fails validation — so a wrong byte-layout guess (see
            // protocol.ts HW-CONFIRM) degrades safely instead of mismapping.
            const identity = Array.from({ length: keyCount }, (_, i) => i)
            try {
                const ledCount = parseLedCount(
                    await client.send(getLedCountCmd()),
                )
                const map: number[] = []
                for (let s = 0; s < keyCount; s += LED_IDX_BATCH_MAX) {
                    const n = Math.min(LED_IDX_BATCH_MAX, keyCount - s)
                    map.push(
                        ...parseLedIndexMap(
                            await client.send(getLedIndexCmd(s, n)),
                            n,
                        ),
                    )
                }
                // Valid iff length matches and every real LED idx is in range
                // and unique (NO_LED keys are skipped — they may repeat).
                const seen = new Set<number>()
                let valid = map.length === keyCount
                for (const v of map) {
                    if (!valid) break
                    if (v === NO_LED) continue
                    if (v < 0 || v >= ledCount || seen.has(v)) valid = false
                    else seen.add(v)
                }
                return valid ? map : identity
            } catch {
                return identity
            }
        },
        async getMixedRegions(): Promise<Uint8Array> {
            const resp = await client.send(getMixedRegionsCmd())
            return parseMixedRegions(resp)
        },
        async setMixedRegions(payload: Uint8Array): Promise<void> {
            await client.send(setMixedRegionsCmd(payload))
        },
        async getMixedEffect(): Promise<Uint8Array> {
            const resp = await client.send(getMixedEffectCmd())
            return parseMixedEffect(resp)
        },
        async setMixedEffect(payload: Uint8Array): Promise<void> {
            await client.send(setMixedEffectCmd(payload))
        },
    }
}
