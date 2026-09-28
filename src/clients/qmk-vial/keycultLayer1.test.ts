// Pattern check: no GoF pattern (-) — rejected — regression fixture; decodes a real keymap's layer through both QMK-family label paths.
//
// Wolffyx/remappr#190: the second layer of the Aftermarket Keycult TKL
// (qmk/qmk_firmware#26409, keymaps/default/keymap.c) is dynamic-macro, RGB
// matrix and mouse-wheel keys. The VIA client labelled them from the catalog;
// the Vial client skipped the codec and showed raw hex for every one.
import { describe, expect, it } from 'vitest'

import { decodeAsKeyAction, relabelQmkLayer } from '@firmware/clients/qmk/actions'
import { qmkCodec } from '@firmware/clients/qmk/codec'
import type { KeyAction } from '@firmware/types'

import { decodeVialAsKeyAction, relabelVialLayer } from './actions'

// Layer 1's non-transparent keys and the encoder map, keycode → canonical id.
const LAYER_1: [string, number, string][] = [
    ['DM_RSTP', 0x7c55, 'macro.dynamic.record_stop'],
    ['DM_REC1', 0x7c53, 'macro.dynamic.record_1'],
    ['DM_REC2', 0x7c54, 'macro.dynamic.record_2'],
    ['DM_PLY1', 0x7c56, 'macro.dynamic.play_1'],
    ['DM_PLY2', 0x7c57, 'macro.dynamic.play_2'],
    ['RM_TOGG', 0x7842, 'rgb.matrix.toggle'],
    ['RM_NEXT', 0x7843, 'rgb.matrix.mode_next'],
    ['RM_PREV', 0x7844, 'rgb.matrix.mode_prev'],
    ['RM_HUEU', 0x7845, 'rgb.matrix.hue.up'],
    ['RM_HUED', 0x7846, 'rgb.matrix.hue.down'],
    ['RM_SATU', 0x7847, 'rgb.matrix.sat.up'],
    ['RM_SATD', 0x7848, 'rgb.matrix.sat.down'],
    ['RM_VALU', 0x7849, 'rgb.matrix.val.up'],
    ['RM_VALD', 0x784a, 'rgb.matrix.val.down'],
    ['RM_SPDU', 0x784b, 'rgb.matrix.speed.up'],
    ['RM_SPDD', 0x784c, 'rgb.matrix.speed.down'],
    ['MS_WHLU', 0x00d9, 'mouse.wheel.up'],
    ['MS_WHLD', 0x00da, 'mouse.wheel.down'],
]

const LAYERS = ['Layer 0', 'Layer 1']

function looksRaw(a: KeyAction): boolean {
    return [a.label.primary, a.label.paramText, a.label.valueLong].some(
        (t) => typeof t === 'string' && /^0x[0-9a-f]+$/i.test(t),
    )
}

describe('Keycult TKL layer 1 labels (#190)', () => {
    it.each(LAYER_1)('%s decodes to a named key on Vial', (_n, kc, id) => {
        const decoded = decodeVialAsKeyAction(kc, LAYERS, [])
        expect(decoded.canonicalId).toBe(id)
        expect(looksRaw(decoded)).toBe(false)

        const [relabelled] = relabelVialLayer([decoded], LAYERS, [])
        expect(relabelled.canonicalId).toBe(id)
        expect(looksRaw(relabelled)).toBe(false)
    })

    it.each(LAYER_1)('%s decodes to a named key on VIA', (_n, kc, id) => {
        const [relabelled] = relabelQmkLayer(
            [decodeAsKeyAction(kc, undefined, qmkCodec)],
            LAYERS,
            qmkCodec,
        )
        expect(relabelled.canonicalId).toBe(id)
        expect(looksRaw(relabelled)).toBe(false)
    })

    it('MO(1) points at the second layer on both paths', () => {
        const vial = decodeVialAsKeyAction(0x5221, LAYERS, [])
        const via = relabelQmkLayer([decodeAsKeyAction(0x5221)], LAYERS)[0]
        for (const a of [vial, via]) {
            expect(a.params).toEqual([1])
            expect(a.label.paramText).toBe('Layer 1')
        }
    })
})
