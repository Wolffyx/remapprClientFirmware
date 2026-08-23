// Pattern check: no GoF pattern (-) — rejected — single concrete inverse mapping
// (ZMK neutral Keymap → canonical remappr config); mirrors configBridge.ts's
// reasoning. Not a swappable family, so no abstraction warranted.
//
// Raises a CONNECTED ZMK device's live keymap into the remappr config (the
// source of truth the download modal compiles per firmware). This is the
// inverse of config/compilers/zmk.ts: each ZMK binding (identified by its
// `&prefix` + params) maps back to a CanonAction. Numeric command constants are
// taken from ZMK's dt-bindings headers so the inverse matches the compiler.
//
// Two things are genuinely unrecoverable over the Studio connection and degrade
// rather than vanish: (1) a custom behavior's BODY — macros/tap-dances expose
// only name + param-arity, so they raise to a reference + a stub definition;
// (2) anything with no canonical equivalent (rgb HSB, undecodable usage) →
// `transparent`. Both are reported as diagnostics; the native exporter still
// ships the full keymap.

import type {
    CanonAction,
    CanonHoldTarget,
    CanonKeyPress,
    CanonMacro,
    ConfigKeymap,
    Modifier,
} from '@firmware/config'
import { MODIFIERS } from '@firmware/config'
import { DiagnosticBag, type Diagnostic } from '@firmware/config'
import { HID_USAGE_DECODE } from '@firmware/catalog/entries'
import type { CanonicalKeyId } from '@firmware/catalog/types'
import type { DeviceInfo, Keymap, KeyAction } from '@firmware/types'
import { KNOWN_BINDING_PREFIXES } from './displayNameToBinding'

/** ZMK packs implicit modifiers into the high byte and (page<<16)|id below it. */
const USAGE_MASK = 0x00ffffff
const decodeUsage = (param: number): CanonicalKeyId | null =>
    HID_USAGE_DECODE.get(param & USAGE_MASK) ?? null

/** HID modifier bitmask (bit i) → Modifier, matching MODIFIERS order. */
const modsFromBitmask = (param: number): Modifier[] => {
    const bits = (param >> 24) & 0xff
    const out: Modifier[] = []
    for (let i = 0; i < 8; i++) if (bits & (1 << i)) out.push(MODIFIERS[i])
    return out
}

/** A `&mt`/`&sk` modifier param carries the HID id 0xe0..0xe7 in its low byte. */
const modFromKeycode = (param: number): Modifier | null => {
    const idx = (param & 0xff) - 0xe0
    return idx >= 0 && idx < 8 ? MODIFIERS[idx] : null
}

const keyPress = (key: CanonicalKeyId, mods?: Modifier[]): CanonKeyPress =>
    mods && mods.length
        ? { type: 'key_press', key, mods }
        : { type: 'key_press', key }

// ZMK numeric command constants, taken verbatim from the dt-bindings headers
// (app/include/dt-bindings/zmk/{bt,outputs,ext_power,backlight,rgb,pointing}.h)
// so the inverse matches the forward compiler exactly.

