// Pattern check: no GoF pattern (-) — rejected — unit tests for the VIA lighting-menu parser, data assertions, no abstraction.
import { describe, it, expect } from 'vitest'

import { parseLightingMenu } from './lightingMenu'

// Trimmed from the real Keychron K5 V2 ANSI RGB definition.
const K5_MENUS = [
    {
        label: 'Lighting',
        content: [
            {
                label: 'Backlight',
                content: [
                    {
                        label: 'Brightness',
                        type: 'range',
                        options: [0, 255],
                        content: ['id_qmk_rgb_matrix_brightness', 3, 1],
                    },
                    {
                        label: 'Effect',
                        type: 'dropdown',
                        content: ['id_qmk_rgb_matrix_effect', 3, 2],
                        options: [
                            ['None', 0],
                            ['Solid Color', 1],
                            ['Breathing', 2],
                            ['Band Spiral Val', 3],
                            ['Cycle All', 4],
                            ['Cycle Left Right', 5],
                            ['Solid Splash', 22],
                        ],
                    },
                    {
                        showIf: '{id_qmk_rgb_matrix_effect} > 1',
                        label: 'Effect Speed',
                        type: 'range',
                        options: [0, 255],
                        content: ['id_qmk_rgb_matrix_effect_speed', 3, 3],
                    },
                    {
                        label: 'Color',
                        type: 'color',
                        content: ['id_qmk_rgb_matrix_color', 3, 4],
                    },
                ],
            },
        ],
    },
]

describe('via/lightingMenu — parseLightingMenu', () => {
    it('parses the K5 lighting menu into a board catalog', () => {
        const cat = parseLightingMenu(K5_MENUS)
        expect(cat).not.toBeNull()
        expect(cat!.kind).toBe('rgb_matrix')
        expect(cat!.hasColor).toBe(true)
        expect(cat!.hasSpeed).toBe(true)
        // Effect names indexed by their firmware value.
        expect(cat!.effects[0]).toBe('None')
        expect(cat!.effects[3]).toBe('Band Spiral Val')
        expect(cat!.effects[5]).toBe('Cycle Left Right')
        expect(cat!.effects[22]).toBe('Solid Splash')
        // Gaps between sparse values are filled, not dropped.
        expect(cat!.effects).toHaveLength(23)
        expect(cat!.effects[10]).toMatch(/Effect 10/)
    })

    it('returns null when no effect dropdown is present', () => {
        expect(parseLightingMenu([])).toBeNull()
        expect(parseLightingMenu(undefined)).toBeNull()
        expect(
            parseLightingMenu([{ label: 'X', content: [{ label: 'Y' }] }]),
        ).toBeNull()
    })
})
