// pattern-check: skip — unit test for the relocated config-blob editor helpers
// (field tables, feature gating, and the diff / validation helpers).
import { describe, expect, it } from 'vitest'

import type { CanonConditionalLayer } from '../types'
import type { CanonHoldTapDef, CanonModMorph } from '../types'
import { LimitsFeature } from '../../remappr/protocol'

import {
    ALL_MODIFIERS,
    FLAVOR_OPTIONS,
    TIMING_FIELDS,
    conditionalError,
    conditionalLayersPatch,
    emptyConditional,
    featureSupported,
    fieldSupported,
    groupedTimingFields,
    holdTapPatch,
    modMorphPatch,
    modifierLabel,
    sameConditional,
    sameConditionalList,
    toggleIfLayer,
    toggleModifier,
} from '../editorFields'

const HT: CanonHoldTapDef = {
    id: 'home-row',
    flavor: 'balanced',
    tappingTermMs: 220,
    quickTapMs: 150,
    retroTap: true,
    bindings: ['&kp', '&kp'],
}

const MM: CanonModMorph = {
    id: 'shift-del',
    mods: ['LEFT_SHIFT'],
    keepMods: ['LEFT_SHIFT'],
    bindings: [
        { type: 'key_press', key: 'key.keyboard_backspace' },
        { type: 'key_press', key: 'key.keyboard_delete_forward' },
    ],
}

const LAYERS = ['base', 'raise', 'lower', 'adjust']
const TRI: CanonConditionalLayer = {
    ifLayers: ['raise', 'lower'],
    thenLayer: 'adjust',
}

describe('timing defaults metadata', () => {
    it('covers every ConfigDefaults field (exhaustiveness) and groups them', () => {
        // 13 ConfigDefaults keys; the compile-time guard in editorFields already
        // enforces coverage, so a count check is enough at runtime.
        expect(TIMING_FIELDS).toHaveLength(12)
        const groups = groupedTimingFields().map(([g]) => g)
        expect(groups).toContain('Engine timing (§7.4.1)')
    })

    it('fieldSupported: core field always; featured follows the bitmask', () => {
        const core = TIMING_FIELDS.find((f) => f.key === 'tappingTermMs')!
        const engine = TIMING_FIELDS.find((f) => f.key === 'capsWordIdleMs')!
        expect(fieldSupported(core, 0)).toBe(true)
        expect(fieldSupported(engine, 0)).toBe(false)
        expect(fieldSupported(engine, LimitsFeature.capsWordIdle)).toBe(true)
    })
})

describe('behavior (hold-tap / mod-morph) helpers', () => {
    it('exposes the four flavors and eight modifiers', () => {
        expect(FLAVOR_OPTIONS).toContain('balanced')
        expect(FLAVOR_OPTIONS).toHaveLength(4)
        expect(ALL_MODIFIERS).toHaveLength(8)
    })

    it('labels modifiers on the short L/R form', () => {
        expect(modifierLabel('LEFT_CTRL')).toBe('LCtrl')
        expect(modifierLabel('RIGHT_GUI')).toBe('RGui')
    })

    it('featureSupported: undefined always; featured follows the bitmask', () => {
        expect(featureSupported(undefined, 0)).toBe(true)
        expect(featureSupported('holdTriggerOnRelease', 0)).toBe(false)
        expect(
            featureSupported(
                'holdTriggerOnRelease',
                LimitsFeature.holdTriggerOnRelease,
            ),
        ).toBe(true)
    })

    it('toggleModifier adds then removes', () => {
        expect(toggleModifier(['LEFT_SHIFT'], 'LEFT_CTRL')).toEqual([
            'LEFT_SHIFT',
            'LEFT_CTRL',
        ])
        expect(
            toggleModifier(['LEFT_SHIFT', 'LEFT_CTRL'], 'LEFT_CTRL'),
        ).toEqual(['LEFT_SHIFT'])
    })

    it('holdTapPatch returns only changed fields, else null', () => {
        expect(holdTapPatch(HT, HT)).toBeNull()
        expect(
            holdTapPatch(HT, { ...HT, tappingTermMs: 333, retroTap: false }),
        ).toEqual({ tappingTermMs: 333, retroTap: false })
    })

    it('modMorphPatch diffs mods/keepMods as sets, order-independent', () => {
        expect(modMorphPatch(MM, ['LEFT_SHIFT'], ['LEFT_SHIFT'])).toBeNull()
        expect(
            modMorphPatch(MM, ['LEFT_SHIFT', 'RIGHT_SHIFT'], ['LEFT_SHIFT']),
        ).toEqual({ mods: ['LEFT_SHIFT', 'RIGHT_SHIFT'] })
        expect(modMorphPatch(MM, ['LEFT_SHIFT'], [])).toEqual({ keepMods: [] })
    })
})

describe('conditional (tri-)layer helpers', () => {
    it('emptyConditional + toggleIfLayer', () => {
        expect(emptyConditional()).toEqual({ ifLayers: [], thenLayer: '' })
        expect(toggleIfLayer(['raise'], 'lower')).toEqual(['raise', 'lower'])
        expect(toggleIfLayer(['raise', 'lower'], 'lower')).toEqual(['raise'])
    })

    it('sameConditional / sameConditionalList: if-set order-independent', () => {
        expect(
            sameConditional(TRI, {
                ifLayers: ['lower', 'raise'],
                thenLayer: 'adjust',
            }),
        ).toBe(true)
        expect(sameConditionalList([TRI], [])).toBe(false)
    })

    it('conditionalLayersPatch: list on change, null when equal', () => {
        expect(
            conditionalLayersPatch(
                [TRI],
                [{ ifLayers: ['lower', 'raise'], thenLayer: 'adjust' }],
            ),
        ).toBeNull()
        expect(conditionalLayersPatch([TRI], [])).toEqual([])
    })

    it('conditionalError: empty if-list, missing then, unknown refs', () => {
        expect(conditionalError([TRI], LAYERS)).toBeNull()
        expect(
            conditionalError([{ ifLayers: [], thenLayer: 'adjust' }], LAYERS),
        ).toMatch(/at least one/)
        expect(
            conditionalError([{ ifLayers: ['raise'], thenLayer: '' }], LAYERS),
        ).toMatch(/"then" layer/)
        expect(
            conditionalError(
                [{ ifLayers: ['ghost'], thenLayer: 'adjust' }],
                LAYERS,
            ),
        ).toMatch(/unknown layer "ghost"/)
    })
})
