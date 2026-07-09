// Pattern check: no GoF pattern (-) — rejected — unit tests over the ZMK
// behavior→ActionType adapter; test code, no design pattern.
//
// Regression coverage for issue #148: &bt BT_SEL <profile> must be reachable.
// Real ZMK splits &bt across several metadata sets (no-arg commands + a
// BT_SEL/BT_DISC set carrying the profile range); behaviorToActionType must
// merge them rather than reading only metadata[0].
import { describe, expect, it } from 'vitest'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import { behaviorToActionType, synthesizeMouseActionType } from '../actionTypes'
import { zmkCommandLegend, zmkShortMap } from '../paramLabel'
import { BT, MT, OUT } from './behaviorFixtures'

describe('behaviorToActionType — &bt multi-set merge (issue #148)', () => {
    const at = behaviorToActionType(BT)

    it('exposes both the command and profile slots', () => {
        expect(at.slots).toHaveLength(2)
    })

    it('command slot is an enum that includes BT_SEL', () => {
        const cmd = at.slots[0]
        expect(cmd.kind).toBe('enum')
        expect(cmd.values).toEqual(
            expect.arrayContaining([
                { value: 3, label: 'BT_SEL', icon: 'bluetooth' },
            ]),
        )
        // every command survives the merge, including those in non-first sets
        const values = cmd.values?.map((v) => v.value).sort((a, b) => a - b)
        expect(values).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('attaches the behavior icon and per-command enum icons (issue #147)', () => {
        expect(at.icon).toBe('bluetooth')
        const byLabel = Object.fromEntries(
            (at.slots[0].values ?? []).map((v) => [v.label, v.icon]),
        )
        expect(byLabel['BT_NXT']).toBe('next')
        expect(byLabel['BT_DISC']).toBe('disconnect')
    })

    it('profile slot is a range gated on BT_SEL / BT_DISC', () => {
        const prof = at.slots[1]
        expect(prof.kind).toBe('number')
        expect(prof.range).toEqual({ min: 0, max: 4 })
        expect(prof.enabledFor).toEqual([3, 5])
        // &bt's profile is 0-based on the wire but shown one-based in the UI.
        expect(prof.oneBased).toBe(true)
    })

    it('labels command-style slots by role, not Hold / Tap', () => {
        expect(at.slots[0].label).toBe('Command')
        expect(at.slots[1].label).toBe('profile')
    })
})

describe('behaviorToActionType — merges params from non-first sets', () => {
    const twoSet: GetBehaviorDetailsResponse = {
        id: 99,
        displayName: 'Two Set',
        metadata: [
            {
                param1: [{ name: 'A', constant: 0 }],
                param2: [{ name: '', nil: {} }],
            },
            {
                param1: [{ name: 'B', constant: 1 }],
                param2: [{ name: 'idx', range: { min: 0, max: 9 } }],
            },
        ],
    }

    it('unions param1 across sets and gates the conditional param2', () => {
        const at = behaviorToActionType(twoSet)
        expect(at.slots[0].values).toEqual([
            { value: 0, label: 'A' },
            { value: 1, label: 'B' },
        ])
        expect(at.slots[1].kind).toBe('number')
        expect(at.slots[1].range).toEqual({ min: 0, max: 9 })
        expect(at.slots[1].enabledFor).toEqual([1])
        // One-based display is keyed on &bt identity, not on gated numbers —
        // an unrelated behavior's numeric param stays 0-based.
        expect(at.slots[1].oneBased).toBeUndefined()
    })
})

describe('behaviorToActionType — genuine hold-taps unaffected', () => {
    it('&mt keeps Hold / Tap labels and no gating', () => {
        const at = behaviorToActionType(MT)
        expect(at.slots).toHaveLength(2)
        expect(at.slots[0].label).toBe('Hold')
        expect(at.slots[1].label).toBe('Tap')
        expect(at.slots[1].enabledFor).toBeUndefined()
    })

    it('single-enum &out stays one slot with no gating', () => {
        const at = behaviorToActionType(OUT)
        expect(at.slots).toHaveLength(1)
        expect(at.slots[0].kind).toBe('enum')
        expect(at.slots[0].enabledFor).toBeUndefined()
    })
})

// Real ZMK reports each command value's `name` as a friendly phrase
// ("Next Profile"), not the C token the fixtures use — so command icons must
// resolve by the stable (behavior &prefix, constant), never by the name.
describe('ZMK command icons from friendly hardware value names (issue #147)', () => {
    // Bluetooth exactly as a live device reports it: friendly names, real
    // constants, split across sets (Select/Disconnect carry a profile).
    const BT_FRIENDLY: GetBehaviorDetailsResponse = {
        id: 200,
        displayName: 'Bluetooth',
        metadata: [
            {
                param1: [
                    { name: 'Clear Selected Profile', constant: 0 },
                    { name: 'Next Profile', constant: 1 },
                    { name: 'Previous Profile', constant: 2 },
                    { name: 'Clear All Profiles', constant: 4 },
                ],
                param2: [{ name: '', nil: {} }],
            },
            {
                param1: [{ name: 'Select Profile', constant: 3 }],
                param2: [{ name: 'profile', range: { min: 0, max: 4 } }],
            },
            {
                param1: [{ name: 'Disconnect Profile', constant: 5 }],
                param2: [{ name: 'profile', range: { min: 0, max: 4 } }],
            },
        ],
    }

    it('attaches command icons by constant, not by the friendly name', () => {
        const at = behaviorToActionType(BT_FRIENDLY)
        expect(at.icon).toBe('bluetooth')
        const byLabel = Object.fromEntries(
            (at.slots[0].values ?? []).map((v) => [v.label, v.icon]),
        )
        expect(byLabel['Next Profile']).toBe('next')
        expect(byLabel['Previous Profile']).toBe('prev')
        expect(byLabel['Clear All Profiles']).toBe('clear-all')
        expect(byLabel['Clear Selected Profile']).toBe('clear')
        expect(byLabel['Select Profile']).toBe('bluetooth')
        expect(byLabel['Disconnect Profile']).toBe('disconnect')
    })

    it('zmkCommandLegend resolves by (prefix, constant); fine-grain stays text', () => {
        expect(zmkCommandLegend('&bt', 1)).toEqual({ text: 'Next', icon: 'next' })
        expect(zmkCommandLegend('&rgb_ug', 7)).toEqual({ text: 'Bri+' }) // no icon
        expect(zmkCommandLegend('&bt', 99)).toBeUndefined()
        expect(zmkCommandLegend(undefined, 1)).toBeUndefined()
    })

    it('zmkShortMap keys friendly labels so the cap legend resolves', () => {
        const at = behaviorToActionType(BT_FRIENDLY)
        const map = zmkShortMap('&bt', at.slots[0].values)
        expect(map['Next Profile']).toEqual({ text: 'Next', icon: 'next' })
        expect(map['Select Profile']).toEqual({ text: 'Sel', icon: 'bluetooth' })
        // Token entries survive so the mock's token-labeled path is unaffected.
        expect(map['BT_NXT']).toEqual({ text: 'Next', icon: 'next' })
    })

    it('token-named values keep their token legend (mock / fixtures unaffected)', () => {
        // The Backlight fixture uses tokens whose constants differ from a live
        // device (0 = BL_TOG there, but 0 = On on hardware); the token map must
        // win so those existing tests stay stable.
        const map = zmkShortMap('&bl', [{ value: 0, label: 'BL_TOG' }])
        expect(map['BL_TOG']).toEqual({ text: 'Tog', icon: 'toggle' })
    })
})

// Mouse behaviors as a live device reports them: &mkp is an enum (MB1..MB5);
// mouse move/scroll surface under lowercase DT node names with NO param slots.
describe('ZMK mouse behaviors (issue #147)', () => {
    const MKP: GetBehaviorDetailsResponse = {
        id: 250,
        displayName: 'Mouse Key Press',
        metadata: [
            {
                param1: [
                    { name: 'MB1', constant: 1 },
                    { name: 'MB2', constant: 2 },
                    { name: 'MB3', constant: 4 },
                    { name: 'MB4', constant: 8 },
                    { name: 'MB5', constant: 16 },
                ],
                param2: [{ name: '', nil: {} }],
            },
        ],
    }
    const MMV: GetBehaviorDetailsResponse = {
        id: 251,
        displayName: 'mouse_move', // DT node name, not a friendly display name
        metadata: [
            { param1: [{ name: '', nil: {} }], param2: [{ name: '', nil: {} }] },
        ],
    }

    it('Mouse Key Press → mouse-button icon + left/right button glyphs', () => {
        const at = behaviorToActionType(MKP)
        expect(at.icon).toBe('mouse-button')
        const byLabel = Object.fromEntries(
            (at.slots[0].values ?? []).map((v) => [v.label, v.icon]),
        )
        expect(byLabel['MB1']).toBe('mouse-left')
        expect(byLabel['MB2']).toBe('mouse-right')
        expect(byLabel['MB3']).toBe('mouse')
        expect(byLabel['MB4']).toBeUndefined() // text only
    })

    it('node-name "mouse_move" resolves to &mmv (mouse-move icon, not a macro)', () => {
        const at = behaviorToActionType(MMV)
        expect(at.icon).toBe('mouse-move')
        expect(at.slots).toHaveLength(0) // firmware exposes no direction param
    })

    it('zmkCommandLegend maps the mouse buttons', () => {
        expect(zmkCommandLegend('&mkp', 1)).toEqual({
            text: 'MB1',
            icon: 'mouse-left',
        })
        expect(zmkCommandLegend('&mkp', 2)).toEqual({
            text: 'MB2',
            icon: 'mouse-right',
        })
    })
})

// The unified Mouse behavior: one enum whose values dispatch (via behaviorRef) to
// the real &mkp / &mmv / &msc behaviors, resolved from the live behavior ids.
describe('synthesizeMouseActionType', () => {
    const mkp: GetBehaviorDetailsResponse = {
        id: 5,
        displayName: 'Mouse Button Press',
        metadata: [
            {
                param1: [
                    { name: 'MB1', constant: 1 },
                    { name: 'MB2', constant: 2 },
                    { name: 'MB3', constant: 4 },
                    { name: 'MB4', constant: 8 },
                    { name: 'MB5', constant: 16 },
                ],
                param2: [{ name: '', nil: {} }],
            },
        ],
    }
    // Real hardware exposes &mmv / &msc with no param metadata (nil-only).
    const node = (id: number, displayName: string): GetBehaviorDetailsResponse => ({
        id,
        displayName,
        metadata: [
            { param1: [{ name: '', nil: {} }], param2: [{ name: '', nil: {} }] },
        ],
    })
    const behaviors: Record<number, GetBehaviorDetailsResponse> = {
        5: mkp,
        6: node(6, 'mouse_move'),
        7: node(7, 'mouse_scroll'),
        8: node(8, 'mouse_warp'), // /mouse/i user macro (unknown &slug, no slots)
        9: node(9, 'my_macro'), // unrelated macro — must be ignored
    }
    const at = synthesizeMouseActionType(behaviors)!

    it('produces one Mouse enum type', () => {
        expect(at.id).toBe('mouse')
        expect(at.displayName).toBe('Mouse')
        expect(at.icon).toBe('mouse-button')
        expect(at.slots).toHaveLength(1)
        expect(at.slots[0].kind).toBe('enum')
    })

    it('buttons dispatch to the resolved &mkp id with the HID bitmask', () => {
        const vals = at.slots[0].values ?? []
        const lmb = vals.find((v) => v.label === 'LMB')
        expect(lmb?.icon).toBe('mouse-left')
        expect(lmb?.behaviorRef).toEqual({ kind: '5', params: [1] })
        expect(vals.find((v) => v.label === 'MB5')?.behaviorRef).toEqual({
            kind: '5',
            params: [16],
        })
    })

    it('move / scroll dispatch to &mmv / &msc with packed deltas', () => {
        const vals = at.slots[0].values ?? []
        expect(vals.find((v) => v.label === 'Move →')?.behaviorRef).toEqual({
            kind: '6',
            params: [0x02580000],
        })
        expect(vals.find((v) => v.label === 'Scroll ↓')?.behaviorRef).toEqual({
            kind: '7',
            params: [0x0000fff6],
        })
    })

    it('folds a /mouse/i macro as a command; ignores unrelated macros', () => {
        const vals = at.slots[0].values ?? []
        const labels = vals.map((v) => v.label)
        expect(labels).toContain('mouse_warp')
        expect(labels).not.toContain('my_macro')
        expect(vals.find((v) => v.label === 'mouse_warp')?.behaviorRef).toEqual({
            kind: '8',
            params: [],
        })
    })

    it('gives every value a unique enum key', () => {
        const vals = at.slots[0].values ?? []
        expect(new Set(vals.map((v) => v.value)).size).toBe(vals.length)
    })

    it('returns undefined when no mouse behaviors are present', () => {
        expect(
            synthesizeMouseActionType({ 1: node(1, 'Key Press') }),
        ).toBeUndefined()
    })
})
