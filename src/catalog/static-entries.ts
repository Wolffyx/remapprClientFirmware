// Pattern check: no GoF pattern (-) — rejected — static canonical entry tables for non-HID groups; data declarations.
import type { CatalogEntry } from './types'

const hid: CatalogEntry['kinds'] = ['hid']

export const WIRELESS_ENTRIES: CatalogEntry[] = [
    // Keychron-style host slot picks. QMK BT_PRF1..5 and these collapse onto
    // the same canonical id when the firmware exposes either form.
    {
        id: 'wireless.profile.1',
        label: 'BT 1',
        name: 'Bluetooth host slot 1',
        kinds: hid,
    },
    {
        id: 'wireless.profile.2',
        label: 'BT 2',
        name: 'Bluetooth host slot 2',
        kinds: hid,
    },
    {
        id: 'wireless.profile.3',
        label: 'BT 3',
        name: 'Bluetooth host slot 3',
        kinds: hid,
    },
    {
        id: 'wireless.profile.4',
        label: 'BT 4',
        name: 'Bluetooth host slot 4',
        kinds: hid,
    },
    {
        id: 'wireless.profile.5',
        label: 'BT 5',
        name: 'Bluetooth host slot 5',
        kinds: hid,
    },
    {
        id: 'wireless.bt.next',
        label: 'BT Next',
        name: 'Next Bluetooth profile',
        kinds: hid,
    },
    {
        id: 'wireless.bt.prev',
        label: 'BT Prev',
        name: 'Previous Bluetooth profile',
        kinds: hid,
    },
    {
        id: 'wireless.bt.unpair',
        label: 'BT Unpair',
        name: 'Unpair current Bluetooth profile',
        kinds: hid,
    },
    {
        id: 'wireless.bt.clear',
        label: 'BT Clr',
        name: 'Clear current Bluetooth profile',
        kinds: hid,
    },
    {
        id: 'wireless.bt.clear_all',
        label: 'BT ClrA',
        name: 'Clear all Bluetooth profiles',
        kinds: hid,
    },
    {
        id: 'wireless.output.auto',
        label: 'OUT Auto',
        name: 'Output auto-select',
        kinds: hid,
    },
    {
        id: 'wireless.output.next',
        label: 'OUT Next',
        name: 'Cycle output mode (next)',
        kinds: hid,
    },
    {
        id: 'wireless.output.prev',
        label: 'OUT Prev',
        name: 'Cycle output mode (previous)',
        kinds: hid,
    },
    {
        id: 'wireless.output.none',
        label: 'OUT Off',
        name: 'Disable output',
        kinds: hid,
    },
    {
        id: 'wireless.output.usb',
        label: 'USB',
        name: 'Output to USB',
        kinds: hid,
    },
    {
        id: 'wireless.output.bt',
        label: 'BT',
        name: 'Output to Bluetooth',
        kinds: hid,
    },
    {
        id: 'wireless.output.2p4ghz',
        label: '2.4G',
        name: 'Output to 2.4 GHz wireless',
        kinds: hid,
    },
    {
        id: 'wireless.battery.level',
        label: 'Bat',
        name: 'Show battery level',
        kinds: hid,
    },
]

