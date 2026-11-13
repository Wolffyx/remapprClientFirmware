// Pattern check: Dispatch Map (Tier 0) — applied — screen chip → devicetree
// node builder as one table, shared by the ZMK and Remappr emitters.
//
// The board's screen and battery sense pin as Zephyr devicetree, for the two
// Zephyr firmware (ZMK and Remappr). Every node copies a cited in-tree one:
//   • SSD1306 128×32 — ZMK app/boards/shields/corne/corne.dtsi
//   • SSD1306 128×64 — ZMK app/boards/shields/kyria/kyria_common.dtsi
//   • SH1106 128×64  — Remappr tests/hil/keyboard_node/oled_enc_nucleo_u5a5zj_q.overlay
//   • Sharp memory LCD (nice!view) — ZMK app/boards/shields/nice_view/nice_view.overlay
//     and nice_view_adapter (chip select active high)
//   • IL0323 80×128 e-paper — ZMK app/boards/arm/corneish_zen/corneish_zen_v2_left.dts
//   • battery — ZMK zmk,battery-voltage-divider (nRF SAADC only:
//     app/module/drivers/sensor/battery/battery_voltage_divider.c; seeeduino_xiao_ble
//     overlay for the chosen), Remappr remappr,battery (dts/bindings/remappr,battery.yaml,
//     tests/hil/power/bench_battery_nrf52840dk_nrf52840.overlay for the ADC channel).
// Which chips each firmware drives is its own table (FIRMWARE_SWITCHES `displays`).
import type { DiagnosticBag } from '../diagnostics'
import { FIRMWARE_SWITCHES } from '../firmwareSwitches'
import { BOARD_PIN_ABILITIES } from '../pinAbilities'
import { resolveStPin, resolveZmkPin } from '../pinmaps'
import { resolveController } from '../controller'
import type { CanonDisplay, CanonPart, ConfigKeymap } from '../types'
import { boardSoc } from './zmk/hardware'

export type ZephyrFirmware = 'zmk' | 'remappr'

/** Devicetree for one peripheral: header includes, blocks after the root. */
export interface DtFragment {
    includes: string[]
    nodes: string[]
}

const NONE: DtFragment = { includes: [], nodes: [] }

/** The board's first screen that has its settings. */
export function boardScreen(config: ConfigKeymap): (CanonPart & { display: CanonDisplay }) | undefined {
    const p = config.keyboard.parts?.find((x) => x.kind === 'display' && x.display)
    return p?.display ? { ...p, display: p.display } : undefined
}

/** Whether `fw` can write the board's screen (it has a driver for its chip). */
export function screenFor(config: ConfigKeymap, fw: ZephyrFirmware): boolean {
    const s = boardScreen(config)
    return !!s && FIRMWARE_SWITCHES[fw].displays.includes(s.display.chip) && !!NODE[s.display.chip]
}

type Pin = (key: string, flags: string) => string | null

interface ScreenNode {
    /** Buses its node is written for. */
    buses: readonly CanonDisplay['bus'][]
    /** Chip-select polarity on SPI. */
    cs?: string
    /** The node's name and body lines (two tabs deep), or null when a pin
     *  it needs is missing. */
    body: (d: CanonDisplay, pin: Pin) => { name: string; lines: string[] } | null
}

const hex = (n: number): string => `0x${n.toString(16)}`

/** The SSD1306-driver init lines shared by the OLEDs. */
const oledLines = (d: CanonDisplay, segOffset: number): string[] => [
    `reg = <${hex(d.address ?? 0x3c)}>;`,
    `width = <${d.width}>;`,
    `height = <${d.height}>;`,
    `segment-offset = <${segOffset}>;`,
    `page-offset = <0>;`,
    `display-offset = <0>;`,
    `multiplex-ratio = <${d.height - 1}>;`,
    `prechargep = <0x22>;`,
]

