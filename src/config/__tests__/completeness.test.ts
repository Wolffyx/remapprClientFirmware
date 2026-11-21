// Pattern check: no GoF pattern (-) — rejected — unit tests over the pure
// checkCompleteness verdicts; assertions on data, no abstraction.
import { describe, expect, it } from 'vitest'
import { checkCompleteness } from '../index'
import type { ConfigKeymap, FirmwareReadiness } from '../index'

const make = (keyboard: Record<string, unknown>, meta = {}): ConfigKeymap =>
    ({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'B', target: null, ...meta },
        keyboard: {
            id: 'b',
            name: 'B',
            keys: [{ x: 0, y: 0, w: 1, h: 1, r: 0 }],
            ...keyboard,
        },
        layers: [{ name: 'base', bindings: [{ type: 'transparent' }] }],
    }) as ConfigKeymap

const by = (r: FirmwareReadiness[], fw: string): FirmwareReadiness =>
    r.find((x) => x.firmware === fw)!

describe('checkCompleteness', () => {
    it('flags missing ZMK board as a blocking error', () => {
        const r = checkCompleteness(make({ firmware: ['zmk'] }))
        const zmk = by(r, 'zmk')
        expect(zmk.ready).toBe(false)
        expect(zmk.issues.some((i) => /controller board/.test(i.message))).toBe(
            true,
        )
    })

    it('marks a fully-specified ZMK board ready', () => {
        const r = checkCompleteness(
            make({
                firmware: ['zmk'],
                controller: { board: 'nice_nano_v2' },
                pins: { rows: ['&gpio0 4 0'], cols: ['&gpio0 5 0'] },
            }),
        )
        expect(by(r, 'zmk').ready).toBe(true)
    })

    it('requires QMK MCU + USB ids', () => {
        const r = checkCompleteness(make({ firmware: ['qmk'] }))
        const qmk = by(r, 'qmk')
        expect(qmk.ready).toBe(false)
        expect(
            qmk.issues.some((i) => /processor \+ bootloader/.test(i.message)),
        ).toBe(true)
        expect(
            qmk.issues.some((i) => /vendor \+ product/.test(i.message)),
        ).toBe(true)
    })

    it('warns on Vial UID + unlock combo, but stays ready', () => {
        const r = checkCompleteness(
            make(
                {
                    firmware: ['vial'],
                    controller: { developmentBoard: 'promicro' },
                    pins: { rows: ['B0'], cols: ['B1'] },
                },
                { vendorId: '0x1', productId: '0x2' },
            ),
        )
        const vial = by(r, 'vial')
        expect(vial.ready).toBe(true) // warnings only
        expect(vial.issues.every((i) => i.level === 'warn')).toBe(true)
        expect(vial.issues.some((i) => /Vial UID/.test(i.message))).toBe(true)
        expect(vial.issues.some((i) => /unlock combo/.test(i.message))).toBe(
            true,
        )
    })

    it('clears Vial warnings when UID + unlock are set', () => {
        const r = checkCompleteness(
            make(
                {
                    firmware: ['vial'],
                    controller: { developmentBoard: 'promicro' },
                    pins: { rows: ['B0'], cols: ['B1'] },
                    vial: {
                        uid: [1, 2, 3, 4, 5, 6, 7, 8],
                        unlockKeys: [[0, 0]],
                    },
                },
                { vendorId: '0x1', productId: '0x2' },
            ),
        )
        expect(by(r, 'vial').issues).toEqual([])
    })

    it('warns when a peripheral is on but its hardware pin is unset', () => {
        const r = checkCompleteness(
            make({
                firmware: ['zmk'],
                controller: { board: 'nice_nano_v2' },
                pins: { rows: ['&gpio0 4 0'], cols: ['&gpio0 5 0'] },
                firmwareConfig: {
                    backlight: true,
                    underglow: true,
                    extPower: true,
                },
            }),
        )
        const zmk = by(r, 'zmk')
        expect(zmk.ready).toBe(true) // warnings only
        expect(zmk.issues.some((i) => /PWM pin/.test(i.message))).toBe(true)
        expect(zmk.issues.some((i) => /WS2812 data pin/.test(i.message))).toBe(
            true,
        )
        expect(zmk.issues.some((i) => /control GPIO/.test(i.message))).toBe(
            true,
        )
    })

    it('clears peripheral warnings when hardware pins are set', () => {
        const r = checkCompleteness(
            make({
                firmware: ['zmk'],
                controller: { board: 'nice_nano_v2' },
                pins: { rows: ['&gpio0 4 0'], cols: ['&gpio0 5 0'] },
                firmwareConfig: {
                    backlight: true,
                    underglow: true,
                    extPower: true,
                },
                hardware: {
                    backlightPwm: {
                        instance: 'pwm0',
                        channel: 0,
                        pin: 'P0.13',
                    },
                    ws2812: { spi: 'spi3', dataPin: 'P1.13', chainLength: 5 },
                    extPowerCtrl: { controlGpio: 'P0.14' },
                },
            }),
        )
        const zmk = by(r, 'zmk')
        expect(zmk.issues.some((i) => /Hardware pins/.test(i.message))).toBe(
            false,
        )
    })

    it('falls back to ZMK when no firmware is selected', () => {
        const r = checkCompleteness(make({}))
        expect(r.map((x) => x.firmware)).toEqual(['zmk'])
    })

    it('checks Remappr as a Zephyr shield, not a QMK build', () => {
        const remappr = by(
            checkCompleteness(
                make({
                    firmware: ['remappr'],
                    controller: { board: 'nice_nano_v2' },
                    pins: { rows: ['D4'], cols: ['D5'] },
                }),
            ),
            'remappr',
        )
        expect(remappr.ready).toBe(true)
        expect(remappr.issues).toEqual([])
    })

    it('flags a Remappr design without a board, and features without pins', () => {
        const remappr = by(
            checkCompleteness(
                make({ firmware: ['remappr'], features: ['lighting'] }),
            ),
            'remappr',
        )
        const text = remappr.issues.map((i) => i.message).join(' ')
        expect(remappr.ready).toBe(false)
        expect(text).toContain('controller board')
        expect(text).toContain('LED data pin')
        expect(text).not.toContain('QMK')
    })
})
