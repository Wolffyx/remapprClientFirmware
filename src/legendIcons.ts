// pattern-check: skip — neutral icon-id vocabulary (a const string list), no logic
//
// The canonical set of neutral icon ids a firmware adapter may attach to a
// behavior (ActionType.icon), an enum option (ActionSlot.values[].icon), or a
// cap legend part (LegendPart.icon). This is a shared *vocabulary*, NOT a
// behavior-classification list — each adapter maps its own tokens onto these
// ids (see zmk/paramLabel.ts), and the renderer owns the id → icon-component
// registry (renderer/.../keyboard/legendIcons.tsx). An id the renderer doesn't
// know simply falls back to the part's text, so adding a new id here is safe
// before the registry learns it. Keeping the list in one neutral place keeps
// ids consistent across firmwares.
export const LEGEND_ICON_IDS = [
    // Bluetooth / output
    'bluetooth',
    'next',
    'prev',
    'clear',
    'clear-all',
    'disconnect',
    'output',
    'usb',
    'ble',
    'wireless',
    // Lighting / power
    'underglow',
    'backlight',
    'power',
    'power-off',
    'toggle',
    'on',
    'off',
    // System
    'reset',
    'bootloader',
    'caps-word',
    'key-repeat',
    'unlock',
    'battery',
    'lock',
    'screenshot',
    // Mouse
    'mouse',
    'mouse-button',
    'mouse-left',
    'mouse-right',
    'mouse-move',
    'mouse-scroll',
    // Direction — mouse-cursor moves / wheel scroll on keycode-picker tiles
    'arrow-up',
    'arrow-down',
    'arrow-left',
    'arrow-right',
    'scroll-up',
    'scroll-down',
    'scroll-left',
    'scroll-right',
] as const

export type LegendIconId = (typeof LEGEND_ICON_IDS)[number]
