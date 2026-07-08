// Pattern check: no GoF pattern (-) — rejected — unit tests over the ZMK
// buildKeyLabel param-legend behavior (issue #147); test code, no pattern.
import { describe, expect, it } from 'vitest'
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap'
import { buildKeyLabel } from '../actions'
import {
    BT,
    KP,
    LT,
    MKP,
    MMV,
    MO,
    MT,
    OUT,
    RGB_UG,
    TO,
    FIXTURE_MAP,
} from './behaviorFixtures'

const keymap = { layers: [{ name: 'Base' }, { name: 'FN1' }, { name: '' }] }

const bind = (
    behaviorId: number,
    param1 = 0,
    param2 = 0,
): BehaviorBinding => ({ behaviorId, param1, param2 }) as BehaviorBinding

const labelOf = (behaviorId: number, p1 = 0, p2 = 0) =>
    buildKeyLabel(bind(behaviorId, p1, p2), FIXTURE_MAP, keymap)

describe('buildKeyLabel — layer behaviors show the layer name', () => {
    it('&mo 1 → paramText "FN1", not a hold-tap', () => {
        const l = labelOf(MO.id, 1)
        expect(l.paramText).toBe('FN1')
        expect(l.holdTap).toBeUndefined()
        expect(l.description).toBe('Momentary Layer: FN1')
    })

    it('&mo 2 (unnamed layer) → "L2"', () => {
        expect(labelOf(MO.id, 2).paramText).toBe('L2')
    })

    it('&to 1 → paramText "FN1"', () => {
        expect(labelOf(TO.id, 1).paramText).toBe('FN1')
    })
})

describe('buildKeyLabel — &bt is command-style, not hold-tap (issue #147/#148)', () => {
    it('BT_SEL index 0 → "BT 1" (profiles shown one-based)', () => {
        const l = labelOf(BT.id, 3, 0)
        expect(l.paramText).toBe('BT 1')
        expect(l.holdTap).toBeUndefined()
    })

    it('BT_DISC index 2 → "Disc 3" (profiles shown one-based)', () => {
        expect(labelOf(BT.id, 5, 2).paramText).toBe('Disc 3')
    })

    it('BT_CLR → "Clr" with no trailing profile', () => {
        expect(labelOf(BT.id, 0).paramText).toBe('Clr')
    })
})

describe('buildKeyLabel — RGB / output / mouse enums', () => {
    it('&rgb_ug RGB_HUI → "Hue+"', () => {
        expect(labelOf(RGB_UG.id, 3).paramText).toBe('Hue+')
    })

    it('&out OUT_USB → "USB"', () => {
        expect(labelOf(OUT.id, 0).paramText).toBe('USB')
    })

    it('&mkp MB1 → "MB1"', () => {
        expect(labelOf(MKP.id, 0x01).paramText).toBe('MB1')
    })

    it('&mmv MOVE_UP → "↑"', () => {
        expect(labelOf(MMV.id, 0x00010000).paramText).toBe('↑')
    })
})

describe('buildKeyLabel — custom behaviors render as Macro', () => {
    // A user macro surfaces over Studio only as its node name with no params —
    // displayNameToBinding yields an &<slug> that isn't a known builtin.
    const macroBehaviors = {
        50: {
            id: 50,
            displayName: 'm_hello',
            metadata: [{ param1: [{ name: '', nil: {} }] }],
        },
    } as unknown as typeof FIXTURE_MAP

    it('&m_hello → header "Macro", legend "m_hello"', () => {
        const l = buildKeyLabel(bind(50), macroBehaviors, keymap)
        expect(l.primary).toBe('Macro')
        expect(l.paramText).toBe('m_hello')
        expect(l.description).toBe('Macro: m_hello')
        expect(l.holdTap).toBeUndefined()
    })

    it('built-in zero-param behaviors keep their own name (not Macro)', () => {
        // Caps Word is a known builtin → header stays "Caps Word".
        const caps = buildKeyLabel(bind(12), FIXTURE_MAP, keymap)
        expect(caps.primary).toBe('Caps Word')
        expect(caps.paramText).toBeUndefined()
    })
})

describe('buildKeyLabel — regressions', () => {
    it('&kp keeps primaryUsage and has no paramText', () => {
        const l = labelOf(KP.id, 0x07_0004)
        expect(l.primaryUsage).toBe(0x07_0004)
        expect(l.paramText).toBeUndefined()
    })

    it('&lt still resolves as a hold-tap with a layer hold', () => {
        const l = labelOf(LT.id, 1, 0x07_0004)
        expect(l.holdTap).toBeDefined()
        expect(l.holdTap?.holdNodeKind).toBe('layer')
        expect(l.paramText).toBeUndefined()
    })

    it('&mt still resolves as a hold-tap with a usage hold', () => {
        const l = labelOf(MT.id, 0x07_00e1, 0x07_0004)
        expect(l.holdTap).toBeDefined()
        expect(l.holdTap?.holdNodeKind).toBe('usage')
    })
})
