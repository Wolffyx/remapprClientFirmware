// pattern-check: skip — assertions over the colour-picker effect table
import { describe, expect, it } from 'vitest'
import {
    effectUsesColor,
    LED_MATRIX_CATALOG,
    RGB_MATRIX_CATALOG,
    RGBLIGHT_CATALOG,
    ZMK_UNDERGLOW_CATALOG,
} from './lighting'

const colorless = (catalog: typeof RGB_MATRIX_CATALOG): string[] =>
    catalog.effects.filter((name) => !effectUsesColor(catalog, name))

describe('effectUsesColor', () => {
    it('hides the picker only for RGB Matrix effects that set their own hue', () => {
        expect(colorless(RGB_MATRIX_CATALOG)).toEqual([
            'None',
            'Cycle All',
            'Cycle Left Right',
            'Cycle Up Down',
            'Cycle Out In',
            'Cycle Out In Dual',
            'Cycle Pinwheel',
            'Cycle Spiral',
            'Flower Blooming',
            'Jellybean Raindrops',
            'Pixel Flow',
            'Pixel Rain',
            'Typing Heatmap',
            'Digital Rain',
        ])
    })

    it('keeps the picker for effects that shift or keep the configured hue', () => {
        for (const name of [
            'Breathing',
            'Band Sat',
            'Gradient Up Down',
            'Dual Beacon',
            'Rainbow Pinwheels',
            'Solid Splash',
            'Starlight',
            'Riverflow',
        ]) {
            expect(effectUsesColor(RGB_MATRIX_CATALOG, name)).toBe(true)
        }
    })

    it('covers RGBLight and ZMK underglow', () => {
        expect(colorless(RGBLIGHT_CATALOG)).toEqual([
            'Rainbow Mood',
            'Rainbow Swirl',
            'Christmas',
            'RGB Test',
        ])
        expect(colorless(ZMK_UNDERGLOW_CATALOG)).toEqual(['Spectrum', 'Swirl'])
    })

    it('matches VIA spellings and keeps the picker for unknown effects', () => {
        expect(effectUsesColor(RGB_MATRIX_CATALOG, 'Cycle Left/Right')).toBe(false)
        expect(effectUsesColor(RGB_MATRIX_CATALOG, 'cycle_all')).toBe(false)
        expect(effectUsesColor(RGB_MATRIX_CATALOG, 'Per Key RGB')).toBe(true)
    })

    it('never offers colour on a monochrome catalog', () => {
        expect(effectUsesColor(LED_MATRIX_CATALOG, 'Solid')).toBe(false)
    })
})