// bt.h — *_CMD values. BT_SEL (3) carries a profile in param2, handled inline.
const BT_CMD: Record<number, CanonAction> = {
    0: { type: 'output', action: 'bluetooth_clear' }, // BT_CLR_CMD
    1: { type: 'output', action: 'bluetooth_next' }, // BT_NXT_CMD
    2: { type: 'output', action: 'bluetooth_prev' }, // BT_PRV_CMD
    4: { type: 'output', action: 'bluetooth_clear' }, // BT_CLR_ALL_CMD ~ clear
}
// outputs.h — OUT_TOG=0, OUT_USB=1, OUT_BLE=2, OUT_NONE=3.
const OUT_CMD: Record<number, CanonAction> = {
    0: { type: 'output', action: 'toggle' }, // OUT_TOG
    1: { type: 'output', action: 'usb' }, // OUT_USB
    2: { type: 'output', action: 'bluetooth' }, // OUT_BLE
    3: { type: 'output', action: 'none' }, // OUT_NONE
}
// ext_power.h — OFF=0, ON=1, TOGGLE=2.
const EP_CMD: Record<number, CanonAction> = {
    0: { type: 'ext_power', action: 'off' }, // EXT_POWER_OFF_CMD
    1: { type: 'ext_power', action: 'on' }, // EXT_POWER_ON_CMD
    2: { type: 'ext_power', action: 'toggle' }, // EXT_POWER_TOGGLE_CMD
}
// pointing.h — MB* are a bitmask (BIT(0)…BIT(4)).
const MOUSE_BTN: Record<number, CanonAction> = {
    1: { type: 'mouse_key', button: 'left' }, // MB1
    2: { type: 'mouse_key', button: 'right' }, // MB2
    4: { type: 'mouse_key', button: 'middle' }, // MB3
    8: { type: 'mouse_key', button: 'mb4' }, // MB4
    16: { type: 'mouse_key', button: 'mb5' }, // MB5
}
// rgb.h *_CMD → LightingAction (inverse of zmk.ts RGB_UG). HSB/EFS have no canon.
const RGB_CMD: Record<number, CanonAction> = {
    0: { type: 'lighting', target: 'underglow', action: 'toggle' },
    1: { type: 'lighting', target: 'underglow', action: 'on' },
    2: { type: 'lighting', target: 'underglow', action: 'off' },
    3: { type: 'lighting', target: 'underglow', action: 'hue_up' },
    4: { type: 'lighting', target: 'underglow', action: 'hue_down' },
    5: { type: 'lighting', target: 'underglow', action: 'saturation_up' },
    6: { type: 'lighting', target: 'underglow', action: 'saturation_down' },
    7: { type: 'lighting', target: 'underglow', action: 'brightness_up' },
    8: { type: 'lighting', target: 'underglow', action: 'brightness_down' },
    9: { type: 'lighting', target: 'underglow', action: 'speed_up' },
    10: { type: 'lighting', target: 'underglow', action: 'speed_down' },
    11: { type: 'lighting', target: 'underglow', action: 'effect_next' },
    12: { type: 'lighting', target: 'underglow', action: 'effect_previous' },
}
// backlight.h *_CMD → LightingAction (inverse of zmk.ts BL). CYCLE/SET no canon.
const BL_CMD: Record<number, CanonAction> = {
    0: { type: 'lighting', target: 'backlight', action: 'on' }, // BL_ON
    1: { type: 'lighting', target: 'backlight', action: 'off' }, // BL_OFF
    2: { type: 'lighting', target: 'backlight', action: 'toggle' }, // BL_TOG
    3: { type: 'lighting', target: 'backlight', action: 'brightness_up' }, // BL_INC
    4: { type: 'lighting', target: 'backlight', action: 'brightness_down' }, // BL_DEC
    5: { type: 'lighting', target: 'backlight', action: 'cycle' }, // BL_CYCLE
}

