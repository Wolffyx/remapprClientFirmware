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

const ROWS1 = ['&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)']
const COLS2 = ['&gpio0 5 GPIO_ACTIVE_HIGH', '&gpio0 6 GPIO_ACTIVE_HIGH']

describe('L1.4 errors for a build that cannot work; no matrix without pins', () => {
    it('is an error when a keyboard has no matrix pins', () => {
        const res = compile(pad({}))
        expect(errorsOf(res).some((m) => /no matrix pins/.test(m))).toBe(true)
    })

    it('is an error when only one side of the matrix has pins', () => {
        const res = compile(pad({ matrix: { rows: ROWS1 } }))
        expect(errorsOf(res).some((m) => /no column pins/.test(m))).toBe(true)
    })

    it('emits no kbd-matrix (and no keymap scanning it) for a pin-less mouse', () => {
        const json = JSON.parse(pad({}))
        json.node = { personality: 'mouse' }
        const res = compile(JSON.stringify(json))
        const ov = overlayOf(res)
        expect(ov).not.toContain('remappr,kbd-matrix')
        expect(ov).not.toContain('scan = <&kbd_matrix>')
        expect(errorsOf(res)).toEqual([])
    })

    it.skipIf(!TC)('a pin-less mouse shield still compiles with dtc', () => {
        const json = JSON.parse(pad({}))
        json.node = { personality: 'mouse' }
        const r = dtcCheck(TC!, overlayOf(compile(JSON.stringify(json))))
        expect(r.log).toBe('')
    })
})

describe('L1.6 cells, duplicates and reserved pins are validated', () => {
    const withMap = (map: number[][]): string =>
        pad(
            { matrix: { rows: ROWS1, cols: COLS2 } },
            { hardware: { transform: { rows: 2, columns: 3, map } } },
        )

    it('is an error when a cell is past the row or column GPIO count', () => {
        const errs = errorsOf(compile(withMap([[0, 0], [1, 2]])))
        expect(errs.some((m) => /on row 1, .*has 1 row GPIO/.test(m))).toBe(true)
        expect(errs.some((m) => /on column 2, .*has 2 column GPIO/.test(m))).toBe(true)
    })

    it('is an error when two keys share a cell', () => {
        const errs = errorsOf(compile(withMap([[0, 1], [0, 1]])))
        expect(errs.some((m) => /keys 0 and 1 .*cell \(0, 1\)/.test(m))).toBe(true)
    })

    it('is an error when a row pin is also a column pin', () => {
        const res = compile(
            pad({ matrix: { rows: ['PA3'], cols: ['PA4', '&gpioa 3 GPIO_ACTIVE_HIGH'] } }),
        )
        expect(errorsOf(res).some((m) => /&gpioa 3 is used twice/.test(m))).toBe(true)
    })

    it('is an error when an encoder or sensor pin reuses a matrix pin', () => {
        const res = compile(
            pad({
                matrix: { rows: ['PA3'], cols: ['PA4', 'PA5'] },
                encoders: [{ a: 'PA4', b: 'PB0' }],
                sensor: { part: 'pixart,paw3395', bus: 'spi1', motion: 'PA5' },
            }),
        )
        const errs = errorsOf(res)
        expect(errs.some((m) => /&gpioa 4 is used twice.*board\.encoders\.0\.a/.test(m))).toBe(true)
        expect(errs.some((m) => /&gpioa 5 is used twice.*board\.sensor\.motion/.test(m))).toBe(true)
    })

    it('is an error when a pin collides with one the board reserves', () => {
        const res = compile(
            pad({
                matrix: { rows: ['PA9'], cols: ['PA4', 'PA5'] },
                reservedPins: [{ pin: 'PA9', use: 'console UART TX' }],
            }),
        )
        expect(
            errorsOf(res).some((m) => /&gpioa 9 is reserved for console UART TX/.test(m)),
        ).toBe(true)
    })
})

describe('L1.10 encoder and slider keys get no fake matrix cell', () => {
    const elementPad = (key: Record<string, unknown>): string => {
        const json = JSON.parse(pad({ matrix: { rows: ROWS1, cols: COLS2 } }))
        delete json.keyboard.hardware
        json.keyboard.keys = [
            { x: 0, y: 0, matrix: [0, 0] },
            { x: 1, y: 0, ...key },
        ]
        return JSON.stringify(json)
    }

    it('is an error for an encoder key with no wiring of its own', () => {
        const res = compile(elementPad({ element: 'encoder' }))
        expect(errorsOf(res).some((m) => /key 1 is an encoder/.test(m))).toBe(true)
    })

    it('takes an encoder key with an explicit cell as its matrix switch', () => {
        const res = compile(elementPad({ element: 'encoder', matrix: [0, 1] }))
        expect(errorsOf(res)).toEqual([])
        expect(overlayOf(res)).toContain('MATRIX_KEY(0, 1, REMAPPR_KB_POS_BASE + 1)')
    })
})

