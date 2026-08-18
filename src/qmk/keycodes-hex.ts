// Pattern check: no GoF pattern (-) — rejected — QMK quantum keycode hex map.
// These are INTERFACE FACTS: the numeric keycode values a QMK/VIA keyboard
// exchanges over the wire, independently compiled to match the public VIA keycode
// numbering — not copied firmware source. Pure data; keep in sync with the
// published keycode assignments.
import type { CanonicalKeyId } from '../catalog/types'

// MIDI note ids: octaves 0..5, 12 notes each. C0 starts at 0x7103.
const NOTE_LETTERS = [
    'c',
    'c_sharp',
    'd',
    'd_sharp',
    'e',
    'f',
    'f_sharp',
    'g',
    'g_sharp',
    'a',
    'a_sharp',
    'b',
] as const
const midiNotes: Record<string, number> = {}
for (let oct = 0; oct <= 5; oct++) {
    for (let n = 0; n < 12; n++) {
        midiNotes[`midi.note.${NOTE_LETTERS[n]}_${oct}`] = 0x7103 + oct * 12 + n
    }
}

const joystickButtons: Record<string, number> = {}
for (let i = 0; i < 32; i++) {
    joystickButtons[`joystick.button.${i}`] = 0x7400 + i
}

const programmableButtons: Record<string, number> = {}
for (let i = 1; i <= 32; i++) {
    programmableButtons[`programmable.button.${i}`] = 0x7440 + (i - 1)
}

