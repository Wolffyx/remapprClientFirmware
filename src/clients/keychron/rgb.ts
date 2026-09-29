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

/** Key idx → LED idx via RGB_SUB.GET_LED_IDX (0x06), plus the LED count to
 *  validate it against. */
async function readLedIndexMap(
    client: HidClient,
    keyCount: number,
): Promise<{ leds: number[]; ledCount: number }> {
    const ledCount = parseLedCount(await client.send(getLedCountCmd()))
    const leds: number[] = []
    for (let s = 0; s < keyCount; s += LED_IDX_BATCH_MAX) {
        const n = Math.min(LED_IDX_BATCH_MAX, keyCount - s)
        leds.push(
            ...parseLedIndexMap(await client.send(getLedIndexCmd(s, n)), n),
        )
    }
    return { leds, ledCount }
}

/** One entry per key, every real LED in range and used once. NO_LED keys
 *  are skipped: they may repeat. */
function isValidLedMap(
    leds: number[],
    keyCount: number,
    ledCount: number,
): boolean {
    if (leds.length !== keyCount) return false
    const real = leds.filter((led) => led !== NO_LED)
    if (real.some((led) => led < 0 || led >= ledCount)) return false
    return new Set(real).size === real.length
}

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
        async getKeyLeds(keyCount: number): Promise<number[][]> {
            // Keychron reports one LED per key (the firmware's g_led_config
            // matrix, where the last LED of a shared key wins). Falls back to
            // identity (LED order == layout order) when the read fails or the
            // map fails validation, so a wrong byte-layout guess (see
            // protocol.ts HW-CONFIRM) degrades safely instead of mismapping.
            const map = await readLedIndexMap(client, keyCount).catch(
                (err: unknown) => {
                    console.warn('[keychron] LED map read failed', err)
                    return null
                },
            )
            const leds =
                map && isValidLedMap(map.leds, keyCount, map.ledCount)
                    ? map.leds
                    : Array.from({ length: keyCount }, (_, i) => i)
            return leds.map((led) => (led === NO_LED ? [] : [led]))
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
