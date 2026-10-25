// Pattern check: no GoF pattern (-) — rejected — pure per-board lookup tables +
// stateless resolver functions; no polymorphic family or construction to abstract.
//
// Pin-name resolver. The builder stores FRIENDLY pin labels — `keyboard.pins`
// (row/col labels for a matrix) and per-key `CanonGeometry.pin` (direct GPIO) —
// e.g. "D4" / "GP29". Those are silkscreen names, NOT devicetree `GpioSpec`
// (`"&gpio0 29 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)"`) or QMK pin tokens. This
// module maps a label → the SoC-specific phandle+pin core per common controller,
// so the ZMK/QMK compilers can synthesize a flashable kscan / config.h pin list
// instead of leaving the wiring as a "NOT GENERATED" checklist item.
//
// Roles/flags (pull-ups, active level) are firmware + scan-direction specific and
// are composed by the caller (see `gpioSpec`); the tables hold only the part that
// genuinely differs per board and is hard to guess.

import type { GpioSpec } from './types'

/** Build "Pn", "Dn" and bare "n" aliases for each of a nexus phandle's pins.
 *  Pro-Micro-footprint and Xiao boards expose a GPIO nexus whose index IS the
 *  silkscreen pin number, so the mapping is an honest index passthrough — the
 *  value of the table is knowing the right phandle + validating the pins. */
function nexusTable(phandle: string, pins: number[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const i of pins) {
        const ref = `${phandle} ${i}`
        out[`P${i}`] = ref
        out[`D${i}`] = ref
        out[`${i}`] = ref
    }
    return out
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** The Pro Micro header's pin numbers: 0–21 without 11, 12, 13 and 17, which
 *  the footprint does not break out (nor does the &pro_micro nexus map them). */
const PRO_MICRO_PINS = [...range(11), 14, 15, 16, 18, 19, 20, 21]

/** Build "GP0".."GPn" → "&gpio0 0".."&gpio0 n" for a direct-GPIO SoC (RP2040). */
function rp2040Table(count: number): Record<string, string> {
    const out: Record<string, string> = {}
    for (let i = 0; i < count; i++) {
        const ref = `&gpio0 ${i}`
        out[`GP${i}`] = ref
        out[`${i}`] = ref
    }
    return out
}

/** board id → (friendly pin label → devicetree phandle+pin core, no flags).
 *  Board ids match Zephyr targets (`hardware.board`). Labels are case-insensitive
 *  (callers normalize to upper-case). */
export const ZMK_PIN_MAPS: Record<string, Record<string, string>> = {
    // Pro-Micro-footprint controllers expose the `&pro_micro` nexus; index = the
    // Pro Micro pin number (0–21).
    nice_nano_v2: nexusTable('&pro_micro', PRO_MICRO_PINS),
    pro_micro: nexusTable('&pro_micro', PRO_MICRO_PINS),
    sparkfun_pro_micro_rp2040: nexusTable('&pro_micro', PRO_MICRO_PINS),
    // Seeed Xiao footprint → `&xiao_d` nexus (D0–D10).
    seeeduino_xiao_ble: nexusTable('&xiao_d', range(11)),
    seeeduino_xiao_rp2040: nexusTable('&xiao_d', range(11)),
    // Generic RP2040 (Pico-class) — bare GPIO bank.
    rp2040: rp2040Table(30),
    rpi_pico: rp2040Table(30),
}

/** Controller boards remappr can resolve friendly pin labels for (→ a real ZMK
 *  kscan). Surfaced in the builder's board picker; free-text boards still work,
 *  they just emit a "fill the GpioSpec" comment instead of a resolved spec. */
export const KNOWN_ZMK_BOARDS: string[] = Object.keys(ZMK_PIN_MAPS).sort()

/** QMK keyboards name their own pins; the friendly label is usually already the
 *  QMK token (RP2040 "GP29"). A sparse per-board alias table overrides the
 *  identity fallback for footprints whose silkscreen ≠ QMK pin name. */
export const QMK_PIN_ALIASES: Record<string, Record<string, string>> = {
    // AVR Pro Micro: Arduino Dn silkscreen → atmega32u4 port pin.
    pro_micro: {
        D0: 'D3',
        D1: 'D2',
        D2: 'D1',
        D3: 'D0',
        D4: 'D4',
        D5: 'C6',
        D6: 'D7',
        D7: 'E6',
        D8: 'B4',
        D9: 'B5',
        D10: 'B6',
        D14: 'B3',
        D15: 'B1',
        D16: 'B2',
        D18: 'F7',
        D19: 'F6',
        D20: 'F5',
        D21: 'F4',
    },
}

/** Normalize a user label for lookup (trim + upper-case). */
const norm = (label: string): string => label.trim().toUpperCase()

const upperKeys = (m: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toUpperCase(), v]))

