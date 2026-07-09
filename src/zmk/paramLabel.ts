// pattern-check: skip — static token→legend data tables for the ZMK adapter
//
// ZMK enum-command tokens (as reported in behavior metadata param values) →
// short keycap text + optional neutral icon id. Consumed by buildParamLabel
// (src/paramLabel.ts) via the `shortMap` argument; any token absent here falls
// back to shortenToken() with no icon. Entries are either a bare string
// (text-only) or { text, icon }. Keep text ≤6 chars — KeyButton sizes the
// legend off text length. Icon ids come from the neutral vocabulary
// (src/legendIcons.ts) and are resolved by the renderer's registry; an
// unrecognised id degrades to the token's text.
import type { TokenLegend, TokenMap } from '../paramLabel'

export const ZMK_SHORT_TOKENS: Readonly<TokenMap> = {
    // &bt — Bluetooth. BT_SEL / BT_DISC take a trailing profile index which
    // buildParamLabel appends as a plain-text part (→ "BT 0" / "Disc 0").
    BT_SEL: { text: 'BT', icon: 'bluetooth' },
    BT_DISC: { text: 'Disc', icon: 'disconnect' },
    BT_CLR: { text: 'Clr', icon: 'clear' },
    BT_CLR_ALL: { text: 'ClrAll', icon: 'clear-all' },
    BT_NXT: { text: 'Next', icon: 'next' },
    BT_PRV: { text: 'Prev', icon: 'prev' },

    // &rgb_ug — RGB underglow. On/off/toggle carry icons; the +/- fine-grain
    // adjustments stay text (no unambiguous glyph) — the &rgb_ug behavior icon
    // still prefixes them.
    RGB_TOG: { text: 'Tog', icon: 'toggle' },
    RGB_ON: { text: 'On', icon: 'on' },
    RGB_OFF: { text: 'Off', icon: 'off' },
    RGB_HUI: 'Hue+',
    RGB_HUD: 'Hue−',
    RGB_SAI: 'Sat+',
    RGB_SAD: 'Sat−',
    RGB_BRI: 'Bri+',
    RGB_BRD: 'Bri−',
    RGB_SPI: 'Spd+',
    RGB_SPD: 'Spd−',
    RGB_EFF: 'Eff+',
    RGB_EFR: 'Eff−',

    // &bl — Backlight.
    BL_TOG: { text: 'Tog', icon: 'toggle' },
    BL_INC: 'Bri+',
    BL_DEC: 'Bri−',
    BL_ON: { text: 'On', icon: 'on' },
    BL_OFF: { text: 'Off', icon: 'off' },
    BL_CYCLE: 'Cycle',

    // &ext_power — External power.
    EP_TOG: { text: 'Tog', icon: 'toggle' },
    EP_ON: { text: 'On', icon: 'on' },
    EP_OFF: { text: 'Off', icon: 'off' },

    // &out — Output selection.
    OUT_USB: { text: 'USB', icon: 'usb' },
    OUT_BLE: { text: 'BLE', icon: 'ble' },
    OUT_TOG: { text: 'Tog', icon: 'toggle' },

    // &mkp — Mouse buttons. Left / right carry a button-specific glyph; the
    // behavior icon prefixes them. (The device reports these as MB* tokens.)
    MB1: { text: 'MB1', icon: 'mouse-left' },
    MB2: { text: 'MB2', icon: 'mouse-right' },
    MB3: { text: 'MB3', icon: 'mouse' },
    MB4: 'MB4',
    MB5: 'MB5',

    // &mmv — Mouse move.
    MOVE_UP: '↑',
    MOVE_DOWN: '↓',
    MOVE_LEFT: '←',
    MOVE_RIGHT: '→',

    // &msc — Mouse scroll.
    SCRL_UP: 'Scr↑',
    SCRL_DOWN: 'Scr↓',
    SCRL_LEFT: 'Scr←',
    SCRL_RIGHT: 'Scr→',
}

// Behavior-level legends keyed by &prefix. The `icon` prefixes every command of
// the behavior on a cap (e.g. a &bt cap leads with the bluetooth icon), and is
// the whole legend for a zero-arg behavior (&soft_off, &caps_word, …) with
// `text` as the icon-less fallback. Param behaviors use `text: ''` — their
// command part carries the visible text. Icon ids are from src/legendIcons.ts.
export const ZMK_BEHAVIOR_LEGENDS: Readonly<Record<string, TokenLegend>> = {
    '&bt': { text: '', icon: 'bluetooth' },
    '&out': { text: '', icon: 'output' },
    '&rgb_ug': { text: '', icon: 'underglow' },
    '&bl': { text: '', icon: 'backlight' },
    '&ext_power': { text: '', icon: 'power' },
    '&mkp': { text: '', icon: 'mouse-button' },
    '&mmv': { text: '', icon: 'mouse-move' },
    '&msc': { text: '', icon: 'mouse-scroll' },
    '&soft_off': { text: 'Off', icon: 'power-off' },
    '&sys_reset': { text: 'Rst', icon: 'reset' },
    '&bootloader': { text: 'Boot', icon: 'bootloader' },
    '&caps_word': { text: 'Caps', icon: 'caps-word' },
    '&key_repeat': { text: 'Rept', icon: 'key-repeat' },
    '&studio_unlock': { text: 'Unlk', icon: 'unlock' },
}

