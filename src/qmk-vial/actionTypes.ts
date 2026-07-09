// Pattern check: no GoF pattern (-) — rejected — static neutral ActionType[] for Vial action catalog with optional per-device custom-keycode entries; data only.
import { QMK_ACTION_TYPES } from '@firmware/qmk/actionTypes'
import type { ActionType } from '@firmware/types'

import type { VialCustomKeycode } from './keyboardDef'

// Note: vial:macro is no longer exposed as a pickable action type —
// users now pick macro slots from the Macros catalog tab (which
// encodes via VialCodec → QK_MACRO 0x7700+idx). Encode/decode of
// existing vial:macro KeyActions stays in actions.ts so old keymaps
// round-trip until rewritten.
const VIAL_BASE: ActionType[] = [
    {
        id: 'vial:tap-dance',
        displayName: 'Tap Dance',
        description: 'Reference a configured tap-dance entry.',
        slots: [
            { label: 'Index', kind: 'number', range: { min: 0, max: 255 } },
        ],
    },
    {
        id: 'vial:reset',
        displayName: 'Bootloader',
        description: 'Reset to bootloader.',
        icon: 'bootloader',
        slots: [],
    },
]

export function buildVialActionTypes(
    customKeycodes?: VialCustomKeycode[],
): ActionType[] {
    const out: ActionType[] = [...QMK_ACTION_TYPES, ...VIAL_BASE]
    if (customKeycodes && customKeycodes.length > 0) {
        out.push({
            id: 'vial:user',
            displayName: 'Custom Keycode',
            description: 'Per-board user-defined keycode.',
            slots: [
                {
                    label: 'Keycode',
                    kind: 'enum',
                    values: customKeycodes.map((k, i) => ({
                        value: i,
                        label: k.title || k.shortName || k.name,
                    })),
                },
            ],
        })
    }
    return out
}

// Default catalog (no per-device customKeycodes). Kept for callers that don't
// have a VialKeyboardService instance handy (e.g. catalog previews).
export const VIAL_ACTION_TYPES: ActionType[] = buildVialActionTypes()
