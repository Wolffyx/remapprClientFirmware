// Pattern check: Strategy (Tier 1) — applied — slot-kind dispatch table replaces displayName switch in renderBinding; one renderer per ActionSlotKind.
//
// Generates a ZMK .keymap devicetree overlay from the neutral Keymap +
// firmware-reported BehaviorMap. Dispatch is slot-driven (using the
// ActionSlot[] returned by behaviorToActionType): the displayName is only
// used to pick the &prefix token via displayNameToBinding. Behavior
// coverage matches https://zmk.dev/docs/keymaps/behaviors.
//
// Shapes handled:
//   []                          -> &prefix                    (&trans, &caps_word, &sys_reset, ...)
//   [hid]                       -> &prefix <key-name>         (&kp, &sk, &kt)
//   [layer]                     -> &prefix <layer-idx>        (&mo, &to, &tog, &sl)
//   [enum]                      -> &prefix <enum-name>        (&out, &rgb_ug, &mkp, &bl, &ext_power)
//   [enum, number]              -> &prefix <enum-name> [n]    (&bt — second arg only when needed)
//   [layer, hid]                -> &prefix <layer> <key>      (&lt)
//   [hid, hid]                  -> &prefix <mod/key> <key>    (&mt)
//   any other                   -> &prefix <p1> <p2>          (raw fallback for unknown firmware shapes)

import type { KeyAction, Keymap, Layer } from '@firmware/types'
import { HID_USAGE_DECODE } from '@firmware/catalog/entries'
import { EXTERNAL_NAMES } from '@firmware/catalog/external-names'
import {
    hidUsageFromPageAndId,
    hidUsagePageAndIdFromUsage,
} from '@firmware/_app/lib/actions/hidUsages'
import type { BehaviorMap } from './actions'
import { zmkBindingFromAction } from './actions'
import { displayNameToBinding } from './displayNameToBinding'
import { behaviorToActionType } from './actionTypes'

export interface ZMKConfigOptions {
    keyboardName: string
    keymapName: string
    includeBehaviors?: boolean
    includeLayers?: boolean
}

const HID_PAGE_KEYBOARD = 0x07
const MOD_HID_LOW = 0xe0
const MOD_HID_HIGH = 0xe7
// ZMK packed encoding: high byte holds modifier-function flags, low 24
// bits hold (page << 16) | id. Matches src/renderer/.../KeycodePickerGrid.tsx.
const MOD_FLAGS_SHIFT = 24
const MOD_FLAGS_MASK = 0xff
const CORE_USAGE_MASK = 0x00ffffff

// ─────────────────────────────────────────────────────────────
// HID lookup — built once at module load from the canonical catalog.
// ─────────────────────────────────────────────────────────────

const HID_USAGE_TO_NAME: Map<number, string> = (() => {
    const m = new Map<number, string>()
    for (const [packed, canonicalId] of HID_USAGE_DECODE) {
        const names = EXTERNAL_NAMES[canonicalId]
        if (names && names.length > 0) {
            // First entry is the canonical ZMK external name (long form).
            m.set(packed, names[0])
        }
    }
    return m
})()

function lookupHidName(page: number, id: number): string {
    const packed = (page << 16) | id
    return HID_USAGE_TO_NAME.get(packed) ?? `UNKNOWN_${packed.toString(16)}`
}

// ─────────────────────────────────────────────────────────────
// Modifier-function rendering — handles &kp LC(LS(A)) and bare modifier keys.
// ─────────────────────────────────────────────────────────────

const MOD_BIT_TO_FUNC: readonly string[] = [
    'LC',
    'LS',
    'LA',
    'LG',
    'RC',
    'RS',
    'RA',
    'RG',
]
const MOD_BIT_TO_FUNC_LONG: readonly string[] = [
    'LCTRL',
    'LSHFT',
    'LALT',
    'LGUI',
    'RCTRL',
    'RSHFT',
    'RALT',
    'RGUI',
]

