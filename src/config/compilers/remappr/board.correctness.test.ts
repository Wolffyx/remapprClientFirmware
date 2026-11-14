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

/** A two-key board with the given `board` section and keyboard extras. */
function pad(board: Record<string, unknown>, keyboard: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Pad', target: 'zmk' },
        keyboard: {
            id: 'pad',
            name: 'Pad',
            keys: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ],
            hardware: { transform: { rows: 1, columns: 2, map: [[0, 0], [0, 1]] } },
            ...keyboard,
        },
        layers: [{ name: 'base', bindings: ['A', 'B'] }],
        board,
    })
}

const errorsOf = (res: CompileResult): string[] =>
    res.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('L1.3 one pin resolver for every pin kind', () => {
    it('resolves an ST label on an encoder phase like on a matrix pin', () => {
        const ov = overlayOf(
            compile(
                pad({
                    matrix: { rows: ['PE11'], cols: ['PF15', 'PE13'] },
                    encoders: [{ a: 'PA0', b: 'pa1' }],
                }),
            ),
        )
        expect(ov).toContain('gpios = <&gpioa 0 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>, <&gpioa 1 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>;')
        expect(ov).not.toContain('<PA0>')
    })

    it('resolves nRF P<port>.<pin> labels on matrix, encoder and sensor pins', () => {
        const res = compile(
            pad({
                controller: 'nrf52840dk/nrf52840',
                matrix: { rows: ['P0.4'], cols: ['P1.2', 'p1.3'] },
                encoders: [{ a: 'P0.17', b: 'P0.20' }],
                sensor: { part: 'pixart,paw3395', bus: 'arduino_spi', motion: 'P1.10' },
            }),
        )
        const ov = overlayOf(res)
        expect(ov).toContain('<&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(ov).toContain('<&gpio1 2 GPIO_ACTIVE_HIGH>')
        expect(ov).toContain('<&gpio1 3 GPIO_ACTIVE_HIGH>')
        expect(ov).toContain('<&gpio0 17 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>')
        expect(ov).toContain('motion-gpios = <&gpio1 10 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>;')
        expect(errorsOf(res)).toEqual([])
    })

    it('gates labels on the SoC: an ST label on an nRF board does not resolve', () => {
        const res = compile(
            pad({ controller: 'nrf52840dk/nrf52840', matrix: { rows: ['PA3'], cols: ['P0.5', 'P0.6'] } }),
        )
        expect(errorsOf(res).some((m) => /"PA3"/.test(m))).toBe(true)
    })
})

describe('L1.5 board.controller and hardware.kscan are read', () => {
    it('takes the controller board from board.controller', () => {
        const res = compile(
            pad({ controller: 'nice_nano_v2', matrix: { rows: ['D4'], cols: ['D5', 'D6'] } }),
        )
        expect(overlayOf(res)).toContain('<&pro_micro 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(errorsOf(res)).toEqual([])
    })

    it('takes the SoC of a custom board.controller', () => {
        const res = compile(
            pad({
                controller: { custom: true, soc: 'stm32u5a5xx', name: 'my_board' },
                matrix: { rows: ['PE11'], cols: ['PF15', 'P0.4'] },
            }),
        )
        expect(overlayOf(res)).toContain('<&gpioe 11')
        // An nRF label on an STM32 board is an error, not a guess.
        expect(errorsOf(res).some((m) => /"P0\.4"/.test(m))).toBe(true)
    })

    it('takes the matrix wiring and debounce from keyboard.hardware.kscan', () => {
        const res = compile(
            pad(
                {},
                {
                    hardware: {
                        transform: { rows: 1, columns: 2, map: [[0, 0], [0, 1]] },
                        kscan: {
                            type: 'matrix',
                            diodeDirection: 'row2col',
                            rowGpios: ['&gpio0 4 GPIO_ACTIVE_LOW'],
                            colGpios: [
                                '&gpio0 5 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)',
                                '&gpio0 6 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)',
                            ],
                            debouncePressMs: 5,
                            debounceReleaseMs: 10,
                        },
                    },
                },
            ),
        )
        const ov = overlayOf(res)
        expect(ov).toContain('diode-direction = "row2col";')
        expect(ov).toContain('<&gpio0 4 GPIO_ACTIVE_LOW>')
        expect(ov).toContain('<&gpio0 6 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>')
        expect(ov).toContain('debounce-press-ms = <5>;')
        expect(ov).toContain('debounce-release-ms = <10>;')
        expect(errorsOf(res)).toEqual([])
    })

    it('refuses direct-pin wiring, which has no generated driver yet', () => {
        const res = compile(
            pad(
                {},
                {
                    hardware: {
                        kscan: { type: 'direct', inputGpios: ['&gpio0 4 GPIO_ACTIVE_LOW', '&gpio0 5 GPIO_ACTIVE_LOW'] },
                    },
                },
            ),
        )
        expect(errorsOf(res).some((m) => /direct/.test(m))).toBe(true)
    })
})
