// pattern-check: skip — neutral action catalog for mock adapter
import type { ActionSlot, ActionType, KeyAction, KeyLabel } from '@firmware/types'
import { buildParamLabel } from '../paramLabel'
import { ZMK_SHORT_TOKENS } from '../zmk/paramLabel'

export const MOCK_KIND_TRANSPARENT = 'mock:trans'
export const MOCK_KIND_KEYPRESS = 'mock:kp'
export const MOCK_KIND_LAYER_MOMENTARY = 'mock:mo'
export const MOCK_KIND_LAYER_TOGGLE = 'mock:tog'
export const MOCK_KIND_MOD_TAP = 'mock:mt'
export const MOCK_KIND_LAYER_TAP = 'mock:lt'
// Command-style behaviors (bluetooth / RGB underglow / mouse). Unlike the six
// kinds above these carry an enum "command" param (and &bt a gated profile),
// mirroring how real ZMK reports &bt / &rgb_ug / &mkp / &mmv — so the demo can
// exercise the param-legend rendering (Wolffyx/remappr#147) without hardware.
// They are runtime-only: the config bridge does not round-trip them (a placed
// command raises to the prior config binding), which is fine for a visual demo.
export const MOCK_KIND_BLUETOOTH = 'mock:bt'
export const MOCK_KIND_RGB = 'mock:rgb_ug'
export const MOCK_KIND_MOUSE_BUTTON = 'mock:mkp'
export const MOCK_KIND_MOUSE_MOVE = 'mock:mmv'

// Enum value tables shared by the ActionType slots and labelFor. Tokens match
// ZMK's so ZMK_SHORT_TOKENS renders the same short text ("BT 0", "Hue+", …).
const BT_COMMANDS: { value: number; label: string }[] = [
    { value: 0, label: 'BT_CLR' },
    { value: 1, label: 'BT_NXT' },
    { value: 2, label: 'BT_PRV' },
    { value: 3, label: 'BT_SEL' },
    { value: 5, label: 'BT_DISC' },
]
const RGB_COMMANDS: { value: number; label: string }[] = [
    { value: 0, label: 'RGB_TOG' },
    { value: 3, label: 'RGB_HUI' },
    { value: 4, label: 'RGB_HUD' },
    { value: 5, label: 'RGB_SAI' },
    { value: 6, label: 'RGB_SAD' },
    { value: 7, label: 'RGB_BRI' },
    { value: 8, label: 'RGB_BRD' },
    { value: 11, label: 'RGB_EFF' },
]
const MOUSE_BUTTONS: { value: number; label: string }[] = [
    { value: 0x01, label: 'MB1' },
    { value: 0x02, label: 'MB2' },
    { value: 0x04, label: 'MB3' },
]
const MOUSE_MOVES: { value: number; label: string }[] = [
    { value: 0x00010000, label: 'MOVE_UP' },
    { value: 0x00000100, label: 'MOVE_DOWN' },
    { value: 0xffff0000, label: 'MOVE_LEFT' },
    { value: 0x0000ffff, label: 'MOVE_RIGHT' },
]

// The neutral slots each command behavior exposes — one source of truth for
// both buildMockActionTypes (the picker) and labelFor (the cap legend).
const COMMAND_SLOTS: Record<string, ActionSlot[]> = {
    [MOCK_KIND_BLUETOOTH]: [
        { label: 'Command', kind: 'enum', values: BT_COMMANDS },
        // Profile applies only to BT_SEL (3) / BT_DISC (5), like real &bt.
        { label: 'profile', kind: 'number', range: { min: 0, max: 4 }, enabledFor: [3, 5] },
    ],
    [MOCK_KIND_RGB]: [{ label: 'Command', kind: 'enum', values: RGB_COMMANDS }],
    [MOCK_KIND_MOUSE_BUTTON]: [
        { label: 'Button', kind: 'enum', values: MOUSE_BUTTONS },
    ],
    [MOCK_KIND_MOUSE_MOVE]: [
        { label: 'Direction', kind: 'enum', values: MOUSE_MOVES },
    ],
}

const COMMAND_META: Record<
    string,
    { displayName: string; description: string; prefix: string }
> = {
    [MOCK_KIND_BLUETOOTH]: {
        displayName: 'Bluetooth',
        description: 'Bluetooth profile control (&bt)',
        prefix: 'bt',
    },
    [MOCK_KIND_RGB]: {
        displayName: 'RGB Underglow',
        description: 'RGB underglow control (&rgb_ug)',
        prefix: 'rgb_ug',
    },
    [MOCK_KIND_MOUSE_BUTTON]: {
        displayName: 'Mouse Button',
        description: 'Mouse button press (&mkp)',
        prefix: 'mkp',
    },
    [MOCK_KIND_MOUSE_MOVE]: {
        displayName: 'Mouse Move',
        description: 'Mouse movement (&mmv)',
        prefix: 'mmv',
    },
}

// Renderer (`HidUsageLabel`, `KeycodePickerGrid`) consumes ZMK-style encoded
// usages: (page << 16) | id. Keep the mock adapter on the same encoding so
// the picker and label resolution work without a translation layer.
const HID_PAGE_KEYBOARD = 0x07
export const encodeHidUsage = (page: number, id: number): number =>
    (page << 16) | id