export const OS_KEYS_ENTRIES: CatalogEntry[] = [
    {
        id: 'os.mac.lopt',
        label: 'LOpt',
        name: 'Left Option (Mac)',
        kinds: hid,
    },
    {
        id: 'os.mac.ropt',
        label: 'ROpt',
        name: 'Right Option (Mac)',
        kinds: hid,
    },
    {
        id: 'os.mac.lcmd',
        label: 'LCmd',
        name: 'Left Command (Mac)',
        kinds: hid,
    },
    {
        id: 'os.mac.rcmd',
        label: 'RCmd',
        name: 'Right Command (Mac)',
        kinds: hid,
    },
    {
        id: 'os.mac.mission_control',
        label: 'Mission',
        name: 'macOS Mission Control',
        kinds: hid,
    },
    {
        id: 'os.mac.launchpad',
        label: 'Launchpad',
        name: 'macOS Launchpad',
        kinds: hid,
    },
    {
        id: 'os.mac.screenshot',
        label: 'Snip',
        name: 'macOS Screenshot',
        kinds: hid,
    },
    {
        id: 'os.mac.siri',
        label: 'Siri',
        name: 'macOS Siri',
        kinds: hid,
    },
    {
        id: 'os.win.task_view',
        label: 'Task',
        name: 'Windows Task View',
        kinds: hid,
    },
    {
        id: 'os.win.file_explorer',
        label: 'Files',
        name: 'Windows File Explorer',
        kinds: hid,
    },
    {
        id: 'os.win.cortana',
        label: 'Cortana',
        name: 'Windows Cortana',
        kinds: hid,
    },
    {
        id: 'os.system.lock_screen',
        label: 'Lock',
        name: 'Lock screen',
        kinds: hid,
    },
    {
        id: 'os.system.control_panel',
        label: 'Ctl Pnl',
        name: 'Control Panel',
        kinds: hid,
    },
    {
        id: 'os.system.assistant',
        label: 'Assist',
        name: 'OS assistant',
        kinds: hid,
    },
    {
        id: 'os.launch.mail',
        label: 'Mail',
        name: 'Launch mail client',
        kinds: hid,
    },
    {
        id: 'os.launch.calc',
        label: 'Calc',
        name: 'Launch calculator',
        kinds: hid,
    },
    {
        id: 'os.launch.my_computer',
        label: 'MyComp',
        name: 'Open My Computer / Files',
        kinds: hid,
    },
    {
        id: 'os.browser.search',
        label: 'WSrch',
        name: 'Browser search',
        kinds: hid,
    },
    {
        id: 'os.browser.home',
        label: 'WHome',
        name: 'Browser home',
        kinds: hid,
    },
    {
        id: 'os.browser.back',
        label: 'WBack',
        name: 'Browser back',
        kinds: hid,
    },
    {
        id: 'os.browser.forward',
        label: 'WFwd',
        name: 'Browser forward',
        kinds: hid,
    },
    {
        id: 'os.browser.stop',
        label: 'WStop',
        name: 'Browser stop',
        kinds: hid,
    },
    {
        id: 'os.browser.refresh',
        label: 'WRfsh',
        name: 'Browser refresh',
        kinds: hid,
    },
    {
        id: 'os.browser.favorites',
        label: 'WFav',
        name: 'Browser favorites',
        kinds: hid,
    },
]

// pattern-check: skip mechanical extraction of three combo control rows from MISC_ENTRIES into new COMBOS_ENTRIES + page record
export const COMBOS_ENTRIES: CatalogEntry[] = [
    {
        id: 'combo.on',
        label: 'Cmb On',
        name: 'Combo on',
        kinds: ['hid'],
    },
    {
        id: 'combo.off',
        label: 'Cmb Off',
        name: 'Combo off',
        kinds: ['hid'],
    },
    {
        id: 'combo.toggle',
        label: 'Cmb Tog',
        name: 'Combo toggle',
        kinds: ['hid'],
    },
]

export const MACROS_ENTRIES: CatalogEntry[] = [
    ...Array.from(
        { length: 16 },
        (_, i): CatalogEntry => ({
            id: `macro.user.${i}`,
            label: `M${i}`,
            name: `Vial macro slot ${i}`,
            kinds: hid,
        }),
    ),
    {
        id: 'macro.dynamic.record_1',
        label: 'DM Rec1',
        name: 'Dynamic macro record 1',
        kinds: hid,
    },
    {
        id: 'macro.dynamic.record_2',
        label: 'DM Rec2',
        name: 'Dynamic macro record 2',
        kinds: hid,
    },
    {
        id: 'macro.dynamic.record_stop',
        label: 'DM Stop',
        name: 'Dynamic macro record stop',
        kinds: hid,
    },
    {
        id: 'macro.dynamic.play_1',
        label: 'DM Ply1',
        name: 'Dynamic macro play 1',
        kinds: hid,
    },
    {
        id: 'macro.dynamic.play_2',
        label: 'DM Ply2',
        name: 'Dynamic macro play 2',
        kinds: hid,
    },
]

