// Pattern check: no GoF pattern (-) — rejected — pure DT-fragment emitters for
// the node-bus and radio bindings, in the PeripheralFragment shape.
//
// The links between a device's parts, for the board generator:
//   • board.nodeBus   → one remappr,node-bus-port per inter-node UART, with the
//                       UART turned on (its pinctrl, baud and DMA when given).
//                       A split keyboard is one device over these ports.
//   • board.radioLink → remappr,spi-link: the radio chip on SPI, with its
//                       DATA_READY and reset pins; picks the SPI radio backend.
//   • board.radio     → remappr,radio-config: the RF channel seed, under the
//                       `remappr_radio` label the dongle and the in-process
//                       radio link read. With the radio chip on SPI the seed
//                       is the chip's own, so it is refused there.
// The ports' Kconfig comes from the JSON too: the node bus is on when a port
// is declared, and the static main role is on for node.role "coordinator".
import type { DiagnosticBag } from '../../diagnostics'
import { ROLE_FLAGS } from '../../pinmaps'
import type { BoardNodeBusPort, ConfigKeymap } from '../../types'
import type { PeripheralFragment } from './boardHardware'
import type { PinBook } from './boardPins'
import { dtDmasOk, dtLabel, dtPhandleOk, dtString } from './dtText'

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