export const QMK_HEX_BY_CANONICAL: Record<CanonicalKeyId, number> = {
    // ───────────── Bare modifiers (HID page-7 0xE0..0xE7) + Meh/Hypr (mod-only wraps) ─────────────
    'mod.lctrl': 0x00e0,
    'mod.lshift': 0x00e1,
    'mod.lalt': 0x00e2,
    'mod.lgui': 0x00e3,
    'mod.rctrl': 0x00e4,
    'mod.rshift': 0x00e5,
    'mod.ralt': 0x00e6,
    'mod.rgui': 0x00e7,
    // QK_LCTL=0x0100 | QK_LSFT=0x0200 | QK_LALT=0x0400, no inner kc.
    'mod.meh': 0x0700,
    // + QK_LGUI=0x0800.
    'mod.hypr': 0x0f00,

    // ───────────── Mouse (HID page-7 basic kc 0xCD..0xDF) ─────────────
    'mouse.cursor.up': 0x00cd,
    'mouse.cursor.down': 0x00ce,
    'mouse.cursor.left': 0x00cf,
    'mouse.cursor.right': 0x00d0,
    'mouse.button.1': 0x00d1,
    'mouse.button.2': 0x00d2,
    'mouse.button.3': 0x00d3,
    'mouse.button.4': 0x00d4,
    'mouse.button.5': 0x00d5,
    'mouse.button.6': 0x00d6,
    'mouse.button.7': 0x00d7,
    'mouse.button.8': 0x00d8,
    'mouse.wheel.up': 0x00d9,
    'mouse.wheel.down': 0x00da,
    'mouse.wheel.left': 0x00db,
    'mouse.wheel.right': 0x00dc,
    'mouse.accel.0': 0x00dd,
    'mouse.accel.1': 0x00de,
    'mouse.accel.2': 0x00df,

    // ───────────── QMK basic-range aliases (0xA5..0xC2) ─────────────
    // NOT literal HID page-7 usages — QMK re-uses the tail of the basic
    // keycode range for System Control, Consumer and desktop shortcuts
    // (KC_SYSTEM_POWER … KC_LAUNCHPAD). Order is fixed by QMK's keycode.h
    // and is what VIA/Keychron boards put in the keymap.
    'sys_ctrl.system_power_down': 0x00a5,
    'sys_ctrl.system_sleep': 0x00a6,
    'sys_ctrl.system_wake_up': 0x00a7,
    'media.mute': 0x00a8,
    'media.volume_increment': 0x00a9,
    'media.volume_decrement': 0x00aa,
    'media.transport.next': 0x00ab,
    'media.transport.prev': 0x00ac,
    'media.transport.stop': 0x00ad,
    'media.transport.play_pause': 0x00ae,
    'media.transport.select': 0x00af,
    'media.eject': 0x00b0,
    'os.launch.mail': 0x00b1,
    'os.launch.calc': 0x00b2,
    'os.launch.my_computer': 0x00b3,
    'os.browser.search': 0x00b4,
    'os.browser.home': 0x00b5,
    'os.browser.back': 0x00b6,
    'os.browser.forward': 0x00b7,
    'os.browser.stop': 0x00b8,
    'os.browser.refresh': 0x00b9,
    'os.browser.favorites': 0x00ba,
    'media.transport.fast_forward': 0x00bb,
    'media.transport.rewind': 0x00bc,
    'display.brightness.up': 0x00bd,
    'display.brightness.down': 0x00be,
    'os.system.control_panel': 0x00bf,
    'os.system.assistant': 0x00c0,
    'os.mac.mission_control': 0x00c1,
    'os.mac.launchpad': 0x00c2,

    // ───────────── Magic (0x7000..0x7022) ─────────────
    'magic.swap.ctrl_caps': 0x7000,
    'magic.unswap.ctrl_caps': 0x7001,
    'magic.toggle.ctrl_caps': 0x7002,
    'magic.caps_as_ctrl.off': 0x7003,
    'magic.caps_as_ctrl.on': 0x7004,
    'magic.swap.lalt_lgui': 0x7005,
    'magic.unswap.lalt_lgui': 0x7006,
    'magic.swap.ralt_rgui': 0x7007,
    'magic.unswap.ralt_rgui': 0x7008,
    'magic.gui.on': 0x7009,
    'magic.gui.off': 0x700a,
    'magic.gui.toggle': 0x700b,
    'magic.swap.grave_esc': 0x700c,
    'magic.unswap.grave_esc': 0x700d,
    'magic.swap.backslash_bs': 0x700e,
    'magic.unswap.backslash_bs': 0x700f,
    'magic.toggle.backslash_bs': 0x7010,
    'magic.nkro.on': 0x7011,
    'magic.nkro.off': 0x7012,
    'magic.nkro.toggle': 0x7013,
    'magic.swap.alt_gui': 0x7014,
    'magic.unswap.alt_gui': 0x7015,
    'magic.toggle.alt_gui': 0x7016,
    'magic.swap.lctl_lgui': 0x7017,
    'magic.unswap.lctl_lgui': 0x7018,
    'magic.swap.rctl_rgui': 0x7019,
    'magic.unswap.rctl_rgui': 0x701a,
    'magic.swap.ctl_gui': 0x701b,
    'magic.unswap.ctl_gui': 0x701c,
    'magic.toggle.ctl_gui': 0x701d,
    'magic.ee_hands.left': 0x701e,
    'magic.ee_hands.right': 0x701f,
    'magic.swap.escape_caps': 0x7020,
    'magic.unswap.escape_caps': 0x7021,
    'magic.toggle.escape_caps': 0x7022,

    // ───────────── MIDI control (0x7100..0x718F) ─────────────
    'midi.on': 0x7100,
    'midi.off': 0x7101,
    'midi.toggle': 0x7102,
    ...midiNotes,
    'midi.octave.n2': 0x714b,
    'midi.octave.n1': 0x714c,
    'midi.octave.0': 0x714d,
    'midi.octave.1': 0x714e,
    'midi.octave.2': 0x714f,
    'midi.octave.3': 0x7150,
    'midi.octave.4': 0x7151,
    'midi.octave.5': 0x7152,
    'midi.octave.6': 0x7153,
    'midi.octave.7': 0x7154,
    'midi.octave.down': 0x7155,
    'midi.octave.up': 0x7156,
    'midi.transpose.n6': 0x7157,
    'midi.transpose.n5': 0x7158,
    'midi.transpose.n4': 0x7159,
    'midi.transpose.n3': 0x715a,
    'midi.transpose.n2': 0x715b,
    'midi.transpose.n1': 0x715c,
    'midi.transpose.0': 0x715d,
    'midi.transpose.1': 0x715e,
    'midi.transpose.2': 0x715f,
    'midi.transpose.3': 0x7160,
    'midi.transpose.4': 0x7161,
    'midi.transpose.5': 0x7162,
    'midi.transpose.6': 0x7163,
    'midi.transpose.down': 0x7164,
    'midi.transpose.up': 0x7165,
    'midi.velocity.0': 0x7166,
    'midi.velocity.1': 0x7167,
    'midi.velocity.2': 0x7168,
    'midi.velocity.3': 0x7169,
    'midi.velocity.4': 0x716a,
    'midi.velocity.5': 0x716b,
    'midi.velocity.6': 0x716c,
    'midi.velocity.7': 0x716d,
    'midi.velocity.8': 0x716e,
    'midi.velocity.9': 0x716f,
    'midi.velocity.10': 0x7170,
    'midi.velocity.down': 0x7171,
    'midi.velocity.up': 0x7172,
    'midi.channel.1': 0x7173,
    'midi.channel.2': 0x7174,
    'midi.channel.3': 0x7175,
    'midi.channel.4': 0x7176,
    'midi.channel.5': 0x7177,
    'midi.channel.6': 0x7178,
    'midi.channel.7': 0x7179,
    'midi.channel.8': 0x717a,
    'midi.channel.9': 0x717b,
    'midi.channel.10': 0x717c,
    'midi.channel.11': 0x717d,
    'midi.channel.12': 0x717e,
    'midi.channel.13': 0x717f,
    'midi.channel.14': 0x7180,
    'midi.channel.15': 0x7181,
    'midi.channel.16': 0x7182,
    'midi.channel.down': 0x7183,
    'midi.channel.up': 0x7184,
    'midi.all_notes_off': 0x7185,
    'midi.sustain': 0x7186,
    'midi.portamento': 0x7187,
    'midi.sostenuto': 0x7188,
    'midi.soft': 0x7189,
    'midi.legato': 0x718a,
    'midi.modulation': 0x718b,
    'midi.modulation.speed_down': 0x718c,
    'midi.modulation.speed_up': 0x718d,
    'midi.pitch_bend.down': 0x718e,
    'midi.pitch_bend.up': 0x718f,

    // ───────────── Joystick + Programmable buttons (0x7400..0x745F) ─────────────
    ...joystickButtons,
    ...programmableButtons,

    // ───────────── Audio / Music (0x7480..0x7495) ─────────────
    'audio.on': 0x7480,
    'audio.off': 0x7481,
    'audio.toggle': 0x7482,
    'audio.clicky.toggle': 0x748a,
    'audio.clicky.on': 0x748b,
    'audio.clicky.off': 0x748c,
    'audio.clicky.up': 0x748d,
    'audio.clicky.down': 0x748e,
    'audio.clicky.reset': 0x748f,
    'audio.music.on': 0x7490,
    'audio.music.off': 0x7491,
    'audio.music.toggle': 0x7492,
    'audio.music.mode_next': 0x7493,
    'audio.voice.next': 0x7494,
    'audio.voice.prev': 0x7495,

    // ───────────── Connection / output / Bluetooth profile (0x7780..0x7797) ─────────────
    'wireless.output.auto': 0x7780,
    'wireless.output.next': 0x7781,
    'wireless.output.prev': 0x7782,
    'wireless.output.none': 0x7783,
    'wireless.output.usb': 0x7784,
    'wireless.output.2p4ghz': 0x7785,
    'wireless.output.bt': 0x7786,
    'wireless.bt.next': 0x7790,
    'wireless.bt.prev': 0x7791,
    'wireless.bt.unpair': 0x7792,
    'wireless.profile.1': 0x7793,
    'wireless.profile.2': 0x7794,
    'wireless.profile.3': 0x7795,
    'wireless.profile.4': 0x7796,
    'wireless.profile.5': 0x7797,
    'wireless.bt.clear': 0x7798,
    'wireless.bt.clear_all': 0x7799,

    // ───────────── Backlight + LED matrix (0x7800..0x7818) ─────────────
    'backlight.on': 0x7800,
    'backlight.off': 0x7801,
    'backlight.toggle': 0x7802,
    'backlight.down': 0x7803,
    'backlight.up': 0x7804,
    'backlight.step': 0x7805,
    'backlight.breathing.toggle': 0x7806,
    'led_matrix.on': 0x7810,
    'led_matrix.off': 0x7811,
    'led_matrix.toggle': 0x7812,
    'led_matrix.mode_next': 0x7813,
    'led_matrix.mode_prev': 0x7814,
    'led_matrix.brightness.up': 0x7815,
    'led_matrix.brightness.down': 0x7816,
    'led_matrix.speed.up': 0x7817,
    'led_matrix.speed.down': 0x7818,

    // ───────────── RGB underglow (0x7820..0x782A) ─────────────
    'rgb.toggle': 0x7820,
    'rgb.mode.next': 0x7821,
    'rgb.mode.prev': 0x7822,
    'rgb.hue.up': 0x7823,
    'rgb.hue.down': 0x7824,
    'rgb.sat.up': 0x7825,
    'rgb.sat.down': 0x7826,
    'rgb.val.up': 0x7827,
    'rgb.val.down': 0x7828,
    'rgb.speed.up': 0x7829,
    'rgb.speed.down': 0x782a,

    // ───────────── RGB matrix (0x7840..0x784C) ─────────────
    'rgb.matrix.on': 0x7840,
    'rgb.matrix.off': 0x7841,
    'rgb.matrix.toggle': 0x7842,
    'rgb.matrix.mode_next': 0x7843,
    'rgb.matrix.mode_prev': 0x7844,
    'rgb.matrix.hue.up': 0x7845,
    'rgb.matrix.hue.down': 0x7846,
    'rgb.matrix.sat.up': 0x7847,
    'rgb.matrix.sat.down': 0x7848,
    'rgb.matrix.val.up': 0x7849,
    'rgb.matrix.val.down': 0x784a,
    'rgb.matrix.speed.up': 0x784b,
    'rgb.matrix.speed.down': 0x784c,

    // ───────────── Quantum / system (0x7C00..0x7C04) ─────────────
    'system.bootloader': 0x7c00,
    'system.reboot': 0x7c01,
    'system.debug.toggle': 0x7c02,
    'system.eeprom_clear': 0x7c03,
    'system.make': 0x7c04,

    // ───────────── Auto Shift (0x7C10..0x7C15) ─────────────
    'auto_shift.down': 0x7c10,
    'auto_shift.up': 0x7c11,
    'auto_shift.report': 0x7c12,
    'auto_shift.on': 0x7c13,
    'auto_shift.off': 0x7c14,
    'auto_shift.toggle': 0x7c15,

    // ───────────── Grave escape + Velocikey + Space cadet (0x7C16..0x7C1E) ─────────────
    grave_escape: 0x7c16,
    'velocikey.toggle': 0x7c17,
    'space_cadet.lcpo': 0x7c18,
    'space_cadet.rcpc': 0x7c19,
    'space_cadet.lspo': 0x7c1a,
    'space_cadet.rspc': 0x7c1b,
    'space_cadet.lapo': 0x7c1c,
    'space_cadet.rapc': 0x7c1d,
    'space_cadet.sftent': 0x7c1e,

    // ───────────── Unicode mode (0x7C30..0x7C37) ─────────────
    'unicode.mode.next': 0x7c30,
    'unicode.mode.prev': 0x7c31,
    'unicode.mode.macos': 0x7c32,
    'unicode.mode.linux': 0x7c33,
    'unicode.mode.windows': 0x7c34,
    'unicode.mode.bsd': 0x7c35,
    'unicode.mode.wincompose': 0x7c36,
    'unicode.mode.emacs': 0x7c37,

    // ───────────── Haptic (0x7C40..0x7C4C) ─────────────
    'haptic.on': 0x7c40,
    'haptic.off': 0x7c41,
    'haptic.toggle': 0x7c42,
    'haptic.reset': 0x7c43,
    'haptic.feedback.toggle': 0x7c44,
    'haptic.buzz.toggle': 0x7c45,
    'haptic.mode.next': 0x7c46,
    'haptic.mode.prev': 0x7c47,
    'haptic.continuous.toggle': 0x7c48,
    'haptic.continuous.up': 0x7c49,
    'haptic.continuous.down': 0x7c4a,
    'haptic.dwell.up': 0x7c4b,
    'haptic.dwell.down': 0x7c4c,

    // ───────────── Combo / Dynamic macros / Leader / Lock (0x7C50..0x7C5C) ─────────────
    'combo.on': 0x7c50,
    'combo.off': 0x7c51,
    'combo.toggle': 0x7c52,
    'macro.dynamic.record_1': 0x7c53,
    'macro.dynamic.record_2': 0x7c54,
    'macro.dynamic.record_stop': 0x7c55,
    'macro.dynamic.play_1': 0x7c56,
    'macro.dynamic.play_2': 0x7c57,
    'leader.start': 0x7c58,
    'key_lock.hold': 0x7c59,
    'one_shot.on': 0x7c5a,
    'one_shot.off': 0x7c5b,
    'one_shot.toggle': 0x7c5c,

    // ───────────── Key override + Secure (0x7C5D..0x7C63) ─────────────
    'key_override.toggle': 0x7c5d,
    'key_override.on': 0x7c5e,
    'key_override.off': 0x7c5f,
    'secure.lock': 0x7c60,
    'secure.unlock': 0x7c61,
    'secure.toggle': 0x7c62,
    'secure.request': 0x7c63,

    // ───────────── Tap term + caps word + autocorrect + tri-layer + repeat + layer lock (0x7C70..0x7C7B) ─────────────
    'tap_term.print': 0x7c70,
    'tap_term.up': 0x7c71,
    'tap_term.down': 0x7c72,
    'caps_word.toggle': 0x7c73,

    // Swap-hands parameterless variants (within QK_SWAP_HANDS range
    // 0x5600..0x56FF; SH_T(kc) uses low byte for basic kc 0x04..0xA7,
    // these aliases occupy the high tail of the range).
    'swap_hands.toggle': 0x56f0, // SH_TOGG
    'swap_hands.tap_toggle': 0x56f1, // SH_TT
    'swap_hands.momentary_on': 0x56f2, // SH_MON
    'swap_hands.momentary_off': 0x56f3, // SH_MOFF
    'swap_hands.off': 0x56f4, // SH_OFF
    'swap_hands.on': 0x56f5, // SH_ON
    'swap_hands.oneshot': 0x56f6, // SH_OS
    'autocorrect.on': 0x7c74,
    'autocorrect.off': 0x7c75,
    'autocorrect.toggle': 0x7c76,
    'tri_layer.lower': 0x7c77,
    'tri_layer.upper': 0x7c78,
    'repeat.last': 0x7c79,
    'repeat.alt': 0x7c7a,
    'layer_lock.toggle': 0x7c7b,
}

