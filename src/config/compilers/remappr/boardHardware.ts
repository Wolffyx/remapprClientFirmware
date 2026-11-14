// Pattern check: no GoF pattern (-) — rejected — pure DT-fragment emitters
// (ws2812 strip + gpio-qdec) for the remappr board generator; string templating
// over config, no abstraction.
//
// Optional peripheral overlay nodes for the remappr-board shield, split out of
// board.ts to keep the matrix generator focused. Both are firmware-native and
// gated on explicit hardware config (absent → empty fragment):
//   • RGB  — a WS2812 SPI led-strip + `chosen remappr,led-strip` (the render
//            target the runtime paints per-key colors onto), on an nRF SPIM or
//            an STM32 SPI; the bit frames follow the SPI clock.
//   • encoders — stock `gpio-qdec` rotation nodes from board.encoders. Rotation →
//            behavior-engine binding is firmware-side + HIL-deferred, so this
//            declares the hardware only (warned).
//   • sensor — a motion sensor on SPI from board.sensor, carrying the product's
//            defaults from node.sensor.defaults as the generic
//            `remappr,setting-defaults` (sensor-settings plan §4b). Its driver
//            enables itself from devicetree.
import {
    registrySetting,
    sensorSettingId,
    sensorWireValue,
} from '../../../clients/remappr/sensorRegistry'
import type { DiagnosticBag } from '../../diagnostics'
import { ROLE_FLAGS } from '../../pinmaps'
import type { CanonWs2812, ConfigKeymap, ConfigSensorValue } from '../../types'
import type { PinBook, Soc } from './boardPins'

/** A peripheral's contribution to the shield: header `#include`s, top-level DT
 *  blocks (appended after the main `/ {}`), and Kconfig.defconfig lines. */
export interface PeripheralFragment {
    includes: string[]
    nodes: string[]
    kconfig: string[]
}

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

// pattern-check: skip — no GoF pattern; private DT-string emitters
/** WS2812 wire order → `color-mapping` LED_COLOR_ID_* token list. */
function colorMapping(order: string): string {
    const M: Record<string, string> = {
        R: 'RED',
        G: 'GREEN',
        B: 'BLUE',
        W: 'WHITE',
    }
    return (order || 'GRB')
        .toUpperCase()
        .split('')
        .map((c) => `LED_COLOR_ID_${M[c] ?? 'GREEN'}`)
        .join(' ')
}

/** The SPI byte the strip reads as one WS2812 bit. A byte is sent per bit:
 *  one low lead-in bit, then the high pulse, then low. The lead-in matters on
 *  STM32, whose SPI drives the first bit onto MOSI as soon as it is enabled,
 *  before the clock runs; a symbol that starts high stretched the first pulse
 *  into a '1', so LED 1 always showed green (bench14, HW-verified).
 *
 *  The pairs known to work on hardware at each SoC's default clock are used
 *  as they are; any other clock gets frames computed from its bit time, aiming
 *  at 0.4 us for a '0' and 0.8 us for a '1' within the WS2812 tolerances. */
const PROVEN_FRAMES: Record<string, { one: number; zero: number }> = {
    'nrf@4000000': { one: 0x70, zero: 0x40 },
    'stm32@5000000': { one: 0x78, zero: 0x60 },
}

/** `n` high bits after the low lead-in bit, as a byte. */
const pulse = (n: number): number => ((1 << n) - 1) << (7 - n)