function renderHidValue(value: number): string {
    const flags = (value >>> MOD_FLAGS_SHIFT) & MOD_FLAGS_MASK
    const core = value & CORE_USAGE_MASK
    const [page, id] = hidUsagePageAndIdFromUsage(core)
    return composeMods(flags, page, id)
}

function composeMods(flags: number, page: number, id: number): string {
    let inner: string
    let remainingFlags = flags
    // Bare modifier keys (HID 7/0xE0..0xE7) without modifier-function flags
    // render as their full name (LCTRL, LSHFT, ...). With flags, the bare
    // mod becomes the innermost name and the flags wrap as LC(...)/LS(...).
    if (page === HID_PAGE_KEYBOARD && id >= MOD_HID_LOW && id <= MOD_HID_HIGH) {
        const bit = id - MOD_HID_LOW
        if (flags === 0) return MOD_BIT_TO_FUNC_LONG[bit]
        inner = MOD_BIT_TO_FUNC_LONG[bit]
    } else {
        inner = lookupHidName(page, id)
    }
    // Wrap from innermost outward. Bit 0 (LC) ends up outermost when present.
    for (let i = 7; i >= 0; i--) {
        const bit = 1 << i
        if (remainingFlags & bit) {
            inner = `${MOD_BIT_TO_FUNC[i]}(${inner})`
            remainingFlags &= ~bit
        }
    }
    return inner
}

// ─────────────────────────────────────────────────────────────
// Slot-driven param renderers.
// ─────────────────────────────────────────────────────────────

interface SlotMeta {
    kind: string
    values?: { value: number; label: string }[]
}

function renderParam(slot: SlotMeta, value: number): string {
    switch (slot.kind) {
        case 'hid':
            return renderHidValue(value)
        case 'modifier':
            // Bitmask of modifier flags (no base key). Compose into
            // LC(LS()...)) wrapping nothing — render as the long mod name
            // when single-bit, otherwise concatenated (e.g. LC(LS)).
            return composeMods(value, 0, 0).replace(/\(\)$/, '')
        case 'layer':
            return String(value)
        case 'number':
            return String(value)
        case 'enum':
            return (
                slot.values?.find((v) => v.value === value)?.label ??
                String(value)
            )
        default:
            return String(value)
    }
}

// ZMK's &bt is the only stock behavior whose second arg is conditional on
// the first arg's enum value. BT_SEL and BT_DISC take a profile index;
// other BT_* commands don't. Without per-enum-value metadata we hardcode
// the allowlist. Other [enum, number] behaviors (none stock today) emit
// both args.
const BT_PREFIXES = new Set(['&bt'])
const BT_TWO_ARG_VALUES = new Set(['BT_SEL', 'BT_DISC'])

function shouldEmitSecondParam(
    prefix: string,
    slots: SlotMeta[],
    p1Token: string,
): boolean {
    if (slots.length !== 2) return slots.length > 1
    if (slots[0].kind === 'enum' && slots[1].kind === 'number') {
        if (BT_PREFIXES.has(prefix)) return BT_TWO_ARG_VALUES.has(p1Token)
        return true
    }
    return true
}

function renderBinding(action: KeyAction, behavior: BehaviorView): string {
    const prefix = displayNameToBinding(behavior.displayName)
    const slots = behavior.slots
    const p1 = action.params[0] ?? 0
    const p2 = action.params[1] ?? 0
    if (slots.length === 0) return prefix
    const p1Token = renderParam(slots[0], p1)
    if (slots.length === 1) return `${prefix} ${p1Token}`
    if (!shouldEmitSecondParam(prefix, slots, p1Token)) {
        return `${prefix} ${p1Token}`
    }
    const p2Token = renderParam(slots[1], p2)
    return `${prefix} ${p1Token} ${p2Token}`
}

// ─────────────────────────────────────────────────────────────
// Behavior view extraction — pulled from BehaviorMap once per binding.
// ─────────────────────────────────────────────────────────────

