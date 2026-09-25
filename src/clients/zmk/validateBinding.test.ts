// pattern-check: skip — table-driven tests for a pure predicate, no abstraction
import { describe, it, expect } from 'vitest'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import { canSetZmkBinding } from './validateBinding'
import { hidUsageFromPageAndId } from '@firmware/_app/lib/actions/hidUsages'

const behavior = (
    metadata: GetBehaviorDetailsResponse['metadata'],
): GetBehaviorDetailsResponse =>
    ({ id: 1, displayName: 'Test', metadata }) as GetBehaviorDetailsResponse

describe('canSetZmkBinding', () => {
    it('rejects an unknown behavior', () => {
        expect(canSetZmkBinding(undefined, 0, 0, 8)).toBe(false)
    })

    describe('no metadata sets (&ext_power, &mmv, &msc, parameterized macros)', () => {
        const none = behavior([])

        it('accepts the zero binding', () => {
            expect(canSetZmkBinding(none, 0, 0, 8)).toBe(true)
        })

        it('rejects any non-zero parameter — the reported restore failure', () => {
            // &ext_power EP_TOG on the failing device: params [2, 0].
            expect(canSetZmkBinding(none, 2, 0, 8)).toBe(false)
            expect(canSetZmkBinding(none, 0, 3, 8)).toBe(false)
        })

        it('treats absent metadata the same as an empty list', () => {
            const undef = {
                id: 1,
                displayName: 'Test',
            } as GetBehaviorDetailsResponse
            expect(canSetZmkBinding(undef, 0, 0, 8)).toBe(true)
            expect(canSetZmkBinding(undef, 1, 0, 8)).toBe(false)
        })
    })

    it('matches a constant value', () => {
        const b = behavior([{ param1: [{ name: 'ON', constant: 4 }], param2: [] }])
        expect(canSetZmkBinding(b, 4, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 5, 0, 8)).toBe(false)
    })

    it('matches a range, inclusive of both bounds', () => {
        const b = behavior([
            { param1: [{ name: 'n', range: { min: 1, max: 3 } }], param2: [] },
        ])
        expect(canSetZmkBinding(b, 1, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 3, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 4, 0, 8)).toBe(false)
        expect(canSetZmkBinding(b, 0, 0, 8)).toBe(false)
    })

    it('bounds a layer id by the keymap length', () => {
        const b = behavior([{ param1: [{ name: 'layer', layerId: {} }], param2: [] }])
        expect(canSetZmkBinding(b, 7, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 8, 0, 8)).toBe(false)
    })

    it('accepts a HID usage inside the device-reported maxima', () => {
        const b = behavior([
            {
                param1: [
                    {
                        name: 'key',
                        hidUsage: { keyboardMax: 0xa4, consumerMax: 0xff },
                    },
                ],
                param2: [],
            },
        ])
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x07, 0x04), 0, 8)).toBe(
            true,
        )
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x07, 0x00), 0, 8)).toBe(
            false,
        )
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x07, 0xff), 0, 8)).toBe(
            false,
        )
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x0c, 0xe9), 0, 8)).toBe(
            true,
        )
        // A page ZMK's validate_hid_usage does not handle.
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x01, 0x30), 0, 8)).toBe(
            false,
        )
    })

    it('accepts any usage id when the device reports no maximum', () => {
        const b = behavior([
            {
                param1: [
                    {
                        name: 'key',
                        hidUsage: { keyboardMax: 0, consumerMax: 0 },
                    },
                ],
                param2: [],
            },
        ])
        expect(canSetZmkBinding(b, hidUsageFromPageAndId(0x07, 0xfff), 0, 8)).toBe(
            true,
        )
    })

    it('requires a zero param where a set defines no values for that column', () => {
        const b = behavior([{ param1: [{ name: 'ON', constant: 1 }], param2: [] }])
        expect(canSetZmkBinding(b, 1, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 1, 2, 8)).toBe(false)
    })

    it('accepts a binding matching any one set (&bt: no-arg set + BT_SEL set)', () => {
        const bt = behavior([
            { param1: [{ name: 'BT_CLR', constant: 0 }], param2: [] },
            {
                param1: [{ name: 'BT_SEL', constant: 5 }],
                param2: [{ name: 'profile', range: { min: 0, max: 4 } }],
            },
        ])
        expect(canSetZmkBinding(bt, 0, 0, 8)).toBe(true)
        expect(canSetZmkBinding(bt, 5, 3, 8)).toBe(true)
        expect(canSetZmkBinding(bt, 5, 9, 8)).toBe(false)
        expect(canSetZmkBinding(bt, 0, 3, 8)).toBe(false)
    })

    it('matches an explicit nil value only for zero', () => {
        const b = behavior([{ param1: [{ name: 'none', nil: {} }], param2: [] }])
        expect(canSetZmkBinding(b, 0, 0, 8)).toBe(true)
        expect(canSetZmkBinding(b, 1, 0, 8)).toBe(false)
    })
})
