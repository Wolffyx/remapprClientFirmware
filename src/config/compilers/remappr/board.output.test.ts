// pattern-check: skip — test wiring: board-gen feature reach, the output group
// (L1.11, L1.15): matrix timings, haptic, LED zones and display parts.
import { describe, expect, it } from 'vitest'

import type { CompileResult } from '../../compiler'
import { getCompiler, parseKeymap } from '../../index'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

function pad(
    board: Record<string, unknown>,
    hardware: Record<string, unknown> = {},
): string {
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
            hardware,
        },
        layers: [{ name: 'base', bindings: ['A', 'B'] }],
        board: {
            controller: 'nrf52840dk/nrf52840',
            ...board,
            matrix: {
                diode: 'col2row',
                rows: ['P0.03'],
                cols: ['P1.01', 'P1.02'],
                ...((board.matrix as object) ?? {}),
            },
        },
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const file = (r: CompileResult, end: string): string =>
    String(r.files.find((f) => f.filename.endsWith(end))!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
const warnings = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'warn').map((d) => d.message)

const STRIP = { ws2812: { spi: 'spi3', dataPin: 'P1.13', chainLength: 12 } }
const OLED = {
    part: 'solomon,ssd1306fb',
    bus: 'i2c0',
    reg: 0x3c,
    width: 128,
    height: 32,
    props: {
        'segment-offset': 0,
        'page-offset': 0,
        'display-offset': 0,
        'multiplex-ratio': 31,
        'segment-remap': true,
        'com-invdir': false,
    },
}

describe('board.matrix timings', () => {
    it('writes every scan timing the binding has', () => {
        const r = compile(
            pad({
                matrix: {
                    sleepPollMs: 20,
                    settleUs: 30,
                    debouncePressMode: 'defer',
                    debouncePressMs: 5,
                    debounceReleaseMs: 10,
                },
            }),
        )
        expect(errors(r)).toEqual([])
        const o = file(r, '.overlay')
        expect(o).toContain('sleep-poll-period-ms = <20>;')
        expect(o).toContain('settle-time-us = <30>;')
        expect(o).toContain('debounce-press-mode = "defer";')
        expect(o).toContain('debounce-press-ms = <5>;')
        expect(o).toContain('debounce-release-ms = <10>;')
    })

    it('warns that a press debounce does nothing in eager mode', () => {
        const r = compile(pad({ matrix: { debouncePressMs: 5 } }))
        expect(warnings(r).join()).toMatch(/only applies with debouncePressMode "defer"/)
    })
})

describe('board.haptic', () => {
    it('emits remappr,haptic and turns the service on with a node bus', () => {
        const r = compile(
            pad({
                haptic: { pwm: 'pwm0', channel: 1, periodNs: 20000000, inverted: true },
                nodeBus: [{ uart: 'uart1' }],
            }),
        )
        expect(errors(r)).toEqual([])
        expect(file(r, '.overlay')).toContain('pwms = <&pwm0 1 20000000 PWM_POLARITY_INVERTED>;')
        expect(file(r, 'Kconfig.defconfig')).toContain('config REMAPPR_HAPTIC_SVC')
    })

    it('without a node bus nothing drives it: warned, service left off', () => {
        const r = compile(pad({ haptic: { pwm: 'pwm0', channel: 0, periodNs: 20000000 } }))
        expect(warnings(r).join()).toMatch(/no node-bus port/)
        expect(file(r, 'Kconfig.defconfig')).not.toContain('HAPTIC')
    })

    it('needs the period: it is a fact of the actuator', () => {
        expect(() => compile(pad({ haptic: { pwm: 'pwm0', channel: 0 } }))).toThrow()
    })
})

describe('board.ledZones', () => {
    it('emits one zone per role on the strip', () => {
        const r = compile(
            pad(
                {
                    ledZones: [
                        { target: 'backlight', offset: 0, length: 8 },
                        { target: 'per-key', offset: 8, length: 4 },
                    ],
                },
                STRIP,
            ),
        )
        expect(errors(r)).toEqual([])
        const o = file(r, '.overlay')
        expect(o).toContain('target = "per-key";')
        expect(o).toContain('per_key_zone: zone_1 {')
    })

    it('refuses zones past the chain, overlapping, twice for a role, or with no strip', () => {
        const past = compile(pad({ ledZones: [{ target: 'backlight', offset: 8, length: 8 }] }, STRIP))
        expect(errors(past).join()).toMatch(/past the 12-LED chain/)
        const overlap = compile(
            pad(
                {
                    ledZones: [
                        { target: 'backlight', offset: 0, length: 6 },
                        { target: 'underglow', offset: 4, length: 4 },
                    ],
                },
                STRIP,
            ),
        )
        expect(errors(overlap).join()).toMatch(/overlap/)
        const twice = compile(
            pad(
                {
                    ledZones: [
                        { target: 'backlight', offset: 0, length: 2 },
                        { target: 'backlight', offset: 2, length: 2 },
                    ],
                },
                STRIP,
            ),
        )
        expect(errors(twice).join()).toMatch(/both serve backlight/)
        const none = compile(pad({ ledZones: [{ target: 'backlight', offset: 0, length: 2 }] }))
        expect(errors(none).join()).toMatch(/has none/)
    })
})

describe('board.displays', () => {
    it('declares a panel from JSON, or points at the board one', () => {
        const r = compile(pad({ displays: [{ panel: OLED }, { panel: 'oled' }] }))
        expect(errors(r)).toEqual([])
        const o = file(r, '.overlay')
        expect(o).toContain('display_panel_0: ssd1306fb@3c {')
        expect(o).toContain('segment-remap;')
        expect(o).not.toContain('com-invdir')
        expect(o).toContain('display = <&oled>;')
        expect(file(r, 'Kconfig.defconfig')).toContain('config REMAPPR_DISPLAY_PART')
    })

    it('checks the panel strings it writes', () => {
        const r = compile(pad({ displays: [{ panel: { ...OLED, part: 'bad part', props: { label: 'a"b' } } }] }))
        expect(errors(r).length).toBe(2)
    })
})

describe.skipIf(!TC)('output shields pass dtc and the binding check', () => {
    it('with timings, a haptic, zones and a panel', () => {
        const r = compile(
            pad(
                {
                    matrix: { settleUs: 30, debouncePressMode: 'eager' },
                    haptic: { pwm: 'pwm0', channel: 0, periodNs: 20000000 },
                    ledZones: [{ target: 'underglow', offset: 0, length: 12 }],
                    displays: [{ panel: { ...OLED, props: { ...OLED.props, prechargep: 34 } } }],
                },
                STRIP,
            ),
        )
        const d = dtcCheck(TC!, file(r, '.overlay'))
        expect(d.log).toBe('')
        expect(d.ok).toBe(true)
    })

    it('and the binding check holds the panel to its driver binding', () => {
        const { 'multiplex-ratio': _drop, ...props } = OLED.props
        const r = compile(pad({ displays: [{ panel: { ...OLED, props } }] }))
        const d = dtcCheck(TC!, file(r, '.overlay'))
        expect(d.ok).toBe(false)
        expect(d.log).toMatch(/multiplex-ratio/)
    })
})
