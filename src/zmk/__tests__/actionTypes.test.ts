// Pattern check: no GoF pattern (-) — rejected — unit tests over the ZMK
// behavior→ActionType adapter; test code, no design pattern.
//
// Regression coverage for issue #148: &bt BT_SEL <profile> must be reachable.
// Real ZMK splits &bt across several metadata sets (no-arg commands + a
// BT_SEL/BT_DISC set carrying the profile range); behaviorToActionType must
// merge them rather than reading only metadata[0].
import { describe, expect, it } from 'vitest'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import { behaviorToActionType } from '../actionTypes'
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
            expect.arrayContaining([{ value: 3, label: 'BT_SEL' }]),
        )
        // every command survives the merge, including those in non-first sets
        const values = cmd.values?.map((v) => v.value).sort((a, b) => a - b)
        expect(values).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('profile slot is a range gated on BT_SEL / BT_DISC', () => {
        const prof = at.slots[1]
        expect(prof.kind).toBe('number')
        expect(prof.range).toEqual({ min: 0, max: 4 })
        expect(prof.enabledFor).toEqual([3, 5])
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
