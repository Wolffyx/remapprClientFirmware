// Pattern check: no GoF pattern (-) — rejected — encoder cw/ccw read/write helpers using QMK keycode codec.
import { decodeAsKeyAction, encodeKeycode } from '@firmware/clients/qmk/actions'
import type { HidClient } from '@firmware/clients/qmk/hidClient'
import type { EncoderAction, KeyAction } from '@firmware/types'

import { getEncoderCmd, parseEncoder, setEncoderCmd } from './protocol'

export async function readEncoder(
    client: HidClient,
    layer: number,
    idx: number,
    layerNames?: string[],
): Promise<EncoderAction> {
    const resp = await client.send(getEncoderCmd(layer, idx))
    const { cw, ccw } = parseEncoder(resp)
    return {
        cw: decodeAsKeyAction(cw, layerNames),
        ccw: decodeAsKeyAction(ccw, layerNames),
    }
}

export async function writeEncoder(
    client: HidClient,
    layer: number,
    idx: number,
    direction: 0 | 1,
    action: KeyAction,
): Promise<void> {
    const kc = encodeKeycode(action)
    await client.send(setEncoderCmd(layer, idx, direction, kc))
}
