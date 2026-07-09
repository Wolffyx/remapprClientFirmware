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

/**
 * One visual unit of a composite cap legend. The renderer shows {@link icon}
 * (resolved against its own id→component registry) when set and resolvable,
 * otherwise {@link text}; `text` doubles as the plain-text fallback and the
 * accessible label. Icon ids are neutral strings — no renderer/icon-library
 * types leak into the firmware layer.
 */
export interface LegendPart {
    icon?: string
    text: string
}

/** A per-token cap legend: short text plus an optional neutral icon id. A bare
 *  string in a token map is shorthand for `{ text }` (icon-less, back-compat). */
export interface TokenLegend {
    text: string
    icon?: string
}

/** A token map value is either legacy text-only or a {@link TokenLegend}. */
export type TokenMap = Record<string, string | TokenLegend>

export interface ParamLabel {
    /** Short glyph text for the cap (undefined ⇒ adapter keeps its own path). */
    paramText?: string
    /** Long, human-readable form for tooltips (e.g. "profile 0"). */
    longText?: string
    /**
     * Composite legend parts (command part [+ trailing value part]). Present
     * only when a token in the map carries an icon; otherwise the text path
     * ({@link paramText}) is used unchanged.
     */
    parts?: LegendPart[]
}

/** Normalize a token-map entry to a {@link TokenLegend} (string ⇒ text-only). */
function normalizeLegend(
    entry: string | TokenLegend | undefined,
): TokenLegend | undefined {
    if (entry === undefined) return undefined
    return typeof entry === 'string' ? { text: entry } : entry
}

/**
 * Assemble a composite cap legend from an engine {@link ParamLabel} and an
 * optional behavior-level legend. The behavior icon prefixes the command/value
 * parts (deduped when the command already leads with it, e.g. `&bt` BT_SEL), and
 * IS the whole legend for a zero-arg behavior (its `text` the icon-less
 * fallback). Returns undefined when nothing carries an icon so the cap keeps its
 * plain-text path. Firmware-neutral — each adapter passes its own behavior
 * legend (see zmk/paramLabel.ts).
 */
export function composeLegendParts(
    param: ParamLabel,
    behaviorLegend: TokenLegend | undefined,
): LegendPart[] | undefined {
    const behaviorIcon = behaviorLegend?.icon
    if (param.parts || param.paramText) {
        const base = param.parts ?? [{ text: param.paramText as string }]
        if (behaviorIcon && base[0]?.icon !== behaviorIcon) {
            return [{ icon: behaviorIcon, text: '' }, ...base]
        }
        return base.some((p) => p.icon) ? base : undefined
    }
    if (behaviorIcon) {
        return [{ icon: behaviorIcon, text: behaviorLegend?.text ?? '' }]
    }
    return undefined
}

/**
 * Title-case fallback for an enum token with no explicit mapping.
 * `RGB_FOO_BAR` → strip through the first `_` → `FOO_BAR` → "Foo Bar".
 * Returns the FULL text — the cap clips it to an ellipsis in CSS while the
 * hover tooltip shows the whole value, so no characters are dropped here.
 */
export function shortenToken(token: string): string {
    const underscore = token.indexOf('_')
    const tail = underscore >= 0 ? token.slice(underscore + 1) : token
    const titled = tail
        .split('_')
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    return titled || token
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
 * @param shortMap  optional per-firmware enum-token → short-text/icon table
 */
export function buildParamLabel(
    slots: ActionSlot[],
    params: number[],
    layerName: (index: number) => string | undefined,
    shortMap?: TokenMap,
): ParamLabel {
    const first = slots[0]
    if (!first) return {}
    const param1 = params[0] ?? 0

    if (first.kind === 'layer') {
        const name = layerName(param1)
        const named = !!name && name.trim().length > 0
        // Short glyph is the layer name or "L3"; the tooltip's full form is the
        // name or "Layer 3". `layerName` returns "" for an unnamed layer (not
        // undefined), so a `??` fallback wouldn't fire — test truthiness.
        return {
            paramText: named ? name : `L${param1}`,
            longText: named ? name : `Layer ${param1}`,
        }
    }

    if (first.kind === 'number') {
        const shown = first.oneBased ? param1 + 1 : param1
        return { paramText: String(shown), longText: String(shown) }
    }

    if (first.kind === 'enum') {
        const token = first.values?.find((v) => v.value === param1)?.label
        const legend = normalizeLegend(token ? shortMap?.[token] : undefined)
        const short = legend?.text ?? (token ? shortenToken(token) : String(param1))
        // Composite parts are emitted only when the token carries an icon; the
        // command part's text is the per-part fallback, the trailing number is
        // always a plain-text part (icons never replace a raw index).
        const commandPart: LegendPart = legend?.icon
            ? { icon: legend.icon, text: short }
            : { text: short }
        const second = slots[1]
        if (second && trailingValueApplies(second, param1)) {
            const raw = params[1] ?? 0
            const value = second.oneBased ? raw + 1 : raw
            return {
                paramText: `${short} ${value}`,
                longText: token ? `${token} ${value}` : `${param1} ${value}`,
                ...(legend?.icon
                    ? { parts: [commandPart, { text: String(value) }] }
                    : {}),
            }
        }
        return {
            paramText: short,
            longText: token ?? String(param1),
            ...(legend?.icon ? { parts: [commandPart] } : {}),
        }
    }

    return {}
}
