// Pattern check: no GoF pattern (-) — rejected — per-controller pin facts as data
// plus one pure resolver; every board is a table row, no per-board code.
//
// What each controller pin can do, so a design's pins are suggested by what
// they are for instead of in board order: a sensor's chip select and motion
// line take plain pins and reserve the board's SPI bus, an analog stick takes
// analog (ADC) pins, matrix rows and columns take what is left — keeping the
// analog pins and the limited ones (NFC pads, …) for last. The facts come from
// the ZMK/Zephyr board files and the SoC datasheets (see the table).
import { resolveZmkPin } from './pinmaps'

/** What a pin is asked to do. */
export type PinUse =
    /** Any GPIO: matrix rows/columns, buttons, chip selects. */
    | 'gpio'
    /** A GPIO that interrupts: encoders, a sensor's motion line. */
    | 'irq'
    /** An analog input: sticks, triggers, battery sense. */
    | 'adc'

/** One pin a design needs. */
export interface PinNeed {
    /** Stable id the suggestion is keyed by ("row-0", "sensor-cs"). */
    id: string
    role: PinUse
    /** The bus it rides on: its pins are reserved for the whole design. */
    bus?: 'spi' | 'i2c'
}

export interface BoardPin {
    /** Analog input channel, when the pin has one. */
    adc?: number
    /** Why to avoid it unless nothing else is free ("NFC pad"). */
    limited?: string
}

/** A bus's pins, by header label. */
export interface BoardBus {
    /** Devicetree node label of the bus. */
    node: string
    pins: Readonly<Record<string, string>>
}

export interface BoardPinAbilities {
    /** Header label → what it can do; every usable pin is listed. */
    pins: Readonly<Record<string, BoardPin>>
    /** The board's default SPI and I²C on the header. */
    spi?: BoardBus
    i2c?: BoardBus
    /** The battery is measured on the board itself; no pin needed. */
    batteryOnBoard?: boolean
}

const NFC = 'NFC pad: a GPIO only once the NFC pins are freed in the devicetree'

/** Pro Micro footprint buses (ZMK pro_micro_spi / pro_micro_i2c). */
const PRO_MICRO_SPI = { SCK: 'D15', MOSI: 'D16', MISO: 'D14' }
const PRO_MICRO_I2C = { SDA: 'D2', SCL: 'D3' }

/** Controller → its pins' abilities, by header label. Sources: the ZMK /
 *  Zephyr board files (pinctrl, connector .dtsi), the nRF52840 Product
 *  Specification (AIN0–7 = P0.02–05, P0.28–31) and the RP2040 datasheet
 *  (ADC = GP26–29). Boards missing here still get pins in board order. */
export const BOARD_PIN_ABILITIES: Readonly<Record<string, BoardPinAbilities>> = {
    // nRF52840. Only D19/D20/D21 are analog (the "A6–A10" silkscreen names
    // are AVR leftovers); D10/D16 are the NFC pads. The battery is read
    // on-chip (VDDH/5).
    nice_nano_v2: {
        pins: {
            D0: {}, D1: {}, D2: {}, D3: {}, D4: {}, D5: {}, D6: {}, D7: {},
            D8: {}, D9: {}, D10: { limited: NFC }, D14: {}, D15: {},
            D16: { limited: NFC }, D18: {},
            D19: { adc: 0 }, D20: { adc: 5 }, D21: { adc: 7 },
        },
        spi: { node: 'pro_micro_spi', pins: PRO_MICRO_SPI },
        i2c: { node: 'pro_micro_i2c', pins: PRO_MICRO_I2C },
        batteryOnBoard: true,
    },
    // RP2040: D18–D21 = GP26–29 = ADC0–3.
    sparkfun_pro_micro_rp2040: {
        pins: {
            D0: {}, D1: {}, D2: {}, D3: {}, D4: {}, D5: {}, D6: {}, D7: {},
            D8: {}, D9: {}, D10: {}, D14: {}, D15: {}, D16: {},
            D18: { adc: 0 }, D19: { adc: 1 }, D20: { adc: 2 }, D21: { adc: 3 },
        },
        spi: { node: 'pro_micro_spi', pins: PRO_MICRO_SPI },
        i2c: { node: 'pro_micro_i2c', pins: PRO_MICRO_I2C },
    },
    // ATmega32u4 (QMK): hardware SPI/I²C as the Pro Micro; ADC on D4, D6,
    // D8–D10 and D18–D21.
    pro_micro: {
        pins: {
            D0: {}, D1: {}, D2: {}, D3: {}, D4: { adc: 8 }, D5: {},
            D6: { adc: 10 }, D7: {}, D8: { adc: 11 }, D9: { adc: 12 },
            D10: { adc: 13 }, D14: {}, D15: {}, D16: {},
            D18: { adc: 7 }, D19: { adc: 6 }, D20: { adc: 5 }, D21: { adc: 4 },
        },
        spi: { node: 'spi', pins: PRO_MICRO_SPI },
        i2c: { node: 'i2c', pins: PRO_MICRO_I2C },
    },
    // nRF52840: D0–D5 analog; the battery has its own divider (AIN7).
    seeeduino_xiao_ble: {
        pins: {
            D0: { adc: 0 }, D1: { adc: 1 }, D2: { adc: 4 }, D3: { adc: 5 },
            D4: { adc: 2 }, D5: { adc: 3 }, D6: {}, D7: {}, D8: {}, D9: {},
            D10: {},
        },
        spi: { node: 'xiao_spi', pins: { SCK: 'D8', MOSI: 'D10', MISO: 'D9' } },
        i2c: { node: 'xiao_i2c', pins: { SDA: 'D4', SCL: 'D5' } },
        batteryOnBoard: true,
    },
    // RP2040: D0–D3 = GP26–29 = ADC0–3.
    seeeduino_xiao_rp2040: {
        pins: {
            D0: { adc: 0 }, D1: { adc: 1 }, D2: { adc: 2 }, D3: { adc: 3 },
            D4: {}, D5: {}, D6: {}, D7: {}, D8: {}, D9: {}, D10: {},
        },
        spi: { node: 'xiao_spi', pins: { SCK: 'D8', MOSI: 'D10', MISO: 'D9' } },
        i2c: { node: 'xiao_i2c', pins: { SDA: 'D4', SCL: 'D5' } },
    },
    // Pico header: GP0–GP22 digital, GP26–GP28 analog (GP29 reads VSYS
    // on the board). Zephyr's default SPI0 and I2C0.
    rpi_pico: {
        pins: {
            ...Object.fromEntries(
                Array.from({ length: 23 }, (_, i) => [`GP${i}`, {}]),
            ),
            GP26: { adc: 0 }, GP27: { adc: 1 }, GP28: { adc: 2 },
        },
        spi: { node: 'spi0', pins: { SCK: 'GP18', MOSI: 'GP19', MISO: 'GP16' } },
        i2c: { node: 'i2c0', pins: { SDA: 'GP4', SCL: 'GP5' } },
    },
}

