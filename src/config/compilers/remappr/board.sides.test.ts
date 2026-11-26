// pattern-check: skip — test wiring: board-gen split boards (universal device
// model §3.6): one JSON, one shield per side, and the side map it implies.
import { describe, expect, it } from 'vitest'

import { LimitsFeature } from '../../../clients/remappr/protocol'
import type { CompileResult } from '../../compiler'
import { configRequiredFeatures } from '../../featureWarnings'
import { getCompiler, parseKeymap } from '../../index'
import { buildRemapprBlob } from './index'
import { DecodeCode, decodeRemapprBlob } from './decode'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

type Json = Record<string, unknown>

/** A 2 + 3 key split: the left half on a U5A5, the right on an nRF52840 with
 *  an encoder; the left faces the right over usart2, the right's strap is low. */
function split(over: { keys?: Json[]; board?: Json; node?: Json } = {}): string {
    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Split', target: 'zmk' },
        keyboard: {
            id: 'split',
            name: 'Split',
            keys: over.keys ?? [
                { x: 0, y: 0, side: 0 },
                { x: 1, y: 0, side: 0 },
                { x: 4, y: 0, side: 1 },
                { x: 5, y: 0, side: 1 },
                { x: 6, y: 0, side: 1 },
            ],
        },
        layers: [{ name: 'base', bindings: ['A', 'B', 'C', 'D', 'E'] }],
        ...(over.node ? { node: over.node } : {}),
        board: {
            matrix: { diode: 'row2col' },
            sides: [
                {
                    side: 0,
                    controller: 'nucleo_u5a5zj_q',
                    matrix: { diode: 'row2col', rows: ['PE11'], cols: ['PF15', 'PE13'] },
                    nodeBus: [{ uart: 'usart2', direction: 'downstream', sideStrap: 'PB2' }],
                },
                {
                    side: 1,
                    controller: 'nrf52840dk/nrf52840',
                    matrix: { diode: 'col2row', rows: ['P0.03'], cols: ['P1.01', 'P1.02', 'P1.03'] },
                    nodeBus: [
                        {
                            uart: 'uart1',
                            direction: 'upstream',
                            sideStrap: 'P1.04',
                            sideStrapActiveLow: true,
                        },
                    ],
                    encoders: [{ a: 'P1.05', b: 'P1.06' }],
                },
            ],
            ...over.board,
        },
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const file = (r: CompileResult, path: string): string =>
    String(r.files.find((f) => f.filename === path)!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('a split board (board.sides)', () => {
    const r = compile(split())
    const left = file(r, 'boards/shields/split_left/split_left.overlay')
    const right = file(r, 'boards/shields/split_right/split_right.overlay')

    it('builds one shield per side, named by side', () => {
        expect(errors(r)).toEqual([])
        expect(r.files.map((f) => f.filename)).toEqual([
            'boards/shields/split_left/split_left.overlay',
            'boards/shields/split_left/Kconfig.shield',
            'boards/shields/split_left/Kconfig.defconfig',
            'boards/shields/split_right/split_right.overlay',
            'boards/shields/split_right/Kconfig.shield',
            'boards/shields/split_right/Kconfig.defconfig',
        ])
        expect(file(r, 'boards/shields/split_right/Kconfig.shield')).toContain('config SHIELD_SPLIT_RIGHT')
    })

    it("gives each half its own keys, bindings and pins, on the whole board's grid", () => {
        expect(left).toContain('rows = <2>;')
        expect(left).toMatch(/KEY\(&x 0 &y 0\)\s+KEY\(&x 1 &y 0\)/)
        expect(left).toContain('&gpioe 11')
        expect(left).not.toContain('&gpio1')
        expect(right).toContain('rows = <3>;')
        expect(right).toMatch(/KEY\(&x 4 &y 0\)\s+KEY\(&x 5 &y 0\)\s+KEY\(&x 6 &y 0\)/)
        expect(left).toMatch(/actions = <\s+&key 0x04 &key 0x05\s+>/)
        expect(right).toMatch(/actions = <\s+&key 0x06 &key 0x07 &key 0x08\s+>/)
        expect(right).toContain('gpio-qdec')
        expect(left).not.toContain('gpio-qdec')
    })

    it('emits each side strap with its polarity, and the role from the ports', () => {
        expect(left).toMatch(/side-gpios = <&gpiob 2 \(GPIO_ACTIVE_HIGH \| GPIO_PULL_DOWN\)>;/)
        expect(right).toMatch(/side-gpios = <&gpio1 4 \(GPIO_ACTIVE_LOW \| GPIO_PULL_UP\)>;/)
        expect(file(r, 'boards/shields/split_left/Kconfig.defconfig')).toContain('config REMAPPR_NODE_BUS_MAIN')
        expect(file(r, 'boards/shields/split_right/Kconfig.defconfig')).not.toContain(
            'REMAPPR_NODE_BUS_MAIN',
        )
    })

    it('builds side numbering into both halves, and not into a one-piece board', () => {
        for (const half of ['left', 'right'])
            expect(file(r, `boards/shields/split_${half}/Kconfig.defconfig`)).toMatch(
                /config REMAPPR_NODE_BUS_POSITION_FWD\n\tdefault y/,
            )
        const json = JSON.parse(split())
        const { sides, ...shared } = json.board
        json.board = { ...shared, ...sides[0], side: undefined }
        json.keyboard.keys = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
        json.layers[0].bindings = ['A', 'B']
        const one = compile(JSON.stringify(json))
        expect(errors(one)).toEqual([])
        expect(file(one, 'boards/shields/split/Kconfig.defconfig')).not.toContain('POSITION_FWD')
    })

    it.skipIf(!TC)('and both halves pass dtc', () => {
        for (const o of [left, right]) {
            const d = dtcCheck(TC!, o)
            expect(d.log).toBe('')
            expect(d.ok).toBe(true)
        }
    })
})

describe('board.sides refuses what the firmware cannot build yet', () => {
    it('a part tagged with a side (same-image split), before its schema drops the tag', () => {
        expect(() => compile(split({ board: { buttons: [{ key: 4, pin: 'PC13', side: 1 }] } }))).toThrow(
            /side-gated parts/,
        )
        const json = JSON.parse(split())
        json.board.sides[1].encoders[0].side = 1
        expect(() => compile(JSON.stringify(json))).toThrow(/side-gated parts/)
    })

    it('keys with a side but no board.sides', () => {
        const json = JSON.parse(split())
        delete json.board.sides
        json.board.matrix = { diode: 'row2col', rows: ['PE11'], cols: ['PF15', 'PE13'] }
        json.board.controller = 'nucleo_u5a5zj_q'
        expect(errors(compile(JSON.stringify(json))).some((e) => /same-image split/.test(e))).toBe(true)
    })

    it('keys not grouped by side, or on no listed side', () => {
        const mixed = split({
            keys: [
                { x: 0, y: 0, side: 0 },
                { x: 4, y: 0, side: 1 },
                { x: 1, y: 0, side: 0 },
                { x: 5, y: 0, side: 1 },
                { x: 6, y: 0, side: 2 },
            ],
        })
        const e = errors(compile(mixed))
        expect(e.some((m) => /grouped by side/.test(m))).toBe(true)
        expect(e.some((m) => /key 4 is on no side/.test(m))).toBe(true)
    })

    it('a side listed twice', () => {
        const json = JSON.parse(split())
        json.board.sides[1].side = 0
        expect(errors(compile(JSON.stringify(json))).some((e) => /listed twice/.test(e))).toBe(true)
    })
})

describe("a side's buttons", () => {
    /** The right half's last key is a button instead of a matrix key. */
    const withButton = (key: number): string => {
        const json = JSON.parse(split())
        json.board.sides[1].matrix.cols = ['P1.01', 'P1.02']
        json.board.sides[1].buttons = [{ key, pin: 'P1.07' }]
        return JSON.stringify(json)
    }

    it('name their key by whole-board index and land on their half', () => {
        const r = compile(withButton(4))
        expect(errors(r)).toEqual([])
        const right = file(r, 'boards/shields/split_right/split_right.overlay')
        expect(right).toContain('&gpio1 7')
        expect(file(r, 'boards/shields/split_left/split_left.overlay')).not.toContain('&gpio1 7')
    })

    it('refuse a key of the other half', () => {
        expect(errors(compile(withButton(1))).some((e) => /not on side 1/.test(e))).toBe(true)
    })
})

describe('the side map a split board implies (TBL_CLUSTER v2)', () => {
    const sidesOf = (json: string) => {
        const { blob, diagnostics } = buildRemapprBlob(parseKeymap(json), { configVersion: 1 })
        const { code, config } = decodeRemapprBlob(blob)
        expect(code).toBe(DecodeCode.OK)
        return { sides: config?.node?.clusterSides, diagnostics }
    }

    it('derives each side from its keys, encoders and sliders', () => {
        expect(sidesOf(split()).sides).toEqual([
            { side: 0, rows: 1, cols: 2 },
            { side: 1, rows: 1, cols: 3, encoders: 1 },
        ])
        expect(configRequiredFeatures(parseKeymap(split())) & LimitsFeature.tblClusterV2).toBeTruthy()
    })

    it('keeps a written map, and warns when it disagrees', () => {
        const written = [
            { side: 0, rows: 1, cols: 2 },
            { side: 1, rows: 1, cols: 4 },
        ]
        const { sides, diagnostics } = sidesOf(split({ node: { clusterSides: written } }))
        expect(sides).toEqual(written)
        expect(diagnostics.some((d) => d.level === 'warn' && /disagrees/.test(d.message))).toBe(true)
    })
})
