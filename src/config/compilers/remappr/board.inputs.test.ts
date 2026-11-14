// pattern-check: skip — test wiring: board-gen feature reach, the input group
// (L1.11, L1.12): off-matrix buttons, sliders, the mouse node, qdec timings.
import { describe, expect, it } from 'vitest'

import type { CompileResult } from '../../compiler'
import { getCompiler, parseKeymap } from '../../index'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

function pad(
    board: Record<string, unknown>,
    keys: Record<string, unknown>[] = [],
    extra: Record<string, unknown> = {},
): string {
    const all = [
        { x: 0, y: 0, matrix: [0, 0] },
        { x: 1, y: 0, matrix: [0, 1] },
        ...keys,
    ]
    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Pad', target: 'zmk' },
        keyboard: { id: 'pad', name: 'Pad', keys: all },
        layers: [{ name: 'base', bindings: all.map(() => 'A') }],
        board: {
            controller: 'nrf52840dk/nrf52840',
            matrix: { diode: 'col2row', rows: ['P0.03'], cols: ['P1.01', 'P1.02'] },
            ...board,
        },
        ...extra,
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const overlayOf = (r: CompileResult): string =>
    String(r.files.find((f) => f.filename.endsWith('.overlay'))!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('board.buttons', () => {
    const BTN = [{ x: 3, y: 0 }, { x: 4, y: 0, w: 2 }]

    it('emits gpio-keys and an extra-input per button; the matrix takes the rest', () => {
        const r = compile(
            pad({ buttons: [{ key: 2, pin: 'P0.26' }, { key: 3, pin: 'P0.27', code: 'INPUT_KEY_ENTER' }] }, BTN),
        )
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o.match(/\bKEY\(&/g)?.length).toBe(2)
        expect(o).toContain('&key 0x04 &key 0x04\n')
        expect(o).toContain('zephyr,code = <INPUT_KEY_F13>;')
        expect(o).toContain('input-code = <INPUT_KEY_ENTER>;')
        expect(o).toContain('rect = <400 0 200 100>;')
    })

    it('needs the buttons to be the last keys, in order', () => {
        const r = compile(pad({ buttons: [{ key: 3, pin: 'P0.26' }, { key: 2, pin: 'P0.27' }] }, BTN))
        expect(errors(r).join()).toMatch(/must be the last keys/)
    })

    it('refuses a button with a matrix cell, and two buttons on one code', () => {
        const cell = compile(pad({ buttons: [{ key: 2, pin: 'P0.26' }] }, [{ x: 3, y: 0, matrix: [0, 0] }]))
        expect(errors(cell).join()).toMatch(/has a matrix cell/)
        const code = compile(
            pad(
                {
                    buttons: [
                        { key: 2, pin: 'P0.26', code: 'INPUT_KEY_A' },
                        { key: 3, pin: 'P0.27', code: 'INPUT_KEY_A' },
                    ],
                },
                BTN,
            ),
        )
        expect(errors(code).join()).toMatch(/both report/)
    })

    it('shares one origin with the placement', () => {
        const o = overlayOf(compile(pad({ buttons: [{ key: 2, pin: 'P0.26' }] }, [{ x: -1, y: 0 }])))
        expect(o).toContain('KEY(&x 1 &y 0)')
        expect(o).toContain('rect = <0 0 100 100>;')
    })
})

describe('board.sliders', () => {
    it('emits remappr,slider on its ADC channel', () => {
        const adc = { adc: 'adc', channel: 6, setup: { gain: 'ADC_GAIN_1_6', reference: 'ADC_REF_INTERNAL', inputPositive: 'NRF_SAADC_AIN6' } }
        const r = compile(pad({ sliders: [{ adc, function: 'rgb-brightness', pollMs: 30 }] }))
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o).toContain('compatible = "remappr,slider";')
        expect(o).toContain('io-channels = <&adc 6>;')
        expect(o).toContain('poll-ms = <30>;')
    })

    it('refuses a slider on the battery channel', () => {
        const adc = { adc: 'adc', channel: 2 }
        const r = compile(pad({ sliders: [{ adc }], battery: { adc } }))
        expect(errors(r).join()).toMatch(/read twice/)
    })
})

describe('board.sensor.cpi and qdec timings', () => {
    const sensor = { part: 'pixart,paw3395', bus: 'arduino_spi', motion: 'P1.10' }

    it('emits remappr,mouse from cpi', () => {
        const o = overlayOf(compile(pad({ sensor: { ...sensor, cpi: { native: 800, max: 26000 } } })))
        expect(o).toContain('compatible = "remappr,mouse";')
        expect(o).toContain('native-cpi = <800>;')
        expect(o).toContain('cpi-max = <26000>;')
    })

    it('a mouse without cpi is an error: no pointer otherwise', () => {
        const r = compile(pad({ sensor }, [], { node: { personality: 'mouse' } }))
        expect(errors(r).join()).toMatch(/needs board.sensor.cpi/)
    })

    it('writes the qdec timings from JSON; 0 idle poll leaves interrupts on', () => {
        const o = overlayOf(
            compile(pad({ encoders: [{ a: 'P1.04', b: 'P1.05', sampleTimeUs: 1000, idlePollTimeUs: 0 }] })),
        )
        expect(o).toContain('sample-time-us = <1000>;')
        expect(o).toContain('idle-timeout-ms = <200>;')
        expect(o).not.toContain('idle-poll-time-us')
    })
})

describe.skipIf(!TC)('input shields pass dtc and the binding check', () => {
    it('with buttons, a slider, an encoder and a mouse node', () => {
        const r = compile(
            pad(
                {
                    buttons: [{ key: 2, pin: 'P0.26' }],
                    sliders: [{ adc: { adc: 'adc', channel: 1 } }],
                    encoders: [{ a: 'P1.04', b: 'P1.05' }],
                    sensor: { part: 'pixart,paw3395', bus: 'arduino_spi', motion: 'P1.10', cpi: { native: 800 } },
                },
                [{ x: 0, y: 1, r: -10 }],
            ),
        )
        const d = dtcCheck(TC!, overlayOf(r))
        expect(d.log).toBe('')
        expect(d.ok).toBe(true)
    })
})
