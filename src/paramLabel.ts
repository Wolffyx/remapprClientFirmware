// pattern-check: skip — pure slot-driven mapper, no abstraction warranted
//
// Firmware-neutral param → short cap-legend engine. Every adapter already
// produces neutral `ActionSlot[]` for its behaviors (see types.ts / the per-
// firmware actionTypes builders); this turns a slot list + binding params into
// the short text a keycap shows for its primary parameter.
//
// The point is generality: a firmware that carries `layer` / `enum` / `number`
// slots gets a legible legend for FREE — no per-firmware code — because the
// enum branch falls back to a token-shortening rule when no `shortMap` is
// supplied. Firmwares opt into nicer names by passing their own token table
// (e.g. ZMK's ZMK_SHORT_TOKENS). There is deliberately NO global cross-firmware
// classification list — each adapter owns its own map, mirroring the per-
// firmware capability philosophy.
import type { ActionSlot } from './types'

export interface ParamLabel {
    /** Short glyph text for the cap (undefined ⇒ adapter keeps its own path). */
    paramText?: string
    /** Long, human-readable form for tooltips (e.g. "profile 0"). */
    longText?: string
}

/**
 * Title-case-and-shorten fallback for an enum token with no explicit mapping.
 * `RGB_FOO_BAR` → strip through the first `_` → `FOO_BAR` → "Foo Bar" → ≤6 chars.
 * Keeps unknown / future tokens legible without a hand-written table entry.
 */
export function shortenToken(token: string): string {
    const underscore = token.indexOf('_')
    const tail = underscore >= 0 ? token.slice(underscore + 1) : token
    const titled = tail
        .split('_')
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    const out = titled || token
    return out.length > 6 ? out.slice(0, 5) + '…' : out
}

/** True when the (conditional) trailing value slot applies to this command. */
function trailingValueApplies(slot: ActionSlot, command: number): boolean {
    if (slot.kind !== 'number') return false
    return !slot.enabledFor || slot.enabledFor.includes(command)
}

/**
 * Derive the short cap legend for a binding's primary parameter from its
 * neutral slots. Returns `{}` for HID / modifier / no-param slots — those keep
 * the adapter's existing rendering (HID usage glyph, mod chips).
 *
 * @param slots    neutral ActionType slots for the behavior
 * @param params   binding params ([param1, param2, ...])
 * @param layerName resolver: layer index → layer name (undefined when unnamed)
 * @param shortMap  optional per-firmware enum-token → short-text table
 */
export function buildParamLabel(
    slots: ActionSlot[],
    params: number[],
    layerName: (index: number) => string | undefined,
    shortMap?: Record<string, string>,
): ParamLabel {
    const first = slots[0]
    if (!first) return {}
    const param1 = params[0] ?? 0

    if (first.kind === 'layer') {
        const name = layerName(param1)
        const text = name && name.trim().length > 0 ? name : `L${param1}`
        return { paramText: text, longText: name ?? `Layer ${param1}` }
    }

    if (first.kind === 'number') {
        return { paramText: String(param1), longText: String(param1) }
    }

    if (first.kind === 'enum') {
        const token = first.values?.find((v) => v.value === param1)?.label
        const short = token
            ? (shortMap?.[token] ?? shortenToken(token))
            : String(param1)
        const second = slots[1]
        if (second && trailingValueApplies(second, param1)) {
            const value = params[1] ?? 0
            return {
                paramText: `${short} ${value}`,
                longText: token ? `${token} ${value}` : `${param1} ${value}`,
            }
        }
        return { paramText: short, longText: token ?? String(param1) }
    }

    return {}
}
