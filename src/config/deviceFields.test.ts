// pattern-check: skip — table-driven checks of the editor field tables
import { describe, expect, it } from 'vitest'

import { DongleSettingsSchema } from './device'
import {
    compactSection,
    DONGLE_FIELDS,
    MOUSE_SCROLL_DIVISOR_FIELD,
    RADIO_FIELDS,
} from './deviceFields'
import { MouseSchema, RadioSettingsSchema } from './schema'

type Field = { key: string; min: number; max: number; defaultValue: number }

/** The schema takes the bounds and the default, and refuses one step past. */
function expectRangeMatches(
    parse: (v: Record<string, number>) => { success: boolean },
    f: Field,
): void {
    expect(parse({ [f.key]: f.min }).success).toBe(true)
    expect(parse({ [f.key]: f.max }).success).toBe(true)
    expect(parse({ [f.key]: f.defaultValue }).success).toBe(true)
    expect(parse({ [f.key]: f.min - 1 }).success).toBe(false)
    expect(parse({ [f.key]: f.max + 1 }).success).toBe(false)
}

describe('device editor fields mirror the schemas', () => {
    it.each(DONGLE_FIELDS)('dongle $key', (f) => {
        // The roster horizon may not sit below the failsafe; hold the failsafe
        // at its minimum so only the field's own range is tested.
        const parse = (v: Record<string, number>) =>
            DongleSettingsSchema.safeParse(
                f.key === 'rosterLiveMs' ? { failsafeMs: 50, ...v } : v,
            )
        expectRangeMatches(parse, f)
    })

    it.each(RADIO_FIELDS)('radio $key', (f) => {
        expectRangeMatches((v) => RadioSettingsSchema.safeParse(v), f)
    })

    it('mouse scroll divisor', () => {
        expectRangeMatches(
            (v) => MouseSchema.safeParse(v),
            MOUSE_SCROLL_DIVISOR_FIELD,
        )
    })
})

describe('compactSection', () => {
    it('drops undefined fields and keeps false / 0', () => {
        expect(
            compactSection({ nkro: false, failsafeMs: undefined, hidSubmitTimeoutMs: 0 }),
        ).toEqual({ nkro: false, hidSubmitTimeoutMs: 0 })
    })

    it('is undefined when nothing is set', () => {
        expect(compactSection({ nkro: undefined })).toBeUndefined()
    })
})
