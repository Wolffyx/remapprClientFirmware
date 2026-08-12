// Pattern check: no GoF pattern (-) — rejected — pure 16-bit QMK keycode encode/decode + label generation; helper functions only.
// QMK 16-bit keycode encoding/decoding for the action kinds the QMK adapter supports.
// The QK_* range bases are interface facts — the public VIA/QMK keycode numbering
// exchanged over the wire, independently compiled, not copied firmware source.

import { CATALOG } from '@firmware/catalog/entries'
import type { CatalogEntry } from '@firmware/catalog/types'
import type { KeycodeCodec } from '@firmware/codec'
import type { ActionType, KeyAction, KeyLabel } from '@firmware/types'
import { ProtocolError } from '@firmware/errors'

import { QMK_ACTION_TYPES } from './actionTypes'

const CATALOG_BY_ID = new Map(CATALOG.map((e) => [e.id, e]))

// QMK kind ids — match action catalog in actionTypes.ts.
export const QMK_KIND = {
    NONE: 'qmk:none',
    TRANS: 'qmk:trans',
    BASIC: 'qmk:basic',
    MOD_TAP: 'qmk:mod-tap',
    LAYER_TAP: 'qmk:layer-tap',
    MOMENTARY: 'qmk:momentary',
    TOGGLE_LAYER: 'qmk:toggle-layer',
    DEFAULT_LAYER: 'qmk:default-layer',
    PERSISTENT_DEFAULT_LAYER: 'qmk:persistent-default-layer',
    LAYER_MOD: 'qmk:layer-mod',
    ONE_SHOT_LAYER: 'qmk:one-shot-layer',
    ONE_SHOT_MOD: 'qmk:one-shot-mod',
    SWAP_HANDS_TAP: 'qmk:swap-hands-tap',
    TO_LAYER: 'qmk:to-layer',
    TAP_TOGGLE_LAYER: 'qmk:tap-toggle-layer',
} as const

// Quantum keycode range bases (the public QMK quantum keycode numbering).
const QK_BASIC_MAX = 0x00ff
const QK_MOD_TAP = 0x2000
const QK_MOD_TAP_MAX = 0x3fff
const QK_LAYER_TAP = 0x4000
const QK_LAYER_TAP_MAX = 0x4fff
const QK_LAYER_MOD = 0x5000
const QK_LAYER_MOD_MAX = 0x51ff
const QK_TO = 0x5200
const QK_TO_MAX = 0x521f
const QK_MOMENTARY = 0x5220
const QK_MOMENTARY_MAX = 0x523f
const QK_DEF_LAYER = 0x5240
const QK_DEF_LAYER_MAX = 0x525f
const QK_TOGGLE_LAYER = 0x5260
const QK_TOGGLE_LAYER_MAX = 0x527f
const QK_ONE_SHOT_LAYER = 0x5280
const QK_ONE_SHOT_LAYER_MAX = 0x529f
const QK_ONE_SHOT_MOD = 0x52a0
const QK_ONE_SHOT_MOD_MAX = 0x52bf
const QK_LAYER_TAP_TOGGLE = 0x52c0
const QK_LAYER_TAP_TOGGLE_MAX = 0x52df
const QK_PERSISTENT_DEF_LAYER = 0x52e0
const QK_PERSISTENT_DEF_LAYER_MAX = 0x52ff
const QK_SWAP_HANDS = 0x5600
const QK_SWAP_HANDS_MAX = 0x56ff

// Modifier mask bits (5-bit packed: lower 4 = mod, bit 4 = isRight).
// VIA mod params we expose match QMK's MOD_BIT() values: 0x01..0x80.
const MOD_BIT_TO_PACKED: Record<number, number> = {
    0x01: 0b00001, // LCTRL
    0x02: 0b00010, // LSHIFT
    0x04: 0b00100, // LALT
    0x08: 0b01000, // LGUI
    0x10: 0b10001, // RCTRL
    0x20: 0b10010, // RSHIFT
    0x40: 0b10100, // RALT
    0x80: 0b11000, // RGUI
}

const PACKED_TO_MOD_BIT: Record<number, number> = Object.fromEntries(
    Object.entries(MOD_BIT_TO_PACKED).map(([k, v]) => [v, Number(k)]),
)

