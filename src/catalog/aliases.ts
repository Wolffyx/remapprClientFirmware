// Pattern check: no GoF pattern (-) — rejected — pure data map for canonical-id dedup, no abstraction.
import type { CanonicalKeyId } from './types'

// Maps a duplicate (secondary) canonical id to its primary canonical id.
// Used at CATALOG build time to collapse functional duplicates (HID Keyboard
// vs Keypad variants, HID modifiers vs static mod.*, HID consumer media
// vs static media.transport.*, HID keyboard editing vs AC equivalents).
//
// Decoder side stays alias-aware via HID_USAGE_DECODE so existing keymaps
// referencing the secondary HID usage still resolve to the primary id.
export const CANONICAL_ALIASES: Record<CanonicalKeyId, CanonicalKeyId> = {
    // Keyboard ↔ Keypad (HID page 7 intra-page)
    'key.keypad_backspace': 'key.keyboard_backspace',
    'key.keypad_tab': 'key.keyboard_tab',
    'key.keypad_enter': 'key.keyboard_return_enter',
    'key.keyboard_return': 'key.keyboard_return_enter',
    'key.keypad_clear': 'key.keyboard_clear',
    'key.keypad_space': 'key.keyboard_spacebar',

    // HID modifiers (page 7 / 224–231) → static MOD_ENTRIES
    'key.keyboard_leftcontrol': 'mod.lctrl',
    'key.keyboard_leftshift': 'mod.lshift',
    'key.keyboard_leftalt': 'mod.lalt',
    'key.keyboard_left_gui': 'mod.lgui',
    'key.keyboard_rightcontrol': 'mod.rctrl',
    'key.keyboard_rightshift': 'mod.rshift',
    'key.keyboard_rightalt': 'mod.ralt',
    'key.keyboard_right_gui': 'mod.rgui',

    // HID consumer (page 12) media keys → static MEDIA_TRANSPORT_ENTRIES
    // Play (0xB0), Pause (0xB1) and Stop/Eject (0xCC) are usages of their
    // own (HID Usage Tables 1.7 15.7), not Play/Pause (0xCD) or Stop (0xB7).
    'media.play_pause': 'media.transport.play_pause',
    'media.stop': 'media.transport.stop',
    'media.fast_forward': 'media.transport.fast_forward',
    'media.rewind': 'media.transport.rewind',
    'media.scan_next_track': 'media.transport.next',
    'media.scan_previous_track': 'media.transport.prev',

    // Keyboard editing keys (page 7 122–126, 155) → AC application controls
    'key.keyboard_undo': 'ac.ac_undo',
    'key.keyboard_cut': 'ac.ac_cut',
    'key.keyboard_copy': 'ac.ac_copy',
    'key.keyboard_paste': 'ac.ac_paste',
    'key.keyboard_find': 'ac.ac_find',
    'key.keyboard_cancel': 'ac.ac_cancel',
}

// Resolve a (possibly aliased) id to its primary canonical id. Walks
// alias chain defensively in case secondary points to another secondary.
export const resolveAlias = (id: CanonicalKeyId): CanonicalKeyId => {
    let cur = id
    for (let i = 0; i < 8; i++) {
        const next = CANONICAL_ALIASES[cur]
        if (!next || next === cur) return cur
        cur = next
    }
    return cur
}