const entry = (
    id: string,
    label: string,
    name: string,
    description?: string,
): CatalogEntry => ({ id, label, name, description, kinds: hid })

export const AUDIO_ENTRIES: CatalogEntry[] = [
    entry('audio.on', 'AU On', 'Audio on'),
    entry('audio.off', 'AU Off', 'Audio off'),
    entry('audio.toggle', 'AU Tog', 'Audio toggle'),
    entry('audio.clicky.toggle', 'CK Tog', 'Clicky toggle'),
    entry('audio.clicky.on', 'CK On', 'Clicky on'),
    entry('audio.clicky.off', 'CK Off', 'Clicky off'),
    entry('audio.clicky.up', 'CK Up', 'Clicky frequency up'),
    entry('audio.clicky.down', 'CK Dn', 'Clicky frequency down'),
    entry('audio.clicky.reset', 'CK Rst', 'Clicky reset frequency'),
    entry('audio.music.on', 'MU On', 'Music mode on'),
    entry('audio.music.off', 'MU Off', 'Music mode off'),
    entry('audio.music.toggle', 'MU Tog', 'Music mode toggle'),
    entry('audio.music.mode_next', 'MU Mod', 'Music mode next'),
    entry('audio.voice.next', 'AU Nxt', 'Audio voice next'),
    entry('audio.voice.prev', 'AU Prv', 'Audio voice previous'),
]

export const BACKLIGHT_ENTRIES: CatalogEntry[] = [
    entry('backlight.on', 'BL On', 'Backlight on'),
    entry('backlight.off', 'BL Off', 'Backlight off'),
    entry('backlight.toggle', 'BL Tog', 'Backlight toggle'),
    entry('backlight.up', 'BL Up', 'Backlight up'),
    entry('backlight.down', 'BL Dn', 'Backlight down'),
    entry('backlight.step', 'BL Stp', 'Backlight step'),
    entry(
        'backlight.breathing.toggle',
        'BL Brth',
        'Backlight breathing toggle',
    ),
    entry('led_matrix.on', 'LM On', 'LED matrix on'),
    entry('led_matrix.off', 'LM Off', 'LED matrix off'),
    entry('led_matrix.toggle', 'LM Tog', 'LED matrix toggle'),
    entry('led_matrix.mode_next', 'LM Nxt', 'LED matrix mode next'),
    entry('led_matrix.mode_prev', 'LM Prv', 'LED matrix mode previous'),
    entry('led_matrix.brightness.up', 'LM B+', 'LED matrix brightness up'),
    entry('led_matrix.brightness.down', 'LM B-', 'LED matrix brightness down'),
    entry('led_matrix.speed.up', 'LM S+', 'LED matrix speed up'),
    entry('led_matrix.speed.down', 'LM S-', 'LED matrix speed down'),
]

// Mouse-tile helper: entry() plus a picker icon (see src/legendIcons.ts).
const mentry = (
    id: string,
    label: string,
    name: string,
    icon: string,
): CatalogEntry => ({ ...entry(id, label, name), icon })

export const MOUSE_ENTRIES: CatalogEntry[] = [
    mentry('mouse.cursor.up', 'MS Up', 'Mouse cursor up', 'arrow-up'),
    mentry('mouse.cursor.down', 'MS Dn', 'Mouse cursor down', 'arrow-down'),
    mentry('mouse.cursor.left', 'MS Lt', 'Mouse cursor left', 'arrow-left'),
    mentry('mouse.cursor.right', 'MS Rt', 'Mouse cursor right', 'arrow-right'),
    mentry('mouse.button.1', 'MS B1', 'Mouse button 1', 'mouse-left'),
    mentry('mouse.button.2', 'MS B2', 'Mouse button 2', 'mouse-right'),
    mentry('mouse.button.3', 'MS B3', 'Mouse button 3', 'mouse'),
    mentry('mouse.button.4', 'MS B4', 'Mouse button 4', 'mouse'),
    mentry('mouse.button.5', 'MS B5', 'Mouse button 5', 'mouse'),
    mentry('mouse.button.6', 'MS B6', 'Mouse button 6', 'mouse'),
    mentry('mouse.button.7', 'MS B7', 'Mouse button 7', 'mouse'),
    mentry('mouse.button.8', 'MS B8', 'Mouse button 8', 'mouse'),
    mentry('mouse.wheel.up', 'WH Up', 'Mouse wheel up', 'scroll-up'),
    mentry('mouse.wheel.down', 'WH Dn', 'Mouse wheel down', 'scroll-down'),
    mentry('mouse.wheel.left', 'WH Lt', 'Mouse wheel left', 'scroll-left'),
    mentry('mouse.wheel.right', 'WH Rt', 'Mouse wheel right', 'scroll-right'),
    // Acceleration presets have no natural glyph — text only.
    entry('mouse.accel.0', 'Acl0', 'Mouse acceleration 0'),
    entry('mouse.accel.1', 'Acl1', 'Mouse acceleration 1'),
    entry('mouse.accel.2', 'Acl2', 'Mouse acceleration 2'),
]

