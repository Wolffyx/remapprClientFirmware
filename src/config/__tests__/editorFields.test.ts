// pattern-check: skip — unit test for the relocated config-blob editor helpers
// (field tables, feature gating, and the diff / validation helpers).
import { describe, expect, it } from 'vitest'

import type { CanonConditionalLayer } from '../types'
import type { CanonHoldTapDef, CanonModMorph } from '../types'
import { LimitsFeature } from '../../remappr/protocol'

import {
    ALL_MODIFIERS,
    autocorrectError,
    withDefaultAutocorrect,
    FLAVOR_OPTIONS,
    HOLD_TAP_BEHAVIOR_TOKENS,
    TIMING_FIELDS,
    conditionalError,
    conditionalLayersPatch,
    emptyConditional,
    emptyHoldTap,
    emptyModMorph,
    featureSupported,
    fieldSupported,
    groupedTimingFields,
    holdTapPatch,
    modMorphPatch,
    modifierLabel,
    nextDefId,
    sameConditional,
    sameConditionalList,
    toggleIfLayer,
    toggleModifier,
    ROLE_OPTIONS,
    FORWARD_MODE_OPTIONS,
    CLUSTER_UID_MAX_HEX,
    emptyClusterNode,
    clusterError,
    LINK_PROFILE_OPTIONS,
    LINK_KNOB_FIELDS,
    emptyLinkProfile,
    linkKnobValue,
    linkKnobRange,
    withLinkOverride,
    linkProfileError,
} from '../editorFields'
import { HoldTapDefSchema, ModMorphSchema } from '../schema'

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

describe('behavior def factories', () => {
    it('emptyHoldTap is a schema-valid balanced mod-tap', () => {
        const ht = emptyHoldTap([])
        expect(() => HoldTapDefSchema.parse(ht)).not.toThrow()
        expect(ht.flavor).toBe('balanced')
        expect(ht.bindings).toEqual(['&kp', '&kp'])
    })

    it('emptyModMorph is a schema-valid Shift morph with two bindings', () => {
        const mm = emptyModMorph([])
        expect(() => ModMorphSchema.parse(mm)).not.toThrow()
        expect(mm.mods).toContain('LEFT_SHIFT')
        expect(mm.bindings).toHaveLength(2)
    })

    it('factory ids avoid collisions with the existing pool', () => {
        const a = emptyHoldTap([])
        const b = emptyHoldTap([a])
        expect(b.id).not.toBe(a.id)
        const m = emptyModMorph([])
        expect(emptyModMorph([m]).id).not.toBe(m.id)
    })

    it('nextDefId skips ids already taken', () => {
        expect(nextDefId('ht_', [])).toBe('ht_1')
        expect(nextDefId('ht_', [{ id: 'ht_1' }])).toBe('ht_2')
        // count-derived guess (ht_3) is taken, so it advances past it
        expect(nextDefId('ht_', [{ id: 'x' }, { id: 'ht_3' }])).toBe('ht_4')
    })

    it('behavior tokens include the common ZMK inners', () => {
        const vals = HOLD_TAP_BEHAVIOR_TOKENS.map((t) => t.value)
        expect(vals).toContain('&kp')
        expect(vals).toContain('&mo')
    })
})

describe('node role / mode-A cluster editor metadata (§N4b/§N4c)', () => {
    it('offers the two node-bus roles and forward modes', () => {
        expect(ROLE_OPTIONS.map((o) => o.value)).toEqual([
            'coordinator',
            'follower',
        ])
        expect(FORWARD_MODE_OPTIONS.map((o) => o.value)).toEqual([
            'resolved',
            'physical',
        ])
    })

    it('emptyClusterNode is a valid single-key row', () => {
        const n = emptyClusterNode()
        expect(n).toEqual({ uid: '', positionBase: 0, rows: 1, cols: 1 })
        // ... but empty until a UID is entered, so it does not yet validate.
        expect(clusterError([n])).toMatch(/UID/)
    })

    it('accepts a well-formed cluster map', () => {
        expect(
            clusterError([
                { uid: 'deadbeef', positionBase: 0, rows: 6, cols: 5 },
                { uid: '0102', positionBase: 30, rows: 4, cols: 4, encoderBase: 2 },
            ]),
        ).toBeNull()
    })

    it('rejects a UID that is not whole hex bytes', () => {
        expect(clusterError([{ uid: 'abc', positionBase: 0, rows: 1, cols: 1 }])).toMatch(
            /even hex length/,
        )
        expect(clusterError([{ uid: 'xy', positionBase: 0, rows: 1, cols: 1 }])).toMatch(
            /hex/,
        )
        expect(
            clusterError([
                { uid: 'a'.repeat(CLUSTER_UID_MAX_HEX + 2), positionBase: 0, rows: 1, cols: 1 },
            ]),
        ).toMatch(/longer than/)
    })

    it('rejects a duplicate UID (it would shadow a node on the coordinator)', () => {
        expect(
            clusterError([
                { uid: 'deadbeef', positionBase: 0, rows: 1, cols: 1 },
                { uid: 'DEADBEEF', positionBase: 1, rows: 1, cols: 1 },
            ]),
        ).toMatch(/duplicate/i)
    })

    it('rejects dims and a base that overrun the u16 position space', () => {
        expect(clusterError([{ uid: 'ab', positionBase: 0, rows: 0, cols: 1 }])).toMatch(
            /rows/,
        )
        expect(
            clusterError([{ uid: 'ab', positionBase: 0xfffe, rows: 2, cols: 2 }]),
        ).toMatch(/overruns/)
    })
})

