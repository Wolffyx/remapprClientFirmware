// Pattern check: no GoF pattern (-) — rejected — pure data tables derived from
// the zod schema + catalog; doc strings, categories, snippets, keycode palette.
// No abstraction, no React (Phase-B code-editor substrate, consumed later).
//
// The schema is the single source of truth for "what an action does / how to use
// it": every action carries a `.describe()`. This module harvests those strings
// (so docs never drift from validation) and pairs them with a categorized
// keycode palette from the catalog — the substrate the future code-editor panel
// reads for hover tooltips, the palette sidebar, autocomplete and snippets.

import { CATALOG_PAGES } from '@firmware/catalog'
import { ActionObjectSchema, ACTION_TYPES } from './schema'

/** Broad grouping for palette sections / sidebar headers. */
export type ActionCategory =
    | 'key'
    | 'tap-hold'
    | 'layer'
    | 'output'
    | 'lighting'
    | 'mouse'
    | 'system'
    | 'macro'

const CATEGORY_BY_TYPE: Record<string, ActionCategory> = {
    key_press: 'key',
    sticky_key: 'key',
    caps_word: 'key',
    transparent: 'key',
    none: 'key',
    key_toggle: 'key',
    key_repeat: 'key',
    grave_escape: 'key',
    tap_hold: 'tap-hold',
    mod_tap: 'tap-hold',
    layer_tap: 'tap-hold',
    layer: 'layer',
    output: 'output',
    lighting: 'lighting',
    mouse_key: 'mouse',
    mouse_move: 'mouse',
    mouse_scroll: 'mouse',
    bootloader: 'system',
    reset: 'system',
    soft_off: 'system',
    studio_unlock: 'system',
    ext_power: 'system',
    macro: 'macro',
    tap_dance: 'macro',
    auto_shift: 'tap-hold',
    tune_tap_term: 'tap-hold',
    alt_repeat: 'key',
    autocorrect: 'key',
    unicode: 'key',
    leader: 'key',
    layer_lock: 'layer',
    layer_mod: 'layer',
    tap_toggle: 'layer',
    set_base_saved: 'layer',
    auto_layer: 'layer',
    gui_lock: 'system',
    secure: 'system',
    peripheral: 'system',
    macro_record: 'macro',
    macro_play: 'macro',
}

// A minimal valid surface example per action type — the future editor inserts
// these on autocomplete/snippet. Bare-string keys stay strings; everything else
// is the explicit object node.
const SNIPPET_BY_TYPE: Record<string, unknown> = {
    key_press: 'A',
    tap_hold: {
        type: 'tap_hold',
        tap: 'A',
        hold: { type: 'modifier', modifier: 'LEFT_CTRL' },
    },
    mod_tap: { type: 'mod_tap', tap: 'A', mod: 'LEFT_CTRL' },
    layer_tap: { type: 'layer_tap', tap: 'SPACE', layer: 'lower' },
    layer: { type: 'layer', mode: 'momentary', layer: 'lower' },
    sticky_key: { type: 'sticky_key', key: 'LEFT_SHIFT' },
    caps_word: { type: 'caps_word' },
    transparent: { type: 'transparent' },
    none: { type: 'none' },
    output: { type: 'output', action: 'bluetooth', profile: 0 },
    lighting: { type: 'lighting', target: 'underglow', action: 'toggle' },
    bootloader: { type: 'bootloader' },
    reset: { type: 'reset' },
    soft_off: { type: 'soft_off' },
    studio_unlock: { type: 'studio_unlock' },
    grave_escape: { type: 'grave_escape' },
    key_repeat: { type: 'key_repeat' },
    key_toggle: { type: 'key_toggle', key: 'CAPSLOCK' },
    ext_power: { type: 'ext_power', action: 'toggle' },
    mouse_key: { type: 'mouse_key', button: 'left' },
    mouse_move: { type: 'mouse_move', direction: 'up' },
    mouse_scroll: { type: 'mouse_scroll', direction: 'down' },
    macro: { type: 'macro', ref: 'my_macro' },
    tap_dance: { type: 'tap_dance', ref: 'my_tap_dance' },
    auto_shift: { type: 'auto_shift', key: 'A', mods: ['LEFT_SHIFT'] },
    alt_repeat: { type: 'alt_repeat' },
    layer_lock: { type: 'layer_lock' },
    layer_mod: { type: 'layer_mod', layer: 'lower', mods: ['LEFT_CTRL'] },
    tap_toggle: { type: 'tap_toggle', layer: 'lower' },
    set_base_saved: { type: 'set_base_saved', layer: 'base' },
    auto_layer: { type: 'auto_layer', layer: 'mouse' },
    gui_lock: { type: 'gui_lock', action: 'toggle' },
    secure: { type: 'secure', action: 'toggle' },
    autocorrect: { type: 'autocorrect', action: 'toggle' },
    tune_tap_term: { type: 'tune_tap_term', ms: 200 },
    unicode: { type: 'unicode', codepoint: 0x00e9 },
    macro_record: { type: 'macro_record', slot: 0 },
    macro_play: { type: 'macro_play', slot: 0 },
    leader: { type: 'leader', windowMs: 500 },
    peripheral: { type: 'peripheral', kind: 'encoder', code: 0 },
}

// Fallback descriptions for the few action options that carry no `.describe()`
// on the schema (so every type has a tooltip string).
const FALLBACK_DESC: Record<string, string> = {
    lighting: 'Drive a lighting axis (underglow / backlight / per-key).',
}

/** Pull each action option's `.describe()` string off the zod union. */
const DESC_BY_TYPE: Record<string, string> = (() => {
    const out: Record<string, string> = {}
    for (const opt of ActionObjectSchema.options) {
        const type = opt.shape.type.value as string
        const desc = opt.description ?? FALLBACK_DESC[type]
        if (desc) out[type] = desc
    }
    return out
})()

export interface ActionMeta {
    type: string
    description: string
    category: ActionCategory
    /** A minimal valid surface example, for autocomplete insertion. */
    snippet: unknown
}

/** Editor metadata for every surface action type, in palette order. */
export const ACTION_META: readonly ActionMeta[] = ACTION_TYPES.map((type) => ({
    type,
    description: DESC_BY_TYPE[type] ?? '',
    category: CATEGORY_BY_TYPE[type] ?? 'key',
    snippet: SNIPPET_BY_TYPE[type] ?? { type },
}))

const ACTION_META_BY_TYPE = new Map(ACTION_META.map((m) => [m.type, m]))

/** Lookup an action type's editor metadata. */
export function getActionMeta(type: string): ActionMeta | undefined {
    return ACTION_META_BY_TYPE.get(type)
}

export interface PaletteKeycode {
    id: string
    name: string
    description?: string
    notes?: string
}

export interface PaletteGroup {
    id: string
    name: string
    keycodes: PaletteKeycode[]
}

/**
 * Categorized keycode palette for the editor sidebar / autocomplete, harvested
 * from the catalog pages. Carries the same name/description/notes the visual
 * picker shows, so the code editor's tooltips match.
 */
export const KEYCODE_PALETTE: readonly PaletteGroup[] = CATALOG_PAGES.map(
    (page) => ({
        id: page.id,
        name: page.name,
        keycodes: page.entries.map((e) => ({
            id: e.id,
            name: e.name,
            ...(e.description ? { description: e.description } : {}),
            ...(e.notes ? { notes: e.notes } : {}),
        })),
    }),
)
