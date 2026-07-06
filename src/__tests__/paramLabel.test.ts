// Pattern check: no GoF pattern (-) — rejected — unit tests over the pure
// firmware-neutral param-label engine; test code, no design pattern.
import { describe, expect, it } from 'vitest'
import type { ActionSlot } from '../types'
import { buildParamLabel, shortenToken } from '../paramLabel'

const layers = ['Base', 'FN1', '']
const layerName = (i: number): string | undefined => layers[i]

describe('shortenToken — generic fallback', () => {
    it('strips through the first underscore and title-cases the tail', () => {
        expect(shortenToken('RGB_HUI')).toBe('Hui')
        expect(shortenToken('FOO_BAR_BAZ')).toBe('Bar B…')
    })

    it('handles a token with no underscore', () => {
        expect(shortenToken('MB1')).toBe('Mb1')
    })

    it('truncates to 6 chars with an ellipsis', () => {
        expect(shortenToken('X_LONGWORD').length).toBeLessThanOrEqual(6)
    })
})

describe('buildParamLabel — slot-kind dispatch', () => {
    it('layer slot → layer name, L<n> when unnamed', () => {
        const slots: ActionSlot[] = [{ label: 'Layer', kind: 'layer' }]
        expect(buildParamLabel(slots, [1], layerName).paramText).toBe('FN1')
        expect(buildParamLabel(slots, [2], layerName).paramText).toBe('L2')
    })

    it('number slot → the raw number', () => {
        const slots: ActionSlot[] = [{ label: 'N', kind: 'number' }]
        expect(buildParamLabel(slots, [7], layerName).paramText).toBe('7')
    })

    it('enum slot → shortMap wins, fallback otherwise', () => {
        const slots: ActionSlot[] = [
            {
                label: 'Cmd',
                kind: 'enum',
                values: [{ value: 3, label: 'RGB_HUI' }],
            },
        ]
        expect(
            buildParamLabel(slots, [3], layerName, { RGB_HUI: 'Hue+' })
                .paramText,
        ).toBe('Hue+')
        // no shortMap → generic fallback
        expect(buildParamLabel(slots, [3], layerName).paramText).toBe('Hui')
    })

    it('enum + gated number slot appends the value only when enabled', () => {
        const slots: ActionSlot[] = [
            {
                label: 'Command',
                kind: 'enum',
                values: [
                    { value: 3, label: 'BT_SEL' },
                    { value: 0, label: 'BT_CLR' },
                ],
            },
            { label: 'profile', kind: 'number', enabledFor: [3, 5] },
        ]
        const map = { BT_SEL: 'BT', BT_CLR: 'Clr' }
        expect(buildParamLabel(slots, [3, 0], layerName, map).paramText).toBe(
            'BT 0',
        )
        // BT_CLR is not in enabledFor → no trailing value appended
        expect(buildParamLabel(slots, [0, 0], layerName, map).paramText).toBe(
            'Clr',
        )
    })

    it('unknown enum value → the raw number', () => {
        const slots: ActionSlot[] = [
            { label: 'E', kind: 'enum', values: [{ value: 1, label: 'A' }] },
        ]
        expect(buildParamLabel(slots, [9], layerName).paramText).toBe('9')
    })

    it('hid / modifier / empty slots return no paramText', () => {
        expect(
            buildParamLabel([{ label: 'K', kind: 'hid' }], [5], layerName),
        ).toEqual({})
        expect(
            buildParamLabel([{ label: 'M', kind: 'modifier' }], [5], layerName),
        ).toEqual({})
        expect(buildParamLabel([], [5], layerName)).toEqual({})
    })
})