/** The same pin however it is spelled (D4, P4, 4): its devicetree core. */
const coreOf = (board: string, label: string): string =>
    resolveZmkPin(board, label) ?? label.trim().toUpperCase()

/** A board's abilities keyed by pin core, built once per board. */
const byCore = new Map<string, Map<string, BoardPin>>()
function abilityOf(board: string | undefined, label: string): BoardPin {
    const a = board ? BOARD_PIN_ABILITIES[board] : undefined
    if (!board || !a) return {}
    let m = byCore.get(board)
    if (!m) {
        m = new Map(Object.entries(a.pins).map(([l, p]) => [coreOf(board, l), p]))
        byCore.set(board, m)
    }
    return m.get(coreOf(board, label)) ?? {}
}

/** The pins a design's needs reserve outright: the buses its parts ride on. */
export function reservedPins(
    board: string | undefined,
    needs: readonly PinNeed[],
): Record<string, string> {
    const a = board ? BOARD_PIN_ABILITIES[board] : undefined
    if (!a) return {}
    const out: Record<string, string> = {}
    const buses = { spi: a.spi, i2c: a.i2c }
    for (const kind of ['spi', 'i2c'] as const) {
        const bus = buses[kind]
        if (!bus || !needs.some((n) => n.bus === kind))
            continue
        for (const [what, label] of Object.entries(bus.pins))
            out[label] = `${kind.toUpperCase()} ${what}`
    }
    return out
}

/** Order the free pins for one use: analog needs take analog pins; the rest
 *  take plain pins first, then analog ones, then limited ones. */
function rank(
    labels: readonly string[],
    use: PinUse,
    board: string | undefined,
): string[] {
    const info = (p: string): BoardPin => abilityOf(board, p)
    if (use === 'adc') return labels.filter((p) => info(p).adc !== undefined)
    const score = (p: string): number =>
        (info(p).limited ? 2 : 0) + (info(p).adc !== undefined ? 1 : 0)
    return [...labels].sort((x, y) => score(x) - score(y))
}

/** Suggest a pin for every need without one, from `free` (the board's pins
 *  in header order, minus those already used). Analog needs go first so
 *  plain needs don't take the few analog pins; bus pins are left alone.
 *  Returns need id → label for the needs it could fill. */
export function suggestPinsByRole(
    board: string | undefined,
    needs: readonly PinNeed[],
    free: readonly string[],
): Record<string, string> {
    const reserved = new Set(
        Object.keys(reservedPins(board, needs)).map((p) =>
            board ? coreOf(board, p) : p,
        ),
    )
    let pool = free.filter((p) => !reserved.has(board ? coreOf(board, p) : p))
    const order: PinUse[] = ['adc', 'irq', 'gpio']
    const out: Record<string, string> = {}
    for (const role of order) {
        for (const need of needs.filter((n) => n.role === role)) {
            const pick = rank(pool, role, board)[0]
            if (!pick) continue
            out[need.id] = pick
            pool = pool.filter((p) => p !== pick)
        }
    }
    return out
}