export const MAGIC_ENTRIES: CatalogEntry[] = [
    entry('magic.swap.ctrl_caps', 'CL SWAP', 'Swap Caps Lock and Left Control'),
    entry(
        'magic.unswap.ctrl_caps',
        'CL NORM',
        'Unswap Caps Lock and Left Control',
    ),
    entry(
        'magic.toggle.ctrl_caps',
        'CL TOGG',
        'Toggle Caps Lock / Left Control swap',
    ),
    entry('magic.caps_as_ctrl.on', 'CL CTRL', 'Caps Lock acts as Control'),
    entry('magic.caps_as_ctrl.off', 'CL CAPS', 'Caps Lock acts as Caps Lock'),
    entry('magic.swap.lctl_lgui', 'LCG SWP', 'Swap Left Ctrl and Left GUI'),
    entry('magic.swap.rctl_rgui', 'RCG SWP', 'Swap Right Ctrl and Right GUI'),
    entry('magic.unswap.lctl_lgui', 'LCG NRM', 'Unswap Left Ctrl and Left GUI'),
    entry(
        'magic.unswap.rctl_rgui',
        'RCG NRM',
        'Unswap Right Ctrl and Right GUI',
    ),
    entry('magic.toggle.ctl_gui', 'CG TOGG', 'Toggle Ctrl/GUI swap'),
    entry('magic.ee_hands.left', 'EH LEFT', 'EE Hands left'),
    entry('magic.ee_hands.right', 'EH RGHT', 'EE Hands right'),
    entry('magic.swap.lalt_lgui', 'LAG SWP', 'Swap Left Alt and Left GUI'),
    entry('magic.swap.ralt_rgui', 'RAG SWP', 'Swap Right Alt and Right GUI'),
    entry('magic.unswap.lalt_lgui', 'LAG NRM', 'Unswap Left Alt and Left GUI'),
    entry(
        'magic.unswap.ralt_rgui',
        'RAG NRM',
        'Unswap Right Alt and Right GUI',
    ),
    entry('magic.toggle.alt_gui', 'AG TOGG', 'Toggle Alt/GUI swap'),
    entry('magic.gui.off', 'GUI OFF', 'Disable GUI key'),
    entry('magic.gui.on', 'GUI ON', 'Enable GUI key'),
    entry('magic.gui.toggle', 'GUI TOG', 'Toggle GUI key'),
    entry('magic.swap.grave_esc', 'GE SWP', 'Swap Grave and Escape'),
    entry('magic.unswap.grave_esc', 'GE NRM', 'Unswap Grave and Escape'),
    entry('magic.swap.backslash_bs', 'BS SWP', 'Swap Backslash and Backspace'),
    entry(
        'magic.unswap.backslash_bs',
        'BS NRM',
        'Unswap Backslash and Backspace',
    ),
    entry(
        'magic.toggle.backslash_bs',
        'BS TOG',
        'Toggle Backslash/Backspace swap',
    ),
    entry('magic.nkro.on', 'NK ON', 'NKRO on'),
    entry('magic.nkro.off', 'NK OFF', 'NKRO off'),
    entry('magic.nkro.toggle', 'NK TOG', 'NKRO toggle'),
]

