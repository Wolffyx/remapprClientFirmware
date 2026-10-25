// Pattern check: no GoF pattern (-) — rejected — pure data Record<id, string[]> for hand-maintained spec-name lookup, no abstraction.
//
// External firmware spellings — ZMK keycode names + QMK KC_*/QK_* names —
// merged into each canonical entry's `aliases[]` at catalog build time.
// Picker search reads `aliases[]` so users can find a key by typing
// `KC_BSPC`, `BSPC`, `KC_BACKSPACE`, or `BACKSPACE` and get one canonical
// "Backspace" entry.
//
// Sourced: zmk.dev/docs/keymaps/list-of-keycodes (snapshot 2026-05-06)
//          docs.qmk.fm/keycodes               (snapshot 2026-05-06)
// Re-run the doc audit and update these tables when either page changes.
//
// Conventions:
//   - Every alias goes on the *primary* canonical id. HID-secondary ids
//     (per CANONICAL_ALIASES in aliases.ts) are not keys here — their
//     names belong on the primary they collapse onto.
//   - Shifted-symbol macros (QMK KC_TILDE / KC_EXLM, ZMK TILDE / EXCL)
//     attach to the existing key.shifted.* entries, not the underlying
//     physical keys (key.keyboard_grave_accent_and_tilde etc.).
//   - For canonical entries that intentionally have no spec mapping
//     (internal helpers like `wireless.battery.level`, dynamic macro
//     slots `macro.user.*`, joystick / programmable button banks, the
//     full MIDI note grid), list the id in EXTERNAL_NAMES_ALLOWLIST so
//     the coverage test passes. Visible adds/removes show up in PR diffs.

import type { CanonicalKeyId } from './types'

// pattern-check: skip small in-file generator helpers — DRY for repetitive HID/keypad/intl banks
type Names = Record<CanonicalKeyId, string[]>

const range = (count: number, start = 0): number[] =>
    Array.from({ length: count }, (_, i) => i + start)

const fromPairs = (pairs: ReadonlyArray<readonly [string, string[]]>): Names =>
    Object.fromEntries(pairs)

// HID page 7 IDs 30–39 — keyboard number row. Names tie back to the slugified
// HID `Name` field ("Keyboard 1 and Bang" → key.keyboard_1_and_bang).
const NUMBER_SLUGS: Record<number, string> = {
    1: '1_and_bang',
    2: '2_and_at',
    3: '3_and_hash',
    4: '4_and_dollar',
    5: '5_and_percent',
    6: '6_and_caret',
    7: '7_and_ampersand',
    8: '8_and_star',
    9: '9_and_left_bracket',
    0: '0_and_right_bracket',
}

// HID page 7 keypad number names (89–98). Order = digit → slug suffix.
const KEYPAD_NUMBER_SLUGS: Record<number, string> = {
    0: '0_and_insert',
    1: '1_and_end',
    2: '2_and_down_arrow',
    3: '3_and_pagedn',
    4: '4_and_left_arrow',
    5: '5',
    6: '6_and_right_arrow',
    7: '7_and_home',
    8: '8_and_up_arrow',
    9: '9_and_pageup',
}

// Per-index extra ZMK shorthands (e.g. INT_RO for INTERNATIONAL_1).
const INTL_EXTRAS: Record<number, string[]> = {
    1: ['INT_RO'],
    2: ['INT_KATAKANAHIRAGANA', 'INT_KANA'],
    3: ['INT_YEN'],
    4: ['INT_HENKAN'],
    5: ['INT_MUHENKAN'],
    6: ['INT_KPJPCOMMA'],
}

