// Pattern check: no GoF pattern (-) — rejected — unit tests for the keymap.c emitter; string-shape assertions.
import { describe, expect, it } from 'vitest'

import type { Keymap } from '@firmware/types'

import { buildQmkKeyAction, QMK_KIND } from './actions'
import { emitKeymapC } from './export'

function makeKeymap(): Keymap {
    const layer0 = [
        buildQmkKeyAction(QMK_KIND.BASIC, [0x04]), // A
        buildQmkKeyAction(QMK_KIND.BASIC, [0x05]), // B
        buildQmkKeyAction(QMK_KIND.MOD_TAP, [0x02, 0x29]), // MT(LSHIFT, ESC)
        buildQmkKeyAction(QMK_KIND.MOMENTARY, [1]), // MO(1)
    ]
    const layer1 = [
        buildQmkKeyAction(QMK_KIND.TRANS, []),
        buildQmkKeyAction(QMK_KIND.TRANS, []),
        buildQmkKeyAction(QMK_KIND.TRANS, []),
        buildQmkKeyAction(QMK_KIND.NONE, []),
    ]
    return {
        layers: [
            { id: 0, name: 'Base', keys: layer0 },
            { id: 1, name: 'Lower', keys: layer1 },
        ],
        availableLayers: 0,
        activeLayoutId: 0,
        layouts: [{ id: 0, name: 'Default', keys: [] }],
    }
}

describe('qmk/export — keymap.c emitter', () => {
    it('includes header + LAYOUT macro per layer', () => {
        const out = emitKeymapC(makeKeymap(), 'Test Keyboard')
        expect(out).toContain('#include QMK_KEYBOARD_H')
        expect(out).toContain('keymaps[][MATRIX_ROWS][MATRIX_COLS]')
        expect(out).toContain('[0] = LAYOUT')
        expect(out).toContain('[1] = LAYOUT')
        expect(out).toContain('// Base')
        expect(out).toContain('// Lower')
    })

    it('uses symbolic names for known basic keys', () => {
        const out = emitKeymapC(makeKeymap(), 'Test')
        expect(out).toContain('KC_A')
        expect(out).toContain('KC_B')
        expect(out).toContain('KC_TRNS')
        expect(out).toContain('KC_NO')
    })

    it('emits MT()/MO() macros for composite kinds', () => {
        const out = emitKeymapC(makeKeymap(), 'Test')
        expect(out).toContain('MT(KC_LSFT, KC_ESC)')
        expect(out).toContain('MO(1)')
    })
})