function ws2812Frames(
    soc: Soc,
    hz: number,
): { one: number; zero: number } | null {
    const proven = PROVEN_FRAMES[`${soc}@${hz}`]
    if (proven) return proven
    const bitNs = 1e9 / hz
    const n0 = Math.round(400 / bitNs)
    const n1 = Math.round(800 / bitNs)
    const t0 = n0 * bitNs
    const t1 = n1 * bitNs
    const fits =
        n0 >= 1 && n1 <= 7 && n1 > n0 && t0 >= 250 && t0 <= 550 && t1 >= 650 && t1 <= 950
    return fits ? { one: pulse(n1), zero: pulse(n0) } : null
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`

/** The `led_strip` child shared by both SPI paths. */
function stripNode(
    ws: CanonWs2812,
    hz: number,
    frames: { one: number; zero: number },
): string[] {
    return [
        `\tled_strip: ws2812@0 {`,
        `\t\tcompatible = "worldsemi,ws2812-spi";`,
        `\t\treg = <0>;`,
        `\t\tspi-max-frequency = <${hz}>;`,
        `\t\tchain-length = <${ws.chainLength}>;`,
        `\t\t/* One low lead-in bit, then the pulse: ${hz} Hz SPI clock. */`,
        `\t\tspi-one-frame = <${hex(frames.one)}>;`,
        `\t\tspi-zero-frame = <${hex(frames.zero)}>;`,
        `\t\tcolor-mapping = <${colorMapping(ws.colorOrder ?? 'GRB')}>;`,
        `\t};`,
    ]
}

const CHOSEN_STRIP = [
    `/ {`,
    `\tchosen {`,
    `\t\t/* Runtime RGB service renders the per-key map / effects here. */`,
    `\t\tremappr,led-strip = &led_strip;`,
    `\t};`,
    `};`,
]

const RGB_KCONFIG = [
    `config REMAPPR_RGB_LED`,
    `\tdefault y`,
    `config SPI`,
    `\tdefault y`,
    `config WS2812_STRIP_SPI`,
    `\tdefault y`,
]

/** STM32 WS2812-over-SPI shield fragment. Unlike nRF (EasyDMA), an STM32 SPI must
 *  be GPDMA-fed or inter-byte gaps latch as a WS2812 reset (→ dark); it also needs
 *  the SPI controller's own pinctrl and (on the Arduino bus) its cs-gpios dropped.
 *  Those board/SoC specifics come from `ws.stm32` (raw — exact GPDMA request lines
 *  and pin-AF nodes can't be guessed). Motorola framing: TI framing corrupts the
 *  raw WS2812 bitstream. */
function emitRgbStm32(
    ws: CanonWs2812,
    hz: number,
    frames: { one: number; zero: number },
): PeripheralFragment {
    const s = ws.stm32!
    // GPDMA is opt-in: present → gapless color-correct path; absent → the basic
    // CPU/FIFO path (fewer moving parts; may need DMA added back for clean color).
    const dma = !!s.dmas
    const nodes = [
        `&${ws.spi} {`,
        ...(s.deleteCs
            ? [`\t/* A WS2812 strip has no chip-select. */`, `\t/delete-property/ cs-gpios;`, ``]
            : []),
        `\tpinctrl-0 = <${s.pinctrl.join(' ')}>;`,
        `\tpinctrl-names = "default";`,
        `\tstatus = "okay";`,
        ...(dma
            ? [
                  ``,
                  `\t/* GPDMA streams the strip buffer gaplessly — needed on STM32 for`,
                  `\t   color-correct output (a CPU/FIFO transfer inserts inter-byte gaps`,
                  `\t   a latch-sensitive WS2812 reads as a reset). Both channels required. */`,
                  `\tdmas = ${s.dmas};`,
                  `\tdma-names = "tx", "rx";`,
              ]
            : []),
        ``,
        ...stripNode(ws, hz, frames),
        `};`,
        ``,
        ...CHOSEN_STRIP,
    ]
    return {
        includes: [
            `#include <zephyr/dt-bindings/led/led.h>`,
            ...(dma ? [`#include <zephyr/dt-bindings/dma/stm32_dma.h>`] : []),
        ],
        nodes,
        kconfig: [
            ``,
            `# WS2812 per-key RGB (chain-length ${ws.chainLength}) over ${ws.spi}${dma ? ' + GPDMA' : ''}.`,
            ...RGB_KCONFIG,
            ...(dma
                ? [`config DMA`, `\tdefault y`, `config SPI_STM32_DMA`, `\tdefault y`]
                : []),
        ],
    }
}

/** nRF WS2812-over-SPIM shield fragment: the MOSI pin's pinctrl groups (an
 *  NRF_PSEL from the `P<port>.<pin>` data pin) and the SPIM node with the strip.
 *  SPIM's EasyDMA streams the buffer without gaps. */
function emitRgbNrf(
    ws: CanonWs2812,
    hz: number,
    frames: { one: number; zero: number },
    diag: DiagnosticBag,
): PeripheralFragment | null {
    const m = /^P(\d)\.(\d{1,2})$/i.exec(ws.dataPin.trim())
    if (!m || Number(m[2]) > 31) {
        diag.error(
            `WS2812 data pin "${ws.dataPin}" is not an nRF port pin like "P0.13"`,
            ['keyboard', 'hardware', 'ws2812', 'dataPin'],
        )
        return null
    }
    const psel = `NRF_PSEL(SPIM_MOSI, ${m[1]}, ${Number(m[2])})`
    const group = (name: string, extra: string[]): string[] => [
        `\t${name}: ${name} {`,
        `\t\tgroup1 {`,
        `\t\t\tpsels = <${psel}>;`,
        ...extra,
        `\t\t};`,
        `\t};`,
    ]
    const nodes = [
        `&pinctrl {`,
        ...group(`${ws.spi}_default`, []),
        ...group(`${ws.spi}_sleep`, [`\t\t\tlow-power-enable;`]),
        `};`,
        ``,
        `&${ws.spi} {`,
        `\tcompatible = "nordic,nrf-spim";`,
        `\tstatus = "okay";`,
        `\tpinctrl-0 = <&${ws.spi}_default>;`,
        `\tpinctrl-1 = <&${ws.spi}_sleep>;`,
        `\tpinctrl-names = "default", "sleep";`,
        ``,
        ...stripNode(ws, hz, frames),
        `};`,
        ``,
        ...CHOSEN_STRIP,
    ]
    return {
        includes: [`#include <zephyr/dt-bindings/led/led.h>`],
        nodes,
        kconfig: [
            ``,
            `# WS2812 per-key RGB (chain-length ${ws.chainLength}) over ${ws.spi}.`,
            ...RGB_KCONFIG,
        ],
    }
}