describe('link/latency profile helpers (§8 N6)', () => {
    it('offers the three base profiles and eight knobs', () => {
        expect(LINK_PROFILE_OPTIONS.map((o) => o.value)).toEqual([
            'balanced',
            'gaming',
            'powerSave',
        ])
        expect(LINK_KNOB_FIELDS).toHaveLength(8)
        expect(LINK_KNOB_FIELDS.map((f) => f.knob)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7,
        ])
    })

    it('emptyLinkProfile is balanced with no overrides', () => {
        expect(emptyLinkProfile()).toEqual({ profile: 'balanced' })
    })

    it('linkKnobValue returns the base default, then the override', () => {
        const lp = emptyLinkProfile()
        expect(linkKnobValue(lp, 0)).toBe(1000000) // balanced baud
        expect(linkKnobValue({ profile: 'gaming' }, 0)).toBe(2000000)
        expect(
            linkKnobValue({ profile: 'balanced', overrides: [{ knob: 0, value: 500000 }] }, 0),
        ).toBe(500000)
    })

    it('withLinkOverride adds, replaces, drops-at-default, and keeps knobs sorted', () => {
        const a = withLinkOverride(emptyLinkProfile(), 2, 200) // heartbeat 100→200
        expect(a.overrides).toEqual([{ knob: 2, value: 200 }])
        const b = withLinkOverride(a, 0, 500000) // add baud, sorted before knob 2
        expect(b.overrides).toEqual([
            { knob: 0, value: 500000 },
            { knob: 2, value: 200 },
        ])
        const c = withLinkOverride(b, 2, 100) // back to the base default → dropped
        expect(c.overrides).toEqual([{ knob: 0, value: 500000 }])
        const d = withLinkOverride(c, 0, 1000000) // baud back to base → no overrides
        expect(d).toEqual({ profile: 'balanced' })
    })

    it('linkKnobRange prefers live GET_LINK_LIMITS, else the static table', () => {
        expect(linkKnobRange(0)).toEqual({ min: 115200, max: 2000000 })
        expect(linkKnobRange(0, [{ knob: 0, min: 200000, max: 900000 }])).toEqual({
            min: 200000,
            max: 900000,
        })
    })

    it('accepts a valid profile and the base defaults', () => {
        expect(linkProfileError(emptyLinkProfile())).toBeNull()
        expect(linkProfileError({ profile: 'gaming' })).toBeNull()
        expect(
            linkProfileError({ profile: 'balanced', overrides: [{ knob: 0, value: 500000 }] }),
        ).toBeNull()
    })

    it('rejects an out-of-range override (static table)', () => {
        expect(
            linkProfileError({ profile: 'balanced', overrides: [{ knob: 0, value: 50 }] }),
        ).toMatch(/USART baud/)
    })

    it('rejects a value outside the live GET_LINK_LIMITS range', () => {
        // 1 000 000 is fine statically but over the live max of 900 000.
        expect(
            linkProfileError(
                { profile: 'balanced', overrides: [{ knob: 0, value: 1000000 }] },
                [{ knob: 0, min: 200000, max: 900000 }],
            ),
        ).toMatch(/USART baud/)
    })

    it('enforces the two cross-knob dependency rules', () => {
        // candidacy (40) < heartbeat (100) → depend error.
        expect(
            linkProfileError({ profile: 'balanced', overrides: [{ knob: 4, value: 40 }] }),
        ).toMatch(/Candidacy/)
        // handover (500) < demotion (1000) → depend error.
        expect(
            linkProfileError({ profile: 'balanced', overrides: [{ knob: 6, value: 500 }] }),
        ).toMatch(/Handover/)
    })
})

describe('autocorrect dictionary editor helpers', () => {
    it('accepts a well-formed dictionary', () => {
        expect(
            autocorrectError([
                { typo: 'teh', correction: 'the' },
                { typo: 'Recieve', correction: 'Receive' },
            ]),
        ).toBeNull()
    })

    it('names the row for each rule the device would enforce', () => {
        expect(autocorrectError([{ typo: '', correction: 'the' }])).toMatch(
            /Entry 1: enter the misspelling/,
        )
        expect(
            autocorrectError([{ typo: 'te h', correction: 'the' }]),
        ).toMatch(/Entry 1: a typo may only/)
        expect(
            autocorrectError([{ typo: 'x'.repeat(25), correction: 'the' }]),
        ).toMatch(/longer than the 24 characters/)
        expect(autocorrectError([{ typo: 'teh', correction: '' }])).toMatch(
            /Entry 1: enter what "teh"/,
        )
        expect(
            autocorrectError([{ typo: 'teh', correction: 'a lot' }]),
        ).toMatch(/no spaces/)
        expect(
            autocorrectError([{ typo: 'teh', correction: 'Teh' }]),
        ).toMatch(/corrects to itself/)
        expect(
            autocorrectError([
                { typo: 'teh', correction: 'the' },
                { typo: 'TEH', correction: 'them' },
            ]),
        ).toMatch(/Entry 2: "teh" is listed twice/)
    })

    it('merges the starter list without touching what the user wrote, twice over', () => {
        const mine = [{ typo: 'teh', correction: 'THE' }]
        const once = withDefaultAutocorrect(mine)
        const twice = withDefaultAutocorrect(once)

        expect(once[0]).toEqual({ typo: 'teh', correction: 'THE' })
        expect(once.length).toBeGreaterThan(mine.length)
        expect(twice).toEqual(once)
        expect(autocorrectError(once)).toBeNull()
    })
})