/** A two-key board with a WS2812 strip. */
const strip = (
    ws: Record<string, unknown>,
    board: Record<string, unknown> = {},
): string =>
    pad(
        { matrix: { rows: ['P0.4'], cols: ['P0.5', 'P1.6'] }, ...board },
        {
            hardware: {
                transform: { rows: 1, columns: 2, map: [[0, 0], [0, 1]] },
                ws2812: { spi: 'spi3', dataPin: 'P0.6', chainLength: 2, ...ws },
            },
        },
    )

const STM32_WS = {
    spi: 'spi2',
    dataPin: 'PC3',
    stm32: { pinctrl: ['&spi2_sck_pb10', '&spi2_mosi_pc3'] },
}
const STM32_PINS = { matrix: { rows: ['PE11'], cols: ['PF15', 'PE13'] } }

describe('L1.2 WS2812 frames', () => {
    it('emits the HW-verified 0x78/0x60 frames on STM32 at 5 MHz', () => {
        const ov = overlayOf(compile(strip(STM32_WS, STM32_PINS)))
        expect(ov).toContain('spi-one-frame = <0x78>;')
        expect(ov).toContain('spi-zero-frame = <0x60>;')
        expect(ov).not.toContain('0xF0')
    })

    it('derives the frames from another SPI clock', () => {
        const ov = overlayOf(
            compile(strip({ ...STM32_WS, spiMaxFrequency: 8000000 }, STM32_PINS)),
        )
        // 125 ns a bit: '1' = 6 bits = 0.75 us, '0' = 3 bits = 0.375 us.
        expect(ov).toContain('spi-one-frame = <0x7E>;')
        expect(ov).toContain('spi-zero-frame = <0x70>;')
    })

    it('is an error for a clock no frame fits', () => {
        const res = compile(strip({ ...STM32_WS, spiMaxFrequency: 2000000 }, STM32_PINS))
        expect(errorsOf(res).some((m) => /no WS2812 bit timing fits a 2000000 Hz/.test(m))).toBe(true)
    })
})

describe('L1.7 the WS2812 path follows the SoC', () => {
    it('refuses an STM32 board without ws2812.stm32, instead of an nrf-spim node', () => {
        const res = compile(
            strip(
                { spi: 'spi1', dataPin: 'PA7' },
                { controller: 'nucleo_u5a5zj_q', ...STM32_PINS },
            ),
        )
        expect(overlayOf(res)).not.toContain('nordic,nrf-spim')
        expect(errorsOf(res).some((m) => /WS2812/.test(m))).toBe(true)
    })

    it('generates the nRF SPIM path for a custom nRF board.controller', () => {
        const res = compile(
            strip({}, { controller: { custom: true, soc: 'nrf52840', name: 'my_board' } }),
        )
        const ov = overlayOf(res)
        expect(ov).toContain('psels = <NRF_PSEL(SPIM_MOSI, 0, 6)>;')
        expect(ov).toContain('compatible = "nordic,nrf-spim";')
        expect(ov).not.toContain('FIXME')
        expect(errorsOf(res)).toEqual([])
    })

    it('is an error when the data pin is also a matrix pin', () => {
        const res = compile(strip({ dataPin: 'P0.5' }, { controller: 'nrf52840dk/nrf52840' }))
        expect(errorsOf(res).some((m) => /&gpio0 5 is used twice/.test(m))).toBe(true)
    })
})

describe.skipIf(!TC)('WS2812 shields compile with dtc', () => {
    it('on nRF and on STM32', () => {
        for (const json of [
            strip({}, { controller: 'nrf52840dk/nrf52840' }),
            strip(STM32_WS, STM32_PINS),
        ]) {
            const r = dtcCheck(TC!, overlayOf(compile(json)))
            expect(r.log).toBe('')
        }
    })
})

describe('L1.15 chain-length', () => {
    it('raises the firmware pixel buffer for a strip longer than 64 LEDs', () => {
        const res = compile(strip({ chainLength: 87 }, { controller: 'nrf52840dk/nrf52840' }))
        const defcfg = String(
            res.files.find((f) => f.filename.endsWith('Kconfig.defconfig'))!.content,
        )
        expect(defcfg).toContain('config REMAPPR_RGB_LED_MAX\n\tdefault 87')
    })

    it('warns when the strip is shorter than the key count', () => {
        const res = compile(strip({ chainLength: 1 }, { controller: 'nrf52840dk/nrf52840' }))
        expect(
            res.diagnostics.some((d) => d.level === 'warn' && /shorter than the 2 keys/.test(d.message)),
        ).toBe(true)
    })
})

