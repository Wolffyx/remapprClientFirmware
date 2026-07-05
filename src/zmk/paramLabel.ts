// pattern-check: skip — static token→short-text data table for the ZMK adapter
//
// ZMK enum-command tokens (as reported in behavior metadata param values) →
// short keycap text. Consumed by buildParamLabel (src/paramLabel.ts) via the
// `shortMap` argument; any token absent here falls back to shortenToken().
// Keep entries ≤6 chars — KeyButton sizes the legend off text length.
export const ZMK_SHORT_TOKENS: Readonly<Record<string, string>> = {
    // &bt — Bluetooth. BT_SEL / BT_DISC take a trailing profile index which
    // buildParamLabel appends (→ "BT 0" / "Disc 0").
    BT_SEL: 'BT',
    BT_DISC: 'Disc',
    BT_CLR: 'Clr',
    BT_CLR_ALL: 'ClrAll',
    BT_NXT: 'Next',
    BT_PRV: 'Prev',

    // &rgb_ug — RGB underglow.
    RGB_TOG: 'Tog',
    RGB_ON: 'On',
    RGB_OFF: 'Off',
    RGB_HUI: 'Hue+',
    RGB_HUD: 'Hue−',
    RGB_SAI: 'Sat+',
    RGB_SAD: 'Sat−',
    RGB_BRI: 'Bri+',
    RGB_BRD: 'Bri−',
    RGB_SPI: 'Spd+',
    RGB_SPD: 'Spd−',
    RGB_EFF: 'Eff+',
    RGB_EFR: 'Eff−',

    // &bl — Backlight.
    BL_TOG: 'Tog',
    BL_INC: 'Bri+',
    BL_DEC: 'Bri−',
    BL_ON: 'On',
    BL_OFF: 'Off',
    BL_CYCLE: 'Cycle',

    // &ext_power — External power.
    EP_TOG: 'Tog',
    EP_ON: 'On',
    EP_OFF: 'Off',

    // &out — Output selection.
    OUT_USB: 'USB',
    OUT_BLE: 'BLE',
    OUT_TOG: 'Tog',

    // &mkp — Mouse buttons (labels already short).
    MB1: 'MB1',
    MB2: 'MB2',
    MB3: 'MB3',
    MB4: 'MB4',
    MB5: 'MB5',

    // &mmv — Mouse move.
    MOVE_UP: '↑',
    MOVE_DOWN: '↓',
    MOVE_LEFT: '←',
    MOVE_RIGHT: '→',

    // &msc — Mouse scroll.
    SCRL_UP: 'Scr↑',
    SCRL_DOWN: 'Scr↓',
    SCRL_LEFT: 'Scr←',
    SCRL_RIGHT: 'Scr→',
}
