// Pattern check: no GoF pattern (-) — rejected — pure data functions (line fit + nearest-rect pick) with one caller, the VialRGB facade.
import type { PhysicalLayoutKey } from '@firmware/types'

/** One LED as VialRGB's get_led_info reports it. */
export interface LedInfo {
    led: number
    /** Position in QMK's LED space (x 0–224, y 0–64). */
    x: number
    y: number
    flags: number
    /** Matrix position, or null when the firmware puts it under no key. */
    pos: { row: number; col: number } | null
}

/** A layout key: its matrix position and physical place (centi-units). */
export type KeyPlace = PhysicalLayoutKey & { row: number; col: number }

/** QMK LED_FLAG_KEYLIGHT: the LED lights a key. */
const LED_FLAG_KEYLIGHT = 0x04
/** How far outside a key an unclaimed LED may land and still be its own. */
const REACH = 50 // ½u
/** Keys this much apart in distance count as equally near. */
const TIE = 15

interface Line {
    slope: number
    offset: number
}

export const posKey = (row: number, col: number): string => `${row},${col}`

/**
 * Matrix position → the LEDs under it.
 *
 * vial-qmk answers get_led_info from g_led_config.matrix_co, which holds one
 * LED per key; QMK lights a key's other LEDs through
 * rgb_matrix_map_row_column_to_led_kb (qmk_firmware#26278), which VialRGB
 * never reads. Those LEDs come back under no key but still flagged as key
 * lights. Each is placed by position instead: the claimed LEDs give the
 * mapping from LED space to the layout, and the LED joins the key it lands
 * on. On a border between keys (the Keycult TKL's left spacebar LED sits
 * right on the Alt/space edge) the larger key takes it: only a key that big
 * holds more than one LED.
 */
export function keyLedsByPos(
    leds: readonly LedInfo[],
    keys: readonly KeyPlace[],
): Map<string, number[]> {
    const byPos = new Map<string, number[]>()
    const add = (row: number, col: number, led: number): void => {
        const k = posKey(row, col)
        byPos.set(k, [...(byPos.get(k) ?? []), led])
    }
    for (const l of leds) if (l.pos) add(l.pos.row, l.pos.col, l.led)

    const strays = leds.filter(
        (l) => !l.pos && (l.flags & LED_FLAG_KEYLIGHT) !== 0,
    )
    const toLayout = strays.length > 0 ? fitLedSpace(leds, keys) : null
    if (!toLayout) return byPos
    for (const l of strays) {
        const owner = ownerOf(toLayout(l), keys)
        if (owner) add(owner.row, owner.col, l.led)
    }
    for (const list of byPos.values()) list.sort((a, b) => a - b)
    return byPos
}

/** LED space → layout centi-units, fitted per axis over the claimed LEDs.
 *  Null when too few keys pin a line down. */
function fitLedSpace(
    leds: readonly LedInfo[],
    keys: readonly KeyPlace[],
): ((l: LedInfo) => { x: number; y: number }) | null {
    const keyAt = new Map(keys.map((k) => [posKey(k.row, k.col), k]))
    const pairs = leds.flatMap((l) => {
        const k = l.pos && keyAt.get(posKey(l.pos.row, l.pos.col))
        return k ? [{ led: l, key: k }] : []
    })
    const xLine = fitLine(pairs.map((p) => [p.led.x, p.key.x + p.key.w / 2]))
    const yLine = fitLine(pairs.map((p) => [p.led.y, p.key.y + p.key.h / 2]))
    if (!xLine || !yLine) return null
    return (l) => ({
        x: xLine.slope * l.x + xLine.offset,
        y: yLine.slope * l.y + yLine.offset,
    })
}

/** Least-squares line through [from, to] points; null below two points. A
 *  `from` that doesn't vary (a one-row board's LED y) maps to the mean. */
function fitLine(points: [number, number][]): Line | null {
    const n = points.length
    if (n < 2) return null
    const meanFrom = points.reduce((s, [f]) => s + f, 0) / n
    const meanTo = points.reduce((s, [, t]) => s + t, 0) / n
    let spread = 0
    let covariance = 0
    for (const [f, t] of points) {
        spread += (f - meanFrom) ** 2
        covariance += (f - meanFrom) * (t - meanTo)
    }
    const slope = spread === 0 ? 0 : covariance / spread
    return { slope, offset: meanTo - slope * meanFrom }
}

/** The key nearest a layout point, within REACH; among keys about as near
 *  (a point on the border of two), the largest. Rotation is ignored: a key
 *  is taken as its unrotated rectangle. */
function ownerOf(
    p: { x: number; y: number },
    keys: readonly KeyPlace[],
): KeyPlace | undefined {
    const near = keys
        .map((key) => ({ key, gap: gapTo(p, key) }))
        .filter((c) => c.gap <= REACH)
    if (near.length === 0) return undefined
    const nearest = Math.min(...near.map((c) => c.gap))
    const tied = near.filter((c) => c.gap <= nearest + TIE)
    tied.sort((a, b) => area(b.key) - area(a.key))
    return tied[0].key
}

function gapTo(p: { x: number; y: number }, k: KeyPlace): number {
    const dx = Math.max(k.x - p.x, 0, p.x - (k.x + k.w))
    const dy = Math.max(k.y - p.y, 0, p.y - (k.y + k.h))
    return Math.hypot(dx, dy)
}

const area = (k: KeyPlace): number => k.w * k.h
