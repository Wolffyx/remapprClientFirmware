// Pattern check: no GoF pattern (-) — rejected — encoder cw/ccw read/write helpers using the Vial keycode codec.
import type { HidClient } from '@firmware/clients/qmk/hidClient'
import type { EncoderAction, KeyAction } from '@firmware/types'

import { decodeVialAsKeyAction, encodeVialKeycode } from './actions'
import { getEncoderCmd, parseEncoder, setEncoderCmd } from './protocol'

export async function readEncoder(
    client: HidClient,
    layer: number,
    idx: number,
    layerNames?: string[],
    customNames?: string[],
): Promise<EncoderAction> {
    const resp = await client.send(getEncoderCmd(layer, idx))
    const { cw, ccw } = parseEncoder(resp)
    // Same decoder as the keys, so a board's custom keycodes on a knob get
    // their names instead of a raw hex label.
    return {
        cw: decodeVialAsKeyAction(cw, layerNames, customNames),
        ccw: decodeVialAsKeyAction(ccw, layerNames, customNames),
    }
}

/** `direction` is the neutral EncoderApi one: 0 = clockwise. */
export async function writeEncoder(
    client: HidClient,
    layer: number,
    idx: number,
    direction: 0 | 1,
    action: KeyAction,
): Promise<void> {
    const kc = encodeVialKeycode(action)
    await client.send(setEncoderCmd(layer, idx, direction === 0, kc))
}