const BASIC_KEY_NAMES: Record<number, string> = {
    0x00: 'KC_NO',
    0x29: 'Esc',
    0x2a: 'Bspc',
    0x2b: 'Tab',
    0x2c: 'Space',
    0x28: 'Enter',
    0x4c: 'Del',
    0x39: 'Caps',
    0x4f: '→',
    0x50: '←',
    0x51: '↓',
    0x52: '↑',
    0x36: ',',
    0x37: '.',
    0x38: '/',
    0x33: ';',
    0x34: "'",
    0x35: '`',
    0x2d: '-',
    0x2e: '=',
    0x2f: '[',
    0x30: ']',
    0x31: '\\',
}

const MOD_LABELS: Record<number, string> = {
    0x01: 'LCtrl',
    0x02: 'LShift',
    0x04: 'LAlt',
    0x08: 'LGui',
    0x10: 'RCtrl',
    0x20: 'RShift',
    0x40: 'RAlt',
    0x80: 'RGui',
}

function basicKeyLabel(code: number): string {
    if (code === 0) return 'No'
    const named = BASIC_KEY_NAMES[code]
    if (named) return named
    if (code >= 0x04 && code <= 0x1d) {
        return String.fromCharCode('A'.charCodeAt(0) + (code - 0x04))
    }
    if (code === 0x27) return '0'
    if (code >= 0x1e && code <= 0x26) {
        return String.fromCharCode('1'.charCodeAt(0) + (code - 0x1e))
    }
    if (code >= 0x3a && code <= 0x45) {
        return `F${code - 0x39}`
    }
    return `0x${code.toString(16).padStart(2, '0')}`
}

function modLabel(modBit: number): string {
    return MOD_LABELS[modBit] ?? `mod 0x${modBit.toString(16)}`
}

function layerName(layer: number, layerNames?: string[]): string {
    if (layerNames && layerNames[layer]) return layerNames[layer]
    return `L${layer}`
}

// KeyLabel slot contract (see src/firmware/labels.ts): `primary` is the
// action-type tag rendered in the cap *header*; the value glyph belongs in
// `primaryUsage` / `paramText` / `paramParts` and renders as the key legend.
// Keep them apart — a value left in `primary` shows up as a header tag on an
// otherwise blank cap face.
const KIND_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
    QMK_ACTION_TYPES.map((t) => [t.id, t.displayName]),
)

const kindName = (kind: string): string => KIND_DISPLAY_NAME[kind] ?? kind

// HID Keyboard/Keypad usage page — QMK basic keycodes ARE page-7 usage ids, so
// page-encode them ((page << 16) | id) the way the renderer's usage tables
// expect instead of passing the raw 8-bit code (which resolved to page 0 and
// rendered nothing).
const HID_KEYBOARD_PAGE = 0x07

// ---- Binding codes (KeyLabel.bindingPrefix) ------------------------------
// The cap's "Binding code" display mode shows `bindingPrefix` — the token a
// user would write in their keymap. For QMK that's the symbolic keycode
// (KC_Q, MO(3), MT(KC_LSFT, KC_A)); the keymap.c emitter renders the same
// tokens, so both read off these helpers.

const QMK_BASIC_CODE_NAMES: Record<number, string> = {
    0x00: 'KC_NO',
    0x28: 'KC_ENT',
    0x29: 'KC_ESC',
    0x2a: 'KC_BSPC',
    0x2b: 'KC_TAB',
    0x2c: 'KC_SPC',
    0x2d: 'KC_MINS',
    0x2e: 'KC_EQL',
    0x2f: 'KC_LBRC',
    0x30: 'KC_RBRC',
    0x31: 'KC_BSLS',
    0x33: 'KC_SCLN',
    0x34: 'KC_QUOT',
    0x35: 'KC_GRV',
    0x36: 'KC_COMM',
    0x37: 'KC_DOT',
    0x38: 'KC_SLSH',
    0x39: 'KC_CAPS',
    0x4c: 'KC_DEL',
    0x4f: 'KC_RGHT',
    0x50: 'KC_LEFT',
    0x51: 'KC_DOWN',
    0x52: 'KC_UP',
}

