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
        expect(shortenToken('FOO_BAR_BAZ')).toBe('Bar Baz')
    })

    it('handles a token with no underscore', () => {
        expect(shortenToken('MB1')).toBe('Mb1')
    })

    it('returns the full text (cap clips via CSS, tooltip shows all)', () => {
        expect(shortenToken('X_LONGWORD')).toBe('Longword')
    })
})

describe('buildParamLabel — slot-kind dispatch', () => {
    it('layer slot → layer name, L<n> when unnamed', () => {
        const slots: ActionSlot[] = [{ label: 'Layer', kind: 'layer' }]
        expect(buildParamLabel(slots, [1], layerName).paramText).toBe('FN1')
        expect(buildParamLabel(slots, [2], layerName).paramText).toBe('L2')
    })

    it('layer longText is the full name, "Layer <n>" when unnamed', () => {
        const slots: ActionSlot[] = [{ label: 'Layer', kind: 'layer' }]
        // Named layer → the name; the tooltip reads it in full.
        expect(buildParamLabel(slots, [1], layerName).longText).toBe('FN1')
        // Index 2's name is "" — `layerName` returns an empty string, not
        // undefined, so longText must fall back on a truthiness test (regression:
        // a `??` fallback left it "" and the tooltip showed the short "L2").
        expect(buildParamLabel(slots, [2], layerName).longText).toBe('Layer 2')
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

    it('one-based number slot labels the value from 1 (raw index unchanged)', () => {
        const slots: ActionSlot[] = [
            {
                label: 'Command',
                kind: 'enum',
                values: [{ value: 3, label: 'BT_SEL' }],
            },
            {
                label: 'profile',
                kind: 'number',
                enabledFor: [3, 5],
                oneBased: true,
            },
        ]
        const map = { BT_SEL: 'BT' }
        // Stored profile index 0 → shown as "BT 1"; index 2 → "BT 3".
        expect(buildParamLabel(slots, [3, 0], layerName, map).paramText).toBe(
            'BT 1',
        )
        expect(buildParamLabel(slots, [3, 2], layerName, map).longText).toBe(
            'BT_SEL 3',
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

describe('buildParamLabel — composite icon parts', () => {
    const cmd = (values: { value: number; label: string }[]): ActionSlot => ({
        label: 'Command',
        kind: 'enum',
        values,
    })

    it('emits a single icon part for an enum token that carries an icon', () => {
        const slots: ActionSlot[] = [cmd([{ value: 1, label: 'BT_NXT' }])]
        const map = { BT_NXT: { text: 'Next', icon: 'next' } }
        const out = buildParamLabel(slots, [1], layerName, map)
        expect(out.parts).toEqual([{ icon: 'next', text: 'Next' }])
        expect(out.paramText).toBe('Next')
    })

    it('trailing number is always a plain-text part', () => {
        const slots: ActionSlot[] = [
            cmd([{ value: 3, label: 'BT_SEL' }]),
            {
                label: 'profile',
                kind: 'number',
                enabledFor: [3],
                oneBased: true,
            },
        ]
        const map = { BT_SEL: { text: 'BT', icon: 'bluetooth' } }
        const out = buildParamLabel(slots, [3, 1], layerName, map)
        // Stored index 1 → shown "2"; icon replaces "BT" text, value stays text.
        expect(out.parts).toEqual([
            { icon: 'bluetooth', text: 'BT' },
            { text: '2' },
        ])
        expect(out.paramText).toBe('BT 2')
    })

    it('no parts when the token map is legacy text-only (back-compat)', () => {
        const slots: ActionSlot[] = [cmd([{ value: 1, label: 'BT_NXT' }])]
        const out = buildParamLabel(slots, [1], layerName, { BT_NXT: 'Next' })
        expect(out.parts).toBeUndefined()
        expect(out.paramText).toBe('Next')
    })

    it('no parts when the icon-less fallback is used', () => {
        const slots: ActionSlot[] = [cmd([{ value: 1, label: 'RGB_HUI' }])]
        const out = buildParamLabel(slots, [1], layerName, {
            RGB_HUI: { text: 'Hue+' },
        })
        expect(out.parts).toBeUndefined()
        expect(out.paramText).toBe('Hue+')
    })
})