// pointing.h MOVE/SCRL pack two int16 as (X << 16) | (Y & 0xFFFF). Direction is
// the dominant nonzero axis. Sign→direction differs by kind: for MOVE +Y is
// down, for SCRL +Y is up (see MOVE_DOWN vs SCRL_UP in the header).
const toInt16 = (v: number): number => (v & 0x8000 ? v - 0x10000 : v)
function moveDirection(
    param: number,
    kind: 'move' | 'scroll',
): 'up' | 'down' | 'left' | 'right' | null {
    const x = toInt16((param >> 16) & 0xffff)
    const y = toInt16(param & 0xffff)
    if (x !== 0 && Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left'
    if (y !== 0) {
        if (kind === 'move') return y > 0 ? 'down' : 'up'
        return y > 0 ? 'up' : 'down'
    }
    return null
}

const TRANSPARENT: CanonAction = { type: 'transparent' }

/**
 * Raise one ZMK neutral KeyAction to a CanonAction. Returns `transparent` and
 * pushes a diagnostic when the binding is unrecognized or not yet modeled, so a
 * lossy position is always visible rather than silently empty.
 */
function raiseBinding(
    ka: KeyAction,
    layerNames: string[],
    diag: DiagnosticBag,
    path: (string | number)[],
    stubs: Map<string, 0 | 1>,
): CanonAction {
    const prefix = ka.label.bindingPrefix ?? ''
    const p1 = ka.params[0] ?? 0
    const p2 = ka.params[1] ?? 0
    const layerName = (idx: number): string | null => layerNames[idx] ?? null

    const unmodeled = (what: string): CanonAction => {
        diag.warn(
            `ZMK binding ${what} is not modeled by the device→config raise yet; raised as transparent`,
            path,
        )
        return TRANSPARENT
    }

    switch (prefix) {
        case '&trans':
            return TRANSPARENT
        case '&none':
            return { type: 'none' }
        case '&caps_word':
            return { type: 'caps_word' }
        case '&key_repeat':
            return { type: 'key_repeat' }
        case '&gresc':
            return { type: 'grave_escape' }
        case '&studio_unlock':
            return { type: 'studio_unlock' }
        case '&soft_off':
            return { type: 'soft_off' }
        case '&sys_reset':
            return { type: 'reset' }
        case '&bootloader':
            return { type: 'bootloader' }
        case '&kp': {
            const key = decodeUsage(p1)
            if (!key) return unmodeled(`&kp 0x${p1.toString(16)}`)
            return keyPress(key, modsFromBitmask(p1))
        }
        case '&kt': {
            const key = decodeUsage(p1)
            return key ? { type: 'key_toggle', key } : unmodeled('&kt')
        }
        case '&sk': {
            const key = decodeUsage(p1)
            return key ? { type: 'sticky_key', key } : unmodeled('&sk')
        }
        case '&mt': {
            const mod = modFromKeycode(p1)
            const key = decodeUsage(p2)
            if (!mod || !key) return unmodeled('&mt')
            const hold: CanonHoldTarget = { type: 'modifier', modifier: mod }
            return {
                type: 'tap_hold',
                tap: keyPress(key),
                hold,
                _preset: 'mod_tap',
            }
        }
        case '&lt': {
            const layer = layerName(p1)
            const key = decodeUsage(p2)
            if (layer === null || !key) return unmodeled('&lt')
            return {
                type: 'tap_hold',
                tap: keyPress(key),
                hold: { type: 'layer', layer },
                _preset: 'layer_tap',
            }
        }
        case '&mo':
        case '&tog':
        case '&to':
        case '&sl': {
            const layer = layerName(p1)
            if (layer === null) return unmodeled(prefix)
            const mode =
                prefix === '&mo'
                    ? 'momentary'
                    : prefix === '&tog'
                      ? 'toggle'
                      : prefix === '&to'
                        ? 'to'
                        : 'sticky'
            return { type: 'layer', mode, layer }
        }
        case '&bt':
            // BT_SEL (3) / BT_DISC (5) select a profile carried in param2.
            if (p1 === 3)
                return { type: 'output', action: 'bluetooth', profile: p2 }
            if (p1 === 5)
                return {
                    type: 'output',
                    action: 'bluetooth_disconnect',
                    profile: p2,
                }
            return BT_CMD[p1] ?? unmodeled(`&bt cmd ${p1}`)
        case '&out':
            return OUT_CMD[p1] ?? unmodeled(`&out cmd ${p1}`)
        case '&ext_power':
            return EP_CMD[p1] ?? unmodeled(`&ext_power cmd ${p1}`)
        case '&rgb_ug':
            return RGB_CMD[p1] ?? unmodeled(`&rgb_ug cmd ${p1}`)
        case '&bl':
            return BL_CMD[p1] ?? unmodeled(`&bl cmd ${p1}`)
        case '&mkp':
            return MOUSE_BTN[p1] ?? unmodeled(`&mkp ${p1}`)
        case '&mmv': {
            const d = moveDirection(p1, 'move')
            return d ? { type: 'mouse_move', direction: d } : unmodeled('&mmv')
        }
        case '&msc': {
            const d = moveDirection(p1, 'scroll')
            return d
                ? { type: 'mouse_scroll', direction: d }
                : unmodeled('&msc')
        }
        default: {
            // A named custom behavior (macro / tap-dance / vendor behavior). ZMK
            // exposes its name + param arity but NOT its definition (steps live
            // in firmware source). Preserve the reference and register a stub so
            // the keymap stays structurally faithful; the user restores the body.
            // Only TRULY custom behaviors stub: a standard ZMK prefix we simply
            // don't model yet (&rgb_ug/&bl/&mmv/&msc/…) stays transparent — never
            // shadow a real behavior with a fake macro node of the same name.
            const ref = prefix.startsWith('&') ? prefix.slice(1) : ''
            if (!ref || KNOWN_BINDING_PREFIXES.includes(prefix)) {
                return unmodeled(prefix || ka.label.primary || 'unknown')
            }
            const parametrized = p1 !== 0
            stubs.set(ref, parametrized ? 1 : 0)
            diag.warn(
                `behavior "&${ref}" definition is not exposed over the ZMK ` +
                    'connection (macros/tap-dances live in firmware source); ' +
                    'raised as a reference with a stub definition — restore its ' +
                    'steps from your board source.',
                path,
            )
            if (parametrized) {
                const param = decodeUsage(p1)
                return param
                    ? { type: 'macro', ref, param }
                    : { type: 'macro', ref }
            }
            return { type: 'macro', ref }
        }
    }
}

export interface RaiseResult {
    config: ConfigKeymap
    diagnostics: Diagnostic[]
}

/**
 * Raise a connected ZMK device's neutral keymap into a canonical remappr config.
 * Geometry comes from the device's active physical layout (ZMK reports centi-key
 * units; config uses key units, so divide by 100). `meta.target` is pinned to
 * 'zmk' since the document originated from a ZMK board.
 */
export function zmkNeutralToConfig(
    keymap: Keymap,
    deviceInfo: DeviceInfo,
): RaiseResult {
    const diag = new DiagnosticBag()

    // Layer references (&to/&mo/&tog/&sl/&lt) are stored BY NAME, so names must
    // be unique and non-empty — else the compiler's name→index map collapses
    // duplicates and every reference resolves to the last layer. A connected
    // ZMK board reports node-label layers as empty display-names, so synthesize
    // `layer_<i>` for blank/duplicate names.
    const used = new Set<string>()
    const layerNames = keymap.layers.map((l, i) => {
        const base = l.name.trim()
        const name = base && !used.has(base) ? base : `layer_${i}`
        used.add(name)
        return name
    })

    // Named custom behaviors (macros/tap-dances) whose body the device can't
    // expose — collected during the raise, emitted as stub definitions below.
    const stubs = new Map<string, 0 | 1>()
    const layers = keymap.layers.map((layer, li) => ({
        name: layerNames[li],
        bindings: layer.keys.map((ka, bi) =>
            raiseBinding(
                ka,
                layerNames,
                diag,
                ['layers', li, 'bindings', bi],
                stubs,
            ),
        ),
    }))

    // One stub macro per referenced custom behavior. A one-param stub forwards
    // its argument (&macro_param_1to1); a zero-param stub carries a TODO text
    // step (compiled to &none + a comment). Steps are unknowable from the device.
    const macros: CanonMacro[] = [...stubs].map(([id, params]) => ({
        id,
        description:
            'Stub — original steps are not recoverable from the device. ' +
            'Restore this macro/behavior from your board source.',
        params,
        steps:
            params === 1
                ? [{ type: 'param' as const }]
                : [
                      {
                          type: 'text' as const,
                          text: 'TODO restore steps from source',
                      },
                  ],
    }))

    // Active physical layout → key geometry. Fall back to an empty layout when
    // the device reports none (config still validates; overlay just has no keys).
    const layout =
        keymap.layouts[keymap.activeLayoutId] ?? keymap.layouts[0] ?? null
    const cu = (n: number): number => n / 100 // centi-units → key units
    const keys = (layout?.keys ?? []).map((k) => ({
        x: cu(k.x),
        y: cu(k.y),
        w: cu(k.w),
        h: cu(k.h),
        r: cu(k.r ?? 0),
        ...(k.rx !== undefined ? { rx: cu(k.rx) } : {}),
        ...(k.ry !== undefined ? { ry: cu(k.ry) } : {}),
    }))

    const name = deviceInfo.name || 'ZMK Keyboard'
    const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')

    const config: ConfigKeymap = {
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: {
            name,
            author: 'remappr (raised from device)',
            target: 'zmk',
        },
        keyboard: { id: id || 'zmk_keyboard', name, keys },
        layers,
        ...(macros.length ? { macros } : {}),
    }

    return { config, diagnostics: [...diag.all] }
}