const QMK_MOD_CODE_NAMES: Record<number, string> = {
    0x01: 'KC_LCTL',
    0x02: 'KC_LSFT',
    0x04: 'KC_LALT',
    0x08: 'KC_LGUI',
    0x10: 'KC_RCTL',
    0x20: 'KC_RSFT',
    0x40: 'KC_RALT',
    0x80: 'KC_RGUI',
}

// Keychron vendor range — QK_KB_0 … QK_KB_31 arrive as BASIC keycodes.
const QK_KB_BASE = 0x7e00
const QK_KB_END = 0x7e1f

export function qmkBasicCodeName(code: number): string {
    const named = QMK_BASIC_CODE_NAMES[code]
    if (named) return named
    if (code >= 0x04 && code <= 0x1d) {
        return `KC_${String.fromCharCode('A'.charCodeAt(0) + (code - 0x04))}`
    }
    if (code >= 0x1e && code <= 0x26) return `KC_${code - 0x1d}`
    if (code === 0x27) return 'KC_0'
    if (code >= 0x3a && code <= 0x45) return `KC_F${code - 0x39}`
    if (code >= QK_KB_BASE && code <= QK_KB_END) {
        return `QK_KB_${code - QK_KB_BASE}`
    }
    return `0x${code.toString(16).padStart(4, '0').toUpperCase()}`
}

export function qmkModCodeName(modBit: number): string {
    return QMK_MOD_CODE_NAMES[modBit] ?? `0x${modBit.toString(16)}`
}

/** Symbolic QMK keycode for a kind + params, e.g. `MO(3)` / `KC_Q`. */
export function qmkBindingCode(kind: string, params: number[]): string {
    const p = params
    switch (kind) {
        case QMK_KIND.NONE:
            return 'KC_NO'
        case QMK_KIND.TRANS:
            return 'KC_TRNS'
        case QMK_KIND.BASIC:
            return qmkBasicCodeName(p[0] ?? 0)
        case QMK_KIND.MOD_TAP:
            return `MT(${qmkModCodeName(p[0] ?? 0)}, ${qmkBasicCodeName(p[1] ?? 0)})`
        case QMK_KIND.LAYER_TAP:
            return `LT(${p[0] ?? 0}, ${qmkBasicCodeName(p[1] ?? 0)})`
        case QMK_KIND.LAYER_MOD:
            return `LM(${p[0] ?? 0}, ${qmkModCodeName(p[1] ?? 0)})`
        case QMK_KIND.MOMENTARY:
            return `MO(${p[0] ?? 0})`
        case QMK_KIND.TOGGLE_LAYER:
            return `TG(${p[0] ?? 0})`
        case QMK_KIND.TO_LAYER:
            return `TO(${p[0] ?? 0})`
        case QMK_KIND.DEFAULT_LAYER:
            return `DF(${p[0] ?? 0})`
        case QMK_KIND.PERSISTENT_DEFAULT_LAYER:
            return `PDF(${p[0] ?? 0})`
        case QMK_KIND.ONE_SHOT_LAYER:
            return `OSL(${p[0] ?? 0})`
        case QMK_KIND.ONE_SHOT_MOD:
            return `OSM(${qmkModCodeName(p[0] ?? 0)})`
        case QMK_KIND.TAP_TOGGLE_LAYER:
            return `TT(${p[0] ?? 0})`
        case QMK_KIND.SWAP_HANDS_TAP:
            return `SH_T(${qmkBasicCodeName(p[0] ?? 0)})`
        default:
            return kind
    }
}

export function buildLabel(
    kind: string,
    params: number[],
    layerNames?: string[],
): KeyLabel {
    return {
        ...buildValueLabel(kind, params, layerNames),
        bindingPrefix: qmkBindingCode(kind, params),
    }
}