export const QMK_CANONICAL_BY_HEX: Map<number, CanonicalKeyId> = new Map(
    Object.entries(QMK_HEX_BY_CANONICAL).map(([id, hex]) => [hex, id]),
)

// Modifier-wrapped (S(kc) / LCTL(kc) / etc.) range bases. high byte holds
// 5-bit packed mod (low 4 mods + high bit = "right" flag), low byte = basic kc.
export const QK_LCTL = 0x0100
export const QK_LSFT = 0x0200
export const QK_LALT = 0x0400
export const QK_LGUI = 0x0800
export const QK_RCTL = 0x1100
export const QK_RSFT = 0x1200
export const QK_RALT = 0x1400
export const QK_RGUI = 0x1800

// Shifted-symbol canonical ids → LSFT|kc encoded value (US ANSI).
export const SHIFTED_SYMBOLS: Record<CanonicalKeyId, number> = {
    'key.shifted.tilde': QK_LSFT | 0x35, // ~  S(KC_GRAVE)
    'key.shifted.exclaim': QK_LSFT | 0x1e,
    'key.shifted.at': QK_LSFT | 0x1f,
    'key.shifted.hash': QK_LSFT | 0x20,
    'key.shifted.dollar': QK_LSFT | 0x21,
    'key.shifted.percent': QK_LSFT | 0x22,
    'key.shifted.circumflex': QK_LSFT | 0x23,
    'key.shifted.ampersand': QK_LSFT | 0x24,
    'key.shifted.asterisk': QK_LSFT | 0x25,
    'key.shifted.lparen': QK_LSFT | 0x26,
    'key.shifted.rparen': QK_LSFT | 0x27,
    'key.shifted.underscore': QK_LSFT | 0x2d,
    'key.shifted.plus': QK_LSFT | 0x2e,
    'key.shifted.lcurly': QK_LSFT | 0x2f,
    'key.shifted.rcurly': QK_LSFT | 0x30,
    'key.shifted.pipe': QK_LSFT | 0x31,
    'key.shifted.colon': QK_LSFT | 0x33,
    'key.shifted.dquote': QK_LSFT | 0x34,
    'key.shifted.lt': QK_LSFT | 0x36,
    'key.shifted.gt': QK_LSFT | 0x37,
    'key.shifted.question': QK_LSFT | 0x38,
}

for (const [id, hex] of Object.entries(SHIFTED_SYMBOLS)) {
    QMK_HEX_BY_CANONICAL[id] = hex
    QMK_CANONICAL_BY_HEX.set(hex, id)
}