// Pre-upper-case the tables once so lookups are a plain object access.
const ZMK_UP: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(ZMK_PIN_MAPS).map(([b, m]) => [b, upperKeys(m)]),
)
const QMK_UP: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(QMK_PIN_ALIASES).map(([b, m]) => [b, upperKeys(m)]),
)

/** Resolve a friendly label to a ZMK phandle+pin core (`"&pro_micro 4"`), or
 *  null when the board is unknown or the label isn't in its table. */
export function resolveZmkPin(
    board: string | undefined,
    label: string,
): string | null {
    if (!board) return null
    const table = ZMK_UP[board]
    if (!table) return null
    return table[norm(label)] ?? null
}

/** GPIO flag presets for a kscan role. ZMK convention: the scanned (input) side
 *  pulls down and reads active-high; the driven (output) side is active-high;
 *  direct switches wire to ground (active-low, pull-up). */
export type PinRole = 'input' | 'output' | 'direct'

const ROLE_FLAGS: Record<PinRole, string> = {
    input: '(GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)',
    output: 'GPIO_ACTIVE_HIGH',
    direct: '(GPIO_ACTIVE_LOW | GPIO_PULL_UP)',
}

/** Compose a full devicetree `GpioSpec` from a resolved phandle core + role. */
export function gpioSpec(core: string, role: PinRole): GpioSpec {
    return `${core} ${ROLE_FLAGS[role]}`
}

/** Resolve a friendly label to a QMK pin token. Falls back to the label itself
 *  (upper-cased) when no board alias applies — QMK pin names are usually already
 *  the silkscreen label (e.g. RP2040 "GP29"). */
export function resolveQmkPin(
    board: string | undefined,
    label: string,
): string {
    const up = norm(label)
    const table = board ? QMK_UP[board] : undefined
    return table?.[up] ?? up
}

/** An ST port-pin silkscreen label ("PE11", "PA3") → its devicetree phandle+pin
 *  core ("&gpioe 11"), or null when the label is not that shape.
 *
 *  Unlike the tables above this needs no per-board data: every Zephyr STM32 board
 *  labels its GPIO controllers `gpio<port>` with the pin as the cell, so the
 *  silkscreen name IS the mapping. Without it a generated STM32 shield emitted
 *  the label verbatim — `row-gpios = <PE11>` — which is not valid devicetree, so
 *  the board-gen output for every ST board failed to build.
 *
 *  Ports A..K, pins 0..15; anything else returns null so the caller still warns
 *  rather than inventing a node that does not exist. */
export function resolveStPin(label: string): string | null {
    const m = /^P([A-K])(\d{1,2})$/.exec(norm(label))
    if (!m) return null
    const pin = Number(m[2])
    if (pin > 15) return null
    return `&gpio${m[1].toLowerCase()} ${pin}`
}

// pattern-check: skip — board-file pin facts as a table plus one pure lookup
/** nRF controllers: header pin number → SoC [port, pin], from each board's
 *  connector gpio-map (ZMK app/boards/arm/nice_nano/arduino_pro_micro_pins.dtsi;
 *  Zephyr boards/seeed/xiao_ble/seeed_xiao_connector.dtsi). A GPIO property
 *  can name the connector pin, but pin multiplexing (an SPI or PWM output)
 *  needs the SoC pin. */
const NRF_HEADER_PINS: Readonly<Record<string, Readonly<Record<number, [number, number]>>>> = {
    nice_nano_v2: {
        0: [0, 8], 1: [0, 6], 2: [0, 17], 3: [0, 20], 4: [0, 22], 5: [0, 24],
        6: [1, 0], 7: [0, 11], 8: [1, 4], 9: [1, 6], 10: [0, 9], 14: [1, 11],
        15: [1, 13], 16: [0, 10], 18: [1, 15], 19: [0, 2], 20: [0, 29], 21: [0, 31],
    },
    seeeduino_xiao_ble: {
        0: [0, 2], 1: [0, 3], 2: [0, 28], 3: [0, 29], 4: [0, 4], 5: [0, 5],
        6: [1, 11], 7: [1, 12], 8: [1, 13], 9: [1, 14], 10: [1, 15],
    },
}