interface BehaviorView {
    displayName: string
    slots: SlotMeta[]
}

function viewFor(
    behaviorId: number,
    behaviors: BehaviorMap,
): BehaviorView | undefined {
    const b = behaviors[behaviorId]
    if (!b) return undefined
    const at = behaviorToActionType(b)
    return { displayName: b.displayName, slots: at.slots }
}

// ─────────────────────────────────────────────────────────────
// Sensor (encoder) bindings — per-layer, simple shape only.
// ─────────────────────────────────────────────────────────────

function renderSensorBindings(
    layer: Layer,
    behaviors: BehaviorMap,
): string | undefined {
    if (!layer.encoders || layer.encoders.length === 0) return undefined
    const parts: string[] = []
    for (const enc of layer.encoders) {
        const cwBinding = zmkBindingFromAction(enc.cw)
        const ccwBinding = zmkBindingFromAction(enc.ccw)
        const cwView = viewFor(cwBinding.behaviorId, behaviors)
        const ccwView = viewFor(ccwBinding.behaviorId, behaviors)
        // Common case: both directions are &kp <hid> — emit as
        // <&inc_dec_kp ccw_key cw_key>. Otherwise fall back to two raw
        // bindings (still valid devicetree, but firmware needs to support
        // it via separate sensor-rotate behaviors per direction).
        if (
            cwView &&
            ccwView &&
            cwView.slots.length === 1 &&
            cwView.slots[0].kind === 'hid' &&
            ccwView.slots.length === 1 &&
            ccwView.slots[0].kind === 'hid' &&
            displayNameToBinding(cwView.displayName) === '&kp' &&
            displayNameToBinding(ccwView.displayName) === '&kp'
        ) {
            const cwName = renderHidValue(cwBinding.param1)
            const ccwName = renderHidValue(ccwBinding.param1)
            parts.push(`<&inc_dec_kp ${ccwName} ${cwName}>`)
        } else {
            const cwTok = cwView
                ? renderBinding(enc.cw, cwView)
                : `&unknown_${cwBinding.behaviorId}`
            const ccwTok = ccwView
                ? renderBinding(enc.ccw, ccwView)
                : `&unknown_${ccwBinding.behaviorId}`
            parts.push(`<${ccwTok}>, <${cwTok}>`)
        }
    }
    return parts.join(', ')
}

// ─────────────────────────────────────────────────────────────
// Conditional include set — derived from which behaviors actually appear.
// ─────────────────────────────────────────────────────────────

const PREFIX_TO_INCLUDE: Record<string, string> = {
    '&bt': 'dt-bindings/zmk/bt.h',
    '&out': 'dt-bindings/zmk/outputs.h',
    '&rgb_ug': 'dt-bindings/zmk/rgb.h',
    '&bl': 'dt-bindings/zmk/backlight.h',
    '&ext_power': 'dt-bindings/zmk/ext_power.h',
    '&sys_reset': 'dt-bindings/zmk/reset.h',
    '&bootloader': 'dt-bindings/zmk/reset.h',
    '&soft_off': 'dt-bindings/zmk/soft_off.h',
    '&studio_unlock': 'dt-bindings/zmk/studio.h',
    '&mkp': 'dt-bindings/zmk/mouse.h',
    '&mmv': 'dt-bindings/zmk/mouse.h',
    '&msc': 'dt-bindings/zmk/mouse.h',
}

function collectIncludes(
    keymap: Keymap,
    behaviors: BehaviorMap,
): readonly string[] {
    const set = new Set<string>(['behaviors.dtsi', 'dt-bindings/zmk/keys.h'])
    const visit = (action: KeyAction): void => {
        const b = zmkBindingFromAction(action)
        const behavior = behaviors[b.behaviorId]
        if (!behavior) return
        const prefix = displayNameToBinding(behavior.displayName)
        const inc = PREFIX_TO_INCLUDE[prefix]
        if (inc) set.add(inc)
    }
    for (const layer of keymap.layers) {
        for (const k of layer.keys) visit(k)
        if (layer.encoders) {
            for (const e of layer.encoders) {
                visit(e.cw)
                visit(e.ccw)
            }
        }
    }
    return Array.from(set)
}