/** Labels a raw `dmas` value refers to (`&gpdma1`), to turn on. */
const dmaControllers = (dmas: string): string[] => [
    ...new Set([...dmas.matchAll(/&([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])),
]

/** The `&usartN { ... }` block that turns one port's UART on. */
function uartBlock(
    port: BoardNodeBusPort,
    uart: string,
    diag: DiagnosticBag,
    path: (string | number)[],
): string[] {
    const pinctrl = port.pinctrl ?? []
    pinctrl.forEach((p, j) => {
        if (!dtPhandleOk(p))
            diag.error(`pinctrl entry "${p}" is not a phandle like "&usart2_tx_pd5"`, [...path, 'pinctrl', j])
    })
    if (port.dmas !== undefined && !dtDmasOk(port.dmas))
        diag.error(`dmas "${port.dmas}" is not a list of <...> cell groups`, [...path, 'dmas'])
    return [
        `&${uart} {`,
        ...(pinctrl.length
            ? [`\tpinctrl-0 = <${pinctrl.map((p) => p.trim()).join(' ')}>;`, `\tpinctrl-names = "default";`]
            : []),
        ...(port.currentSpeed ? [`\tcurrent-speed = <${port.currentSpeed}>;`] : []),
        ...(port.dmas ? [`\tdmas = ${port.dmas.trim()};`, `\tdma-names = "tx", "rx";`] : []),
        `\tstatus = "okay";`,
        `};`,
        ``,
    ]
}

/** A presence-detect pin: high while plugged in, unless the JSON says low. */
const detectFlags = (port: BoardNodeBusPort): string =>
    port.detectActiveLow ? ROLE_FLAGS.direct : ROLE_FLAGS.input

/** The side strap (§5.2): asserted = right; high unless the JSON says low. */
const strapFlags = (port: BoardNodeBusPort): string =>
    port.sideStrapActiveLow ? ROLE_FLAGS.direct : ROLE_FLAGS.input

/** One UART per port, at most one upstream port, and none on the main. */
function checkTopology(
    config: ConfigKeymap,
    ports: BoardNodeBusPort[],
    diag: DiagnosticBag,
): void {
    const up = ports.filter((p) => p.direction === 'upstream').length
    if (up > 1)
        diag.error(`${up} upstream node-bus ports: a node has at most one`, ['board', 'nodeBus'])
    const role = config.node?.role
    if (role === 'coordinator' && up > 0)
        diag.error(
            `the coordinator has no parent, so it has no upstream node-bus port`,
            ['board', 'nodeBus'],
        )
    if (role === 'follower' && up === 0)
        diag.warn(
            `a follower forwards its input out of its upstream port, and none is declared`,
            ['board', 'nodeBus'],
        )
    const seen = new Set<string>()
    ports.forEach((p, i) => {
        const u = p.uart.trim().replace(/^&/, '')
        if (seen.has(u))
            diag.error(`UART ${u} backs two node-bus ports`, ['board', 'nodeBus', i, 'uart'])
        seen.add(u)
    })
}

/** remappr,node-bus-port nodes from board.nodeBus. */
export function emitNodeBus(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const ports = config.board?.nodeBus
    if (!ports || ports.length === 0) return EMPTY
    checkTopology(config, ports, diag)
    const uarts: string[] = []
    const nodes: string[] = []
    const dmas = new Set<string>()
    ports.forEach((port, i) => {
        const path = ['board', 'nodeBus', i]
        const uart = dtLabel(port.uart, diag, [...path, 'uart'])
        const dir = port.direction ?? 'downstream'
        uarts.push(...uartBlock(port, uart, diag, path))
        if (port.dmas) dmaControllers(port.dmas).forEach((d) => dmas.add(d))
        nodes.push(
            `\tnode_bus_${i}: node_bus_${i} {`,
            `\t\tcompatible = "remappr,node-bus-port";`,
            `\t\tuart = <&${uart}>;`,
            `\t\tdirection = "${dir}";`,
            ...(port.detect
                ? [`\t\tdetect-gpios = <${book.spec(port.detect, detectFlags(port), [...path, 'detect'])}>;`]
                : []),
            ...(port.sideStrap
                ? [`\t\tside-gpios = <${book.spec(port.sideStrap, strapFlags(port), [...path, 'sideStrap'])}>;`]
                : []),
            ...(port.label
                ? [`\t\tlabel = "${dtString(port.label, diag, [...path, 'label'])}";`]
                : []),
            `\t};`,
        )
    })
    const dmaOn = [...dmas].flatMap((d) => [`&${d} {`, `\tstatus = "okay";`, `};`, ``])
    const stm32Dma = dmas.size > 0 && book.target.soc === 'stm32'
    return {
        includes: stm32Dma ? [`#include <zephyr/dt-bindings/dma/stm32_dma.h>`] : [],
        nodes: [...dmaOn, ...uarts, `/ {`, ...nodes, `};`],
        kconfig: [
            ``,
            `# ${ports.length} node-bus port(s) from board.nodeBus.`,
            `config REMAPPR_NODE_BUS`,
            `\tdefault y`,
            ...(config.node?.role === 'coordinator'
                ? [`config REMAPPR_NODE_BUS_MAIN`, `\tdefault y`]
                : []),
        ],
    }
}

/** remappr,spi-link from board.radioLink: the radio chip on SPI. */
export function emitRadioLink(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const link = config.board?.radioLink
    if (!link) return EMPTY
    const path = (k: string): (string | number)[] => ['board', 'radioLink', k]
    const spi = dtLabel(link.spi, diag, path('spi'))
    const pin = (k: 'cs' | 'dataReady' | 'reset', flags: string): string =>
        book.spec(link[k] ?? '', flags, path(k))
    return {
        includes: [],
        nodes: [
            `&${spi} {`,
            `\tstatus = "okay";`,
            ...(link.cs ? [`\tcs-gpios = <${pin('cs', 'GPIO_ACTIVE_LOW')}>;`] : []),
            ``,
            `\tradio_link: radio-link@0 {`,
            `\t\tcompatible = "remappr,spi-link";`,
            `\t\treg = <0>;`,
            `\t\tspi-max-frequency = <${link.spiMaxHz ?? 8000000}>;`,
            `\t\tdata-ready-gpios = <${pin('dataReady', 'GPIO_ACTIVE_HIGH')}>;`,
            ...(link.reset
                ? [`\t\treset-gpios = <${pin('reset', '(GPIO_ACTIVE_LOW | GPIO_PULL_UP)')}>;`]
                : []),
            `\t};`,
            `};`,
        ],
        kconfig: [
            ``,
            `# The 2.4 GHz link runs on the radio chip over ${spi}.`,
            `choice REMAPPR_RADIO_BACKEND`,
            `\tdefault REMAPPR_RADIO_SPI`,
            `endchoice`,
        ],
    }
}

/** The label the firmware reads the seed by (DT_NODELABEL(remappr_radio) in
 *  app/dongle and subsys/remappr/radio_link), on the node path the dongle
 *  board overlays use, so a shield and an overlay merge into one node. */
export const RADIO_CONFIG_LABEL = 'remappr_radio'

/** remappr,radio-config from board.radio. */
export function emitRadioConfig(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): PeripheralFragment {
    const seed = config.board?.radio?.channelSeed
    if (!seed) return EMPTY
    if (config.board?.radioLink) {
        diag.error(
            `board.radio.channelSeed has no reader here: with the radio chip on SPI ` +
                `(board.radioLink) the link runs on the chip, which reads its own ` +
                `devicetree. Give the seed in the radio chip's or the dongle's board JSON`,
            ['board', 'radio', 'channelSeed'],
        )
        return EMPTY
    }
    return {
        includes: [],
        nodes: [
            `/ {`,
            `\t${RADIO_CONFIG_LABEL}: remappr-radio {`,
            `\t\tcompatible = "remappr,radio-config";`,
            `\t\tchannel-seed = /bits/ 8 <${seed.join(' ')}>;`,
            `\t};`,
            `};`,
        ],
        kconfig: [],
    }
}
