// Pattern check: no GoF pattern (-) — rejected — single shared data table (the
// canonical mouse command list); consumed by the builder (→ CanonAction) and the
// editor's ZMK synth (→ behaviorRef). No abstraction.
//
// One source of truth for the unified "Mouse" command set. The builder derives its
// deviceless `ENUM_ACTIONS.mouse` from this (builderActionTypes.ts); the editor
// synthesizes a composite "Mouse" ActionType from it (zmk/actionTypes.ts via
// zmk/mouseZmk.ts). Array order === the enum value, so both sides agree and the
// builder's existing value↔action decode (builderKeyActionBridge) is unchanged.

import type { CanonAction } from '@firmware/config'

export interface MouseCommand {
    /** Dropdown / cap label (e.g. "LMB", "Move ↑"). */
    label: string
    /** Neutral icon id (src/legendIcons.ts); omitted for MB4 / MB5. */
    icon?: string
    /** Neutral action this command represents. */
    canon: CanonAction
}

/** The 13 unified mouse commands, in display order (index === enum value). */
export const MOUSE_COMMANDS: MouseCommand[] = [
    { label: 'LMB', icon: 'mouse-left', canon: { type: 'mouse_key', button: 'left' } },
    { label: 'RMB', icon: 'mouse-right', canon: { type: 'mouse_key', button: 'right' } },
    { label: 'MMB', icon: 'mouse', canon: { type: 'mouse_key', button: 'middle' } },
    { label: 'MB4', canon: { type: 'mouse_key', button: 'mb4' } },
    { label: 'MB5', canon: { type: 'mouse_key', button: 'mb5' } },
    { label: 'Move ↑', icon: 'arrow-up', canon: { type: 'mouse_move', direction: 'up' } },
    { label: 'Move ↓', icon: 'arrow-down', canon: { type: 'mouse_move', direction: 'down' } },
    { label: 'Move ←', icon: 'arrow-left', canon: { type: 'mouse_move', direction: 'left' } },
    { label: 'Move →', icon: 'arrow-right', canon: { type: 'mouse_move', direction: 'right' } },
    { label: 'Scroll ↑', icon: 'scroll-up', canon: { type: 'mouse_scroll', direction: 'up' } },
    { label: 'Scroll ↓', icon: 'scroll-down', canon: { type: 'mouse_scroll', direction: 'down' } },
    { label: 'Scroll ←', icon: 'scroll-left', canon: { type: 'mouse_scroll', direction: 'left' } },
    { label: 'Scroll →', icon: 'scroll-right', canon: { type: 'mouse_scroll', direction: 'right' } },
]
