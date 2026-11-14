// pattern-check: skip — test wiring: board-gen correctness cases from the
// November 2026 later audit (L1), each compiled and, where a toolchain is
// present, run through cpp + dtc.
import { describe, expect, it } from 'vitest'

import { getCompiler, parseKeymap } from '../../index'
import type { CompileResult } from '../../compiler'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

/** A row-major grid board: `n` keys, 16 to a row, wired 1:1 to the matrix. */
function grid(n: number, extra: Record<string, unknown> = {}): string {
    const cols = Math.min(n, 16)
    const rows = Math.ceil(n / 16)
    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Grid', target: 'zmk' },
        keyboard: {
            id: 'grid',
            name: 'Grid',
            keys: Array.from({ length: n }, (_, i) => ({
                x: i % 16,
                y: Math.floor(i / 16),
            })),
            hardware: {
                transform: {
                    rows,
                    columns: cols,
                    map: Array.from({ length: n }, (_, i) => [
                        Math.floor(i / 16),
                        i % 16,
                    ]),
                },
            },
        },
        layers: [{ name: 'base', bindings: Array.from({ length: n }, () => 'A') }],
        board: {
            matrix: {
                rows: Array.from(
                    { length: rows },
                    (_, i) => `&gpio0 ${i} (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)`,
                ),
                cols: Array.from(
                    { length: cols },
                    (_, i) => `&gpio1 ${i} GPIO_ACTIVE_HIGH`,
                ),
            },
        },
        ...extra,
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))

const overlayOf = (res: CompileResult): string =>
    String(res.files.find((f) => f.filename.endsWith('.overlay'))!.content)

describe('L1.1 a keymap with more than 64 keys', () => {
    it('emits one MATRIX_KEY per position, not the 64-argument macro', () => {
        const ov = overlayOf(compile(grid(87)))
        expect(ov).not.toContain('REMAPPR_MATRIX_KEYMAP(')
        expect(ov).toContain('MATRIX_KEY(0, 0, REMAPPR_KB_POS_BASE + 0)')
        expect(ov).toContain('MATRIX_KEY(5, 6, REMAPPR_KB_POS_BASE + 86)')
        expect(ov.match(/MATRIX_KEY\(/g)).toHaveLength(87)
    })

    it.skipIf(!TC)('compiles with dtc at 64, 65 and 104 keys', () => {
        for (const n of [64, 65, 104]) {
            const r = dtcCheck(TC!, overlayOf(compile(grid(n))))
            expect(r.log, `${n} keys`).toBe('')
            expect(r.ok, `${n} keys`).toBe(true)
        }
    })
})