export const RGB_ENTRIES: CatalogEntry[] = [
    entry('rgb.toggle', 'UG TOG', 'RGB underglow toggle'),
    entry('rgb.mode.next', 'UG Nxt', 'RGB underglow mode next'),
    entry('rgb.mode.prev', 'UG Prv', 'RGB underglow mode previous'),
    entry('rgb.hue.up', 'UG H+', 'RGB underglow hue up'),
    entry('rgb.hue.down', 'UG H-', 'RGB underglow hue down'),
    entry('rgb.sat.up', 'UG S+', 'RGB underglow saturation up'),
    entry('rgb.sat.down', 'UG S-', 'RGB underglow saturation down'),
    entry('rgb.val.up', 'UG V+', 'RGB underglow value up'),
    entry('rgb.val.down', 'UG V-', 'RGB underglow value down'),
    entry('rgb.speed.up', 'UG SP+', 'RGB underglow speed up'),
    entry('rgb.speed.down', 'UG SP-', 'RGB underglow speed down'),
    entry('rgb.matrix.on', 'RM On', 'RGB matrix on'),
    entry('rgb.matrix.off', 'RM Off', 'RGB matrix off'),
    entry('rgb.matrix.toggle', 'RM Tog', 'RGB matrix toggle'),
    entry('rgb.matrix.mode_next', 'RM Nxt', 'RGB matrix mode next'),
    entry('rgb.matrix.mode_prev', 'RM Prv', 'RGB matrix mode previous'),
    entry('rgb.matrix.hue.up', 'RM H+', 'RGB matrix hue up'),
    entry('rgb.matrix.hue.down', 'RM H-', 'RGB matrix hue down'),
    entry('rgb.matrix.sat.up', 'RM S+', 'RGB matrix saturation up'),
    entry('rgb.matrix.sat.down', 'RM S-', 'RGB matrix saturation down'),
    entry('rgb.matrix.val.up', 'RM V+', 'RGB matrix value up'),
    entry('rgb.matrix.val.down', 'RM V-', 'RGB matrix value down'),
    entry('rgb.matrix.speed.up', 'RM SP+', 'RGB matrix speed up'),
    entry('rgb.matrix.speed.down', 'RM SP-', 'RGB matrix speed down'),
]

export const MEDIA_TRANSPORT_ENTRIES: CatalogEntry[] = [
    entry('media.transport.next', 'Next', 'Next track'),
    entry('media.transport.prev', 'Prev', 'Previous track'),
    entry('media.transport.stop', 'Stop', 'Stop'),
    entry('media.transport.play_pause', 'Play', 'Play / pause'),
    entry('media.transport.select', 'Sel', 'Media select'),
    entry('media.transport.fast_forward', 'FF', 'Fast forward'),
    entry('media.transport.rewind', 'Rwd', 'Rewind'),
]