function buildValueLabel(
    kind: string,
    params: number[],
    layerNames?: string[],
): KeyLabel {
    switch (kind) {
        case QMK_KIND.NONE:
            return { primary: kindName(kind), description: 'KC_NO' }
        case QMK_KIND.TRANS:
            return {
                primary: kindName(kind),
                paramText: '▽',
                description: 'Transparent (KC_TRNS)',
            }
        case QMK_KIND.BASIC: {
            const code = params[0] ?? 0
            const text = basicKeyLabel(code)
            return {
                primary: kindName(kind),
                ...(code > 0 && code <= 0xff
                    ? { primaryUsage: (HID_KEYBOARD_PAGE << 16) | code }
                    : {}),
                paramText: text,
                valueLong: text,
                description: `Basic 0x${code.toString(16).padStart(2, '0')}`,
            }
        }
        case QMK_KIND.MOD_TAP: {
            const mod = params[0] ?? 0
            const tap = params[1] ?? 0
            return {
                primary: kindName(kind),
                paramText: basicKeyLabel(tap),
                valueLong: basicKeyLabel(tap),
                secondary: modLabel(mod),
                description: `MT(${modLabel(mod)}, ${basicKeyLabel(tap)})`,
            }
        }
        case QMK_KIND.LAYER_TAP: {
            const layer = params[0] ?? 0
            const tap = params[1] ?? 0
            return {
                primary: kindName(kind),
                paramText: basicKeyLabel(tap),
                valueLong: basicKeyLabel(tap),
                secondary: layerName(layer, layerNames),
                description: `LT(${layerName(layer, layerNames)}, ${basicKeyLabel(tap)})`,
            }
        }
        case QMK_KIND.MOMENTARY: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `MO(${layer})`,
            }
        }
        case QMK_KIND.TOGGLE_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `TG(${layer})`,
            }
        }
        case QMK_KIND.DEFAULT_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `DF(${layer})`,
            }
        }
        case QMK_KIND.PERSISTENT_DEFAULT_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `PDF(${layer})`,
            }
        }
        case QMK_KIND.LAYER_MOD: {
            const layer = params[0] ?? 0
            const mod = params[1] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                secondary: modLabel(mod),
                description: `LM(${layer}, ${modLabel(mod)})`,
            }
        }
        case QMK_KIND.ONE_SHOT_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `OSL(${layer})`,
            }
        }
        case QMK_KIND.ONE_SHOT_MOD: {
            const mod = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: modLabel(mod),
                valueLong: modLabel(mod),
                description: `OSM(${modLabel(mod)})`,
            }
        }
        case QMK_KIND.SWAP_HANDS_TAP: {
            const tap = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: basicKeyLabel(tap),
                valueLong: basicKeyLabel(tap),
                secondary: 'SH',
                description: `SH_T(${basicKeyLabel(tap)})`,
            }
        }
        case QMK_KIND.TO_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `TO(${layer})`,
            }
        }
        case QMK_KIND.TAP_TOGGLE_LAYER: {
            const layer = params[0] ?? 0
            return {
                primary: kindName(kind),
                paramText: layerName(layer, layerNames),
                valueLong: layerName(layer, layerNames),
                description: `TT(${layer})`,
            }
        }
        default:
            return { primary: kindName(kind) }
    }
}

// Header tag for a catalog-resolved keycode, keyed off the canonical id's
// domain — a wireless/system keycode routed through QMK_KIND.BASIC is not a
// "Key Press" and should not be tagged as one.
const DOMAIN_HEADER: Record<string, string> = {
    key: 'Key Press',
    mod: 'Key Press',
    media: 'Media',
    consumer: 'Media',
    os: 'System',
    system: 'System',
    wireless: 'Wireless',
    mouse: 'Mouse',
    light: 'Lighting',
    rgb: 'Lighting',
    backlight: 'Lighting',
    macro: 'Macro',
    combo: 'Combo',
}

// Catalog entry → cap legend (`paramText`), keeping the action-type tag in the
// header slot. Preserves any `paramParts` icon legend already on the label.
function withCatalogLabel(label: KeyLabel, entry: CatalogEntry): KeyLabel {
    // Keycodes outside the symbolic table fall back to a raw 0xNNNN literal —
    // prefer the entry's QMK spelling (KC_*/QK_*) from external-names when it
    // has one, so binding-code mode shows a real token.
    const alias =
        label.bindingPrefix?.startsWith('0x') === true
            ? entry.aliases?.find((a) => /^(KC_|QK_)/.test(a))
            : undefined
    return {
        ...label,
        primary: DOMAIN_HEADER[entry.id.split('.')[0]] ?? label.primary,
        ...(alias ? { bindingPrefix: alias } : {}),
        paramText: entry.label,
        valueLong: entry.name,
        description: entry.name,
    }
}

