// pattern-check: skip — test wiring: board-gen feature reach, the power group
// (L1.11): battery, status LEDs and power-off from board JSON.
import { describe, expect, it } from 'vitest'

import type { CompileResult } from '../../compiler'
import { getCompiler, parseKeymap } from '../../index'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

function pad(board: Record<string, unknown>): string {
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
        board: {
            controller: 'nrf52840dk/nrf52840',
            matrix: { diode: 'col2row', rows: ['P0.03'], cols: ['P1.01', 'P1.02'] },
            ...board,
        },
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const overlayOf = (r: CompileResult): string =>
    String(r.files.find((f) => f.filename.endsWith('.overlay'))!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

const ADC4 = {
    adc: 'adc',
    channel: 4,
    setup: {
        gain: 'ADC_GAIN_1_6',
        reference: 'ADC_REF_INTERNAL',
        inputPositive: 'NRF_SAADC_AIN4',
        resolution: 12,
    },
}

describe('board.battery', () => {
    it('emits remappr,battery on an ADC channel with its channel node', () => {
        const r = compile(pad({ battery: { adc: ADC4, divider: { outputOhms: 10, fullOhms: 14 } } }))
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o).toContain('io-channels = <&adc 4>;')
        expect(o).toContain('output-ohms = <10>;')
        expect(o).toContain('channel@4 {')
        expect(o).toContain('zephyr,input-positive = <NRF_SAADC_AIN4>;')
        expect(o).toContain('#include <zephyr/dt-bindings/adc/nrf-saadc.h>')
    })

    it('refers to a channel the board configures when there is no setup', () => {
        const o = overlayOf(compile(pad({ battery: { adc: { adc: 'adc', channel: 2 } } })))
        expect(o).toContain('io-channels = <&adc 2>;')
        expect(o).not.toContain('channel@2')
    })

    it('takes a fuel gauge instead', () => {
        const o = overlayOf(compile(pad({ battery: { fuelGauge: '&max17048' } })))
        expect(o).toContain('fuel-gauge = <&max17048>;')
    })

    it('needs exactly one source and a descending curve', () => {
        expect(() => compile(pad({ battery: {} }))).toThrow()
        expect(() =>
            compile(pad({ battery: { adc: ADC4, fuelGauge: 'fg' } })),
        ).toThrow()
        expect(() =>
            compile(pad({ battery: { adc: ADC4, ocvCurve: [[3000, 0], [4200, 100]] } })),
        ).toThrow()
    })

    it('needs the analog input on an nRF SAADC channel', () => {
        const setup = { gain: 'ADC_GAIN_1_6', reference: 'ADC_REF_INTERNAL', resolution: 12 }
        const r = compile(pad({ battery: { adc: { adc: 'adc', channel: 4, setup } } }))
        expect(errors(r).join()).toMatch(/inputPositive/)
    })

    it('needs the resolution with a setup: Zephyr refuses a 0-bit channel', () => {
        const { resolution: _drop, ...setup } = ADC4.setup
        expect(() =>
            compile(pad({ battery: { adc: { ...ADC4, setup } } })),
        ).toThrow(/resolution/)
        expect(overlayOf(compile(pad({ battery: { adc: ADC4 } })))).toContain(
            'zephyr,resolution = <12>;',
        )
    })

    it('reads the charger pin active low with a pull-up, or active high', () => {
        const low = overlayOf(compile(pad({ battery: { adc: ADC4, charging: 'P0.29' } })))
        expect(low).toContain('charging-gpios = <&gpio0 29 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;')
        const high = overlayOf(
            compile(pad({ battery: { adc: ADC4, charging: 'P0.29', chargingActiveHigh: true } })),
        )
        expect(high).toContain('charging-gpios = <&gpio0 29 (GPIO_PULL_DOWN | GPIO_ACTIVE_HIGH)>;')
        expect(() =>
            compile(pad({ battery: { adc: ADC4, chargingActiveHigh: true } })),
        ).toThrow(/goes with charging/)
    })

    it('refuses a charging pin the matrix uses', () => {
        const r = compile(pad({ battery: { adc: ADC4, charging: 'P0.03' } }))
        expect(errors(r).join()).toMatch(/used twice/)
    })
})

describe('board.statusLeds', () => {
    it('points at a board LED, or declares one on a pin', () => {
        const r = compile(
            pad({
                statusLeds: [
                    { function: 'link', led: 'led0' },
                    { function: 'battery', pin: 'P1.08', activeLow: true, flashMs: 900 },
                ],
            }),
        )
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o).toContain('led = <&led0>;')
        expect(o).toContain('compatible = "gpio-leds";')
        expect(o).toContain('gpios = <&gpio1 8 GPIO_ACTIVE_LOW>;')
        expect(o).toContain('led = <&status_led_1>;')
        expect(o).toContain('flash-ms = <900>;')
    })

    it('needs exactly one of pin and led, and a known function', () => {
        expect(() => compile(pad({ statusLeds: [{ function: 'link' }] }))).toThrow()
        expect(() =>
            compile(pad({ statusLeds: [{ function: 'caps', led: 'led0' }] })),
        ).toThrow()
    })
})

describe('board.powerOff', () => {
    it('emits the policy; wake-first pins are the inputs, not new pins', () => {
        const r = compile(pad({ powerOff: { partialWake: true, wakeFirst: ['P0.03'] } }))
        expect(errors(r)).toEqual([])
        const o = overlayOf(r)
        expect(o).toContain('partial-wake;')
        expect(o).toContain('wake-first-gpios = <&gpio0 3 0>;')
        expect(o).not.toContain('&pwr')
    })

    it('turns on the STM32 wake-up lines', () => {
        const json = JSON.parse(pad({ powerOff: {} }))
        json.board.controller = 'nucleo_u5a5zj_q'
        json.board.matrix = { rows: ['PE11'], cols: ['PF15', 'PE13'] }
        const o = overlayOf(compile(JSON.stringify(json)))
        expect(o).toContain('&pwr {')
    })
})

describe.skipIf(!TC)('power shields pass dtc and the binding check', () => {
    it('with every field set', () => {
        const r = compile(
            pad({
                battery: {
                    adc: ADC4,
                    divider: { outputOhms: 10, fullOhms: 14 },
                    charging: 'P0.29',
                    ocvCurve: [[4200, 100], [3300, 0]],
                },
                statusLeds: [
                    { function: 'link', led: 'led0', blinkMs: 0 },
                    { function: 'heartbeat', pin: 'P1.08' },
                ],
                powerOff: { partialWake: true, wakeFirst: ['P0.03'] },
            }),
        )
        const d = dtcCheck(TC!, overlayOf(r))
        expect(d.log).toBe('')
        expect(d.ok).toBe(true)
    })

    it('and the binding check catches a value outside an enum', () => {
        const o = overlayOf(compile(pad({ statusLeds: [{ function: 'link', led: 'led0' }] })))
        const d = dtcCheck(TC!, o.replace('function = "link"', 'function = "caps"'))
        expect(d.ok).toBe(false)
        expect(d.log).toMatch(/caps/)
    })
})
