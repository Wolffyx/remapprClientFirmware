// Pattern check: no GoF pattern (-) — rejected — plain data type definitions for catalog entries/pages, no abstraction needed.
// pattern-check: skip adding optional notes field to existing CatalogEntry data interface — mechanical extension
import type { ActionSlotKind, BehaviorRef } from '../types'

// Neutral domain id for a pickable key, e.g. 'key.letter.a',
// 'wireless.profile.1', 'mouse.cursor.up'. Stable across firmwares.
export type CanonicalKeyId = string

// pattern-check: skip optional field add to existing data interface — mechanical extension
export interface CatalogEntry {
    id: CanonicalKeyId
    label: string
    name: string
    description?: string
    // Neutral icon id (see src/legendIcons.ts) shown on the picker tile before
    // the label — e.g. a mouse-cursor key gets an arrow, a button gets a mouse
    // glyph. The renderer resolves it; an unknown id just shows the label.
    icon?: string
    // Platform-support / caveats (e.g. "Globe — iOS full, macOS partial").
    // Sourced from external-names EXTERNAL_NOTES; surfaced in tooltips.
    notes?: string
    x?: number
    y?: number
    w?: number
    h?: number
    kinds: ActionSlotKind[]
    // Alternate names from merged duplicate entries (e.g. "Keypad Backspace"
    // when merged into "Keyboard Backspace") plus external firmware spellings
    // (ZMK + QMK + KC_*/QK_*) from external-names EXTERNAL_NAMES. Picker
    // search includes these.
    aliases?: string[]
    // Runtime-injected entries for ZMK user-defined `&macro_*` / `&combo_*`
    // behaviors and Remappr §24 named macros. Picker click skips the
    // slot-fill flow and emits a complete KeyAction { kind, params } via
    // onActionChosen instead of a codec-encoded number. `params` carries the
    // composite pool index for Remappr macros; ZMK behaviors omit it (empty
    // params). Static catalog entries leave this unset.
    behaviorRef?: BehaviorRef
    // Display-only tile (e.g. parsed ZMK combo from a side-loaded
    // .keymap file). Picker click shows a toast instead of dispatching
    // a binding because there's no firmware path to set the entry.
    displayOnly?: boolean
    // Toast text shown on a displayOnly click, replacing the generic
    // sideloaded-combo message (e.g. why a parameterized macro can't be
    // assigned over the wire).
    displayOnlyNote?: string
}

export interface CatalogPage {
    id: string
    name: string
    style: 'keyboard-grid' | 'flat-grid'
    visible: boolean
    entries: CatalogEntry[]
}

export interface KeyCatalog {
    pages: CatalogPage[]
}
