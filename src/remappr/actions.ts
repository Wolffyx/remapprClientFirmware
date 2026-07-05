// pattern-check: skip — neutral action catalog for the remappr adapter (mirror
// src/mock/actions.ts). Pure data + label builders, no behavior abstraction.
//
// The live Remappr blob represents far more than these six kinds, but the editor
// runtime models the same compact set the mock does (key / mod-tap / layer-tap /
// momentary / toggle / transparent). Richer canonical actions lower to
// transparent for display and survive in the config across a raise (configBridge).
import type { ActionType, KeyAction, KeyLabel } from '../types'

export const REMAPPR_KIND_TRANSPARENT = 'remappr:trans'
export const REMAPPR_KIND_KEYPRESS = 'remappr:kp'
export const REMAPPR_KIND_LAYER_MOMENTARY = 'remappr:mo'
export const REMAPPR_KIND_LAYER_TOGGLE = 'remappr:tog'
export const REMAPPR_KIND_MOD_TAP = 'remappr:mt'
export const REMAPPR_KIND_LAYER_TAP = 'remappr:lt'
// Composite references (§24). params[0] = the pool index; the display name is
// threaded in as `displayName` and preserved across relabel via label.secondary.
// Step/slot editing happens in the Macros / Tap-Dance tabs, not the key grid.
export const REMAPPR_KIND_MACRO = 'remappr:macro'
export const REMAPPR_KIND_TAP_DANCE = 'remappr:td'
export const REMAPPR_KIND_MOD_MORPH = 'remappr:mm'

// Renderer (`HidUsageLabel`, `KeycodePickerGrid`) consumes ZMK-style encoded
// usages: (page << 16) | id. Keep the adapter on the same encoding so the picker
// and label resolution work without a translation layer.
const HID_PAGE_KEYBOARD = 0x07
export const encodeHidUsage = (page: number, id: number): number =>
    (page << 16) | id
export const HID_KP = (id: number): number =>
    encodeHidUsage(HID_PAGE_KEYBOARD, id)

const HID_VALUES = (): { value: number; label: string }[] => {
    const out: { value: number; label: string }[] = []
    // A..Z (HID usage 0x04..0x1D)
    for (let i = 0; i < 26; i++) {
        out.push({ value: HID_KP(0x04 + i), label: String.fromCharCode(65 + i) })
    }
    // 1..0 (HID usage 0x1E..0x27)
    const digits = '1234567890'
    for (let i = 0; i < digits.length; i++) {
        out.push({ value: HID_KP(0x1e + i), label: digits[i] })
    }
    out.push({ value: HID_KP(0x28), label: 'Enter' })
    out.push({ value: HID_KP(0x29), label: 'Esc' })
    out.push({ value: HID_KP(0x2a), label: 'Backspace' })
    out.push({ value: HID_KP(0x2b), label: 'Tab' })
    out.push({ value: HID_KP(0x2c), label: 'Space' })
    out.push({ value: HID_KP(0x2d), label: '-' })
    out.push({ value: HID_KP(0x2e), label: '=' })
    out.push({ value: HID_KP(0x2f), label: '[' })
    out.push({ value: HID_KP(0x30), label: ']' })
    out.push({ value: HID_KP(0x31), label: '\\' })
    out.push({ value: HID_KP(0x33), label: ';' })
    out.push({ value: HID_KP(0x34), label: "'" })
    out.push({ value: HID_KP(0x35), label: '`' })
    out.push({ value: HID_KP(0x36), label: ',' })
    out.push({ value: HID_KP(0x37), label: '.' })
    out.push({ value: HID_KP(0x38), label: '/' })
    out.push({ value: HID_KP(0x39), label: 'CapsLk' })
    for (let i = 0; i < 12; i++) {
        out.push({ value: HID_KP(0x3a + i), label: `F${i + 1}` })
    }
    out.push({ value: HID_KP(0x4c), label: 'Del' })
    out.push({ value: HID_KP(0x4f), label: '→' })
    out.push({ value: HID_KP(0x50), label: '←' })
    out.push({ value: HID_KP(0x51), label: '↓' })
    out.push({ value: HID_KP(0x52), label: '↑' })
    return out
}

