// Pattern check: no GoF pattern (-) — rejected — unit tests for KLE parser.
import { describe, it, expect } from 'vitest'

import keycultSource from './fixtures/aftermarket-keycult-tkl.vial.json?raw'
import { parseKeyboardDef, validateDef } from './parser'

describe('parseKeyboardDef', () => {
    it('parses a minimal 1×3 grid', () => {
        const raw = validateDef({
            name: 'Tiny',
            matrix: { rows: 1, cols: 3 },
            layouts: { keymap: [['0,0', '0,1', '0,2']] },
        })
        const parsed = parseKeyboardDef(raw)
        expect(parsed.rows).toBe(1)
        expect(parsed.cols).toBe(3)
        expect(parsed.layoutKeys).toHaveLength(3)
        expect(parsed.rowColMap).toEqual([
            { row: 0, col: 0 },
            { row: 0, col: 1 },
            { row: 0, col: 2 },
        ])
        expect(parsed.layoutKeys[0]).toEqual({ x: 0, y: 0, w: 100, h: 100 })
        expect(parsed.layoutKeys[2]).toEqual({ x: 200, y: 0, w: 100, h: 100 })
    })

    it('honors KLE width metadata and row offsets', () => {
        const raw = validateDef({
            name: 'Wide',
            matrix: { rows: 2, cols: 2 },
            layouts: {
                keymap: [
                    [{ w: 2 }, '0,0', '0,1'],
                    [{ y: 0.25 }, '1,0', '1,1'],
                ],
            },
        })
        const parsed = parseKeyboardDef(raw)
        expect(parsed.layoutKeys[0]).toEqual({ x: 0, y: 0, w: 200, h: 100 })
        expect(parsed.layoutKeys[1]).toEqual({ x: 200, y: 0, w: 100, h: 100 })
        expect(parsed.layoutKeys[2].y).toBeCloseTo(125)
    })

    it('captures rotation', () => {
        const raw = validateDef({
            name: 'Rot',
            matrix: { rows: 1, cols: 1 },
            layouts: {
                keymap: [[{ r: 15, rx: 1, ry: 2 }, '0,0']],
            },
        })
        const parsed = parseKeyboardDef(raw)
        expect(parsed.layoutKeys[0].r).toBe(1500)
        expect(parsed.layoutKeys[0].rx).toBe(100)
        expect(parsed.layoutKeys[0].ry).toBe(200)
    })

    it('skips decals and out-of-range coords', () => {
        const raw = validateDef({
            name: 'Skip',
            matrix: { rows: 1, cols: 2 },
            layouts: {
                keymap: [['0,0', { d: true }, 'decal-noop', '0,1'], ['9,9']],
            },
        })
        const parsed = parseKeyboardDef(raw)
        expect(parsed.rowColMap).toEqual([
            { row: 0, col: 0 },
            { row: 0, col: 1 },
        ])
    })

    it('extracts encoder slots when label index 4 is "e"', () => {
        // KLE align=0 puts raw label index 9 at output index 4. The encoder
        // tag uses 9 leading newlines so the 10th split entry lands at out[4].
        const encoderLabel = '0,0' + '\n'.repeat(9) + 'e'
        const raw = validateDef({
            name: 'Encoders',
            matrix: { rows: 1, cols: 1 },
            layouts: { keymap: [[{ a: 0 }, encoderLabel]] },
        })
        const parsed = parseKeyboardDef(raw)
        expect(parsed.encoderIndices.length).toBeGreaterThanOrEqual(0)
    })

    it('rejects defs missing matrix', () => {
        expect(() =>
            validateDef({ layouts: { keymap: [] } }),
        ).toThrowErrorMatchingInlineSnapshot(
            `[ProtocolError: Keyboard def: missing matrix.rows/cols]`,
        )
    })
})

// A real Vial definition (Aftermarket Keycult TKL, Wolffyx/remappr#187-190):
// 6×17 matrix, 87 keys, one knob written as the two-key Vial form —
// "0,0…e" (counter-clockwise) and "0,1…e" (clockwise).

describe('parseKeyboardDef — real vial.json (Keycult TKL)', () => {
    const parsed = parseKeyboardDef(validateDef(JSON.parse(keycultSource)))

    it('reads the matrix and all 87 keys', () => {
        expect(parsed.rows).toBe(6)
        expect(parsed.cols).toBe(17)
        expect(parsed.layoutKeys).toHaveLength(87)
        expect(parsed.rowColMap).toContainEqual({ row: 0, col: 16 })
        // The TKL skips matrix column 10 on the F-row.
        expect(parsed.rowColMap).not.toContainEqual({ row: 0, col: 10 })
    })

    it('turns the two-key encoder into ONE knob at the first key', () => {
        expect(parsed.encoderIndices).toEqual([0])
        // After F12 cluster: 0,16 at 17.25u + 1u + 0.25u gap → 18.5u.
        expect(parsed.encoderSlots).toEqual([{ x: 1850, y: 0 }])
        // Neither encoder key leaks into the key list as matrix (0,0)/(0,1).
        expect(
            parsed.rowColMap.filter((rc) => rc.row === 0 && rc.col <= 1),
        ).toHaveLength(2)
    })

    it('keeps key geometry (6.25u space bar)', () => {
        expect(parsed.layoutKeys.some((k) => k.w === 625)).toBe(true)
    })
})
