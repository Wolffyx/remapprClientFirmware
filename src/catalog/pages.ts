// Pattern check: no GoF pattern (-) — rejected — static page metadata + simple grouping helper, no abstraction.
import {
    AC_ENTRIES,
    AL_ENTRIES,
    AUDIO_ENTRIES,
    BACKLIGHT_ENTRIES,
    COMBOS_ENTRIES,
    CONSUMER_ENTRIES,
    CONTACT_ENTRIES,
    JOYSTICK_ENTRIES,
    KEYBOARD_ENTRIES,
    MACROS_ENTRIES,
    MAGIC_ENTRIES,
    MEDIA_ENTRIES,
    MEDIA_TRANSPORT_ENTRIES,
    MIDI_ENTRIES,
    MISC_ENTRIES,
    MOD_ENTRIES,
    MOUSE_ENTRIES,
    OS_KEYS_ENTRIES,
    PROGRAMMABLE_ENTRIES,
    QUANTUM_ENTRIES,
    RGB_ENTRIES,
    SHIFTED_ENTRIES,
    SYSTEM_ENTRIES,
    WIRELESS_ENTRIES,
} from './entries'
import type { CanonicalKeyId, CatalogPage } from './types'

// IME / locale switching keys — HID page 7 IDs 135–146 — split off the
// Keyboard tab into their own Language tab so the main grid stays
// focused on Latin-keyboard keys.
const isLanguageId = (id: CanonicalKeyId): boolean =>
    /^key\.keyboard_(international|lang)\d+$/.test(id)

const LANGUAGE_ENTRIES = KEYBOARD_ENTRIES.filter((e) => isLanguageId(e.id))
const KEYBOARD_NON_LANGUAGE = KEYBOARD_ENTRIES.filter(
    (e) => !isLanguageId(e.id),
)

// HID pages plus extension pages: 'wireless' / 'os-keys' / 'lighting'
// (RGB underglow + backlight + LED matrix collapsed into one tab) /
// 'audio' / 'mouse' / 'midi' / 'magic' / 'quantum' / 'macros' / 'misc'.
export const CATALOG_PAGES: CatalogPage[] = [
    {
        id: 'keyboard',
        name: 'Keyboard',
        style: 'keyboard-grid',
        visible: true,
        entries: [...KEYBOARD_NON_LANGUAGE, ...SHIFTED_ENTRIES, ...MOD_ENTRIES],
    },
    {
        id: 'language',
        name: 'Language',
        style: 'flat-grid',
        visible: true,
        entries: LANGUAGE_ENTRIES,
    },
    {
        id: 'consumer',
        name: 'Consumer',
        style: 'flat-grid',
        visible: true,
        entries: CONSUMER_ENTRIES,
    },
    {
        id: 'ac',
        name: 'AC',
        style: 'flat-grid',
        visible: true,
        entries: AC_ENTRIES,
    },
    {
        id: 'al',
        name: 'AL',
        style: 'flat-grid',
        visible: true,
        entries: AL_ENTRIES,
    },
    {
        id: 'contact',
        name: 'Contact',
        style: 'flat-grid',
        visible: true,
        entries: CONTACT_ENTRIES,
    },
    {
        id: 'media',
        name: 'Media',
        style: 'flat-grid',
        visible: true,
        entries: [...MEDIA_ENTRIES, ...MEDIA_TRANSPORT_ENTRIES],
    },
    {
        // GD System Control (HID page 1): power / sleep / wake → BH_SYS_CTRL.
        id: 'system-control',
        name: 'System',
        style: 'flat-grid',
        visible: true,
        entries: SYSTEM_ENTRIES,
    },
    {
        id: 'wireless',
        name: 'Wireless',
        style: 'flat-grid',
        visible: true,
        entries: WIRELESS_ENTRIES,
    },
    {
        id: 'os-keys',
        name: 'OS Keys',
        style: 'flat-grid',
        visible: true,
        entries: OS_KEYS_ENTRIES,
    },
    {
        id: 'lighting',
        name: 'Lighting',
        style: 'flat-grid',
        visible: true,
        entries: [...RGB_ENTRIES, ...BACKLIGHT_ENTRIES],
    },
    {
        id: 'audio',
        name: 'Audio',
        style: 'flat-grid',
        visible: true,
        entries: AUDIO_ENTRIES,
    },
    {
        id: 'mouse',
        name: 'Mouse',
        style: 'flat-grid',
        visible: true,
        entries: MOUSE_ENTRIES,
    },
    {
        id: 'magic',
        name: 'Magic',
        style: 'flat-grid',
        visible: true,
        entries: MAGIC_ENTRIES,
    },
    {
        id: 'quantum',
        name: 'Quantum',
        style: 'flat-grid',
        visible: true,
        entries: QUANTUM_ENTRIES,
    },
    {
        id: 'macros',
        name: 'Macros',
        style: 'flat-grid',
        visible: true,
        entries: MACROS_ENTRIES,
    },
    {
        id: 'combos',
        name: 'Combos',
        style: 'flat-grid',
        visible: true,
        entries: COMBOS_ENTRIES,
    },
    {
        id: 'misc',
        name: 'Misc',
        style: 'flat-grid',
        visible: true,
        entries: [
            ...MISC_ENTRIES,
            ...JOYSTICK_ENTRIES,
            ...PROGRAMMABLE_ENTRIES,
        ],
    },
    {
        id: 'midi',
        name: 'MIDI',
        style: 'flat-grid',
        visible: true,
        entries: MIDI_ENTRIES,
    },
]

// Maps a canonical id prefix → page id. Codecs can add new prefixes by
// extending this map at module init.
const PREFIX_TO_PAGE: Record<string, string> = {
    key: 'keyboard',
    consumer: 'consumer',
    ac: 'ac',
    al: 'al',
    media: 'media',
    contact: 'contact',
    wireless: 'wireless',
    os: 'os-keys',
    rgb: 'lighting',
    backlight: 'lighting',
    led_matrix: 'lighting',
    audio: 'audio',
    mouse: 'mouse',
    midi: 'midi',
    magic: 'magic',
    macro: 'macros',
    combo: 'combos',
    system: 'quantum',
    sys_ctrl: 'system-control',
    mod: 'keyboard',
    display: 'misc',
    caps_word: 'misc',
    leader: 'misc',
    key_lock: 'misc',
    layer_lock: 'misc',
    repeat: 'misc',
    auto_shift: 'misc',
    autocorrect: 'misc',
    grave_escape: 'misc',
    space_cadet: 'misc',
    swap_hands: 'misc',
    tap_term: 'misc',
    joystick: 'misc',
    programmable: 'misc',
    one_shot: 'misc',
    unicode: 'misc',
    tri_layer: 'misc',
    haptic: 'misc',
    velocikey: 'misc',
    key_override: 'misc',
    secure: 'misc',
}

export const groupForId = (id: CanonicalKeyId): string | null => {
    if (isLanguageId(id)) return 'language'
    const prefix = id.split('.')[0]
    return PREFIX_TO_PAGE[prefix] ?? null
}