const NODE: Readonly<Record<string, ScreenNode>> = {
    // corne (128×32) and kyria (128×64).
    SSD1306: {
        buses: ['i2c'],
        body: (d) => ({
            name: `ssd1306@${(d.address ?? 0x3c).toString(16)}`,
            lines: [
                `compatible = "solomon,ssd1306fb";`,
                ...oledLines(d, 0),
                ...(d.height === 32 ? [`segment-remap;`, `com-invdir;`, `com-sequential;`] : []),
                `inversion-on;`,
            ],
        }),
    },
    // The rig's 1.3" module: 132-column RAM, 128 visible.
    SH1106: {
        buses: ['i2c'],
        body: (d) => ({
            name: `sh1106@${(d.address ?? 0x3c).toString(16)}`,
            lines: [
                `compatible = "sinowealth,sh1106";`,
                ...oledLines(d, 2),
                `segment-remap;`,
                `com-invdir;`,
                `ready-time-ms = <100>;`,
            ],
        }),
    },
    'Sharp memory LCD': {
        buses: ['spi'],
        cs: 'GPIO_ACTIVE_HIGH',
        body: (d) => ({
            name: 'ls0xx@0',
            lines: [
                `compatible = "sharp,ls0xx";`,
                `spi-max-frequency = <1000000>;`,
                `reg = <0>;`,
                `width = <${d.width}>;`,
                `height = <${d.height}>;`,
            ],
        }),
    },
    // corneish_zen's panel; pwr / cdi / tcon are that panel's values.
    IL0323: {
        buses: ['spi'],
        cs: 'GPIO_ACTIVE_LOW',
        body: (d, pin) => {
            const dc = pin('dc', 'GPIO_ACTIVE_LOW')
            const busy = pin('busy', 'GPIO_ACTIVE_LOW')
            const rst = pin('rst', 'GPIO_ACTIVE_LOW')
            if (!dc || !busy || !rst) return null
            return {
                name: 'il0323@0',
                lines: [
                    `compatible = "gooddisplay,il0323";`,
                    `reg = <0>;`,
                    `width = <${d.width}>;`,
                    `height = <${d.height}>;`,
                    `spi-max-frequency = <4000000>;`,
                    `dc-gpios = <${dc}>;`,
                    `busy-gpios = <${busy}>;`,
                    `reset-gpios = <${rst}>;`,
                    `pwr = [03 00 26 26];`,
                    `cdi = <0xd2>;`,
                    `tcon = <0x22>;`,
                ],
            }
        },
    },
}

const NAME: Record<ZephyrFirmware, string> = { zmk: 'ZMK', remappr: 'Remappr' }

/** A part pin as a devicetree GPIO spec, or null when unset / unknown. */
function partPin(part: CanonPart, board: string | undefined): Pin {
    return (key, flags) => {
        const label = part.pins?.[key]?.trim()
        if (!label) return null
        if (label.startsWith('&')) return label
        const core = resolveZmkPin(board, label) ?? resolveStPin(label)
        return core ? `${core} ${flags}` : null
    }
}

/** The board's screen as a node on its bus + `chosen zephyr,display`. A
 *  screen this firmware has no driver (or no cited node) for is left out with
 *  a warning saying why. */
export function emitScreen(config: ConfigKeymap, fw: ZephyrFirmware, diag: DiagnosticBag, tab = '    '): DtFragment {
    const screen = boardScreen(config)
    if (!screen) return NONE
    const d = screen.display
    const path = ['keyboard', 'parts', screen.id]
    const skip = (why: string): DtFragment => {
        diag.warn(`${screen.name} (${d.chip}) not written: ${why}`, path)
        return NONE
    }
    if (!FIRMWARE_SWITCHES[fw].displays.includes(d.chip)) return skip(`${NAME[fw]} has no driver for ${d.chip}`)
    const node = NODE[d.chip]
    if (!node) return skip(`set up its panel node by hand (its init values depend on the panel)`)
    if (!node.buses.includes(d.bus)) return skip(`its ${d.bus.toUpperCase()} node is not written yet`)
    const board = resolveController(config).board
    const bus = d.bus === 'spi' ? BOARD_PIN_ABILITIES[board ?? '']?.spi : BOARD_PIN_ABILITIES[board ?? '']?.i2c
    if (!bus) return skip(`remappr does not know ${board ?? 'the controller'}'s ${d.bus.toUpperCase()} bus`)
    const pin = partPin(screen, board)
    const cs = node.cs ? pin('cs', node.cs) : null
    if (node.cs && !cs) return skip('set its chip-select pin')
    const body = node.body(d, pin)
    if (!body) return skip('set its DC, BUSY and RST pins')
    if (d.rotation) diag.warn(`${screen.name}: turn the picture ${d.rotation}° in the firmware's display settings`, path)
    const t2 = tab + tab
    return {
        includes: [`#include <zephyr/dt-bindings/gpio/gpio.h>`],
        nodes: [
            `&${bus.node} {`,
            `${tab}status = "okay";`,
            ...(cs ? [`${tab}cs-gpios = <${cs}>;`] : []),
            ``,
            `${tab}remappr_screen: ${body.name} {`,
            ...body.lines.map((l) => t2 + l),
            `${tab}};`,
            `};`,
            ``,
            `/ {`,
            `${tab}chosen {`,
            `${t2}zephyr,display = &remappr_screen;`,
            `${tab}};`,
            `};`,
        ],
    }
}