const LANG_EXTRAS: Record<number, string[]> = {
    1: ['LANG_HANGEUL'],
    2: ['LANG_HANJA'],
    3: ['LANG_KATAKANA'],
    4: ['LANG_HIRAGANA'],
    5: ['LANG_ZENKAKUHANKAKU'],
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const lettersMap: Names = fromPairs(
    LETTERS.map((c) => [`key.keyboard_${c.toLowerCase()}`, [c, `KC_${c}`]]),
)

const fkeysMap: Names = fromPairs(
    range(24, 1).map((n) => [`key.keyboard_f${n}`, [`F${n}`, `KC_F${n}`]]),
)

const numbersMap: Names = fromPairs(
    range(10).map((n) => [
        `key.keyboard_${NUMBER_SLUGS[n]}`,
        [`NUMBER_${n}`, `N${n}`, `KC_${n}`],
    ]),
)

const keypadNumbersMap: Names = fromPairs(
    range(10).map((n) => [
        `key.keypad_${KEYPAD_NUMBER_SLUGS[n]}`,
        [`KP_NUMBER_${n}`, `KP_N${n}`, `KC_KP_${n}`, `KC_P${n}`],
    ]),
)

const internationalsMap: Names = fromPairs(
    range(9, 1).map((n) => [
        `key.keyboard_international${n}`,
        [
            `INTERNATIONAL_${n}`,
            `INT${n}`,
            ...(INTL_EXTRAS[n] ?? []),
            `KC_INTERNATIONAL_${n}`,
            `KC_INT${n}`,
        ],
    ]),
)

const languagesMap: Names = fromPairs(
    range(9, 1).map((n) => [
        `key.keyboard_lang${n}`,
        [
            `LANGUAGE_${n}`,
            `LANG${n}`,
            ...(LANG_EXTRAS[n] ?? []),
            `KC_LANGUAGE_${n}`,
            `KC_LNG${n}`,
        ],
    ]),
)

const btProfilesMap: Names = fromPairs(
    range(5, 1).map((n) => [
        `wireless.profile.${n}`,
        [`BT_SEL ${n - 1}`, `QK_BLUETOOTH_PROFILE${n}`, `BT_PRF${n}`],
    ]),
)

const mouseButtonsMap: Names = fromPairs(
    range(8, 1).map((n) => [
        `mouse.button.${n}`,
        [`QK_MOUSE_BUTTON_${n}`, `MS_BTN${n}`],
    ]),
)

// pattern-check: skip mechanical range/flatMap expansion of MIDI banks
const MIDI_NOTE_SLUGS = [
    'c', 'c_sharp', 'd', 'd_sharp', 'e', 'f',
    'f_sharp', 'g', 'g_sharp', 'a', 'a_sharp', 'b',
] as const
const MIDI_OCTAVE_SLUGS = [
    'n2', 'n1', '0', '1', '2', '3', '4', '5', '6', '7',
] as const
const MIDI_TRANSPOSE_SLUGS = [
    'n6', 'n5', 'n4', 'n3', 'n2', 'n1',
    '0', '1', '2', '3', '4', '5', '6',
] as const

const MIDI_BANK_IDS: readonly CanonicalKeyId[] = [
    ...range(6).flatMap((o) =>
        MIDI_NOTE_SLUGS.map((s) => `midi.note.${s}_${o}`),
    ),
    ...MIDI_OCTAVE_SLUGS.map((o) => `midi.octave.${o}`),
    ...MIDI_TRANSPOSE_SLUGS.map((t) => `midi.transpose.${t}`),
    ...range(11).map((v) => `midi.velocity.${v}`),
    ...range(16, 1).map((c) => `midi.channel.${c}`),
]

export const EXTERNAL_NAMES: Record<CanonicalKeyId, string[]> = {
    ...lettersMap,
    ...fkeysMap,
    ...numbersMap,
    ...keypadNumbersMap,
    ...internationalsMap,
    ...languagesMap,
    ...btProfilesMap,
    ...mouseButtonsMap,

    // pattern-check: skip bulk row trim — generators above provide same data
    // Letters (HID 7 / 4–29) and numbers (30–39) come from lettersMap /
    // numbersMap above. Override-able here if a digit ever needs more
    // than [NUMBER_n, Nn, KC_n] — none today.

    // ─────────────────────────────────────────────────────────────
    // Control & whitespace (HID 7 / 40–43)
    // RETURN2/RET2 (HID 158) collapses here via CANONICAL_ALIASES.
    // ─────────────────────────────────────────────────────────────
    'key.keyboard_return_enter': [
        'RETURN', 'ENTER', 'RET', 'RETURN2', 'RET2',
        'KC_ENTER', 'KC_ENT',
    ],
    'key.keyboard_escape': ['ESCAPE', 'ESC', 'KC_ESCAPE', 'KC_ESC'],
    'key.keyboard_backspace': [
        'BACKSPACE', 'BSPC',
        'KC_BACKSPACE', 'KC_BSPC',
    ],
    'key.keyboard_tab': ['TAB', 'KC_TAB'],
    'key.keyboard_spacebar': ['SPACE', 'KC_SPACE', 'KC_SPC'],

    // ─────────────────────────────────────────────────────────────
    // Punctuation (HID 7 / 45–56)
    // ─────────────────────────────────────────────────────────────
    'key.keyboard_dash_and_underscore': [
        'MINUS', 'KC_MINUS', 'KC_MINS',
    ],
    'key.keyboard_equals_and_plus': [
        'EQUAL', 'KC_EQUAL', 'KC_EQL',
    ],
    'key.keyboard_left_brace': [
        'LEFT_BRACKET', 'LBKT', 'KC_LEFT_BRACKET', 'KC_LBRC',
    ],
    'key.keyboard_right_brace': [
        'RIGHT_BRACKET', 'RBKT', 'KC_RIGHT_BRACKET', 'KC_RBRC',
    ],
    'key.keyboard_backslash_and_pipe': [
        'BACKSLASH', 'BSLH', 'KC_BACKSLASH', 'KC_BSLS',
    ],
    'key.keyboard_non_us_hash_and_tilde': [
        'NON_US_HASH', 'NUHS', 'TILDE2',
        'KC_NONUS_HASH', 'KC_NUHS',
    ],
    'key.keyboard_semicolon_and_colon': [
        'SEMICOLON', 'SEMI', 'KC_SEMICOLON', 'KC_SCLN',
    ],
    'key.keyboard_left_apos_and_double': [
        'SINGLE_QUOTE', 'SQT', 'APOSTROPHE', 'APOS',
        'KC_QUOTE', 'KC_QUOT',
    ],
    'key.keyboard_grave_accent_and_tilde': [
        'GRAVE', 'KC_GRAVE', 'KC_GRV',
    ],
    'key.keyboard_comma_and_lessthan': ['COMMA', 'KC_COMMA', 'KC_COMM'],
    'key.keyboard_period_and_greaterthan': ['PERIOD', 'DOT', 'KC_DOT'],
    'key.keyboard_forwardslash_and_questionmark': [
        'SLASH', 'FSLH', 'KC_SLASH', 'KC_SLSH',
    ],

    // ─────────────────────────────────────────────────────────────
    // Locks (HID 7 / 57, 71, 83, 130–132)
    // ─────────────────────────────────────────────────────────────
    'key.keyboard_caps_lock': [
        'CAPSLOCK', 'CAPS', 'CLCK', 'KC_CAPS_LOCK', 'KC_CAPS',
    ],
    'key.keyboard_scroll_lock': [
        'SCROLLLOCK', 'SLCK', 'KC_SCROLL_LOCK', 'KC_SCRL', 'KC_BRMD',
    ],
    'key.keypad_num_lock_and_clear': [
        'KP_NUMLOCK', 'KP_NUM', 'KP_NLCK',
        'KC_NUM_LOCK', 'KC_NUM',
    ],
    'key.keyboard_locking_caps_lock': [
        'LOCKING_CAPS', 'LCAPS',
        'KC_LOCKING_CAPS_LOCK', 'KC_LCAP',
    ],
    'key.keyboard_locking_num_lock': [
        'LOCKING_NUM', 'LNLCK',
        'KC_LOCKING_NUM_LOCK', 'KC_LNUM',
    ],
    'key.keyboard_locking_scroll_lock': [
        'LOCKING_SCROLL', 'LSLCK',
        'KC_LOCKING_SCROLL_LOCK', 'KC_LSCR',
    ],

    // pattern-check: skip bulk row trim — fkeysMap covers F1–F24
    // F1–F24 (HID 7 / 58–69, 104–115) come from fkeysMap above.

    // ─────────────────────────────────────────────────────────────
    // Navigation (HID 7 / 70–82)
    // ─────────────────────────────────────────────────────────────
    'key.keyboard_printscreen': [
        'PRINTSCREEN', 'PSCRN', 'KC_PRINT_SCREEN', 'KC_PSCR',
    ],
    'key.keyboard_pause': [
        'PAUSE_BREAK', 'KC_PAUSE', 'KC_PAUS', 'KC_BRK', 'KC_BRMU',
    ],
    'key.keyboard_insert': ['INSERT', 'INS', 'KC_INSERT', 'KC_INS'],
    'key.keyboard_home': ['HOME', 'KC_HOME'],
    'key.keyboard_pageup': [
        'PAGE_UP', 'PG_UP', 'KC_PAGE_UP', 'KC_PGUP',
    ],
    'key.keyboard_delete_forward': [
        'DELETE', 'DEL', 'KC_DELETE', 'KC_DEL',
    ],
    'key.keyboard_end': ['END', 'KC_END'],
    'key.keyboard_pagedown': [
        'PAGE_DOWN', 'PG_DN', 'KC_PAGE_DOWN', 'KC_PGDN',
    ],
    'key.keyboard_rightarrow': [
        'RIGHT_ARROW', 'RIGHT', 'KC_RIGHT', 'KC_RGHT',
    ],
    'key.keyboard_leftarrow': ['LEFT_ARROW', 'LEFT', 'KC_LEFT'],
    'key.keyboard_downarrow': ['DOWN_ARROW', 'DOWN', 'KC_DOWN'],
    'key.keyboard_uparrow': ['UP_ARROW', 'UP', 'KC_UP'],
    'key.keyboard_application': [
        'K_APPLICATION', 'K_APP', 'K_CONTEXT_MENU', 'K_CMENU',
        'KC_APPLICATION', 'KC_APP',
    ],
    'key.keyboard_power': [
        'K_POWER', 'K_PWR', 'KC_KB_POWER',
    ],

    // ─────────────────────────────────────────────────────────────
    // Keypad (HID 7 / 84–99, 103, 133–134)
    // ─────────────────────────────────────────────────────────────
    'key.keypad_forwardslash': [
        'KP_DIVIDE', 'KP_SLASH',
        'KC_KP_SLASH', 'KC_PSLS',
    ],
    'key.keypad_star': [
        'KP_MULTIPLY', 'KP_ASTERISK',
        'KC_KP_ASTERISK', 'KC_PAST',
    ],
    'key.keypad_dash': [
        'KP_MINUS', 'KP_SUBTRACT',
        'KC_KP_MINUS', 'KC_PMNS',
    ],
    'key.keypad_plus': ['KP_PLUS', 'KC_KP_PLUS', 'KC_PPLS'],
    // pattern-check: skip bulk row trim — keypadNumbersMap covers KP 0–9
    'key.keypad_period_and_delete': ['KP_DOT', 'KC_KP_DOT', 'KC_PDOT'],
    'key.keyboard_non_us_backslash_and_pipe': [
        'NON_US_BACKSLASH', 'NON_US_BSLH', 'NUBS', 'PIPE2',
        'KC_NONUS_BACKSLASH', 'KC_NUBS',
    ],
    'key.keypad_equals': [
        'KP_EQUAL', 'KC_KP_EQUAL', 'KC_PEQL',
    ],
    'key.keypad_comma': ['KP_COMMA', 'KC_KP_COMMA', 'KC_PCMM'],
    'key.keypad_equal_sign': [
        'KP_EQUAL_AS400', 'KC_KP_EQUAL_AS400',
    ],

    // pattern-check: skip bulk row trim — internationalsMap + languagesMap cover 1–9 with INTL_EXTRAS / LANG_EXTRAS for the named slots
    // International (HID 7 / 135–143) and Language (144–152) come from
    // internationalsMap / languagesMap above with INTL_EXTRAS /
    // LANG_EXTRAS supplying the named ZMK shorthands (INT_RO,
    // LANG_HANGEUL, etc.) per index.

    // ─────────────────────────────────────────────────────────────
    // Misc keyboard (HID 7 / 116–164, 166)
    // ─────────────────────────────────────────────────────────────
    'key.keyboard_execute': ['K_EXECUTE', 'K_EXEC', 'KC_EXECUTE', 'KC_EXEC'],
    'key.keyboard_help': ['K_HELP', 'KC_HELP'],
    'key.keyboard_menu': ['K_MENU', 'KC_MENU'],
    'key.keyboard_select': ['K_SELECT', 'KC_SELECT', 'KC_SLCT'],
    'key.keyboard_stop': [
        'K_STOP', 'K_STOP2', 'K_STOP3', 'KC_STOP',
    ],
    'key.keyboard_again': [
        'K_AGAIN', 'K_REDO', 'KC_AGAIN', 'KC_AGIN',
    ],
    'key.keyboard_undo': ['K_UNDO', 'KC_UNDO'],
    'key.keyboard_cut': ['K_CUT', 'KC_CUT'],
    'key.keyboard_copy': ['K_COPY', 'KC_COPY'],
    'key.keyboard_paste': ['K_PASTE', 'KC_PASTE', 'KC_PSTE'],
    'key.keyboard_find': ['K_FIND', 'K_FIND2', 'KC_FIND'],
    'key.keyboard_mute': [
        'K_MUTE', 'K_MUTE2', 'KC_KB_MUTE',
        // Its label before it read as the keyboard-page variant: saved configs
        // that spell it this way keep sending the same key.
        'Mute',
    ],
    'key.keyboard_volume_up': [
        'K_VOLUME_UP', 'K_VOL_UP', 'K_VOLUME_UP2', 'K_VOL_UP2',
        'KC_KB_VOLUME_UP',
        // Its label before it read as the keyboard-page variant: saved configs
        // that spell it this way keep sending the same key.
        'Volume Up',
    ],
    'key.keyboard_volume_down': [
        'K_VOLUME_DOWN', 'K_VOL_DN', 'K_VOLUME_DOWN2', 'K_VOL_DN2',
        'KC_KB_VOLUME_DOWN',
        // Its label before it read as the keyboard-page variant: saved configs
        // that spell it this way keep sending the same key.
        'Volume Down',
    ],
    'key.keyboard_alternate_erase': [
        'ALT_ERASE', 'KC_ALTERNATE_ERASE', 'KC_ERAS',
    ],
    'key.keyboard_sysreq_attention': [
        'SYSREQ', 'ATTENTION', 'KC_SYSTEM_REQUEST', 'KC_SYRQ',
    ],
    'key.keyboard_cancel': ['K_CANCEL', 'KC_CANCEL', 'KC_CNCL'],
    'key.keyboard_clear': ['CLEAR', 'KC_CLEAR', 'KC_CLR'],
    'key.keyboard_prior': ['PRIOR', 'KC_PRIOR', 'KC_PRIR'],
    'key.keyboard_separator': ['SEPARATOR', 'KC_SEPARATOR', 'KC_SEPR'],
    'key.keyboard_out': ['OUT', 'KC_OUT'],
    'key.keyboard_oper': ['OPER', 'KC_OPER'],
    'key.keyboard_clear_again': [
        'CLEAR_AGAIN', 'KC_CLEAR_AGAIN', 'KC_CLAG',
    ],
    'key.keyboard_crsel_props': ['CRSEL', 'KC_CRSEL', 'KC_CRSL'],
    'key.keyboard_exsel': ['EXSEL', 'KC_EXSEL', 'KC_EXSL'],
    'key.keypad_clear': ['KP_CLEAR'],
    'key.keypad_clear_entry': ['CLEAR2'],

    // ─────────────────────────────────────────────────────────────
    // Modifiers (HID 7 / 224–231 → mod.* via CANONICAL_ALIASES)
    // ─────────────────────────────────────────────────────────────
    'mod.lctrl': [
        'LEFT_CONTROL', 'LCTRL', 'KC_LEFT_CTRL', 'KC_LCTL',
    ],
    'mod.lshift': [
        'LEFT_SHIFT', 'LSHIFT', 'LSHFT',
        'KC_LEFT_SHIFT', 'KC_LSFT',
    ],
    'mod.lalt': [
        'LEFT_ALT', 'LALT',
        'KC_LEFT_ALT', 'KC_LALT', 'KC_LOPT',
    ],
    'mod.lgui': [
        'LEFT_GUI', 'LGUI', 'LEFT_WIN', 'LWIN',
        'LEFT_COMMAND', 'LCMD', 'LEFT_META', 'LMETA',
        'KC_LEFT_GUI', 'KC_LGUI', 'KC_LCMD', 'KC_LWIN',
    ],
    'mod.rctrl': [
        'RIGHT_CONTROL', 'RCTRL', 'KC_RIGHT_CTRL', 'KC_RCTL',
    ],
    'mod.rshift': [
        'RIGHT_SHIFT', 'RSHIFT', 'RSHFT',
        'KC_RIGHT_SHIFT', 'KC_RSFT',
    ],
    'mod.ralt': [
        'RIGHT_ALT', 'RALT',
        'KC_RIGHT_ALT', 'KC_RALT', 'KC_ROPT', 'KC_ALGR',
    ],
    'mod.rgui': [
        'RIGHT_GUI', 'RGUI', 'RIGHT_WIN', 'RWIN',
        'RIGHT_COMMAND', 'RCMD', 'RIGHT_META', 'RMETA',
        'KC_RIGHT_GUI', 'KC_RGUI', 'KC_RCMD', 'KC_RWIN',
    ],
    'mod.meh': ['KC_MEH'],
    'mod.hypr': ['KC_HYPR'],

    // ─────────────────────────────────────────────────────────────
    // Shifted symbols (key.shifted.* — QMK macros + ZMK shifted constants)
    // ─────────────────────────────────────────────────────────────
    'key.shifted.tilde': ['TILDE', 'KC_TILDE', 'KC_TILD'],
    'key.shifted.exclaim': [
        'EXCLAMATION', 'EXCL',
        'KC_EXCLAIM', 'KC_EXLM',
    ],
    'key.shifted.at': ['AT_SIGN', 'AT', 'KC_AT'],
    'key.shifted.hash': ['HASH', 'POUND', 'KC_HASH'],
    'key.shifted.dollar': ['DOLLAR', 'DLLR', 'KC_DOLLAR', 'KC_DLR'],
    'key.shifted.percent': ['PERCENT', 'PRCNT', 'KC_PERCENT', 'KC_PERC'],
    'key.shifted.circumflex': [
        'CARET', 'KC_CIRCUMFLEX', 'KC_CIRC',
    ],
    'key.shifted.ampersand': [
        'AMPERSAND', 'AMPS', 'KC_AMPERSAND', 'KC_AMPR',
    ],
    'key.shifted.asterisk': [
        'ASTERISK', 'ASTRK', 'STAR',
        'KC_ASTERISK', 'KC_ASTR',
    ],
    'key.shifted.lparen': [
        'LEFT_PARENTHESIS', 'LPAR',
        'KC_LEFT_PAREN', 'KC_LPRN',
    ],
    'key.shifted.rparen': [
        'RIGHT_PARENTHESIS', 'RPAR',
        'KC_RIGHT_PAREN', 'KC_RPRN',
    ],
    'key.shifted.underscore': [
        'UNDERSCORE', 'UNDER', 'KC_UNDERSCORE', 'KC_UNDS',
    ],
    'key.shifted.plus': ['PLUS', 'KC_PLUS'],
    'key.shifted.lcurly': [
        'LEFT_BRACE', 'LBRC',
        'KC_LEFT_CURLY_BRACE', 'KC_LCBR',
    ],
    'key.shifted.rcurly': [
        'RIGHT_BRACE', 'RBRC',
        'KC_RIGHT_CURLY_BRACE', 'KC_RCBR',
    ],
    'key.shifted.pipe': ['PIPE', 'KC_PIPE'],
    'key.shifted.colon': ['COLON', 'KC_COLON', 'KC_COLN'],
    'key.shifted.dquote': [
        'DOUBLE_QUOTES', 'DQT',
        'KC_DOUBLE_QUOTE', 'KC_DQUO', 'KC_DQT',
    ],
    'key.shifted.lt': [
        'LESS_THAN', 'LT',
        'KC_LEFT_ANGLE_BRACKET', 'KC_LABK', 'KC_LT',
    ],
    'key.shifted.gt': [
        'GREATER_THAN', 'GT',
        'KC_RIGHT_ANGLE_BRACKET', 'KC_RABK', 'KC_GT',
    ],
    'key.shifted.question': [
        'QUESTION', 'QMARK', 'KC_QUESTION', 'KC_QUES',
    ],

    // ─────────────────────────────────────────────────────────────
    // Consumer keys (HID 12) — selected coverage. Usages the media page
    // (hid-pages/media.json) defines carry its `media.` id.
    // ─────────────────────────────────────────────────────────────
    'consumer.consumer_control': ['Consumer Control'],
    'media.volume_increment': ['C_VOLUME_UP', 'C_VOL_UP'],
    'media.volume_decrement': ['C_VOLUME_DOWN', 'C_VOL_DN'],
    'media.mute': ['C_MUTE'],
    'media.bass_boost': ['C_BASS_BOOST'],
    'media.alternate_audio_increment': [
        'C_ALTERNATE_AUDIO_INCREMENT', 'C_ALT_AUDIO_INC',
    ],
    'consumer.brightness_increment': [
        'C_BRIGHTNESS_INC', 'C_BRI_INC', 'C_BRI_UP',
        'KC_BRIGHTNESS_UP', 'KC_BRIU',
    ],
    'consumer.brightness_decrement': [
        'C_BRIGHTNESS_DEC', 'C_BRI_DEC', 'C_BRI_DN',
        'KC_BRIGHTNESS_DOWN', 'KC_BRID',
    ],
    'consumer.minimum_brightness': ['C_BRIGHTNESS_MINIMUM', 'C_BRI_MIN'],
    'consumer.maximum_brightness': ['C_BRIGHTNESS_MAXIMUM', 'C_BRI_MAX'],
    'consumer.auto_brightness': ['C_BRIGHTNESS_AUTO', 'C_BRI_AUTO'],
    'consumer.backlight_toggle': ['C_BACKLIGHT_TOGGLE', 'C_BKLT_TOG'],
    'consumer.aspect': ['C_ASPECT'],
    'consumer.picture_in_picture_toggle': ['C_PIP'],
    'consumer.menu': ['C_MENU'],
    'consumer.menu_pick': ['C_MENU_PICK', 'C_MENU_SELECT'],
    'consumer.menu_up': ['C_MENU_UP'],
    'consumer.menu_down': ['C_MENU_DOWN'],
    'consumer.menu_left': ['C_MENU_LEFT'],
    'consumer.menu_right': ['C_MENU_RIGHT'],
    'consumer.menu_escape': ['C_MENU_ESCAPE', 'C_MENU_ESC'],
    'consumer.menu_value_increase': ['C_MENU_INCREASE', 'C_MENU_INC'],
    'consumer.menu_value_decrease': ['C_MENU_DECREASE', 'C_MENU_DEC'],
    'consumer.red_menu_button': ['C_RED_BUTTON', 'C_RED'],
    'consumer.green_menu_button': ['C_GREEN_BUTTON', 'C_GREEN'],
    'consumer.blue_menu_button': ['C_BLUE_BUTTON', 'C_BLUE'],
    'consumer.yellow_menu_button': ['C_YELLOW_BUTTON', 'C_YELLOW'],
    'consumer.channel_increment': ['C_CHANNEL_INC', 'C_CHAN_INC'],
    'consumer.channel_decrement': ['C_CHANNEL_DEC', 'C_CHAN_DEC'],
    'consumer.recall_last': ['C_RECALL_LAST', 'C_CHAN_LAST'],
    'media.media_select_program_guide': ['C_MEDIA_GUIDE'],
    'media.media_select_home': ['C_MEDIA_HOME'],
    'media.media_select_tv': ['C_MEDIA_TV'],
    'media.media_select_www': ['C_MEDIA_WWW'],
    'media.media_select_telephone': ['C_MEDIA_PHONE'],
    'consumer.application_launch_button_configuration_tool': [
        'C_AL_CCC',
    ],
    'consumer.power': [
        'C_POWER', 'C_PWR',
        'KC_SYSTEM_POWER', 'KC_PWR',
    ],
    'consumer.reset': ['C_RESET'],
    'consumer.sleep': [
        'C_SLEEP', 'KC_SYSTEM_SLEEP', 'KC_SLEP',
    ],
    'consumer.sleep_mode': ['C_SLEEP_MODE'],
    'media.record': ['C_RECORD', 'C_REC'],
    'media.eject': [
        'C_EJECT',
        'KC_MEDIA_EJECT', 'KC_EJCT',
    ],
    'consumer.stop_eject': ['C_STOP_EJECT'],
    'media.slow': ['C_SLOW'],
    'media.repeat': ['C_REPEAT'],
    'media.random_play': ['C_RANDOM_PLAY', 'C_SHUFFLE'],
    'consumer.closed_caption_toggle': [
        'C_CAPTIONS', 'C_SUBTITLES',
    ],
    'consumer.data_on_screen': ['C_DATA_ON_SCREEN'],
    'consumer.snapshot': ['C_SNAPSHOT'],

    // Keyboard-page editing duplicates → AC application controls
    'ac.ac_undo': ['C_AC_UNDO'],
    'ac.ac_cut': ['C_AC_CUT'],
    'ac.ac_copy': ['C_AC_COPY'],
    'ac.ac_paste': ['C_AC_PASTE'],
    'ac.ac_find': ['C_AC_FIND'],
    'ac.ac_cancel': ['C_AC_CANCEL'],
    'ac.ac_redo_repeat': ['C_AC_REDO'],
    'ac.ac_properties': ['C_AC_PROPERTIES', 'C_AC_PROPS'],
    'ac.ac_refresh': ['C_AC_REFRESH'],
    'ac.ac_stop': ['C_AC_STOP'],
    'ac.ac_forward': ['C_AC_FORWARD'],
    'ac.ac_back': ['C_AC_BACK'],
    'ac.ac_home': ['C_AC_HOME'],
    'ac.ac_bookmarks': [
        'C_AC_BOOKMARKS', 'C_AC_FAVORITES', 'C_AC_FAVOURITES',
    ],
    'ac.ac_new': ['C_AC_NEW'],
    'ac.ac_open': ['C_AC_OPEN'],
    'ac.ac_save': ['C_AC_SAVE'],
    'ac.ac_close': ['C_AC_CLOSE'],
    'ac.ac_exit': ['C_AC_EXIT'],
    'ac.ac_print': ['C_AC_PRINT'],
    'ac.ac_search': ['C_AC_SEARCH'],
    'ac.ac_go_to': ['C_AC_GOTO'],
    'ac.ac_zoom': ['C_AC_ZOOM'],
    'ac.ac_zoom_in': ['C_AC_ZOOM_IN'],
    'ac.ac_zoom_out': ['C_AC_ZOOM_OUT'],
    'ac.ac_scroll_up': ['C_AC_SCROLL_UP'],
    'ac.ac_scroll_down': ['C_AC_SCROLL_DOWN'],
    'ac.ac_reply': ['C_AC_REPLY'],
    'ac.ac_forward_msg': ['C_AC_FORWARD_MAIL'],
    'ac.ac_send': ['C_AC_SEND'],
    'ac.ac_edit': ['C_AC_EDIT'],
    'ac.ac_insert_mode': ['C_AC_INSERT', 'C_AC_INS'],
    'ac.ac_delete': ['C_AC_DEL'],
    'ac.ac_view_toggle': ['C_AC_VIEW_TOGGLE'],
    'ac.ac_desktop_show_all_windows': [
        'C_AC_DESKTOP_SHOW_ALL_WINDOWS',
        'KC_MISSION_CONTROL', 'KC_MCTL',
    ],
    'ac.ac_desktop_show_all_applications': [
        'C_AC_DESKTOP_SHOW_ALL_APPLICATIONS',
        'KC_LAUNCHPAD', 'KC_LPAD',
    ],
    'ac.ac_voice_command': [
        'C_VOICE_COMMAND', 'KC_ASSISTANT', 'KC_ASST',
    ],
    'ac.ac_next_keyboard_layout_select': [
        'C_AC_NEXT_KEYBOARD_LAYOUT_SELECT', 'GLOBE',
    ],
    'ac.ac_keyboard_input_assist_next': [
        'C_KEYBOARD_INPUT_ASSIST_NEXT', 'C_KBIA_NEXT',
    ],
    'ac.ac_keyboard_input_assist_previous': [
        'C_KEYBOARD_INPUT_ASSIST_PREVIOUS', 'C_KBIA_PREV',
    ],
    'ac.ac_keyboard_input_assist_next_group': [
        'C_KEYBOARD_INPUT_ASSIST_NEXT_GROUP', 'C_KBIA_NEXT_GRP',
    ],
    'ac.ac_keyboard_input_assist_previous_group': [
        'C_KEYBOARD_INPUT_ASSIST_PREVIOUS_GROUP', 'C_KBIA_PREV_GRP',
    ],
    'ac.ac_keyboard_input_assist_accept': [
        'C_KEYBOARD_INPUT_ASSIST_ACCEPT', 'C_KBIA_ACCEPT',
    ],
    'ac.ac_keyboard_input_assist_cancel': [
        'C_KEYBOARD_INPUT_ASSIST_CANCEL', 'C_KBIA_CANCEL',
    ],

    // AL — Application Launch
    'al.al_logoff': ['C_AL_LOGOFF'],
    'al.al_terminal_lock_screensaver': [
        'C_AL_LOCK', 'C_AL_SCREENSAVER', 'C_AL_COFFEE',
    ],
    'al.al_next_task_application': ['C_AL_NEXT_TASK'],
    'al.al_previous_task_application': [
        'C_AL_PREVIOUS_TASK', 'C_AL_PREV_TASK',
    ],
    'al.al_select_task_application': ['C_AL_SELECT_TASK'],
    'al.al_local_machine_browser': [
        'C_AL_MY_COMPUTER',
        'KC_MY_COMPUTER', 'KC_MYCM',
    ],
    'al.al_documents': ['C_AL_DOCUMENTS', 'C_AL_DOCS'],
    'al.al_file_browser': ['C_AL_FILE_BROWSER', 'C_AL_FILES'],
    'al.al_internet_browser': ['C_AL_WWW'],
    'al.al_email_reader': [
        'C_AL_EMAIL', 'C_AL_MAIL',
        'KC_MAIL',
    ],
    'al.al_instant_messaging': ['C_AL_INSTANT_MESSAGING', 'C_AL_IM'],
    'al.al_network_chat': ['C_AL_NETWORK_CHAT', 'C_AL_CHAT'],
    'al.al_contacts_address_book': [
        'C_AL_CONTACTS', 'C_AL_ADDRESS_BOOK',
    ],
    'al.al_calendar_schedule': ['C_AL_CALENDAR', 'C_AL_CAL'],
    'al.al_image_browser': ['C_AL_IMAGE_BROWSER', 'C_AL_IMAGES'],
    'al.al_audio_browser': [
        'C_AL_AUDIO_BROWSER', 'C_AL_AUDIO', 'C_AL_MUSIC',
    ],
    'al.al_movie_browser': ['C_AL_MOVIE_BROWSER', 'C_AL_MOVIES'],
    'al.al_text_editor': ['C_AL_TEXT_EDITOR'],
    'al.al_word_processor': ['C_AL_WORD'],
    'al.al_spreadsheet': ['C_AL_SPREADSHEET', 'C_AL_SHEET'],
    'al.al_presentation_app': ['C_AL_PRESENTATION'],
    'al.al_graphics_editor': ['C_AL_GRAPHICS_EDITOR'],
    'al.al_calculator': [
        'C_AL_CALCULATOR', 'C_AL_CALC',
        'KC_CALCULATOR', 'KC_CALC',
    ],
    'al.al_news': ['C_AL_NEWS'],
    'al.al_database_app': ['C_AL_DATABASE', 'C_AL_DB'],
    'al.al_voicemail': ['C_AL_VOICEMAIL'],
    'al.al_consumer_finance': ['C_AL_FINANCE'],
    'al.al_task_project_manager': ['C_AL_TASK_MANAGER'],
    'al.al_log_journal_timecard': ['C_AL_JOURNAL'],
    'al.al_av_capture_playback': ['C_AL_AV_CAPTURE_PLAYBACK'],
    'al.al_spell_check': ['C_AL_SPELLCHECK', 'C_AL_SPELL'],
    'al.al_screen_saver': ['C_AL_SCREEN_SAVER'],
    'al.al_keyboard_layout': ['C_AL_KEYBOARD_LAYOUT'],
    'al.al_control_panel': [
        'C_AL_CONTROL_PANEL',
        'KC_CONTROL_PANEL', 'KC_CPNL',
    ],
    'al.al_integrated_help_center': ['C_AL_HELP'],
    'al.al_oem_features_tips_tutorial_browser': [
        'C_AL_OEM_FEATURES', 'C_AL_TIPS', 'C_AL_TUTORIAL',
    ],

    // ─────────────────────────────────────────────────────────────
    // Media transport (consolidates HID + ZMK static + QMK media keys)
    // ─────────────────────────────────────────────────────────────
    'media.transport.play_pause': [
        'C_PLAY_PAUSE', 'C_PP', 'K_PLAY_PAUSE', 'K_PP',
        'C_PLAY', 'C_PAUSE',
        'KC_MEDIA_PLAY_PAUSE', 'KC_MPLY',
    ],
    'media.transport.stop': [
        'C_STOP', 'KC_MEDIA_STOP', 'KC_MSTP',
    ],
    'media.transport.next': [
        'C_NEXT', 'K_NEXT', 'C_SCAN_NEXT_TRACK',
        'KC_MEDIA_NEXT_TRACK', 'KC_MNXT',
    ],
    'media.transport.prev': [
        'C_PREVIOUS', 'C_PREV', 'K_PREVIOUS', 'K_PREV',
        'C_SCAN_PREVIOUS_TRACK',
        'KC_MEDIA_PREV_TRACK', 'KC_MPRV',
    ],
    'media.transport.fast_forward': [
        'C_FAST_FORWARD', 'C_FF',
        'KC_MEDIA_FAST_FORWARD', 'KC_MFFD',
    ],
    'media.transport.rewind': [
        'C_REWIND', 'C_RW',
        'KC_MEDIA_REWIND', 'KC_MRWD',
    ],
    'media.transport.select': ['KC_MEDIA_SELECT', 'KC_MSEL'],

    // ─────────────────────────────────────────────────────────────
    // Wireless (Bluetooth + output mode)
    // pattern-check: skip bulk row trim — btProfilesMap covers profile 1–5
    // ─────────────────────────────────────────────────────────────
    // BT profiles 1–5 come from btProfilesMap above.
    'wireless.bt.next': [
        'BT_NXT', 'QK_BLUETOOTH_PROFILE_NEXT', 'BT_NEXT',
    ],
    'wireless.bt.prev': [
        'BT_PRV', 'QK_BLUETOOTH_PROFILE_PREV', 'BT_PREV',
    ],
    'wireless.bt.unpair': ['QK_BLUETOOTH_UNPAIR', 'BT_UNPR'],
    'wireless.bt.clear': ['BT_CLR'],
    'wireless.bt.clear_all': ['BT_CLR_ALL'],
    'wireless.output.auto': ['QK_OUTPUT_AUTO', 'OU_AUTO'],
    'wireless.output.next': [
        'OUT_TOG', 'QK_OUTPUT_NEXT', 'OU_NEXT',
    ],
    'wireless.output.prev': ['QK_OUTPUT_PREV', 'OU_PREV'],
    'wireless.output.none': ['QK_OUTPUT_NONE', 'OU_NONE'],
    'wireless.output.usb': ['OUT_USB', 'QK_OUTPUT_USB', 'OU_USB'],
    'wireless.output.bt': [
        'OUT_BLE', 'QK_OUTPUT_BLUETOOTH', 'OU_BT',
    ],
    'wireless.output.2p4ghz': ['QK_OUTPUT_2P4GHZ', 'OU_2P4G'],

    // ─────────────────────────────────────────────────────────────
    // Mouse keys (QMK Mouse Keys)
    // ─────────────────────────────────────────────────────────────
    'mouse.cursor.up': ['QK_MOUSE_CURSOR_UP', 'MS_UP'],
    'mouse.cursor.down': ['QK_MOUSE_CURSOR_DOWN', 'MS_DOWN'],
    'mouse.cursor.left': ['QK_MOUSE_CURSOR_LEFT', 'MS_LEFT'],
    'mouse.cursor.right': ['QK_MOUSE_CURSOR_RIGHT', 'MS_RGHT'],
    // pattern-check: skip bulk row trim — mouseButtonsMap covers button 1–8
    'mouse.wheel.up': ['QK_MOUSE_WHEEL_UP', 'MS_WHLU'],
    'mouse.wheel.down': ['QK_MOUSE_WHEEL_DOWN', 'MS_WHLD'],
    'mouse.wheel.left': ['QK_MOUSE_WHEEL_LEFT', 'MS_WHLL'],
    'mouse.wheel.right': ['QK_MOUSE_WHEEL_RIGHT', 'MS_WHLR'],
    'mouse.accel.0': ['QK_MOUSE_ACCELERATION_0', 'MS_ACL0'],
    'mouse.accel.1': ['QK_MOUSE_ACCELERATION_1', 'MS_ACL1'],
    'mouse.accel.2': ['QK_MOUSE_ACCELERATION_2', 'MS_ACL2'],

    // ─────────────────────────────────────────────────────────────
    // OS keys (Mac / Windows / system / launchers)
    // ─────────────────────────────────────────────────────────────
    'os.mac.lopt': ['LOpt'],
    'os.mac.ropt': ['ROpt'],
    'os.mac.lcmd': ['LCmd'],
    'os.mac.rcmd': ['RCmd'],
    'os.browser.search': ['KC_WWW_SEARCH', 'KC_WSCH'],
    'os.browser.home': ['KC_WWW_HOME', 'KC_WHOM'],
    'os.browser.back': ['KC_WWW_BACK', 'KC_WBAK'],
    'os.browser.forward': ['KC_WWW_FORWARD', 'KC_WFWD'],
    'os.browser.stop': ['KC_WWW_STOP', 'KC_WSTP'],
    'os.browser.refresh': ['KC_WWW_REFRESH', 'KC_WREF'],
    'os.browser.favorites': ['KC_WWW_FAVORITES', 'KC_WFAV'],

    // ─────────────────────────────────────────────────────────────
    // RGB underglow + matrix (QMK)
    // ─────────────────────────────────────────────────────────────
    'rgb.toggle': ['QK_UNDERGLOW_TOGGLE', 'UG_TOGG', 'RGB_TOG'],
    'rgb.mode.next': ['QK_UNDERGLOW_MODE_NEXT', 'UG_NEXT', 'RGB_MOD'],
    'rgb.mode.prev': [
        'QK_UNDERGLOW_MODE_PREVIOUS', 'UG_PREV', 'RGB_RMOD',
    ],
    'rgb.hue.up': ['QK_UNDERGLOW_HUE_UP', 'UG_HUEU', 'RGB_HUI'],
    'rgb.hue.down': ['QK_UNDERGLOW_HUE_DOWN', 'UG_HUED', 'RGB_HUD'],
    'rgb.sat.up': ['QK_UNDERGLOW_SAT_UP', 'UG_SATU', 'RGB_SAI'],
    'rgb.sat.down': ['QK_UNDERGLOW_SAT_DOWN', 'UG_SATD', 'RGB_SAD'],
    'rgb.val.up': ['QK_UNDERGLOW_VAL_UP', 'UG_VALU', 'RGB_VAI'],
    'rgb.val.down': ['QK_UNDERGLOW_VAL_DOWN', 'UG_VALD', 'RGB_VAD'],
    'rgb.speed.up': ['QK_UNDERGLOW_SPEED_UP', 'UG_SPDU', 'RGB_SPI'],
    'rgb.speed.down': [
        'QK_UNDERGLOW_SPEED_DOWN', 'UG_SPDD', 'RGB_SPD',
    ],
    'rgb.matrix.on': ['QK_RGB_MATRIX_ON', 'RM_ON'],
    'rgb.matrix.off': ['QK_RGB_MATRIX_OFF', 'RM_OFF'],
    'rgb.matrix.toggle': ['QK_RGB_MATRIX_TOGGLE', 'RM_TOGG'],
    'rgb.matrix.mode_next': ['QK_RGB_MATRIX_MODE_NEXT', 'RM_NEXT'],
    'rgb.matrix.mode_prev': [
        'QK_RGB_MATRIX_MODE_PREVIOUS', 'RM_PREV',
    ],
    'rgb.matrix.hue.up': ['QK_RGB_MATRIX_HUE_UP', 'RM_HUEU'],
    'rgb.matrix.hue.down': ['QK_RGB_MATRIX_HUE_DOWN', 'RM_HUED'],
    'rgb.matrix.sat.up': ['QK_RGB_MATRIX_SAT_UP', 'RM_SATU'],
    'rgb.matrix.sat.down': ['QK_RGB_MATRIX_SAT_DOWN', 'RM_SATD'],
    'rgb.matrix.val.up': ['QK_RGB_MATRIX_VAL_UP', 'RM_VALU'],
    'rgb.matrix.val.down': ['QK_RGB_MATRIX_VAL_DOWN', 'RM_VALD'],
    'rgb.matrix.speed.up': ['QK_RGB_MATRIX_SPEED_UP', 'RM_SPDU'],
    'rgb.matrix.speed.down': [
        'QK_RGB_MATRIX_SPEED_DOWN', 'RM_SPDD',
    ],

    // ─────────────────────────────────────────────────────────────
    // Backlight + LED matrix (QMK)
    // ─────────────────────────────────────────────────────────────
    'backlight.on': ['QK_BACKLIGHT_ON', 'BL_ON'],
    'backlight.off': ['QK_BACKLIGHT_OFF', 'BL_OFF'],
    'backlight.toggle': ['QK_BACKLIGHT_TOGGLE', 'BL_TOGG'],
    'backlight.up': ['QK_BACKLIGHT_UP', 'BL_UP'],
    'backlight.down': ['QK_BACKLIGHT_DOWN', 'BL_DOWN'],
    'backlight.step': ['QK_BACKLIGHT_STEP', 'BL_STEP'],
    'backlight.breathing.toggle': [
        'QK_BACKLIGHT_TOGGLE_BREATHING', 'BL_BRTG',
    ],
    'led_matrix.on': ['QK_LED_MATRIX_ON', 'LM_ON'],
    'led_matrix.off': ['QK_LED_MATRIX_OFF', 'LM_OFF'],
    'led_matrix.toggle': ['QK_LED_MATRIX_TOGGLE', 'LM_TOGG'],
    'led_matrix.mode_next': ['QK_LED_MATRIX_MODE_NEXT', 'LM_NEXT'],
    'led_matrix.mode_prev': [
        'QK_LED_MATRIX_MODE_PREVIOUS', 'LM_PREV',
    ],
    'led_matrix.brightness.up': [
        'QK_LED_MATRIX_BRIGHTNESS_UP', 'LM_BRIU',
    ],
    'led_matrix.brightness.down': [
        'QK_LED_MATRIX_BRIGHTNESS_DOWN', 'LM_BRID',
    ],
    'led_matrix.speed.up': ['QK_LED_MATRIX_SPEED_UP', 'LM_SPDU'],
    'led_matrix.speed.down': ['QK_LED_MATRIX_SPEED_DOWN', 'LM_SPDD'],

    // ─────────────────────────────────────────────────────────────
    // Audio + Music + Clicky (QMK)
    // ─────────────────────────────────────────────────────────────
    'audio.on': ['QK_AUDIO_ON', 'AU_ON'],
    'audio.off': ['QK_AUDIO_OFF', 'AU_OFF'],
    'audio.toggle': ['QK_AUDIO_TOGGLE', 'AU_TOGG'],
    'audio.clicky.toggle': ['QK_AUDIO_CLICKY_TOGGLE', 'CK_TOGG'],
    'audio.clicky.on': ['QK_AUDIO_CLICKY_ON', 'CK_ON'],
    'audio.clicky.off': ['QK_AUDIO_CLICKY_OFF', 'CK_OFF'],
    'audio.clicky.up': ['QK_AUDIO_CLICKY_UP', 'CK_UP'],
    'audio.clicky.down': ['QK_AUDIO_CLICKY_DOWN', 'CK_DOWN'],
    'audio.clicky.reset': ['QK_AUDIO_CLICKY_RESET', 'CK_RST'],
    'audio.music.on': ['QK_MUSIC_ON', 'MU_ON'],
    'audio.music.off': ['QK_MUSIC_OFF', 'MU_OFF'],
    'audio.music.toggle': ['QK_MUSIC_TOGGLE', 'MU_TOGG'],
    'audio.music.mode_next': ['QK_MUSIC_MODE_NEXT', 'MU_NEXT'],
    'audio.voice.next': ['QK_AUDIO_VOICE_NEXT', 'AU_NEXT'],
    'audio.voice.prev': ['QK_AUDIO_VOICE_PREVIOUS', 'AU_PREV'],

    // ─────────────────────────────────────────────────────────────
    // Magic (QMK remapping shortcuts)
    // ─────────────────────────────────────────────────────────────
    'magic.swap.ctrl_caps': [
        'CL_SWAP', 'MAGIC_SWAP_CONTROL_CAPSLOCK',
    ],
    'magic.unswap.ctrl_caps': [
        'CL_NORM', 'MAGIC_UNSWAP_CONTROL_CAPSLOCK',
    ],
    'magic.toggle.ctrl_caps': [
        'CL_TOGG', 'MAGIC_TOGGLE_CONTROL_CAPSLOCK',
    ],
    'magic.caps_as_ctrl.on': ['CL_CTRL', 'MAGIC_CAPSLOCK_TO_CONTROL'],
    'magic.caps_as_ctrl.off': [
        'CL_CAPS', 'MAGIC_UNCAPSLOCK_TO_CONTROL',
    ],
    'magic.swap.lctl_lgui': ['LCG_SWP', 'MAGIC_SWAP_LCTL_LGUI'],
    'magic.swap.rctl_rgui': ['RCG_SWP', 'MAGIC_SWAP_RCTL_RGUI'],
    'magic.unswap.lctl_lgui': ['LCG_NRM', 'MAGIC_UNSWAP_LCTL_LGUI'],
    'magic.unswap.rctl_rgui': ['RCG_NRM', 'MAGIC_UNSWAP_RCTL_RGUI'],
    'magic.toggle.ctl_gui': ['CG_TOGG', 'MAGIC_TOGGLE_CTL_GUI'],
    'magic.ee_hands.left': ['EH_LEFT', 'MAGIC_EE_HANDS_LEFT'],
    'magic.ee_hands.right': ['EH_RGHT', 'MAGIC_EE_HANDS_RIGHT'],
    'magic.swap.lalt_lgui': ['LAG_SWP', 'MAGIC_SWAP_LALT_LGUI'],
    'magic.swap.ralt_rgui': ['RAG_SWP', 'MAGIC_SWAP_RALT_RGUI'],
    'magic.unswap.lalt_lgui': ['LAG_NRM', 'MAGIC_UNSWAP_LALT_LGUI'],
    'magic.unswap.ralt_rgui': ['RAG_NRM', 'MAGIC_UNSWAP_RALT_RGUI'],
    'magic.toggle.alt_gui': ['AG_TOGG', 'MAGIC_TOGGLE_ALT_GUI'],
    'magic.gui.off': ['GUI_OFF', 'MAGIC_NO_GUI'],
    'magic.gui.on': ['GUI_ON', 'MAGIC_GUI'],
    'magic.gui.toggle': ['GUI_TOG', 'MAGIC_TOGGLE_GUI'],
    'magic.swap.grave_esc': ['GE_SWAP', 'MAGIC_SWAP_GRAVE_ESC'],
    'magic.unswap.grave_esc': ['GE_NORM', 'MAGIC_UNSWAP_GRAVE_ESC'],
    'magic.swap.backslash_bs': ['BS_SWAP', 'MAGIC_SWAP_BACKSLASH_BACKSPACE'],
    'magic.unswap.backslash_bs': [
        'BS_NORM', 'MAGIC_UNSWAP_BACKSLASH_BACKSPACE',
    ],
    'magic.toggle.backslash_bs': [
        'BS_TOGG', 'MAGIC_TOGGLE_BACKSLASH_BACKSPACE',
    ],
    'magic.nkro.on': ['NK_ON', 'MAGIC_HOST_NKRO'],
    'magic.nkro.off': ['NK_OFF', 'MAGIC_UNHOST_NKRO'],
    'magic.nkro.toggle': ['NK_TOGG', 'MAGIC_TOGGLE_NKRO'],

    // ─────────────────────────────────────────────────────────────
    // Quantum / system
    // ─────────────────────────────────────────────────────────────
    'system.bootloader': [
        '&bootloader', 'QK_BOOTLOADER', 'QK_BOOT',
    ],
    'system.reboot': [
        '&sys_reset', 'QK_REBOOT', 'QK_RBT',
    ],
    'system.debug.toggle': ['QK_DEBUG_TOGGLE', 'DB_TOGG'],
    'system.eeprom_clear': ['QK_CLEAR_EEPROM', 'EE_CLR'],
    'system.make': ['QK_MAKE'],

    // ─────────────────────────────────────────────────────────────
    // Misc — caps_word, leader, key/layer lock, repeat, autocorrect,
    // auto_shift, grave_esc, space_cadet, tap_term, tri_layer,
    // one_shot, key_override, combo, velocikey, haptic, secure,
    // unicode mode, display brightness
    // ─────────────────────────────────────────────────────────────
    'display.brightness.up': ['&brightness_up'],
    'display.brightness.down': ['&brightness_down'],
    'caps_word.toggle': [
        '&caps_word', 'QK_CAPS_WORD_TOGGLE', 'CW_TOGG',
    ],
    'leader.start': ['QK_LEAD'],
    'key_lock.hold': ['QK_LOCK'],
    'layer_lock.toggle': ['QK_LAYER_LOCK', 'QK_LLCK'],
    'repeat.last': ['QK_REPEAT_KEY', 'QK_REP'],
    'repeat.alt': ['QK_ALT_REPEAT_KEY', 'QK_AREP'],
    'autocorrect.on': ['QK_AUTOCORRECT_ON', 'AC_ON'],
    'autocorrect.off': ['QK_AUTOCORRECT_OFF', 'AC_OFF'],
    'autocorrect.toggle': ['QK_AUTOCORRECT_TOGGLE', 'AC_TOGG'],
    'auto_shift.toggle': ['QK_AUTO_SHIFT_TOGGLE', 'AS_TOGG'],
    'auto_shift.on': ['QK_AUTO_SHIFT_ON', 'AS_ON'],
    'auto_shift.off': ['QK_AUTO_SHIFT_OFF', 'AS_OFF'],
    'auto_shift.up': ['QK_AUTO_SHIFT_UP', 'AS_UP'],
    'auto_shift.down': ['QK_AUTO_SHIFT_DOWN', 'AS_DOWN'],
    'auto_shift.report': ['QK_AUTO_SHIFT_REPORT', 'AS_RPT'],
    'grave_escape': ['QK_GRAVE_ESCAPE', 'QK_GESC'],
    'space_cadet.lcpo': [
        'QK_SPACE_CADET_LEFT_CTRL_PARENTHESIS_OPEN', 'SC_LCPO',
    ],
    'space_cadet.rcpc': [
        'QK_SPACE_CADET_RIGHT_CTRL_PARENTHESIS_CLOSE', 'SC_RCPC',
    ],
    'space_cadet.lspo': [
        'QK_SPACE_CADET_LEFT_SHIFT_PARENTHESIS_OPEN', 'SC_LSPO',
    ],
    'space_cadet.rspc': [
        'QK_SPACE_CADET_RIGHT_SHIFT_PARENTHESIS_CLOSE', 'SC_RSPC',
    ],
    'space_cadet.lapo': [
        'QK_SPACE_CADET_LEFT_ALT_PARENTHESIS_OPEN', 'SC_LAPO',
    ],
    'space_cadet.rapc': [
        'QK_SPACE_CADET_RIGHT_ALT_PARENTHESIS_CLOSE', 'SC_RAPC',
    ],
    'space_cadet.sftent': [
        'QK_SPACE_CADET_RIGHT_SHIFT_ENTER', 'SC_SENT',
    ],
    'tap_term.up': ['QK_DYNAMIC_TAPPING_TERM_UP', 'DT_UP'],
    'tap_term.down': ['QK_DYNAMIC_TAPPING_TERM_DOWN', 'DT_DOWN'],
    'tap_term.print': ['QK_DYNAMIC_TAPPING_TERM_PRINT', 'DT_PRNT'],
    'tri_layer.lower': ['QK_TRI_LAYER_LOWER', 'TL_LOWR'],
    'tri_layer.upper': ['QK_TRI_LAYER_UPPER', 'TL_UPPR'],
    'one_shot.on': ['QK_ONE_SHOT_ON', 'OS_ON'],
    'one_shot.off': ['QK_ONE_SHOT_OFF', 'OS_OFF'],
    'one_shot.toggle': ['QK_ONE_SHOT_TOGGLE', 'OS_TOGG'],
    'key_override.on': ['QK_KEY_OVERRIDE_ON', 'KO_ON'],
    'key_override.off': ['QK_KEY_OVERRIDE_OFF', 'KO_OFF'],
    'key_override.toggle': ['QK_KEY_OVERRIDE_TOGGLE', 'KO_TOGG'],
    'combo.on': ['QK_COMBO_ON', 'CM_ON'],
    'combo.off': ['QK_COMBO_OFF', 'CM_OFF'],
    'combo.toggle': ['QK_COMBO_TOGGLE', 'CM_TOGG'],
    'velocikey.toggle': ['QK_VELOCIKEY_TOGGLE', 'VK_TOGG'],
    'haptic.on': ['QK_HAPTIC_ON', 'HF_ON'],
    'haptic.off': ['QK_HAPTIC_OFF', 'HF_OFF'],
    'haptic.toggle': ['QK_HAPTIC_TOGGLE', 'HF_TOGG'],
    'haptic.reset': ['QK_HAPTIC_RESET', 'HF_RST'],
    'haptic.feedback.toggle': [
        'QK_HAPTIC_FEEDBACK_TOGGLE', 'HF_FDBK',
    ],
    'haptic.buzz.toggle': ['QK_HAPTIC_BUZZ_TOGGLE', 'HF_BUZZ'],
    'haptic.mode.next': ['QK_HAPTIC_MODE_NEXT', 'HF_NEXT'],
    'haptic.mode.prev': ['QK_HAPTIC_MODE_PREVIOUS', 'HF_PREV'],
    'haptic.continuous.toggle': [
        'QK_HAPTIC_CONTINUOUS_TOGGLE', 'HF_CONT',
    ],
    'haptic.continuous.up': ['QK_HAPTIC_CONTINUOUS_UP', 'HF_CONU'],
    'haptic.continuous.down': [
        'QK_HAPTIC_CONTINUOUS_DOWN', 'HF_COND',
    ],
    'haptic.dwell.up': ['QK_HAPTIC_DWELL_UP', 'HF_DWLU'],
    'haptic.dwell.down': ['QK_HAPTIC_DWELL_DOWN', 'HF_DWLD'],
    'secure.lock': ['QK_SECURE_LOCK', 'SE_LOCK'],
    'secure.unlock': ['QK_SECURE_UNLOCK', 'SE_UNLK'],
    'secure.toggle': ['QK_SECURE_TOGGLE', 'SE_TOGG'],
    'secure.request': ['QK_SECURE_REQUEST', 'SE_REQ'],
    'unicode.mode.next': ['QK_UNICODE_MODE_NEXT', 'UC_NEXT'],
    'unicode.mode.prev': ['QK_UNICODE_MODE_PREVIOUS', 'UC_PREV'],
    'unicode.mode.macos': ['QK_UNICODE_MODE_MACOS', 'UC_MAC'],
    'unicode.mode.linux': ['QK_UNICODE_MODE_LINUX', 'UC_LINX'],
    'unicode.mode.windows': ['QK_UNICODE_MODE_WINDOWS', 'UC_WIN'],
    'unicode.mode.bsd': ['QK_UNICODE_MODE_BSD', 'UC_BSD'],
    'unicode.mode.wincompose': [
        'QK_UNICODE_MODE_WINCOMPOSE', 'UC_WINC',
    ],
    'unicode.mode.emacs': ['QK_UNICODE_MODE_EMACS', 'UC_EMAC'],

    // ─────────────────────────────────────────────────────────────
    // Macros — dynamic record/play (QMK)
    // ─────────────────────────────────────────────────────────────
    'macro.dynamic.record_1': [
        'QK_DYNAMIC_MACRO_RECORD_START_1', 'DM_REC1',
    ],
    'macro.dynamic.record_2': [
        'QK_DYNAMIC_MACRO_RECORD_START_2', 'DM_REC2',
    ],
    'macro.dynamic.record_stop': [
        'QK_DYNAMIC_MACRO_RECORD_STOP', 'DM_RSTP',
    ],
    'macro.dynamic.play_1': ['QK_DYNAMIC_MACRO_PLAY_1', 'DM_PLY1'],
    'macro.dynamic.play_2': ['QK_DYNAMIC_MACRO_PLAY_2', 'DM_PLY2'],

    // ─────────────────────────────────────────────────────────────
    // MIDI — control surface (notes, octave/transpose/velocity/channel
    // banks live in the allowlist; only the global toggles get aliases)
    // ─────────────────────────────────────────────────────────────
    'midi.on': ['MI_ON'],
    'midi.off': ['MI_OFF'],
    'midi.toggle': ['MI_TOGG'],
    'midi.octave.up': ['MI_OCTU'],
    'midi.octave.down': ['MI_OCTD'],
    'midi.transpose.up': ['MI_TRSU'],
    'midi.transpose.down': ['MI_TRSD'],
    'midi.velocity.up': ['MI_VELU'],
    'midi.velocity.down': ['MI_VELD'],
    'midi.channel.up': ['MI_CHU'],
    'midi.channel.down': ['MI_CHD'],
    'midi.all_notes_off': ['MI_AOFF'],
    'midi.sustain': ['MI_SUS'],
    'midi.portamento': ['MI_PORT'],
    'midi.sostenuto': ['MI_SOST'],
    'midi.soft': ['MI_SOFT'],
    'midi.legato': ['MI_LEG'],
    'midi.modulation': ['MI_MOD'],
    'midi.modulation.speed_up': ['MI_MODSU'],
    'midi.modulation.speed_down': ['MI_MODSD'],
    'midi.pitch_bend.up': ['MI_BNDU'],
    'midi.pitch_bend.down': ['MI_BNDD'],
}

// Optional platform-support / caveat strings, surfaced via tooltip.
export const EXTERNAL_NOTES: Partial<Record<CanonicalKeyId, string>> = {
    'ac.ac_next_keyboard_layout_select':
        'Globe — iOS full, macOS partial (Globe+key only), no Win/Linux',
    'key.keyboard_locking_caps_lock':
        'No Win/Linux/Android support; Mac only on Apple keyboards',
    'key.keyboard_locking_num_lock':
        'Win partial; Linux/Android no support',
    'key.keyboard_locking_scroll_lock':
        'Win only; Linux/Android no support',
    'key.keyboard_power':
        'macOS / iOS: ignores quick presses; long-press shows prompt',
    'consumer.power':
        'Linux / macOS / iOS supported; Windows ignored',
    // HID Keyboard-page 0x7F-0x81, not the Consumer-page keys most keyboards send.
    'key.keyboard_mute':
        'Keyboard-page Mute (0x7F). For the usual mute key use Media → Mute.',
    'key.keyboard_volume_up':
        'Keyboard-page Volume Up (0x80). For the usual volume key use Media → Volume Increment.',
    'key.keyboard_volume_down':
        'Keyboard-page Volume Down (0x81). For the usual volume key use Media → Volume Decrement.',
}

// Canonical ids that intentionally have no spec-name mapping. Coverage
// test skips these. Keep this set explicit so adds/removes are visible
// in PR diffs.
export const EXTERNAL_NAMES_ALLOWLIST: ReadonlySet<CanonicalKeyId> = new Set<
    CanonicalKeyId
>([
    // pattern-check: skip mechanical range expansion of indexed banks
    // Internal helpers / device-specific
    'wireless.battery.level',
    // Macro slot bank (16) + joystick (32) + programmable buttons (32).
    ...range(16).map((i) => `macro.user.${i}`),
    ...range(32).map((i) => `joystick.button.${i}`),
    ...range(32, 1).map((i) => `programmable.button.${i}`),
    // MIDI grid: 12 notes × 6 octaves, plus octave/transpose/velocity/
    // channel index banks. Top-level toggles get aliases above.
    ...MIDI_BANK_IDS,
    // HID error / metadata entries (not user-pickable in normal flows)
    // pattern-check: skip bulk static-list extension to allowlist Set
    'key.errorrollover',
    'key.postfail',
    'key.errorundefined',
    'consumer.consumer_control',
    // HID 7 keypad math / programming / memory entries (167–221) —
    // present in the HID spec but absent from both ZMK and QMK docs.
    'key.keypad_double_0',
    'key.keypad_triple_0',
    'key.thousands_separator',
    'key.decimal_separator',
    'key.currency_unit',
    'key.currency_sub_unit',
    'key.keypad_left_bracket',
    'key.keypad_right_bracket',
    'key.keypad_left_brace',
    'key.keypad_right_brace',
    'key.keypad_a',
    'key.keypad_b',
    'key.keypad_c',
    'key.keypad_d',
    'key.keypad_e',
    'key.keypad_f',
    'key.keypad_xor',
    'key.keypad_caret',
    'key.keypad_percentage',
    'key.keypad_less',
    'key.keypad_greater',
    'key.keypad_ampersand',
    'key.keypad_double_ampersand',
    'key.keypad_bar',
    'key.keypad_double_bar',
    'key.keypad_colon',
    'key.keypad_hash',
    'key.keypad_at',
    'key.keypad_bang',
    'key.keypad_memory_store',
    'key.keypad_memory_recall',
    'key.keypad_memory_clear',
    'key.keypad_memory_add',
    'key.keypad_memory_subtract',
    'key.keypad_memory_multiply',
    'key.keypad_memory_divide',
    'key.keypad_plus_minus',
    'key.keypad_binary',
    'key.keypad_octal',
    'key.keypad_decimal',
    'key.keypad_hexadecimal',
    // OS-keys static convenience entries that mac/windows/system/launch
    // expose for picker UX but have no QMK or ZMK doc spelling.
    'os.mac.mission_control',
    'os.mac.launchpad',
    'os.mac.screenshot',
    'os.mac.siri',
    'os.win.task_view',
    'os.win.file_explorer',
    'os.win.cortana',
    'os.system.lock_screen',
    'os.system.control_panel',
    'os.system.assistant',
    'os.launch.mail',
    'os.launch.calc',
    'os.launch.my_computer',
    // Contact page (HID 12 contact-list usages — phone/PDA, not keyboards)
    // Catalog includes them but no ZMK/QMK doc references them.
])
