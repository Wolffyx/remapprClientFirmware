// pattern-check: skip — unit tests for the screen and battery exports per firmware.
import { describe, expect, it } from 'vitest'
import { buildProjectBundle, parseKeymap, type CanonDisplay, type ConfigKeymap } from '../index'

const board = (opts: {
    display?: CanonDisplay
    pins?: Record<string, string>
    battery?: { pin: string; outputOhms?: number; fullOhms?: number }
    controller?: string
    firmware?: string[]
}): ConfigKeymap =>
    parseKeymap(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'Board S', target: 'zmk' },
            keyboard: {
                id: 'board_s',
                name: 'Board S',
                keys: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                ],
                controller: { board: opts.controller ?? 'nice_nano_v2', shield: 'boards' },
                firmware: opts.firmware ?? ['zmk'],
                pins: { rows: ['D4'], cols: ['D5', 'D6'] },
                hardware: opts.battery ? { battery: opts.battery } : undefined,
                parts: opts.display
                    ? [{ id: 'display-1', kind: 'display', name: 'Screen', x: 3, y: 0, w: 3, h: 1.5, pins: opts.pins, display: opts.display }]
                    : undefined,
            },
            layers: [{ name: 'base', bindings: ['A', 'B'] }],
        }),
    )

const file = (c: ConfigKeymap, target: 'zmk' | 'remappr' | 'qmk', end: string): string => {
    const f = buildProjectBundle(c, target).files.find((x) => x.filename.endsWith(end))
    return f ? String(f.content) : ''
}
const warnings = (c: ConfigKeymap, target: 'zmk' | 'remappr' | 'qmk'): string =>
    buildProjectBundle(c, target)
        .diagnostics.map((d) => d.message)
        .join('\n')

const SSD1306_32: CanonDisplay = { module: 'ssd1306-128x32', chip: 'SSD1306', bus: 'i2c', width: 128, height: 32, address: 0x3c }
const SH1106: CanonDisplay = { module: 'sh1106-128x64', chip: 'SH1106', bus: 'i2c', width: 128, height: 64, address: 0x3c }
const NICE_VIEW: CanonDisplay = { module: 'nice-view', chip: 'Sharp memory LCD', bus: 'spi', width: 160, height: 68 }

describe('ZMK screen', () => {
    it('writes an SSD1306 on the board I²C like corne, and turns the display on', () => {
        const c = board({ display: SSD1306_32 })
        const overlay = file(c, 'zmk', '.overlay')
        expect(overlay).toContain('&pro_micro_i2c {')
        expect(overlay).toContain('remappr_screen: ssd1306@3c {')
        expect(overlay).toContain('compatible = "solomon,ssd1306fb";')
        expect(overlay).toContain('multiplex-ratio = <31>;')
        expect(overlay).toContain('com-sequential;')
        expect(overlay).toContain('zephyr,display = &remappr_screen;')
        expect(file(c, 'zmk', '.conf')).toContain('CONFIG_ZMK_DISPLAY=y')
    })

    it('puts a nice!view on the board SPI with its chip select active high', () => {
        const overlay = file(board({ display: NICE_VIEW, pins: { cs: 'D7' } }), 'zmk', '.overlay')
        expect(overlay).toContain('&pro_micro_spi {')
        expect(overlay).toContain('cs-gpios = <&pro_micro 7 GPIO_ACTIVE_HIGH>;')
        expect(overlay).toContain('compatible = "sharp,ls0xx";')
    })

    it('leaves out a chip ZMK has no driver for, and says why', () => {
        const c = board({ display: SH1106 })
        expect(file(c, 'zmk', '.overlay')).not.toContain('remappr_screen')
        expect(file(c, 'zmk', '.conf')).not.toContain('\nCONFIG_ZMK_DISPLAY=y')
        expect(warnings(c, 'zmk')).toContain('ZMK has no driver for SH1106')
    })
})

describe('Remappr screen', () => {
    it('writes the rig’s SH1106 node and turns the OLED service on', () => {
        const c = board({ display: SH1106, firmware: ['remappr'] })
        const overlay = file(c, 'remappr', '.overlay')
        expect(overlay).toContain('compatible = "sinowealth,sh1106";')
        expect(overlay).toContain('segment-offset = <2>;')
        const kconfig = file(c, 'remappr', 'Kconfig.defconfig')
        expect(kconfig).toContain('config REMAPPR_OLED')
        expect(kconfig).toContain('config I2C')
    })
})

describe('QMK screen', () => {
    it('turns the OLED driver on for an SH1106', () => {
        const c = board({ display: SH1106, firmware: ['qmk'] })
        expect(file(c, 'qmk', 'rules.mk')).toContain('OLED_ENABLE = yes')
        const h = file(c, 'qmk', 'config.h')
        expect(h).toContain('#define OLED_IC OLED_IC_SH1106')
        expect(h).toContain('#define OLED_DISPLAY_128X64')
    })

    it('says when QMK has no driver', () => {
        const c = board({ display: NICE_VIEW, firmware: ['qmk'] })
        expect(file(c, 'qmk', 'rules.mk')).not.toContain('OLED_ENABLE')
        expect(file(c, 'qmk', 'config.h')).toContain('QMK has no driver for it')
    })
})

describe('battery sense', () => {
    const bat = { pin: 'D21', outputOhms: 510000, fullOhms: 1510000 }

    it('ZMK: a voltage divider on the pin’s AIN, chosen as the battery', () => {
        const overlay = file(board({ battery: bat }), 'zmk', '.overlay')
        expect(overlay).toContain('zmk,battery = &remappr_vbatt;')
        expect(overlay).toContain('compatible = "zmk,battery-voltage-divider";')
        expect(overlay).toContain('io-channels = <&adc 7>;')
        expect(overlay).toContain('full-ohms = <1510000>;')
    })

    it('ZMK needs both resistor values', () => {
        const c = board({ battery: { pin: 'D21' } })
        expect(file(c, 'zmk', '.overlay')).not.toContain('remappr_vbatt')
        expect(warnings(c, 'zmk')).toContain('both divider resistor values')
    })

    it('Remappr: a remappr,battery node and its SAADC channel', () => {
        const overlay = file(board({ battery: { pin: 'D21' }, firmware: ['remappr'] }), 'remappr', '.overlay')
        expect(overlay).toContain('compatible = "remappr,battery";')
        expect(overlay).toContain('zephyr,input-positive = <NRF_SAADC_AIN7>;')
    })

    it('is left out on a board that is not nRF', () => {
        const c = board({ battery: bat, controller: 'sparkfun_pro_micro_rp2040' })
        expect(warnings(c, 'zmk')).toContain('only nRF boards are written')
    })
})
