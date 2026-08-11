// Pattern check: no GoF pattern (-) — rejected — unit tests for QMK keycode encode/decode round-trips and label generation.
import { describe, expect, it } from 'vitest'

import {
    buildQmkKeyAction,
    decodeKeycode,
    encodeKeycode,
    QMK_KIND,
} from './actions'

describe('qmk/actions — keycode codec', () => {
    it('KC_NO encodes 0x0000', () => {
        expect(encodeKeycode(buildQmkKeyAction(QMK_KIND.NONE, []))).toBe(0x0000)
        expect(decodeKeycode(0x0000)).toEqual({
            kind: QMK_KIND.NONE,
            params: [],
        })
    })

    it('KC_TRNS encodes 0x0001', () => {
        expect(encodeKeycode(buildQmkKeyAction(QMK_KIND.TRANS, []))).toBe(
            0x0001,
        )
        expect(decodeKeycode(0x0001)).toEqual({
            kind: QMK_KIND.TRANS,
            params: [],
        })
    })

    it('basic key A (0x04) round-trips', () => {
        const a = buildQmkKeyAction(QMK_KIND.BASIC, [0x04])
        const kc = encodeKeycode(a)
        expect(kc).toBe(0x0004)
        expect(decodeKeycode(kc)).toEqual({
            kind: QMK_KIND.BASIC,
            params: [0x04],
        })
    })

    it('mod-tap LSHIFT + A round-trips', () => {
        const action = buildQmkKeyAction(QMK_KIND.MOD_TAP, [0x02, 0x04])
        const kc = encodeKeycode(action)
        // QK_MOD_TAP base 0x2000; mod 0x02 (LSHIFT) packs to 0b00010
        expect(kc).toBe(0x2000 | (0b00010 << 8) | 0x04)
        const decoded = decodeKeycode(kc)
        expect(decoded.kind).toBe(QMK_KIND.MOD_TAP)
        expect(decoded.params).toEqual([0x02, 0x04])
    })

    it('mod-tap RGUI + Space round-trips', () => {
        const action = buildQmkKeyAction(QMK_KIND.MOD_TAP, [0x80, 0x2c])
        const decoded = decodeKeycode(encodeKeycode(action))
        expect(decoded.kind).toBe(QMK_KIND.MOD_TAP)
        expect(decoded.params).toEqual([0x80, 0x2c])
    })

    it('layer-tap layer 2 + Esc round-trips', () => {
        const action = buildQmkKeyAction(QMK_KIND.LAYER_TAP, [2, 0x29])
        const kc = encodeKeycode(action)
        expect(kc).toBe(0x4000 | (2 << 8) | 0x29)
        expect(decodeKeycode(kc)).toEqual({
            kind: QMK_KIND.LAYER_TAP,
            params: [2, 0x29],
        })
    })

    it('momentary layer 3 round-trips', () => {
        const action = buildQmkKeyAction(QMK_KIND.MOMENTARY, [3])
        const kc = encodeKeycode(action)
        expect(kc).toBe(0x5223)
        expect(decodeKeycode(kc)).toEqual({
            kind: QMK_KIND.MOMENTARY,
            params: [3],
        })
    })

    it('toggle-layer 1 round-trips', () => {
        const kc = encodeKeycode(buildQmkKeyAction(QMK_KIND.TOGGLE_LAYER, [1]))
        expect(kc).toBe(0x5261)
        expect(decodeKeycode(kc)).toEqual({
            kind: QMK_KIND.TOGGLE_LAYER,
            params: [1],
        })
    })

    it('to-layer 2 round-trips', () => {
        const kc = encodeKeycode(buildQmkKeyAction(QMK_KIND.TO_LAYER, [2]))
        expect(kc).toBe(0x5202)
        expect(decodeKeycode(kc)).toEqual({
            kind: QMK_KIND.TO_LAYER,
            params: [2],
        })
    })

    it('default-layer 4 round-trips', () => {
        const kc = encodeKeycode(buildQmkKeyAction(QMK_KIND.DEFAULT_LAYER, [4]))
        expect(kc).toBe(0x5244)
        expect(decodeKeycode(kc).kind).toBe(QMK_KIND.DEFAULT_LAYER)
    })

    it('one-shot-layer 5 round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.ONE_SHOT_LAYER, [5]),
        )
        expect(kc).toBe(0x5285)
        const dec = decodeKeycode(kc)
        expect(dec.kind).toBe(QMK_KIND.ONE_SHOT_LAYER)
        expect(dec.params).toEqual([5])
    })

    it('one-shot-mod LSHIFT round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.ONE_SHOT_MOD, [0x02]),
        )
        expect(kc).toBe(0x52a0 | 0b00010)
        const dec = decodeKeycode(kc)
        expect(dec.kind).toBe(QMK_KIND.ONE_SHOT_MOD)
        expect(dec.params).toEqual([0x02])
    })

    it('layer-mod L1 + LCTL round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.LAYER_MOD, [1, 0x01]),
        )
        // QK_LAYER_MOD=0x5000 | (layer<<5) | mod_packed
        expect(kc).toBe(0x5000 | (1 << 5) | 0b00001)
        const dec = decodeKeycode(kc)
        expect(dec.kind).toBe(QMK_KIND.LAYER_MOD)
        expect(dec.params).toEqual([1, 0x01])
    })

    it('tap-toggle-layer 6 round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.TAP_TOGGLE_LAYER, [6]),
        )
        expect(kc).toBe(0x52c6)
        const dec = decodeKeycode(kc)
        expect(dec.kind).toBe(QMK_KIND.TAP_TOGGLE_LAYER)
    })

    it('persistent-default-layer 3 round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.PERSISTENT_DEFAULT_LAYER, [3]),
        )
        expect(kc).toBe(0x52e3)
        expect(decodeKeycode(kc).kind).toBe(QMK_KIND.PERSISTENT_DEFAULT_LAYER)
    })

    it('swap-hands-tap A round-trips', () => {
        const kc = encodeKeycode(
            buildQmkKeyAction(QMK_KIND.SWAP_HANDS_TAP, [0x04]),
        )
        expect(kc).toBe(0x5604)
        const dec = decodeKeycode(kc)
        expect(dec.kind).toBe(QMK_KIND.SWAP_HANDS_TAP)
        expect(dec.params).toEqual([0x04])
    })

    it('label uses layer name when available', () => {
        const action = buildQmkKeyAction(
            QMK_KIND.MOMENTARY,
            [1],
            ['Base', 'Lower'],
        )
        expect(action.label.paramText).toContain('Lower')
        // The action-type name stays in the header slot, not the key legend.
        expect(action.label.primary).toBe('Momentary Layer')
    })

    it('binding code carries the symbolic QMK keycode', () => {
        expect(buildQmkKeyAction(QMK_KIND.BASIC, [0x14]).label.bindingPrefix)
            .toBe('KC_Q')
        expect(buildQmkKeyAction(QMK_KIND.MOMENTARY, [3]).label.bindingPrefix)
            .toBe('MO(3)')
        expect(
            buildQmkKeyAction(QMK_KIND.MOD_TAP, [0x02, 0x04]).label
                .bindingPrefix,
        ).toBe('MT(KC_LSFT, KC_A)')
        // Keychron vendor range arrives as a BASIC keycode.
        expect(buildQmkKeyAction(QMK_KIND.BASIC, [0x7e0c]).label.bindingPrefix)
            .toBe('QK_KB_12')
    })

    it('label falls back to hex for unknown basic codes', () => {
        const a = buildQmkKeyAction(QMK_KIND.BASIC, [0xab])
        expect(a.label.paramText).toMatch(/0xab/i)
    })
})