export function buildQmkKeyAction(
    kind: string,
    params: number[],
    layerNames?: string[],
    codec?: KeycodeCodec,
): KeyAction {
    const action: KeyAction = {
        kind,
        params: [...params],
        label: buildLabel(kind, params, layerNames),
    }
    if (codec && kind === QMK_KIND.BASIC) {
        const decoded = codec.decode(params[0] ?? 0)
        if (decoded) {
            action.canonicalId = decoded.canonicalId
            const entry = CATALOG_BY_ID.get(decoded.canonicalId)
            if (entry) {
                action.label = withCatalogLabel(action.label, entry)
            }
        }
    }
    return action
}

// Encode a neutral KeyAction → 16-bit QMK keycode.
export function encodeKeycode(action: KeyAction): number {
    const p = action.params
    switch (action.kind) {
        case QMK_KIND.NONE:
            return 0x0000
        case QMK_KIND.TRANS:
            return 0x0001
        case QMK_KIND.BASIC:
            // Widened to 16-bit so cross-firmware catalog values (Keychron
            // QK_KB 0x7E00..1F, Vial macros 0x7700..7F, etc.) round-trip
            // losslessly when the codec encoded them.
            return (p[0] ?? 0) & 0xffff
        case QMK_KIND.MOD_TAP: {
            const modBit = p[0] ?? 0
            const packed = MOD_BIT_TO_PACKED[modBit] ?? 0
            const tap = (p[1] ?? 0) & 0xff
            return QK_MOD_TAP | (packed << 8) | tap
        }
        case QMK_KIND.LAYER_TAP: {
            const layer = (p[0] ?? 0) & 0x0f
            const tap = (p[1] ?? 0) & 0xff
            return QK_LAYER_TAP | (layer << 8) | tap
        }
        case QMK_KIND.LAYER_MOD: {
            const layer = (p[0] ?? 0) & 0x0f
            const modBit = p[1] ?? 0
            const packed = MOD_BIT_TO_PACKED[modBit] ?? 0
            return QK_LAYER_MOD | (layer << 5) | (packed & 0x1f)
        }
        case QMK_KIND.TO_LAYER:
            return QK_TO | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.MOMENTARY:
            return QK_MOMENTARY | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.DEFAULT_LAYER:
            return QK_DEF_LAYER | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.TOGGLE_LAYER:
            return QK_TOGGLE_LAYER | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.ONE_SHOT_LAYER:
            return QK_ONE_SHOT_LAYER | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.ONE_SHOT_MOD: {
            const packed = MOD_BIT_TO_PACKED[p[0] ?? 0] ?? 0
            return QK_ONE_SHOT_MOD | (packed & 0x1f)
        }
        case QMK_KIND.TAP_TOGGLE_LAYER:
            return QK_LAYER_TAP_TOGGLE | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.PERSISTENT_DEFAULT_LAYER:
            return QK_PERSISTENT_DEF_LAYER | ((p[0] ?? 0) & 0x1f)
        case QMK_KIND.SWAP_HANDS_TAP:
            return QK_SWAP_HANDS | ((p[0] ?? 0) & 0xff)
        default:
            throw new ProtocolError(
                `qmk encode: unsupported kind ${action.kind}`,
            )
    }
}

export interface DecodedKeycode {
    kind: string
    params: number[]
}