/** An nRF pin as port + pin: "P1.13" as written, or a header label on a board
 *  above ("D15" on a nice!nano is P1.13); null otherwise. */
export function nrfPinOf(
    board: string | undefined,
    label: string,
): { port: number; pin: number } | null {
    const m = /^P(\d)\.(\d{1,2})$/i.exec(label.trim())
    if (m) return { port: Number(m[1]), pin: Number(m[2]) }
    const ref = resolveZmkPin(board, label)
    const header = board ? NRF_HEADER_PINS[board] : undefined
    const at = ref && header ? header[Number(ref.split(' ')[1])] : undefined
    return at ? { port: at[0], pin: at[1] } : null
}

// pattern-check: skip — two pure lookups over the existing pin tables
/** The board's pins, one label each (its table's first spelling), or null
 *  when remappr has no pin table for it. */
export function boardPinLabels(board: string | undefined): string[] | null {
    const table = board ? ZMK_PIN_MAPS[board] : undefined
    if (!table) return null
    // A lettered spelling ("P4") reads better than the bare number; object
    // order puts integer-like keys first, so pick per pin, not by order.
    const byRef = new Map<string, string>()
    for (const [label, ref] of Object.entries(table)) {
        const had = byRef.get(ref)
        if (!had || (/^\d/.test(had) && !/^\d/.test(label)))
            byRef.set(ref, label)
    }
    return [...byRef.values()]
}

/** The spellings a board accepts, as ranges ("P0–P21, D0–D21 or 0–21"), or
 *  null when remappr has no pin table for it. */
export function boardPinForms(board: string | undefined): string | null {
    const table = board ? ZMK_PIN_MAPS[board] : undefined
    if (!table) return null
    const ranges = new Map<string, [number, number]>()
    for (const label of Object.keys(table)) {
        const m = /^([A-Za-z]*)(\d+)$/.exec(label)
        if (!m) continue
        const n = Number(m[2])
        const r = ranges.get(m[1])
        ranges.set(m[1], r ? [Math.min(r[0], n), Math.max(r[1], n)] : [n, n])
    }
    // Bare numbers last (object order would put them first).
    const parts = [...ranges]
        .sort(([a], [b]) => Number(a === '') - Number(b === ''))
        .map(([p, [lo, hi]]) => `${p}${lo}–${p}${hi}`)
    if (parts.length < 2) return parts.join('')
    return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`
}

/** True when two labels name the same pin on @p board (D4 and P4 do). */
export function samePin(board: string | undefined, a: string, b: string): boolean {
    const ra = resolveZmkPin(board, a)
    return ra !== null && ra === resolveZmkPin(board, b)
}

// pattern-check: skip — board footprint data beside the pin tables, one lookup
/** A controller's header, top view with USB at the top: each side's pads from
 *  top to bottom. A pad is a pin label from the board's table, or a power /
 *  control pad's name (GND, RAW, RST, …). */
export interface BoardFootprint {
    name: string
    left: string[]
    right: string[]
}

const PRO_MICRO_FOOTPRINT = {
    left: ['D1', 'D0', 'GND', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'],
    right: ['RAW', 'GND', 'RST', 'VCC', 'D21', 'D20', 'D19', 'D18', 'D15', 'D14', 'D16', 'D10'],
}

const BOARD_FOOTPRINTS: Record<string, BoardFootprint> = {
    nice_nano_v2: { name: 'nice!nano v2', ...PRO_MICRO_FOOTPRINT },
    pro_micro: { name: 'Pro Micro', ...PRO_MICRO_FOOTPRINT },
    sparkfun_pro_micro_rp2040: {
        name: 'Pro Micro RP2040',
        ...PRO_MICRO_FOOTPRINT,
    },
    seeeduino_xiao_ble: {
        name: 'Xiao BLE',
        left: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
        right: ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7'],
    },
    seeeduino_xiao_rp2040: {
        name: 'Xiao RP2040',
        left: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
        right: ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7'],
    },
    rpi_pico: {
        name: 'Raspberry Pi Pico',
        left: ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
        right: ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'GND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
    },
}

/** The board's header as drawn on the board, or null when remappr has no
 *  drawing of it (its pins can still be listed with boardPinLabels). */
export function boardFootprint(board: string | undefined): BoardFootprint | null {
    return (board && BOARD_FOOTPRINTS[board]) || null
}

/** True when remappr has a ZMK pin table for this board. */
export function hasZmkPinMap(board: string | undefined): boolean {
    return Boolean(board && ZMK_UP[board])
}