/** The neutral icon id for an enum token, if the ZMK map assigns one. */
export function zmkTokenIcon(token: string | undefined): string | undefined {
    if (!token) return undefined
    const entry = ZMK_SHORT_TOKENS[token]
    return typeof entry === 'object' ? entry.icon : undefined
}

// pattern-check: skip — static value-keyed data tables + pure resolver/merge helpers
//
// Command legends keyed by &prefix → param1 CONSTANT → legend. Real ZMK reports
// each command value's `name` as a friendly phrase ("Next Profile") that varies
// by firmware version, but the constant is the stable contract (matches ZMK's
// dt-bindings headers), so we key on it — the token map above only ever matches
// the mock (whose value labels ARE the tokens). Icons come from the neutral
// vocabulary (src/legendIcons.ts); fine-grain adjust commands (hue/sat/±) carry
// text only. Constants verified against a live ZMK device, not the fixtures
// (several of whose constants are wrong — e.g. Backlight / Output).
export const ZMK_COMMAND_LEGENDS: Readonly<
    Record<string, Readonly<Record<number, TokenLegend>>>
> = {
    '&bt': {
        0: { text: 'Clr', icon: 'clear' }, // Clear Selected Profile
        1: { text: 'Next', icon: 'next' }, // Next Profile
        2: { text: 'Prev', icon: 'prev' }, // Previous Profile
        3: { text: 'Sel', icon: 'bluetooth' }, // Select Profile (+ index)
        4: { text: 'ClrAll', icon: 'clear-all' }, // Clear All Profiles
        5: { text: 'Disc', icon: 'disconnect' }, // Disconnect Profile (+ index)
    },
    '&out': {
        0: { text: 'Tog', icon: 'toggle' }, // Toggle Outputs
        1: { text: 'USB', icon: 'usb' }, // USB Output
        2: { text: 'BLE', icon: 'ble' }, // BLE Output
        3: { text: 'None', icon: 'off' }, // No Output
    },
    '&rgb_ug': {
        0: { text: 'Tog', icon: 'toggle' },
        1: { text: 'On', icon: 'on' },
        2: { text: 'Off', icon: 'off' },
        3: { text: 'Hue+' },
        4: { text: 'Hue−' },
        5: { text: 'Sat+' },
        6: { text: 'Sat−' },
        7: { text: 'Bri+' },
        8: { text: 'Bri−' },
        9: { text: 'Spd+' },
        10: { text: 'Spd−' },
        11: { text: 'Eff+' },
        12: { text: 'Eff−' },
    },
    '&bl': {
        0: { text: 'On', icon: 'on' },
        1: { text: 'Off', icon: 'off' },
        2: { text: 'Tog', icon: 'toggle' },
        3: { text: 'Bri+' },
        4: { text: 'Bri−' },
        5: { text: 'Cyc' }, // Cycle Brightness
        6: { text: 'Set' }, // Set Brightness
    },
    '&ext_power': {
        0: { text: 'Off', icon: 'off' }, // EXT_POWER_OFF_CMD
        1: { text: 'On', icon: 'on' }, // EXT_POWER_ON_CMD
        2: { text: 'Tog', icon: 'toggle' }, // EXT_POWER_TOGGLE_CMD
    },
    // &mkp — mouse buttons. Left / right get the button-specific glyph; the
    // rest keep text (no distinct icon) and fall back to the behavior glyph.
    '&mkp': {
        1: { text: 'MB1', icon: 'mouse-left' }, // MB1 — left
        2: { text: 'MB2', icon: 'mouse-right' }, // MB2 — right
        4: { text: 'MB3', icon: 'mouse' }, // MB3 — middle
        8: { text: 'MB4' }, // MB4 — back
        16: { text: 'MB5' }, // MB5 — forward
    },
}

/** The command legend for a (behavior &prefix, param1 constant), if mapped. */
export function zmkCommandLegend(
    prefix: string | undefined,
    constant: number | undefined,
): TokenLegend | undefined {
    if (!prefix || constant === undefined) return undefined
    return ZMK_COMMAND_LEGENDS[prefix]?.[constant]
}

/**
 * Build the cap-legend `shortMap` for one behavior, keyed by its enum values'
 * ACTUAL labels (friendly on hardware, tokens on the mock) so buildParamLabel's
 * `shortMap[label]` lookup resolves either way. A value whose label is already a
 * known token keeps its ZMK_SHORT_TOKENS entry (the mock / fixtures rely on it,
 * and their constants may differ from a live device); only labels the token map
 * doesn't cover — i.e. friendly hardware names — fall through to value-keyed.
 */
export function zmkShortMap(
    prefix: string | undefined,
    enumValues: ReadonlyArray<{ value: number; label: string }> | undefined,
): TokenMap {
    if (!enumValues || enumValues.length === 0) return ZMK_SHORT_TOKENS
    const map: TokenMap = { ...ZMK_SHORT_TOKENS }
    for (const v of enumValues) {
        if (map[v.label] !== undefined) continue // token label — keep existing
        const legend = zmkCommandLegend(prefix, v.value)
        if (legend) map[v.label] = legend
    }
    return map
}