// Decode a 16-bit QMK keycode → neutral kind + params.
export function decodeKeycode(kc: number): DecodedKeycode {
    const code = kc & 0xffff
    if (code === 0x0000) return { kind: QMK_KIND.NONE, params: [] }
    if (code === 0x0001) return { kind: QMK_KIND.TRANS, params: [] }
    if (code <= QK_BASIC_MAX) {
        return { kind: QMK_KIND.BASIC, params: [code] }
    }
    if (code >= QK_MOD_TAP && code <= QK_MOD_TAP_MAX) {
        const packed = (code >> 8) & 0x1f
        const modBit = PACKED_TO_MOD_BIT[packed] ?? 0
        return { kind: QMK_KIND.MOD_TAP, params: [modBit, code & 0xff] }
    }
    if (code >= QK_LAYER_TAP && code <= QK_LAYER_TAP_MAX) {
        const layer = (code >> 8) & 0x0f
        return { kind: QMK_KIND.LAYER_TAP, params: [layer, code & 0xff] }
    }
    if (code >= QK_LAYER_MOD && code <= QK_LAYER_MOD_MAX) {
        const layer = (code >> 5) & 0x0f
        const packed = code & 0x1f
        const modBit = PACKED_TO_MOD_BIT[packed] ?? 0
        return { kind: QMK_KIND.LAYER_MOD, params: [layer, modBit] }
    }
    if (code >= QK_TO && code <= QK_TO_MAX) {
        return { kind: QMK_KIND.TO_LAYER, params: [code & 0x1f] }
    }
    if (code >= QK_MOMENTARY && code <= QK_MOMENTARY_MAX) {
        return { kind: QMK_KIND.MOMENTARY, params: [code & 0x1f] }
    }
    if (code >= QK_DEF_LAYER && code <= QK_DEF_LAYER_MAX) {
        return { kind: QMK_KIND.DEFAULT_LAYER, params: [code & 0x1f] }
    }
    if (code >= QK_TOGGLE_LAYER && code <= QK_TOGGLE_LAYER_MAX) {
        return { kind: QMK_KIND.TOGGLE_LAYER, params: [code & 0x1f] }
    }
    if (code >= QK_ONE_SHOT_LAYER && code <= QK_ONE_SHOT_LAYER_MAX) {
        return { kind: QMK_KIND.ONE_SHOT_LAYER, params: [code & 0x1f] }
    }
    if (code >= QK_ONE_SHOT_MOD && code <= QK_ONE_SHOT_MOD_MAX) {
        const packed = code & 0x1f
        const modBit = PACKED_TO_MOD_BIT[packed] ?? 0
        return { kind: QMK_KIND.ONE_SHOT_MOD, params: [modBit] }
    }
    if (code >= QK_LAYER_TAP_TOGGLE && code <= QK_LAYER_TAP_TOGGLE_MAX) {
        return { kind: QMK_KIND.TAP_TOGGLE_LAYER, params: [code & 0x1f] }
    }
    if (
        code >= QK_PERSISTENT_DEF_LAYER &&
        code <= QK_PERSISTENT_DEF_LAYER_MAX
    ) {
        return {
            kind: QMK_KIND.PERSISTENT_DEFAULT_LAYER,
            params: [code & 0x1f],
        }
    }
    if (code >= QK_SWAP_HANDS && code <= QK_SWAP_HANDS_MAX) {
        // Parameterless aliases (SH_TOGG..SH_OS) occupy 0x56F0..0x56F6;
        // surface as BASIC so the codec maps them to swap_hands.* tiles.
        if (code >= 0x56f0 && code <= 0x56f6) {
            return { kind: QMK_KIND.BASIC, params: [code] }
        }
        return { kind: QMK_KIND.SWAP_HANDS_TAP, params: [code & 0xff] }
    }
    // Fallback: treat as raw basic; loses fidelity but never throws.
    return { kind: QMK_KIND.BASIC, params: [code & 0xff] }
}

export function decodeAsKeyAction(
    kc: number,
    layerNames?: string[],
    codec?: KeycodeCodec,
): KeyAction {
    const { kind, params } = decodeKeycode(kc)
    return buildQmkKeyAction(kind, params, layerNames, codec)
}

export function relabelQmkLayer(
    keys: KeyAction[],
    layerNames: string[],
    codec?: KeycodeCodec,
): KeyAction[] {
    return keys.map((k) => {
        const label = buildLabel(k.kind, k.params, layerNames)
        if (codec && k.kind === QMK_KIND.BASIC) {
            const decoded = codec.decode(k.params[0] ?? 0)
            const entry = decoded
                ? CATALOG_BY_ID.get(decoded.canonicalId)
                : undefined
            if (entry) {
                return {
                    ...k,
                    canonicalId: decoded!.canonicalId,
                    label: withCatalogLabel(label, entry),
                }
            }
        }
        return { ...k, label }
    })
}

export function getActionTypes(): ActionType[] {
    return QMK_ACTION_TYPES
}
