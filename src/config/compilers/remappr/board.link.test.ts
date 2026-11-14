// pattern-check: skip — test wiring: board-gen feature reach, the link group
// (L1.11): node-bus ports, the radio chip on SPI and the RF channel seed.
import { describe, expect, it } from 'vitest'

import type { CompileResult } from '../../compiler'
import { getCompiler, parseKeymap } from '../../index'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const TC = dtcToolchain()

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
        board: {
            controller: 'nucleo_u5a5zj_q',
            matrix: { diode: 'row2col', rows: ['PE11'], cols: ['PF15', 'PE13'] },
            ...board,
        },
    })
}

const compile = (json: string): CompileResult =>
    getCompiler('remappr-board').compile(parseKeymap(json))
const file = (r: CompileResult, end: string): string =>
    String(r.files.find((f) => f.filename.endsWith(end))!.content)
const errors = (r: CompileResult): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('board.nodeBus', () => {
    it('emits a port per UART and turns the UART and its DMA on', () => {
        const r = compile(
            pad(
                {
                    nodeBus: [
                        {
                            uart: 'usart2',
                            currentSpeed: 1000000,
                            pinctrl: ['&usart2_tx_pd5', '&usart2_rx_pd6'],
                            dmas: '<&gpdma1 2 27 STM32_DMA_PERIPH_TX>, <&gpdma1 3 26 STM32_DMA_PERIPH_RX>',
                            detect: 'PB2',
                        },
                    ],
                },
                { role: 'coordinator' },
            ),
        )
        expect(errors(r)).toEqual([])
        const o = file(r, '.overlay')
        expect(o).toContain('uart = <&usart2>;')
        expect(o).toContain('direction = "downstream";')
        expect(o).toContain('detect-gpios = <&gpiob 2 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>;')
        expect(o).toContain('&gpdma1 {')
        expect(o).toContain('#include <zephyr/dt-bindings/dma/stm32_dma.h>')
        const k = file(r, 'Kconfig.defconfig')
        expect(k).toContain('config REMAPPR_NODE_BUS\n')
        expect(k).toContain('config REMAPPR_NODE_BUS_MAIN')
    })

    it('a follower is not the main', () => {
        const r = compile(
            pad({ nodeBus: [{ uart: 'usart2', direction: 'upstream' }] }, { role: 'follower' }),
        )
        expect(file(r, 'Kconfig.defconfig')).not.toContain('NODE_BUS_MAIN')
    })

    it('refuses two upstream ports, an upstream port on the main, and a UART twice', () => {
        const two = compile(
            pad({
                nodeBus: [
                    { uart: 'usart2', direction: 'upstream' },
                    { uart: 'usart3', direction: 'upstream' },
                ],
            }),
        )
        expect(errors(two).join()).toMatch(/at most one/)
        const main = compile(
            pad({ nodeBus: [{ uart: 'usart2', direction: 'upstream' }] }, { role: 'coordinator' }),
        )
        expect(errors(main).join()).toMatch(/no parent/)
        const dup = compile(pad({ nodeBus: [{ uart: 'usart2' }, { uart: '&usart2' }] }))
        expect(errors(dup).join()).toMatch(/two node-bus ports/)
    })

    it('checks the raw strings it writes', () => {
        const r = compile(
            pad({ nodeBus: [{ uart: 'usart2', pinctrl: ['usart2_tx'], dmas: 'gpdma1 2', label: 'a"b' }] }),
        )
        expect(errors(r).length).toBe(3)
    })
})

describe('board.radioLink and board.radio', () => {
    it('emits the spi-link node and picks the SPI radio backend', () => {
        const r = compile(pad({ radioLink: { spi: 'spi1', cs: 'PD14', dataReady: 'PD15' } }))
        expect(errors(r)).toEqual([])
        const o = file(r, '.overlay')
        expect(o).toContain('compatible = "remappr,spi-link";')
        expect(o).toContain('cs-gpios = <&gpiod 14 GPIO_ACTIVE_LOW>;')
        expect(o).toContain('data-ready-gpios = <&gpiod 15 GPIO_ACTIVE_HIGH>;')
        expect(file(r, 'Kconfig.defconfig')).toContain('default REMAPPR_RADIO_SPI')
    })

    it('refuses a radio pin the matrix uses', () => {
        const r = compile(pad({ radioLink: { spi: 'spi1', dataReady: 'PE11' } }))
        expect(errors(r).join()).toMatch(/used twice/)
    })

    it('writes the channel seed as bytes, and refuses a channel past 100', () => {
        const o = file(compile(pad({ radio: { channelSeed: [2, 26, 100] } })), '.overlay')
        expect(o).toContain('channel-seed = [02 1a 64];')
        expect(() => compile(pad({ radio: { channelSeed: [101] } }))).toThrow()
    })
})

describe.skipIf(!TC)('link shields pass dtc and the binding check', () => {
    it('with every field set', () => {
        const r = compile(
            pad(
                {
                    nodeBus: [
                        { uart: 'usart2', direction: 'downstream', label: 'dn', detect: 'PB2' },
                        { uart: 'usart3', direction: 'upstream', currentSpeed: 1000000 },
                    ],
                    radioLink: { spi: 'spi1', cs: 'PD14', dataReady: 'PD15', reset: 'PF12', spiMaxHz: 4000000 },
                    radio: { channelSeed: [2, 26, 50] },
                },
                { role: 'follower' },
            ),
        )
        const d = dtcCheck(TC!, file(r, '.overlay'))
        expect(d.log).toBe('')
        expect(d.ok).toBe(true)
    })

    it('and the binding check sees the spi-link on its bus', () => {
        const o = file(compile(pad({ radioLink: { spi: 'spi1', dataReady: 'PD15' } })), '.overlay')
        const d = dtcCheck(TC!, o.replace(/\t\tdata-ready-gpios = .*\n/, ''))
        expect(d.ok).toBe(false)
        expect(d.log).toMatch(/data-ready-gpios/)
    })
})
