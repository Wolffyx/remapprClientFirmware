// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; static neutral ActionType[] for QMK/VIA action catalog.
import type { ActionType } from '@firmware/types'

const MODIFIER_VALUES = [
    { value: 0x01, label: 'LCTRL' },
    { value: 0x02, label: 'LSHIFT' },
    { value: 0x04, label: 'LALT' },
    { value: 0x08, label: 'LGUI' },
    { value: 0x10, label: 'RCTRL' },
    { value: 0x20, label: 'RSHIFT' },
    { value: 0x40, label: 'RALT' },
    { value: 0x80, label: 'RGUI' },
]

export const QMK_ACTION_TYPES: ActionType[] = [
    {
        id: 'qmk:none',
        displayName: 'None',
        description: 'No action (KC_NO).',
        slots: [],
    },
    {
        id: 'qmk:trans',
        displayName: 'Transparent',
        description: 'Pass-through (KC_TRNS).',
        slots: [],
    },
    {
        id: 'qmk:basic',
        displayName: 'Key Press',
        description: 'Send a basic HID keycode.',
        slots: [{ label: 'Key', kind: 'hid' }],
    },
    {
        id: 'qmk:mod-tap',
        displayName: 'Mod-Tap',
        description: 'Hold for modifier, tap for key.',
        slots: [
            { label: 'Hold', kind: 'modifier', values: MODIFIER_VALUES },
            { label: 'Tap', kind: 'hid' },
        ],
    },
    {
        id: 'qmk:layer-tap',
        displayName: 'Layer-Tap',
        description: 'Hold for layer, tap for key.',
        slots: [
            {
                label: 'Hold',
                kind: 'layer',
                range: { min: 0, max: 15 },
            },
            { label: 'Tap', kind: 'hid' },
        ],
    },
    {
        id: 'qmk:momentary',
        displayName: 'Momentary Layer',
        description: 'Activate layer while held (MO).',
        slots: [
            {
                label: 'Layer',
                kind: 'layer',
                range: { min: 0, max: 15 },
            },
        ],
    },
    {
        id: 'qmk:toggle-layer',
        displayName: 'Toggle Layer',
        description: 'Toggle layer (TG).',
        slots: [
            {
                label: 'Layer',
                kind: 'layer',
                range: { min: 0, max: 15 },
            },
        ],
    },
    {
        id: 'qmk:to-layer',
        displayName: 'To Layer',
        description: 'Switch to the given layer (TO).',
        slots: [{ label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } }],
    },
    {
        id: 'qmk:default-layer',
        displayName: 'Default Layer',
        description: 'Switch the default layer (DF).',
        slots: [{ label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } }],
    },
    {
        id: 'qmk:persistent-default-layer',
        displayName: 'Persistent Default Layer',
        description: 'Switch and persist the default layer (PDF).',
        slots: [{ label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } }],
    },
    {
        id: 'qmk:layer-mod',
        displayName: 'Layer + Mod',
        description: 'Hold momentary layer with modifier (LM).',
        slots: [
            { label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } },
            { label: 'Mod', kind: 'modifier', values: MODIFIER_VALUES },
        ],
    },
    {
        id: 'qmk:one-shot-layer',
        displayName: 'One Shot Layer',
        description: 'Activate layer for the next key press (OSL).',
        slots: [{ label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } }],
    },
    {
        id: 'qmk:one-shot-mod',
        displayName: 'One Shot Mod',
        description: 'Apply modifier to the next key press (OSM).',
        slots: [{ label: 'Mod', kind: 'modifier', values: MODIFIER_VALUES }],
    },
    {
        id: 'qmk:tap-toggle-layer',
        displayName: 'Tap Toggle Layer',
        description: 'Tap = toggle, hold = momentary (TT).',
        slots: [{ label: 'Layer', kind: 'layer', range: { min: 0, max: 15 } }],
    },
    {
        id: 'qmk:swap-hands-tap',
        displayName: 'Swap-Hands Tap',
        description: 'Swap hands while held, tap to send key (SH_T).',
        slots: [{ label: 'Tap', kind: 'hid' }],
    },
]
