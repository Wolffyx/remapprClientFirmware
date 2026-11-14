// pattern-check: skip — test wiring: board-gen pin maps from JSON (L1.14) and
// the shield bundle's build notes for any board (L1.13).
import { describe, expect, it } from 'vitest'

import { buildProjectBundle } from '../../bundle'
import type { CompileResult } from '../../compiler'
import { getCompiler, parseKeymap } from '../../index'

function pad(board: Record<string, unknown>, node: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Pad', target: 'zmk' },
        keyboard: {
            id: 'pad',
            name: 'Pad',
            keys: [
                { x: 0, y: 0, matrix: [0, 0] },
                { x: 1, y: 0, matrix: [0, 1] },
            ],
        },
        layers: [{ name: 'base', bindings: ['A', 'B'] }],
        node,
        board,
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const overlayOf = (r: CompileResult): string =>
    String(r.files.find((f) => f.filename.endsWith('.overlay'))!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('board.pinMap', () => {
    it('resolves the board labels the JSON gives, on a board no table knows', () => {
        const r = compile(
            pad({
                controller: 'promicro_nrf52840/nrf52840/uf2',
                pinMap: { D2: '&gpio0 17', d3: '&gpio0  20', D10: '&arduino_header 16' },
                matrix: { rows: ['D2'], cols: ['d3', 'D10'] },
            }),
        )
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o).toContain('<&gpio0 17 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(o).toContain('<&gpio0 20 GPIO_ACTIVE_HIGH>')
        expect(o).toContain('<&arduino_header 16 GPIO_ACTIVE_HIGH>')
    })

    it('comes before the built-in board table', () => {
        const r = compile(
            pad({
                controller: 'nice_nano_v2',
                pinMap: { D4: '&gpio1 4' },
                matrix: { rows: ['D4'], cols: ['D5', 'D6'] },
            }),
        )
        const o = overlayOf(r)
        expect(o).toContain('<&gpio1 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(o).toContain('<&pro_micro 5 GPIO_ACTIVE_HIGH>')
    })

    it('catches two labels for one pin, like any pin used twice', () => {
        const r = compile(
            pad({
                controller: 'nrf52840dk/nrf52840',
                pinMap: { A: '&gpio0 3', B: '&gpio0 3' },
                matrix: { rows: ['A'], cols: ['B', 'P1.02'] },
            }),
        )
        expect(errors(r).join()).toMatch(/used twice/)
    })

    it('refuses a value that is not a phandle and one pin', () => {
        const r = compile(
            pad({
                controller: 'nrf52840dk/nrf52840',
                pinMap: { A: 'P0.03', B: '&gpio0 3 GPIO_ACTIVE_LOW', C: '&gpio0 4; x' },
                matrix: { rows: ['P0.03'], cols: ['P1.01', 'P1.02'] },
            }),
        )
        expect(errors(r).filter((e) => e.startsWith('pinMap')).length).toBe(3)
    })
})

describe('the shield bundle builds for any board', () => {
    const files = (json: string) =>
        buildProjectBundle(parseKeymap(json), 'remappr-board').files
    const readme = (json: string): string =>
        String(files(json).find((f) => f.filename.endsWith('README.md'))!.content)

    it('sets the shield for the app image only, the app per personality', () => {
        const kb = readme(pad({ matrix: { rows: ['P0.03'], cols: ['P1.01', 'P1.02'] } }))
        expect(kb).toContain('-Dkeyboard_node_SHIELD=pad')
        expect(kb).not.toContain('-DSHIELD=')
        const mouse = readme(pad({}, { personality: 'mouse' }))
        expect(mouse).toContain('remappr-firmware/app/mouse')
        expect(mouse).toContain('-Dmouse_SHIELD=pad')
    })

    it('says what a board with no overlay of its own needs', () => {
        const kb = readme(pad({ matrix: { rows: ['P0.03'], cols: ['P1.01', 'P1.02'] } }))
        expect(kb).toContain('keyboard-hid.dtsi')
    })
})
