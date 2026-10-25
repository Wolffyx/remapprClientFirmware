// pattern-check: skip — unit tests for position-derived wiring and kept keys.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deriveMatrix, parseKeymap, resolveKeyMatrix } from '../index'
import type { CanonGeometry, ConfigKeymap } from '../types'

const key = (x: number, y: number, extra: Partial<CanonGeometry> = {}): CanonGeometry => ({
    x,
    y,
    w: 1,
    h: 1,
    r: 0,
    ...extra,
})

const unique = (map: [number, number][]): boolean =>
    new Set(map.map(([r, c]) => `${r},${c}`)).size === map.length

const corne = parseKeymap(
    readFileSync(
        fileURLToPath(new URL('./corne.keymap.json', import.meta.url)),
        'utf8',
    ),
)

describe('deriveMatrix', () => {
    it('wires a Corne as 4 rows × 12 columns with thumbs on the last row', () => {
        const m = deriveMatrix(corne.keyboard.keys)
        expect(unique(m.map)).toBe(true)
        expect(m.rows).toBe(4)
        expect(m.columns).toBe(12)
        // Left thumbs (keys 36, 38, 40) sit under columns 3–5 on row 3.
        expect([36, 38, 40].map((i) => m.map[i])).toEqual([
            [3, 3],
            [3, 4],
            [3, 5],
        ])
    })

    it('keeps a short column on its rows instead of packing it upward', () => {
        // 3×3 grid without the top-left key.
        const keys = [0, 1, 2]
            .flatMap((y) => [0, 1, 2].map((x) => key(x, y)))
            .slice(1)
        const m = deriveMatrix(keys)
        expect(m.map[2]).toEqual([1, 0])
        expect(m.map[5]).toEqual([2, 0])
    })

    it('joins a thumb offset by a quarter unit to its column', () => {
        const keys = [key(0, 0), key(0, 1), key(1, 0), key(1, 1), key(1.25, 2.2)]
        const m = deriveMatrix(keys)
        expect(m.columns).toBe(2)
        expect(m.map[4]).toEqual([2, 1])
    })

    it('places a rotated key by where it shows', () => {
        // Rotated 90° about its own top-left: its centre moves left of x.
        const keys = [key(0, 0), key(0, 1), key(1, 0), key(1, 1), key(2, 2, { r: 90, rx: 2, ry: 2 })]
        const m = deriveMatrix(keys)
        expect(m.map[4]![1]).toBe(1)
    })
})

describe('resolveKeyMatrix with kept keys', () => {
    it('moves a derived key off a slot a kept key holds', () => {
        const base: ConfigKeymap = {
            ...corne,
            keyboard: {
                ...corne.keyboard,
                keys: corne.keyboard.keys.map((k, i) =>
                    i === 0 ? { ...k, matrix: [0, 1] as [number, number] } : k,
                ),
            },
        }
        const map = resolveKeyMatrix(base)
        expect(map[0]).toEqual([0, 1])
        expect(unique(map)).toBe(true)
    })
})