describe('L1.8 free strings reach devicetree checked', () => {
    it('keeps a */ in meta.name from closing the header comment', () => {
        const json = JSON.parse(pad({ matrix: { rows: ROWS1, cols: COLS2 } }))
        json.meta.name = 'Evil */ / { bad'
        const ov = overlayOf(compile(JSON.stringify(json)))
        expect(ov.split('*/')).toHaveLength(2) // only the comment's own close
    })

    it.skipIf(!TC)('a shield named with */ still compiles with dtc', () => {
        const json = JSON.parse(pad({ matrix: { rows: ROWS1, cols: COLS2 } }))
        json.meta.name = 'Evil */ / { bad'
        expect(dtcCheck(TC!, overlayOf(compile(JSON.stringify(json)))).log).toBe('')
    })

    it('takes a node label with or without its leading &', () => {
        const ov = overlayOf(
            compile(
                strip(
                    { spi: '&spi3' },
                    {
                        controller: 'nrf52840dk/nrf52840',
                        sensor: { part: 'pixart,paw3395', bus: '&arduino_spi', motion: 'P1.10' },
                    },
                ),
            ),
        )
        expect(ov).not.toContain('&&')
        expect(ov).toContain('&spi3 {')
        expect(ov).toContain('&arduino_spi {')
    })

    it('is an error for a label, compatible or raw spec that is not devicetree', () => {
        const res = compile(
            pad({
                matrix: { rows: ['&gpio0 4 GPIO_ACTIVE_HIGH>; evil = <1'], cols: COLS2 },
                sensor: { part: 'pixart,"paw', bus: 'spi 1', motion: '&gpio1 10 0' },
            }),
        )
        const errs = errorsOf(res)
        expect(errs.some((m) => /board\.matrix|GPIO spec/.test(m))).toBe(true)
        expect(errs.some((m) => /compatible/.test(m))).toBe(true)
        expect(errs.some((m) => /node label/.test(m))).toBe(true)
    })

    it('validates board.encoders in the schema', () => {
        expect(() =>
            parseKeymap(pad({ encoders: [{ a: 'PA0', b: 'PA1', axis: 'INPUT_REL_WHEEL>; x = <1' }] })),
        ).toThrow()
        expect(() => parseKeymap(pad({ encoders: [{ a: 'PA0' }] }))).toThrow()
        expect(() => parseKeymap(pad({ encoders: [{ a: 'PA0', b: 'PA1', steps: 4 }] }))).not.toThrow()
    })
})

describe('L1.9 geometry in KEY() and max-layers', () => {
    const geo = (keys: Record<string, unknown>[], board: Record<string, unknown> = {}): string => {
        const json = JSON.parse(
            pad({
                matrix: {
                    rows: ROWS1,
                    cols: Array.from({ length: keys.length }, (_, i) => `&gpio1 ${i} GPIO_ACTIVE_HIGH`),
                },
                ...board,
            }),
        )
        json.keyboard.keys = keys
        json.keyboard.hardware.transform = {
            rows: 1,
            columns: keys.length,
            map: keys.map((_, i) => [0, i]),
        }
        json.layers[0].bindings = keys.map(() => 'A')
        return JSON.stringify(json)
    }

    it('places each key at its own x/y with its size and rotation', () => {
        const ov = overlayOf(
            compile(
                geo([
                    { x: 0, y: 0 },
                    { x: 1, y: 0, w: 2 },
                    { x: 5, y: 0, h: 2 },
                    { x: 7, y: 1, r: 15, rx: 7, ry: 1 },
                ]),
            ),
        )
        expect(ov).toContain('KEY(&x 0 &y 0)')
        expect(ov).toContain('KEY(&x 1 &y 0 &w 2)')
        expect(ov).toContain('KEY(&x 5 &y 0 &h 2)')
        expect(ov).toContain('KEY(&x 7 &y 1 &rot 15 &rotx 7 &roty 1)')
    })

    it('turns a negative rotation into its clockwise equivalent', () => {
        const ov = overlayOf(compile(geo([{ x: 0, y: 0 }, { x: 1, y: 0, r: -30 }])))
        expect(ov).toContain('&rot 330')
    })

    it('rounds fractional geometry to whole key-units, with a warning', () => {
        const res = compile(geo([{ x: 0, y: 0, w: 1.5 }, { x: 1.5, y: 0 }]))
        expect(overlayOf(res)).toContain('KEY(&x 2 &y 0)')
        expect(
            res.diagnostics.some((d) => d.level === 'warn' && /whole key-units/.test(d.message)),
        ).toBe(true)
    })

    it('gives the app room for more layers than the bootstrap has', () => {
        expect(overlayOf(compile(geo([{ x: 0, y: 0 }])))).toContain('max-layers = <4>;')
        expect(
            overlayOf(compile(geo([{ x: 0, y: 0 }], { maxLayers: 8 }))),
        ).toContain('max-layers = <8>;')
    })

    it('is an error when maxLayers is below the authored layer count', () => {
        const json = JSON.parse(geo([{ x: 0, y: 0 }], { maxLayers: 1 }))
        json.layers.push({ name: 'fn', bindings: ['B'] })
        const res = compile(JSON.stringify(json))
        expect(errorsOf(res).some((m) => /maxLayers 1 .*2 layers/.test(m))).toBe(true)
    })

    it.skipIf(!TC)('a placed, rotated board compiles with dtc', () => {
        const ov = overlayOf(
            compile(geo([{ x: 0, y: 0, w: 2 }, { x: 3, y: 1, r: -20, rx: 3, ry: 1 }])),
        )
        expect(dtcCheck(TC!, ov).log).toBe('')
    })
})