// ─────────────────────────────────────────────────────────────
// Top-level keymap file generator.
// ─────────────────────────────────────────────────────────────

export function generateZMKKeymapFile(
    keymap: Keymap,
    behaviors: BehaviorMap,
    options: ZMKConfigOptions,
): string {
    const lines: string[] = []
    lines.push(`// Generated ZMK keymap for ${options.keyboardName}`)
    lines.push(`// Keymap: ${options.keymapName}`)
    lines.push('')
    for (const inc of collectIncludes(keymap, behaviors)) {
        lines.push(`#include <${inc}>`)
    }
    lines.push('')

    if (keymap.layers && options.includeLayers) {
        lines.push(`// Layer indices`)
        keymap.layers.forEach((layer, index) => {
            lines.push(`#define L${index} ${layer.id}`)
        })
        lines.push('')
    }

    lines.push('/ {')
    lines.push('    keymap {')
    lines.push('        compatible = "zmk,keymap";')
    lines.push('')
    keymap.layers.forEach((layer, layerIndex) => {
        lines.push(`        layer_${layerIndex} {`)
        lines.push(
            `            label = "${layer.name || `Layer ${layerIndex}`}";`,
        )
        lines.push('            bindings = <')
        layer.keys.forEach((action, keyIndex) => {
            const b = zmkBindingFromAction(action)
            const view = viewFor(b.behaviorId, behaviors)
            if (!view) return
            const token = renderBinding(action, view)
            const sep = keyIndex < layer.keys.length - 1 ? '' : ''
            lines.push(`                ${token}${sep}`)
        })
        lines.push('            >;')
        const sensor = renderSensorBindings(layer, behaviors)
        if (sensor) {
            lines.push(`            sensor-bindings = <${sensor}>;`)
        }
        lines.push('        };')
        if (layerIndex < keymap.layers.length - 1) lines.push('')
    })
    lines.push('    };')
    lines.push('};')
    lines.push('')
    return lines.join('\n')
}

export function generateZMKConfigFile(options: ZMKConfigOptions): string {
    let config = `// Generated ZMK configuration for ${options.keyboardName}\n`
    config += `// Configuration: ${options.keymapName}\n\n`

    config += `// Enable USB logging\n`
    config += `CONFIG_ZMK_USB_LOGGING=y\n\n`

    config += `// Enable Bluetooth\n`
    config += `CONFIG_BT=y\n`
    config += `CONFIG_BT_PERIPHERAL=y\n`
    config += `CONFIG_BT_DEVICE_NAME="${options.keyboardName}"\n\n`

    config += `// Enable battery reporting\n`
    config += `CONFIG_ZMK_BATTERY_REPORTING=y\n`
    config += `CONFIG_ZMK_BATTERY_REPORT_INTERVAL=60000\n\n`

    config += `// Enable RGB underglow (if supported)\n`
    config += `CONFIG_ZMK_RGB_UNDERGLOW=y\n`
    config += `CONFIG_WS2812_STRIP=y\n\n`

    config += `// Enable combos\n`
    config += `CONFIG_ZMK_COMBO_MAX_COMBOS_PER_KEY=6\n`
    config += `CONFIG_ZMK_COMBO_MAX_KEYS_PER_COMBO=4\n\n`

    return config
}

export function downloadConfigFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

export function downloadConfigZip(
    keymapContent: string,
    configContent: string,
    keyboardName: string,
): void {
    downloadConfigFile(keymapContent, `${keyboardName}.keymap`)
    setTimeout(() => {
        downloadConfigFile(configContent, `${keyboardName}.conf`)
    }, 100)
}

// Re-export so external callers can build their own (page,id)→encoded helper
// without re-implementing the bit-shift convention.
export { hidUsageFromPageAndId }
