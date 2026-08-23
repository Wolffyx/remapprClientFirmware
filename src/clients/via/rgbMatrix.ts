// Pattern check: Facade (Tier 1) — applied — groups the VIA custom-channel
// RGB-matrix get/set/save commands behind the neutral RgbApi effect surface
// (mirrors keychron/rgb.ts). Firmware-agnostic: any VIA device (stock QMK or
// Keychron, which rides stock VIA for its global effect) reuses this.
//
// QMK exposes the global RGB-matrix effect via the VIA custom channel 3
// (id_custom_get/set/save_value). Per-key colours are NOT here — those are
// firmware-specific (Keychron 0xA8 / VIAL). Implemented from the public VIA
// protocol spec: https://www.caniusevia.com/docs/specification
import type { HidClient } from '@firmware/hid/rawHidClient'
import { RGB_MATRIX_CATALOG } from '@firmware/lighting'
import type { RgbEffectState } from '@firmware/service'

import {
    customGetCmd,
    customSaveCmd,
    customSetCmd,
    parseCustomGet,
    VIA_CHANNEL,
    VIA_RGB_MATRIX_VALUE,
} from '@firmware/clients/qmk/protocol'

const CH = VIA_CHANNEL.RGB_MATRIX
const V = VIA_RGB_MATRIX_VALUE

export interface RgbMatrixEffectFacade {
    effectCatalog: typeof RGB_MATRIX_CATALOG
    getEffect(): Promise<RgbEffectState>
    setEffect(state: RgbEffectState): Promise<void>
    /** Persist the matrix channel to EEPROM (VIA id_custom_save, channel 3). */
    saveEffect(): Promise<void>
}

export function createRgbMatrixEffectFacade(
    client: HidClient,
): RgbMatrixEffectFacade {
    const get1 = async (valueId: number): Promise<number> => {
        const resp = await client.send(customGetCmd(CH, valueId))
        return parseCustomGet(resp, CH, valueId)[0] & 0xff
    }
    return {
        effectCatalog: RGB_MATRIX_CATALOG,
        async getEffect(): Promise<RgbEffectState> {
            const brightness = await get1(V.BRIGHTNESS)
            const mode = await get1(V.EFFECT)
            const speed = await get1(V.EFFECT_SPEED)
            const colorResp = await client.send(customGetCmd(CH, V.COLOR))
            const color = parseCustomGet(colorResp, CH, V.COLOR)
            return {
                mode,
                brightness,
                speed,
                color: {
                    h: color[0] & 0xff,
                    s: color[1] & 0xff,
                    v: brightness,
                },
            }
        },
        async setEffect(state: RgbEffectState): Promise<void> {
            await client.send(customSetCmd(CH, V.EFFECT, [state.mode & 0xff]))
            await client.send(
                customSetCmd(CH, V.BRIGHTNESS, [state.brightness & 0xff]),
            )
            await client.send(
                customSetCmd(CH, V.EFFECT_SPEED, [state.speed & 0xff]),
            )
            await client.send(
                customSetCmd(CH, V.COLOR, [
                    state.color.h & 0xff,
                    state.color.s & 0xff,
                ]),
            )
        },
        async saveEffect(): Promise<void> {
            await client.send(customSaveCmd(CH))
        },
    }
}
