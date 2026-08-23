// pattern-check: skip — pure VIA-menu → LightingCatalog parser; tree walk + marshalling
//
// A VIA keyboard definition's `menus` array describes the board's lighting
// controls — including the EXACT effect list (names + values) the firmware
// supports, which differs per board and per firmware revision. This parses the
// lighting menu into a LightingCatalog so the RGB modal shows the board's real
// effect names instead of the hardcoded full QMK enum.
//
// Item shape (VIA): { label, type, content: [valueIdName, channel, valueId], options }
//   - effect dropdown: type 'dropdown', content[0] ~ /_effect$/, options [[label,value],…]
//   - brightness/speed: type 'range', content[0] ~ /_brightness$/ | /_effect_speed$/
//   - colour:           type 'color',  content[0] ~ /_color$/
import type { LightingCatalog, LightingKind } from '@firmware/lighting'

interface MenuLeaf {
    type: string
    content: unknown[]
    options?: unknown
}

function collectLeaves(node: unknown, out: MenuLeaf[]): void {
    if (Array.isArray(node)) {
        for (const n of node) collectLeaves(n, out)
        return
    }
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    if (typeof o.type === 'string' && Array.isArray(o.content)) {
        out.push({
            type: o.type,
            content: o.content,
            options: o.options,
        })
        return
    }
    if (Array.isArray(o.content)) collectLeaves(o.content, out)
}

function valueIdName(leaf: MenuLeaf): string {
    return typeof leaf.content[0] === 'string' ? leaf.content[0] : ''
}

function kindFromId(id: string): LightingKind | null {
    if (id.startsWith('id_qmk_rgb_matrix')) return 'rgb_matrix'
    if (id.startsWith('id_qmk_rgblight')) return 'rgblight'
    if (id.startsWith('id_qmk_led_matrix')) return 'led_matrix'
    if (id.startsWith('id_qmk_backlight')) return 'backlight'
    return null
}

/** Effect dropdown options → names indexed by their firmware value (gaps filled). */
function effectsFromOptions(options: unknown): string[] | null {
    if (!Array.isArray(options) || options.length === 0) return null
    const pairs: Array<[string, number]> = []
    for (const opt of options) {
        if (!Array.isArray(opt) || opt.length < 2) continue
        const label = String(opt[0])
        const value = Number(opt[1])
        if (Number.isFinite(value)) pairs.push([label, value])
    }
    if (pairs.length === 0) return null
    const max = pairs.reduce((m, [, v]) => Math.max(m, v), 0)
    const names: string[] = Array.from(
        { length: max + 1 },
        (_, i) => `Effect ${i}`,
    )
    for (const [label, value] of pairs) names[value] = label
    return names
}

/**
 * Parse a VIA definition's `menus` into a LightingCatalog, or null when no
 * lighting menu with an effect dropdown is present.
 */
export function parseLightingMenu(menus: unknown): LightingCatalog | null {
    const leaves: MenuLeaf[] = []
    collectLeaves(menus, leaves)
    if (leaves.length === 0) return null

    let effects: string[] | null = null
    let kind: LightingKind | null = null
    let hasColor = false
    let hasSpeed = false

    for (const leaf of leaves) {
        const id = valueIdName(leaf)
        if (!id) continue
        const k = kindFromId(id)
        if (k && !kind) kind = k
        if (/_effect_speed$/.test(id)) hasSpeed = true
        else if (/_effect$/.test(id) && leaf.type === 'dropdown') {
            effects = effectsFromOptions(leaf.options) ?? effects
        } else if (/_color$/.test(id) || leaf.type === 'color') {
            hasColor = true
        }
    }

    if (!effects || !kind) return null
    return { kind, effects, hasColor, hasSpeed }
}