export const MISC_ENTRIES: CatalogEntry[] = [
    entry('display.brightness.up', 'Brt+', 'Display brightness up'),
    entry('display.brightness.down', 'Brt-', 'Display brightness down'),
    entry('caps_word.toggle', 'CW Tog', 'Caps word toggle'),
    entry('leader.start', 'LDR', 'Leader sequence start'),
    entry('key_lock.hold', 'KeyLk', 'Hold next key (key lock)'),
    entry('layer_lock.toggle', 'LLock', 'Layer lock toggle'),
    entry('repeat.last', 'Rep', 'Repeat last key'),
    entry('repeat.alt', 'AltRep', 'Repeat last key (alt)'),
    entry('autocorrect.on', 'AC On', 'Autocorrect on'),
    entry('autocorrect.off', 'AC Off', 'Autocorrect off'),
    entry('autocorrect.toggle', 'AC Tog', 'Autocorrect toggle'),
    entry('auto_shift.toggle', 'AS Tog', 'Auto shift toggle'),
    entry('auto_shift.on', 'AS On', 'Auto shift on'),
    entry('auto_shift.off', 'AS Off', 'Auto shift off'),
    entry('auto_shift.up', 'AS Up', 'Auto shift threshold up'),
    entry('auto_shift.down', 'AS Dn', 'Auto shift threshold down'),
    entry('auto_shift.report', 'AS Rpt', 'Auto shift report'),
    entry('grave_escape', 'GEsc', 'Grave escape'),
    entry('space_cadet.lcpo', 'LCPO', 'Left Ctrl/paren open'),
    entry('space_cadet.rcpc', 'RCPC', 'Right Ctrl/paren close'),
    entry('space_cadet.lspo', 'LSPO', 'Left Shift/paren open'),
    entry('space_cadet.rspc', 'RSPC', 'Right Shift/paren close'),
    entry('space_cadet.lapo', 'LAPO', 'Left Alt/paren open'),
    entry('space_cadet.rapc', 'RAPC', 'Right Alt/paren close'),
    entry('space_cadet.sftent', 'SftEnt', 'Right Shift/Enter'),
    entry('swap_hands.toggle', 'SH Tog', 'Swap hands toggle'),
    entry('swap_hands.tap_toggle', 'SH TT', 'Swap hands tap-toggle'),
    entry('swap_hands.momentary_on', 'SH MOn', 'Swap hands momentary on'),
    entry('swap_hands.momentary_off', 'SH MOff', 'Swap hands momentary off'),
    entry('swap_hands.off', 'SH Off', 'Swap hands off'),
    entry('swap_hands.on', 'SH On', 'Swap hands on'),
    entry('swap_hands.oneshot', 'SH OS', 'Swap hands one-shot'),
    entry('tap_term.up', 'TT Up', 'Tap term up'),
    entry('tap_term.down', 'TT Dn', 'Tap term down'),
    entry('tap_term.print', 'TT Prt', 'Tap term print'),
    entry('tri_layer.lower', 'Tri Lo', 'Tri-layer lower'),
    entry('tri_layer.upper', 'Tri Hi', 'Tri-layer upper'),
    entry('one_shot.on', 'OS On', 'One shot keys on'),
    entry('one_shot.off', 'OS Off', 'One shot keys off'),
    entry('one_shot.toggle', 'OS Tog', 'One shot keys toggle'),
    entry('key_override.on', 'KO On', 'Key override on'),
    entry('key_override.off', 'KO Off', 'Key override off'),
    entry('key_override.toggle', 'KO Tog', 'Key override toggle'),
    entry('velocikey.toggle', 'Velki', 'Velocikey toggle'),
    entry('haptic.on', 'Hap On', 'Haptic on'),
    entry('haptic.off', 'Hap Off', 'Haptic off'),
    entry('haptic.toggle', 'Hap Tog', 'Haptic toggle'),
    entry('haptic.reset', 'Hap Rst', 'Haptic reset'),
    entry('haptic.feedback.toggle', 'Hap Fbk', 'Haptic feedback toggle'),
    entry('haptic.buzz.toggle', 'Hap Buz', 'Haptic buzz toggle'),
    entry('haptic.mode.next', 'Hap Nxt', 'Haptic mode next'),
    entry('haptic.mode.prev', 'Hap Prv', 'Haptic mode previous'),
    entry('haptic.continuous.toggle', 'Hap Cnt', 'Haptic continuous toggle'),
    entry('haptic.continuous.up', 'Hap C+', 'Haptic continuous up'),
    entry('haptic.continuous.down', 'Hap C-', 'Haptic continuous down'),
    entry('haptic.dwell.up', 'Hap D+', 'Haptic dwell up'),
    entry('haptic.dwell.down', 'Hap D-', 'Haptic dwell down'),
    entry('secure.lock', 'Sec Lk', 'Secure lock'),
    entry('secure.unlock', 'Sec Un', 'Secure unlock'),
    entry('secure.toggle', 'Sec Tg', 'Secure toggle'),
    entry('secure.request', 'Sec Rq', 'Secure request'),
    entry('unicode.mode.next', 'UC Nxt', 'Unicode mode next'),
    entry('unicode.mode.prev', 'UC Prv', 'Unicode mode previous'),
    entry('unicode.mode.macos', 'UC Mac', 'Unicode mode macOS'),
    entry('unicode.mode.linux', 'UC Lnx', 'Unicode mode Linux'),
    entry('unicode.mode.windows', 'UC Win', 'Unicode mode Windows'),
    entry('unicode.mode.bsd', 'UC BSD', 'Unicode mode BSD'),
    entry('unicode.mode.wincompose', 'UC WC', 'Unicode mode WinCompose'),
    entry('unicode.mode.emacs', 'UC Em', 'Unicode mode Emacs'),
]