export const HID_KP = (id: number): number =>
    encodeHidUsage(HID_PAGE_KEYBOARD, id)

const HID_VALUES = (): { value: number; label: string }[] => {
    const out: { value: number; label: string }[] = []
    // A..Z (HID usage 0x04..0x1D)
    for (let i = 0; i < 26; i++) {
        out.push({
            value: HID_KP(0x04 + i),
            label: String.fromCharCode(65 + i),
        })
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
    // Punctuation / nav (must round-trip from picker → label)
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
    // F1..F12
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

export function buildMockActionTypes(maxLayers: number): ActionType[] {
    return [
        {
            id: MOCK_KIND_TRANSPARENT,
            displayName: 'Transparent',
            description: 'Pass-through to lower layer',
            slots: [],
        },
        {
            id: MOCK_KIND_KEYPRESS,
            displayName: 'Key Press',
            description: 'Send a HID keycode',
            slots: [
                {
                    label: 'Key',
                    kind: 'hid',
                    values: HID_VALUES(),
                },
            ],
        },
        {
            id: MOCK_KIND_LAYER_MOMENTARY,
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
            id: MOCK_KIND_LAYER_TOGGLE,
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
            id: MOCK_KIND_MOD_TAP,
            displayName: 'Mod-Tap',
            description: 'Tap for the key, hold for a modifier',
            slots: [
                { label: 'Tap', kind: 'hid', values: HID_VALUES() },
                { label: 'Hold', kind: 'modifier', values: MOD_USAGES },
            ],
        },
        {
            id: MOCK_KIND_LAYER_TAP,
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
        ...Object.keys(COMMAND_SLOTS).map((kind) => ({
            id: kind,
            displayName: COMMAND_META[kind].displayName,
            description: COMMAND_META[kind].description,
            slots: COMMAND_SLOTS[kind],
        })),
    ]
}

const HID_LABELS = new Map<number, string>(
    HID_VALUES().map((v) => [v.value, v.label]),
)

// Modifier choices for the Mod-Tap hold slot (left-hand variants). Stored as
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

const encodeUsage = (raw: number): number =>
    raw >= 1 << 16 ? raw : HID_KP(raw)
const usageDesc = (encoded: number): string =>
    MOD_LABELS.get(encoded) ??
    HID_LABELS.get(encoded) ??
    `0x${encoded.toString(16)}`

// ZMK convention (see src/firmware/zmk/actions.ts buildKeyLabel):
//   - label.primary       → behavior displayName (e.g. "Key Press") — shown
//                           as small header; identifies WHAT behavior fires.
//   - label.primaryUsage  → encoded HID usage rendered as the big glyph by
//                           HidUsageLabel in renderer.
//   - label.bindingPrefix → short binding token (e.g. "kp") for binding mode.
function labelFor(
    kind: string,
    params: number[],
    layerNames: string[],
): KeyLabel {
    if (kind === MOCK_KIND_TRANSPARENT) {
        return {
            primary: 'Transparent',
            bindingPrefix: 'trans',
        }
    }
    if (kind === MOCK_KIND_KEYPRESS) {
        const raw = params[0] ?? 0
        // Picker passes encoded usages; legacy callers may pass raw HID id.
        const encoded = raw >= 1 << 16 ? raw : HID_KP(raw)
        return {
            primary: 'Key Press',
            primaryUsage: encoded,
            bindingPrefix: 'kp',
            description: HID_LABELS.get(encoded) ?? `0x${encoded.toString(16)}`,
        }
    }
    if (kind === MOCK_KIND_LAYER_MOMENTARY) {
        const layer = params[0] ?? 0
        const name = layerNames[layer] ?? `L${layer}`
        return {
            primary: 'Momentary Layer',
            secondary: name,
            paramText: name,
            bindingPrefix: 'mo',
        }
    }
    if (kind === MOCK_KIND_LAYER_TOGGLE) {
        const layer = params[0] ?? 0
        const name = layerNames[layer] ?? `L${layer}`
        return {
            primary: 'Toggle Layer',
            secondary: name,
            paramText: name,
            bindingPrefix: 'tog',
        }
    }
    if (kind === MOCK_KIND_MOD_TAP) {
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
    if (COMMAND_SLOTS[kind]) {
        const meta = COMMAND_META[kind]
        const p = buildParamLabel(
            COMMAND_SLOTS[kind],
            params,
            (i) => layerNames[i],
            ZMK_SHORT_TOKENS,
        )
        return {
            primary: meta.displayName,
            ...(p.paramText ? { paramText: p.paramText } : {}),
            bindingPrefix: meta.prefix,
            description: p.longText
                ? `${meta.displayName}: ${p.longText}`
                : meta.displayName,
        }
    }
    if (kind === MOCK_KIND_LAYER_TAP) {
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
    return { primary: '?' }
}

export function buildMockKeyAction(
    kind: string,
    params: number[],
    layerNames: string[] = [],
): KeyAction {
    return {
        kind,
        params: [...params],
        label: labelFor(kind, params, layerNames),
    }
}

export function relabelLayer(
    keys: KeyAction[],
    layerNames: string[],
): KeyAction[] {
    return keys.map((k) => buildMockKeyAction(k.kind, k.params, layerNames))
}