// pattern-check: skip — mechanical revert of the enum-slot experiment back to the
// original bare ActionType factory (named-macro picking moves to the Macros tab).
export function buildRemapprActionTypes(maxLayers: number): ActionType[] {
    return [
        {
            id: REMAPPR_KIND_TRANSPARENT,
            displayName: 'Transparent',
            description: 'Pass-through to lower layer',
            slots: [],
        },
        {
            id: REMAPPR_KIND_KEYPRESS,
            displayName: 'Key Press',
            description: 'Send a HID keycode',
            slots: [{ label: 'Key', kind: 'hid', values: HID_VALUES() }],
        },
        {
            id: REMAPPR_KIND_LAYER_MOMENTARY,
            displayName: 'Momentary Layer',
            description: 'Activate layer while held',
            slots: [
                {
                    label: 'Layer',
                    kind: 'layer',
                    range: { min: 0, max: maxLayers - 1 },
                },
            ],
        },
        {
            id: REMAPPR_KIND_LAYER_TOGGLE,
            displayName: 'Toggle Layer',
            description: 'Toggle layer on/off',
            slots: [
                {
                    label: 'Layer',
                    kind: 'layer',
                    range: { min: 0, max: maxLayers - 1 },
                },
            ],
        },
        {
            id: REMAPPR_KIND_MOD_TAP,
            displayName: 'Mod-Tap',
            description: 'Tap for the key, hold for a modifier',
            slots: [
                { label: 'Tap', kind: 'hid', values: HID_VALUES() },
                { label: 'Hold', kind: 'modifier', values: MOD_USAGES },
            ],
        },
        {
            id: REMAPPR_KIND_LAYER_TAP,
            displayName: 'Layer-Tap',
            description: 'Tap for the key, hold to activate a layer',
            slots: [
                { label: 'Tap', kind: 'hid', values: HID_VALUES() },
                {
                    label: 'Hold',
                    kind: 'layer',
                    range: { min: 0, max: maxLayers - 1 },
                },
            ],
        },
        // Composite references (§24): no inline slots — the key just points at a
        // macro / tap-dance / mod-morph defined in its own tab. Listed so the
        // editor recognises the kind and renders its label.
        {
            id: REMAPPR_KIND_MACRO,
            displayName: 'Macro',
            description: 'Play a macro (edit steps in the Macros tab)',
            slots: [],
        },
        {
            id: REMAPPR_KIND_TAP_DANCE,
            displayName: 'Tap Dance',
            description: 'Tap-count behavior (edit in the Tap Dance tab)',
            slots: [],
        },
        {
            id: REMAPPR_KIND_MOD_MORPH,
            displayName: 'Mod Morph',
            description: 'Morphs under held modifiers (read-only)',
            slots: [],
        },
    ]
}

const HID_LABELS = new Map<number, string>(
    HID_VALUES().map((v) => [v.value, v.label]),
)

// Modifier choices for the Mod-Tap hold slot (left-hand variants), stored as
// encoded HID usages so the renderer's HidUsageLabel can draw the hold glyph.
export const MOD_USAGES: { value: number; label: string }[] = [
    { value: HID_KP(0xe0), label: 'Ctrl' },
    { value: HID_KP(0xe1), label: 'Shift' },
    { value: HID_KP(0xe2), label: 'Alt' },
    { value: HID_KP(0xe3), label: 'Gui' },
]
const MOD_LABELS = new Map<number, string>(
    MOD_USAGES.map((m) => [m.value, m.label]),
)

const encodeUsage = (raw: number): number => (raw >= 1 << 16 ? raw : HID_KP(raw))
const usageDesc = (encoded: number): string =>
    MOD_LABELS.get(encoded) ??
    HID_LABELS.get(encoded) ??
    `0x${encoded.toString(16)}`