/** The firmware's pixel buffer (CONFIG_REMAPPR_RGB_LED_MAX): its default and
 *  its Kconfig range. A longer strip must raise it or the LEDs past it stay
 *  dark. */
const RGB_LED_MAX_DEFAULT = 64
const RGB_LED_MAX_LIMIT = 1024

/** Chain-length against the firmware buffer and the key count. */
function checkChain(
    config: ConfigKeymap,
    ws: CanonWs2812,
    diag: DiagnosticBag,
): string[] {
    const path = ['keyboard', 'hardware', 'ws2812', 'chainLength']
    const n = ws.chainLength
    const keys = config.keyboard.keys.length
    if (n > RGB_LED_MAX_LIMIT)
        diag.error(`chain-length ${n} is over the firmware's ${RGB_LED_MAX_LIMIT}-LED limit`, path)
    if (n < keys)
        diag.warn(
            `chain-length ${n} is shorter than the ${keys} keys: keys past LED ` +
                `${n} have no LED for their per-key color`,
            path,
        )
    if (n <= RGB_LED_MAX_DEFAULT) return []
    return [
        `# The pixel buffer must hold the whole chain (default ${RGB_LED_MAX_DEFAULT}).`,
        `config REMAPPR_RGB_LED_MAX`,
        `\tdefault ${Math.min(n, RGB_LED_MAX_LIMIT)}`,
    ]
}

/** WS2812 per-key RGB from `keyboard.hardware.ws2812` (chain-length = LED count).
 *  Emits the SPI led_strip block + a `chosen remappr,led-strip` the runtime RGB
 *  service renders the per-key map / effects onto. No ws2812 → empty fragment.
 *  `ws2812.stm32` selects the STM32 path, an nRF board the SPIM path; any other
 *  board is an error, since its SPI controller and pin-mux cannot be guessed
 *  (this used to emit `compatible = "nordic,nrf-spim"` onto an STM32 SPI). */
export function emitRgb(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const ws = config.keyboard.hardware?.ws2812
    if (!ws) return EMPTY
    const soc = book.target.soc
    const path = ['keyboard', 'hardware', 'ws2812']
    book.claim(ws.dataPin, [...path, 'dataPin'])
    const kind: Soc = ws.stm32 ? 'stm32' : soc
    if (ws.stm32 && soc !== 'stm32' && soc !== 'unknown') {
        diag.error(`ws2812.stm32 is set on a ${soc} board`, [...path, 'stm32'])
        return EMPTY
    }
    if (kind === 'stm32' && !ws.stm32) {
        diag.error(
            `WS2812 on an STM32 board needs ws2812.stm32: the SPI pinctrl, and ` +
                `the GPDMA channels for gapless output`,
            path,
        )
        return EMPTY
    }
    if (kind !== 'nrf' && kind !== 'stm32') {
        diag.error(
            kind === 'unknown'
                ? `WS2812 needs a known SoC: set board.controller (nRF), or ` +
                      `ws2812.stm32 with the SPI pinctrl (STM32)`
                : `WS2812 over SPI is generated for nRF and STM32 boards, not ${kind}`,
            path,
        )
        return EMPTY
    }
    const hz = ws.spiMaxFrequency ?? (kind === 'nrf' ? 4000000 : 5000000)
    const frames = ws2812Frames(kind, hz)
    if (!frames) {
        diag.error(
            `no WS2812 bit timing fits a ${hz} Hz SPI clock (one byte per bit ` +
                `must carry a 0.4 us and a 0.8 us pulse); use 2.5 to 9 MHz`,
            [...path, 'spiMaxFrequency'],
        )
        return EMPTY
    }
    const chain = checkChain(config, ws, diag)
    const frag =
        kind === 'stm32'
            ? emitRgbStm32(ws, hz, frames)
            : emitRgbNrf(ws, hz, frames, diag)
    if (!frag) return EMPTY
    return { ...frag, kconfig: [...frag.kconfig, ...chain] }
}

/** Stock `gpio-qdec` rotary encoders from `board.encoders`. Each emits a qdec node
 *  (A/B phases, detent steps, relative axis). The qdec driver produces an
 *  INPUT_REL event; binding that rotation into the remappr behavior engine is
 *  firmware-side and HIL-deferred, so this declares the hardware only (warned).
 *  No encoders → empty fragment. */