export const MIDI_ENTRIES: CatalogEntry[] = (() => {
    const items: CatalogEntry[] = [
        entry('midi.on', 'MI On', 'MIDI on'),
        entry('midi.off', 'MI Off', 'MIDI off'),
        entry('midi.toggle', 'MI Tog', 'MIDI toggle'),
    ]
    const notes = [
        'C',
        'C#',
        'D',
        'D#',
        'E',
        'F',
        'F#',
        'G',
        'G#',
        'A',
        'A#',
        'B',
    ]
    const slugs = [
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
    ]
    for (let oct = 0; oct <= 5; oct++) {
        for (let n = 0; n < 12; n++) {
            items.push(
                entry(
                    `midi.note.${slugs[n]}_${oct}`,
                    `${notes[n]}${oct}`,
                    `MIDI note ${notes[n]}${oct}`,
                ),
            )
        }
    }
    for (const o of ['n2', 'n1', '0', '1', '2', '3', '4', '5', '6', '7']) {
        items.push(entry(`midi.octave.${o}`, `Oct ${o}`, `MIDI octave ${o}`))
    }
    items.push(
        entry('midi.octave.up', 'Oct+', 'MIDI octave up'),
        entry('midi.octave.down', 'Oct-', 'MIDI octave down'),
    )
    for (const t of [
        'n6',
        'n5',
        'n4',
        'n3',
        'n2',
        'n1',
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
    ]) {
        items.push(
            entry(`midi.transpose.${t}`, `Trn ${t}`, `MIDI transpose ${t}`),
        )
    }
    items.push(
        entry('midi.transpose.up', 'Trn+', 'MIDI transpose up'),
        entry('midi.transpose.down', 'Trn-', 'MIDI transpose down'),
    )
    for (let v = 0; v <= 10; v++) {
        items.push(
            entry(`midi.velocity.${v}`, `Vel ${v}`, `MIDI velocity ${v}`),
        )
    }
    items.push(
        entry('midi.velocity.up', 'Vel+', 'MIDI velocity up'),
        entry('midi.velocity.down', 'Vel-', 'MIDI velocity down'),
    )
    for (let c = 1; c <= 16; c++) {
        items.push(entry(`midi.channel.${c}`, `Ch ${c}`, `MIDI channel ${c}`))
    }
    items.push(
        entry('midi.channel.up', 'Ch+', 'MIDI channel up'),
        entry('midi.channel.down', 'Ch-', 'MIDI channel down'),
        entry('midi.all_notes_off', 'AllOff', 'MIDI all notes off'),
        entry('midi.sustain', 'Sus', 'MIDI sustain'),
        entry('midi.portamento', 'Port', 'MIDI portamento'),
        entry('midi.sostenuto', 'Sost', 'MIDI sostenuto'),
        entry('midi.soft', 'Soft', 'MIDI soft'),
        entry('midi.legato', 'Leg', 'MIDI legato'),
        entry('midi.modulation', 'Mod', 'MIDI modulation'),
        entry('midi.modulation.speed_up', 'Mod+', 'MIDI modulation speed up'),
        entry(
            'midi.modulation.speed_down',
            'Mod-',
            'MIDI modulation speed down',
        ),
        entry('midi.pitch_bend.up', 'PB+', 'MIDI pitch bend up'),
        entry('midi.pitch_bend.down', 'PB-', 'MIDI pitch bend down'),
    )
    return items
})()

export const JOYSTICK_ENTRIES: CatalogEntry[] = Array.from(
    { length: 32 },
    (_, i): CatalogEntry => ({
        id: `joystick.button.${i}`,
        label: `J${i}`,
        name: `Joystick button ${i}`,
        kinds: hid,
    }),
)