function labelFor(
    kind: string,
    params: number[],
    layerNames: string[],
    modifiers?: string,
    displayName?: string,
): KeyLabel {
    if (kind === REMAPPR_KIND_TRANSPARENT) {
        return { primary: 'Transparent', bindingPrefix: 'trans' }
    }
    if (kind === REMAPPR_KIND_KEYPRESS) {
        const raw = params[0] ?? 0
        const encoded = raw >= 1 << 16 ? raw : HID_KP(raw)
        return {
            primary: 'Key Press',
            primaryUsage: encoded,
            ...(modifiers ? { modifiers } : {}),
            bindingPrefix: 'kp',
            description: HID_LABELS.get(encoded) ?? `0x${encoded.toString(16)}`,
        }
    }
    if (kind === REMAPPR_KIND_LAYER_MOMENTARY) {
        const layer = params[0] ?? 0
        const name = layerNames[layer] ?? `L${layer}`
        return {
            primary: 'Momentary Layer',
            secondary: name,
            paramText: name,
            bindingPrefix: 'mo',
        }
    }
    if (kind === REMAPPR_KIND_LAYER_TOGGLE) {
        const layer = params[0] ?? 0
        const name = layerNames[layer] ?? `L${layer}`
        return {
            primary: 'Toggle Layer',
            secondary: name,
            paramText: name,
            bindingPrefix: 'tog',
        }
    }
    if (kind === REMAPPR_KIND_MOD_TAP) {
        const tapParam = encodeUsage(params[0] ?? 0)
        const holdParam = encodeUsage(params[1] ?? HID_KP(0xe0))
        const tapDesc = HID_LABELS.get(tapParam) ?? `0x${tapParam.toString(16)}`
        const holdDesc = usageDesc(holdParam)
        const tooltip = `Mod-Tap\nTap: ${tapDesc}\nHold: ${holdDesc}`
        return {
            primary: 'Mod-Tap',
            bindingPrefix: '&mt',
            description: tooltip,
            holdTap: {
                actionTypeName: 'Mod-Tap',
                actionLabel: '&mt',
                tapParam,
                tapDesc,
                holdNodeKind: 'usage',
                holdParam,
                holdUsageDesc: holdDesc,
                tooltip,
            },
        }
    }
    if (kind === REMAPPR_KIND_LAYER_TAP) {
        const tapParam = encodeUsage(params[0] ?? 0)
        const layer = params[1] ?? 0
        const tapDesc = HID_LABELS.get(tapParam) ?? `0x${tapParam.toString(16)}`
        const layerName = layerNames[layer]
        const holdDesc = layerName ?? `L${layer}`
        const tooltip = `Layer-Tap\nTap: ${tapDesc}\nHold: ${holdDesc}`
        return {
            primary: 'Layer-Tap',
            bindingPrefix: '&lt',
            description: tooltip,
            holdTap: {
                actionTypeName: 'Layer-Tap',
                actionLabel: '&lt',
                tapParam,
                tapDesc,
                holdNodeKind: 'layer',
                holdParam: layer,
                holdLayerName: layerName,
                holdLayerMomentary: holdDesc,
                holdLayerLabel: holdDesc,
                tooltip,
            },
        }
    }
    if (
        kind === REMAPPR_KIND_MACRO ||
        kind === REMAPPR_KIND_TAP_DANCE ||
        kind === REMAPPR_KIND_MOD_MORPH
    ) {
        const primary =
            kind === REMAPPR_KIND_MACRO
                ? 'Macro'
                : kind === REMAPPR_KIND_TAP_DANCE
                  ? 'Tap Dance'
                  : 'Mod Morph'
        const prefix =
            kind === REMAPPR_KIND_MACRO
                ? 'macro'
                : kind === REMAPPR_KIND_TAP_DANCE
                  ? 'td'
                  : 'mm'
        const name = displayName ?? `#${params[0] ?? 0}`
        return {
            primary,
            secondary: name,
            bindingPrefix: prefix,
            description: `${primary}: ${name}`,
        }
    }
    return { primary: '?' }
}

export function buildRemapprKeyAction(
    kind: string,
    params: number[],
    layerNames: string[] = [],
    modifiers?: string,
    displayName?: string,
): KeyAction {
    return {
        kind,
        params: [...params],
        label: labelFor(kind, params, layerNames, modifiers, displayName),
    }
}

export function relabelLayer(
    keys: KeyAction[],
    layerNames: string[],
): KeyAction[] {
    return keys.map((k) =>
        buildRemapprKeyAction(
            k.kind,
            k.params,
            layerNames,
            k.label.modifiers,
            // Preserve a composite's resolved name (§24) across relabel — it's
            // not derivable from kind+params alone.
            k.label.secondary,
        ),
    )
}
