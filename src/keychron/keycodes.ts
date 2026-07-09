// pattern-check: skip — data table + lookup for Keychron QK_KB_0..31 range; no abstraction
// Keychron-specific keycodes occupy the QK_KB_0 (0x7E00) … QK_KB_31 (0x7E1F)
// protocol range. The exact assignment depends on which *_ENABLE flags the
// firmware was built with (the offsets chain in build order). These are interface
// values — the keycodes a Keychron board reports over the wire — reconstructed by
// observation, not copied source. We ship the most common K-series build
// (LK_WIRELESS, no analog, no LED matrix) plus the universal media keys first.
//
// Caveat: a board with ANALOG_MATRIX or KEYCOMBO_OS_TOGGLE will shift later
// entries. When that becomes a problem we can read the firmware version
// string (0xA1) and pick a per-build table.

import type { KeyAction, KeyLabel } from '@firmware/types'
import type { LegendPart } from '../paramLabel'

export const KEYCHRON_QK_KB_BASE = 0x7e00
export const KEYCHRON_QK_KB_END = 0x7e1f

export const KEYCHRON_KIND_PREFIX = 'keychron.'

interface KeychronKeycode {
    /** Offset from KEYCHRON_QK_KB_BASE. */
    offset: number
    label: KeyLabel
}

function kc(
    offset: number,
    _kind: string,
    primary: string,
    description: string,
    secondary?: string,
): KeychronKeycode {
    const label: KeyLabel = {
        primary,
        description,
        ...(secondary ? { secondary } : {}),
        bindingPrefix: 'KC',
    }
    return { offset, label }
}

// K-series wireless build (LK_WIRELESS_ENABLE, no analog, no LED matrix,
// no OS-toggle keycombo, no extra screens). Verified against a Keychron K5 Max's
// reported keycodes (default build flags).
const TABLE: KeychronKeycode[] = [
    kc(0x00, 'lopt', 'LOpt', 'Left Option (Mac)'),
    kc(0x01, 'ropt', 'ROpt', 'Right Option (Mac)'),
    kc(0x02, 'lcmd', 'LCmd', 'Left Command (Mac)'),
    kc(0x03, 'rcmd', 'RCmd', 'Right Command (Mac)'),
    kc(0x04, 'mac_mission_control', 'Mission', 'macOS Mission Control'),
    kc(0x05, 'mac_launchpad', 'Launchpad', 'macOS Launchpad'),
    kc(0x06, 'win_task_view', 'Task', 'Windows Task View'),
    kc(0x07, 'win_file_explorer', 'Files', 'Windows File Explorer'),
    kc(0x08, 'mac_screenshot', 'Snip', 'macOS Screenshot'),
    kc(0x09, 'win_cortana', 'Cortana', 'Windows Cortana'),
    kc(0x0a, 'mac_lock_screen', 'Lock', 'Lock screen'),
    kc(0x0b, 'mac_siri', 'Siri', 'macOS Siri'),
    kc(0x0c, 'bt_hst1', 'BT 1', 'Bluetooth host slot 1'),
    kc(0x0d, 'bt_hst2', 'BT 2', 'Bluetooth host slot 2'),
    kc(0x0e, 'bt_hst3', 'BT 3', 'Bluetooth host slot 3'),
    kc(0x0f, 'p2p4g', '2.4G', '2.4 GHz wireless'),
    kc(0x10, 'bat_lvl', 'Bat', 'Show battery level'),
]

// Composite icon legends for the icon-worthy Keychron keycodes (issue #147).
// Keyed by table offset; the part text is the icon-less fallback. Entries not
// listed keep their plain-text label. Icon ids come from the neutral vocabulary
// (src/legendIcons.ts) and resolve in the renderer's registry.
const ICON_PARTS: Readonly<Record<number, LegendPart[]>> = {
    0x08: [{ icon: 'screenshot', text: 'Snip' }],
    0x0a: [{ icon: 'lock', text: 'Lock' }],
    0x0c: [{ icon: 'bluetooth', text: 'BT' }, { text: '1' }],
    0x0d: [{ icon: 'bluetooth', text: 'BT' }, { text: '2' }],
    0x0e: [{ icon: 'bluetooth', text: 'BT' }, { text: '3' }],
    0x0f: [{ icon: 'wireless', text: '2.4G' }],
    0x10: [{ icon: 'battery', text: 'Bat' }],
}
for (const e of TABLE) {
    const parts = ICON_PARTS[e.offset]
    if (parts) e.label = { ...e.label, paramParts: parts }
}

const BY_KEYCODE = new Map<number, KeychronKeycode>(
    TABLE.map((e) => [KEYCHRON_QK_KB_BASE + e.offset, e]),
)

// Pattern check: no GoF pattern (-) — rejected — refactoring decode return shape to use qmk:basic kind with full 16-bit value; data routing change, no abstraction.
export function decodeKeychronKeycode(keycode: number): KeyAction | null {
    if (keycode < KEYCHRON_QK_KB_BASE || keycode > KEYCHRON_QK_KB_END) {
        return null
    }
    const entry = BY_KEYCODE.get(keycode)
    // Catalog-resolvable Keychron entries route through QMK_KIND.BASIC with
    // the raw 16-bit value preserved so KeychronCodec.decode resolves the
    // canonical id at picker render time and encodeKeycode round-trips it.
    if (entry) {
        return {
            kind: 'qmk:basic',
            params: [keycode],
            label: entry.label,
        }
    }
    return {
        kind: 'qmk:basic',
        params: [keycode],
        label: {
            primary: `0x${keycode.toString(16).toUpperCase()}`,
            description: 'Keychron custom keycode (unknown)',
            bindingPrefix: 'KC',
        },
    }
}