export const PROGRAMMABLE_ENTRIES: CatalogEntry[] = Array.from(
    { length: 32 },
    (_, i): CatalogEntry => ({
        id: `programmable.button.${i + 1}`,
        label: `P${i + 1}`,
        name: `Programmable button ${i + 1}`,
        kinds: hid,
    }),
)

export const MOD_ENTRIES: CatalogEntry[] = [
    entry('mod.lctrl', 'LCtl', 'Left Control'),
    entry('mod.lshift', 'LSft', 'Left Shift'),
    entry('mod.lalt', 'LAlt', 'Left Alt'),
    entry('mod.lgui', 'LGui', 'Left GUI'),
    entry('mod.rctrl', 'RCtl', 'Right Control'),
    entry('mod.rshift', 'RSft', 'Right Shift'),
    entry('mod.ralt', 'RAlt', 'Right Alt'),
    entry('mod.rgui', 'RGui', 'Right GUI'),
    entry('mod.meh', 'Meh', 'Meh (LCtl+LSft+LAlt)'),
    entry('mod.hypr', 'Hypr', 'Hyper (LCtl+LSft+LAlt+LGui)'),
]

export const SHIFTED_ENTRIES: CatalogEntry[] = [
    entry('key.shifted.tilde', '~', 'Tilde (S+`)'),
    entry('key.shifted.exclaim', '!', 'Exclamation (S+1)'),
    entry('key.shifted.at', '@', 'At (S+2)'),
    entry('key.shifted.hash', '#', 'Hash (S+3)'),
    entry('key.shifted.dollar', '$', 'Dollar (S+4)'),
    entry('key.shifted.percent', '%', 'Percent (S+5)'),
    entry('key.shifted.circumflex', '^', 'Circumflex (S+6)'),
    entry('key.shifted.ampersand', '&', 'Ampersand (S+7)'),
    entry('key.shifted.asterisk', '*', 'Asterisk (S+8)'),
    entry('key.shifted.lparen', '(', 'Left paren (S+9)'),
    entry('key.shifted.rparen', ')', 'Right paren (S+0)'),
    entry('key.shifted.underscore', '_', 'Underscore (S+-)'),
    entry('key.shifted.plus', '+', 'Plus (S+=)'),
    entry('key.shifted.lcurly', '{', 'Left curly (S+[)'),
    entry('key.shifted.rcurly', '}', 'Right curly (S+])'),
    entry('key.shifted.pipe', '|', 'Pipe (S+\\)'),
    entry('key.shifted.colon', ':', 'Colon (S+;)'),
    entry('key.shifted.dquote', '"', "Double quote (S+')"),
    entry('key.shifted.lt', '<', 'Less than (S+,)'),
    entry('key.shifted.gt', '>', 'Greater than (S+.)'),
    entry('key.shifted.question', '?', 'Question (S+/)'),
]

export const QUANTUM_ENTRIES: CatalogEntry[] = [
    entry('system.bootloader', 'BOOT', 'Enter bootloader'),
    entry('system.reboot', 'RBT', 'Reboot keyboard'),
    entry('system.debug.toggle', 'DBG', 'Toggle debug mode'),
    entry('system.eeprom_clear', 'EE_CLR', 'Clear EEPROM'),
    entry('system.make', 'MAKE', 'Output qmk compile command'),
]

export const STATIC_ENTRIES: CatalogEntry[] = [
    ...WIRELESS_ENTRIES,
    ...OS_KEYS_ENTRIES,
    ...MACROS_ENTRIES,
    ...COMBOS_ENTRIES,
    ...AUDIO_ENTRIES,
    ...BACKLIGHT_ENTRIES,
    ...MOUSE_ENTRIES,
    ...MAGIC_ENTRIES,
    ...RGB_ENTRIES,
    ...QUANTUM_ENTRIES,
    ...MEDIA_TRANSPORT_ENTRIES,
    ...MISC_ENTRIES,
    ...MIDI_ENTRIES,
    ...JOYSTICK_ENTRIES,
    ...PROGRAMMABLE_ENTRIES,
    ...SHIFTED_ENTRIES,
    ...MOD_ENTRIES,
]
