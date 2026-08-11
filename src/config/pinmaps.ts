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

/** Build "P0".."Pn", "D0".."Dn" and bare "0".."n" aliases for a nexus phandle.
 *  Pro-Micro-footprint and Xiao boards expose a GPIO nexus whose index IS the
 *  silkscreen pin number, so the mapping is an honest index passthrough — the
 *  value of the table is knowing the right phandle + validating the range. */
function nexusTable(phandle: string, count: number): Record<string, string> {
    const out: Record<string, string> = {}
    for (let i = 0; i < count; i++) {
        const ref = `${phandle} ${i}`
        out[`P${i}`] = ref
        out[`D${i}`] = ref
        out[`${i}`] = ref
    }
    return out
}

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
    nice_nano_v2: nexusTable('&pro_micro', 22),
    pro_micro: nexusTable('&pro_micro', 22),
    sparkfun_pro_micro_rp2040: nexusTable('&pro_micro', 22),
    // Seeed Xiao footprint → `&xiao_d` nexus (D0–D10).
    seeeduino_xiao_ble: nexusTable('&xiao_d', 11),
    seeeduino_xiao_rp2040: nexusTable('&xiao_d', 11),
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

/** True when remappr has a ZMK pin table for this board. */
export function hasZmkPinMap(board: string | undefined): boolean {
    return Boolean(board && ZMK_UP[board])
}