export function emitEncoders(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const encoders = config.board?.encoders
    if (!encoders || encoders.length === 0) return EMPTY
    diag.warn(
        `${encoders.length} encoder(s) emitted as gpio-qdec nodes — rotation → ` +
            `behavior-engine binding is not yet wired in production firmware ` +
            `(bench synth-key path only), so turns won't drive keymap actions yet`,
        ['board', 'encoders'],
    )
    const nodes: string[] = [`/ {`]
    encoders.forEach((enc, i) => {
        // A quadrature encoder wires to ground: PULL_UP | ACTIVE_LOW.
        const phase = (k: 'a' | 'b'): string =>
            book.spec(enc[k], ROLE_FLAGS.direct, ['board', 'encoders', i, k])
        const a = phase('a')
        const b = phase('b')
        nodes.push(
            `\tqdec_${i}: qdec_${i} {`,
            `\t\tcompatible = "gpio-qdec";`,
            `\t\tgpios = <${a}>, <${b}>;`,
            `\t\tsteps-per-period = <${enc.steps ?? 4}>;`,
            `\t\tzephyr,axis = <${enc.axis ?? 'INPUT_REL_WHEEL'}>;`,
            `\t\tsample-time-us = <2000>;`,
            `\t\tidle-timeout-ms = <200>;`,
            `\t\tidle-poll-time-us = <5000>;`,
            `\t};`,
        )
    })
    nodes.push(`};`)
    return {
        includes: [],
        nodes,
        kconfig: [
            ``,
            `# ${encoders.length} rotary encoder(s) — stock gpio-qdec. Rotation →`,
            `# behavior-engine binding is HIL-deferred (see the overlay warning).`,
            `config INPUT_GPIO_QDEC`,
            `\tdefault y`,
        ],
    }
}

/** A setting value as a devicetree cell (negative ones in parentheses). */
const cell = (v: number): string => (v < 0 ? `(${v})` : String(v))

/** `remappr,setting-defaults` pairs from node.sensor.defaults, by registry
 *  macro (the hex id for one the registry has no name for). */
function settingDefaults(
    defaults: Readonly<Record<string, ConfigSensorValue>>,
    diag: DiagnosticBag,
): string[] {
    const pairs: string[] = []
    for (const [key, raw] of Object.entries(defaults)) {
        const id = sensorSettingId(key)
        const value = sensorWireValue(key, raw)
        if (id === undefined || value === undefined) {
            diag.warn(`sensor default "${key}" is not a setting or option`, [
                'node',
                'sensor',
                'defaults',
                key,
            ])
            continue
        }
        const macro = registrySetting(id)?.macro
        const name = macro ? `REMAPPR_SENSOR_${macro}` : `0x${id.toString(16)}`
        pairs.push(`\t\t\t${name} ${cell(value)}`)
    }
    return pairs
}

/** The motion sensor from `board.sensor`: its node on the SPI bus, with the
 *  product's defaults (node.sensor.defaults) as `remappr,setting-defaults`.
 *  No sensor → empty fragment. */
export function emitSensor(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const sensor = config.board?.sensor
    if (!sensor) return EMPTY
    const path = (k: string): (string | number)[] => ['board', 'sensor', k]
    const pin = (k: 'cs' | 'motion' | 'reset', flags: string): string =>
        book.spec(sensor[k] ?? '', flags, path(k))
    const defaults = settingDefaults(config.node?.sensor?.defaults ?? {}, diag)
    const unit = sensor.part.split(',').pop() || 'sensor'
    const nodes = [
        `&${sensor.bus} {`,
        `\tstatus = "okay";`,
        ...(sensor.cs ? [`\tcs-gpios = <${pin('cs', 'GPIO_ACTIVE_LOW')}>;`] : []),
        ``,
        `\tremappr_sensor: ${unit}@0 {`,
        `\t\tcompatible = "${sensor.part}";`,
        `\t\treg = <0>;`,
        `\t\tspi-max-frequency = <${sensor.spiMaxHz ?? 8000000}>;`,
        `\t\tmotion-gpios = <${pin('motion', '(GPIO_ACTIVE_LOW | GPIO_PULL_UP)')}>;`,
        ...(sensor.reset
            ? [`\t\treset-gpios = <${pin('reset', 'GPIO_ACTIVE_LOW')}>;`]
            : []),
        `\t\tzephyr,axis-x = <INPUT_REL_X>;`,
        `\t\tzephyr,axis-y = <INPUT_REL_Y>;`,
        ...(defaults.length
            ? [`\t\tremappr,setting-defaults = <`, ...defaults, `\t\t>;`]
            : []),
        `\t};`,
        `};`,
    ]
    return {
        includes: [`#include <dt-bindings/remappr/sensor.h>`],
        nodes,
        kconfig: [],
    }
}
