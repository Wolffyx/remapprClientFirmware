// Pattern check: no GoF pattern (-) — rejected — pure DT-fragment emitters for
// the power bindings, in the PeripheralFragment shape boardHardware.ts uses.
//
// The battery, status LEDs and power-off policy for the board generator, each
// from its own `board` field and each matching one firmware binding:
//   • board.battery    → remappr,battery (an ADC channel behind a divider, or a
//                        fuel gauge), with the channel node on the ADC
//   • board.statusLeds → remappr,status-led, on an LED the board has or one
//                        the shield declares on a pin (gpio-leds)
//   • board.powerOff   → remappr,power-off; on STM32 the PWR wake-up lines are
//                        turned on, since the chip only wakes on those
// Absent → empty fragment. The firmware turns each service on from the node.
import type { DiagnosticBag } from '../../diagnostics'
import type { ConfigKeymap } from '../../types'
import type { AdcBook } from './boardAdc'
import type { PeripheralFragment } from './boardHardware'
import type { PinBook } from './boardPins'
import { dtLabel } from './dtText'

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

/** Flags for a pin another node reads; the firmware matches wake pins by
 *  port and pin only. */
const NO_FLAGS = '0'

/** `remappr,battery` from board.battery. */
export function emitBattery(
    config: ConfigKeymap,
    book: PinBook,
    adc: AdcBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const b = config.board?.battery
    if (!b) return EMPTY
    const path = ['board', 'battery']
    const source = b.adc
        ? [
              `\t\tio-channels = <${adc.use(b.adc, [...path, 'adc'])}>;`,
              ...(b.divider
                  ? [
                        `\t\toutput-ohms = <${b.divider.outputOhms}>;`,
                        `\t\tfull-ohms = <${b.divider.fullOhms}>;`,
                    ]
                  : []),
          ]
        : [`\t\tfuel-gauge = <&${dtLabel(b.fuelGauge!, diag, [...path, 'fuelGauge'])}>;`]
    const charging = b.charging
        ? [
              `\t\tcharging-gpios = <${book.spec(b.charging, '(GPIO_PULL_UP | GPIO_ACTIVE_LOW)', [...path, 'charging'])}>;`,
          ]
        : []
    const curve = b.ocvCurve
        ? [
              `\t\tocv-curve = <`,
              ...b.ocvCurve.map(([mv, pct]) => `\t\t\t${mv} ${pct}`),
              `\t\t>;`,
          ]
        : []
    return {
        includes: [],
        nodes: [
            `/ {`,
            `\tremappr_battery: battery {`,
            `\t\tcompatible = "remappr,battery";`,
            ...source,
            ...charging,
            ...curve,
            `\t};`,
            `};`,
        ],
        kconfig: [],
    }
}

/** `remappr,status-led` nodes from board.statusLeds. An LED given by pin is
 *  declared in a gpio-leds node of the shield, so its pin is described once. */
export function emitStatusLeds(
    config: ConfigKeymap,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const leds = config.board?.statusLeds
    if (!leds || leds.length === 0) return EMPTY
    const declared: string[] = []
    const status: string[] = []
    leds.forEach((s, i) => {
        const path = ['board', 'statusLeds', i]
        let label: string
        if (s.pin) {
            label = `status_led_${i}`
            const flags = s.activeLow ? 'GPIO_ACTIVE_LOW' : 'GPIO_ACTIVE_HIGH'
            declared.push(
                `\t\t${label}: ${label} {`,
                `\t\t\tgpios = <${book.spec(s.pin, flags, [...path, 'pin'])}>;`,
                `\t\t};`,
            )
        } else label = dtLabel(s.led!, diag, [...path, 'led'])
        status.push(
            `\t${s.function}_status_${i} {`,
            `\t\tcompatible = "remappr,status-led";`,
            `\t\tled = <&${label}>;`,
            `\t\tfunction = "${s.function}";`,
            ...(s.blinkMs !== undefined ? [`\t\tblink-ms = <${s.blinkMs}>;`] : []),
            ...(s.flashMs !== undefined ? [`\t\tflash-ms = <${s.flashMs}>;`] : []),
            `\t};`,
        )
    })
    const ledsNode = declared.length
        ? [
              `\tremappr_status_leds {`,
              `\t\tcompatible = "gpio-leds";`,
              ...declared,
              `\t};`,
              ``,
          ]
        : []
    return {
        includes: [],
        nodes: [`/ {`, ...ledsNode, ...status, `};`],
        kconfig: [],
    }
}

/** `remappr,power-off` from board.powerOff; the STM32 wake-up lines with it. */
export function emitPowerOff(
    config: ConfigKeymap,
    book: PinBook,
): PeripheralFragment {
    const p = config.board?.powerOff
    if (!p) return EMPTY
    const path = ['board', 'powerOff']
    const first = (p.wakeFirst ?? []).map(
        (pin, i) => `<${book.ref(pin, NO_FLAGS, [...path, 'wakeFirst', i])}>`,
    )
    const pwr =
        book.target.soc === 'stm32'
            ? [
                  ``,
                  `/* STM32 shutdown wakes on the PWR wake-up lines only. */`,
                  `&pwr {`,
                  `\tstatus = "okay";`,
                  `};`,
              ]
            : []
    return {
        includes: [],
        nodes: [
            `/ {`,
            `\tremappr_power_off: power-off {`,
            `\t\tcompatible = "remappr,power-off";`,
            ...(p.partialWake ? [`\t\tpartial-wake;`] : []),
            ...(first.length ? [`\t\twake-first-gpios = ${first.join(', ')};`] : []),
            `\t};`,
            `};`,
            ...pwr,
        ],
        kconfig: [],
    }
}