/** The battery sense pin's ADC channel, or null with the reason. */
function batteryChannel(config: ConfigKeymap): { channel: number } | { why: string } {
    const pin = config.keyboard.hardware?.battery?.pin?.trim()
    const board = resolveController(config).board
    if (!pin) return { why: 'no sense pin' }
    if (boardSoc(board) !== 'nrf') return { why: `only nRF boards are written (${board ?? 'no controller'})` }
    const a = board ? BOARD_PIN_ABILITIES[board] : undefined
    const core = resolveZmkPin(board, pin)
    const hit = a && core ? Object.entries(a.pins).find(([l]) => resolveZmkPin(board, l) === core)?.[1] : undefined
    if (hit?.adc === undefined) return { why: `${pin} is not an analog pin on ${board}` }
    return { channel: hit.adc }
}

/** The battery behind its divider. ZMK: a zmk,battery-voltage-divider chosen as
 *  zmk,battery (needs both resistor values). Remappr: a remappr,battery node
 *  and its ADC channel (the divider defaults to 1:2 when not set). */
export function emitBattery(config: ConfigKeymap, fw: ZephyrFirmware, diag: DiagnosticBag, tab = '    '): DtFragment {
    const bat = config.keyboard.hardware?.battery
    if (!bat?.pin) return NONE
    const path = ['keyboard', 'hardware', 'battery']
    const ch = batteryChannel(config)
    if ('why' in ch) {
        diag.warn(`battery sense not written: ${ch.why}`, path)
        return NONE
    }
    const t2 = tab + tab
    const ohms = [
        ...(bat.outputOhms ? [`${t2}output-ohms = <${bat.outputOhms}>;`] : []),
        ...(bat.fullOhms ? [`${t2}full-ohms = <${bat.fullOhms}>;`] : []),
    ]
    if (fw === 'zmk') {
        if (!bat.outputOhms || !bat.fullOhms) {
            diag.warn('battery sense not written: ZMK needs both divider resistor values', path)
            return NONE
        }
        return {
            includes: [],
            nodes: [
                `/ {`,
                `${tab}chosen {`,
                `${t2}zmk,battery = &remappr_vbatt;`,
                `${tab}};`,
                ``,
                `${tab}remappr_vbatt: remappr_vbatt {`,
                `${t2}compatible = "zmk,battery-voltage-divider";`,
                `${t2}io-channels = <&adc ${ch.channel}>;`,
                ...ohms,
                `${tab}};`,
                `};`,
                ``,
                `&adc {`,
                `${tab}status = "okay";`,
                `};`,
            ],
        }
    }
    return {
        includes: [`#include <zephyr/dt-bindings/adc/adc.h>`, `#include <zephyr/dt-bindings/adc/nrf-saadc.h>`],
        nodes: [
            `/ {`,
            `${tab}remappr_battery: remappr_battery {`,
            `${t2}compatible = "remappr,battery";`,
            `${t2}io-channels = <&adc ${ch.channel}>;`,
            ...ohms,
            `${tab}};`,
            `};`,
            ``,
            `&adc {`,
            `${tab}status = "okay";`,
            `${tab}#address-cells = <1>;`,
            `${tab}#size-cells = <0>;`,
            ``,
            `${tab}channel@${ch.channel} {`,
            `${t2}reg = <${ch.channel}>;`,
            `${t2}zephyr,gain = "ADC_GAIN_1_6";`,
            `${t2}zephyr,reference = "ADC_REF_INTERNAL";`,
            `${t2}zephyr,acquisition-time = <ADC_ACQ_TIME_DEFAULT>;`,
            `${t2}zephyr,input-positive = <NRF_SAADC_AIN${ch.channel}>;`,
            `${t2}zephyr,resolution = <12>;`,
            `${tab}};`,
            `};`,
        ],
    }
}
