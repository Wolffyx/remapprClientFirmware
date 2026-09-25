// pattern-check: skip — pure data: lighting effect catalogues from firmware docs
//
// Effect enum lists transcribed from the firmware docs, in firmware enum order
// (the index IS the mode value written to the device):
//   - RGB Matrix   https://docs.qmk.fm/features/rgb_matrix
//   - RGBLight     https://docs.qmk.fm/features/rgblight
//   - LED Matrix   https://docs.qmk.fm/features/led_matrix   (monochrome)
//   - ZMK underglow https://zmk.dev/docs/config/lighting
// Backlight (QMK & ZMK) is brightness-only with no effect list.

// Which lighting subsystem a device's global effect belongs to. Determines the
// effect list and which controls (colour / speed) make sense.
export type LightingKind =
    | 'rgb_matrix'
    | 'rgblight'
    | 'led_matrix'
    | 'zmk_underglow'
    | 'backlight'

export interface LightingCatalog {
    kind: LightingKind
    /** Effect names in firmware enum order; index = mode value. Empty = brightness-only. */
    effects: readonly string[]
    /** Hue/saturation adjustable (false for monochrome backlight / LED matrix). */
    hasColor: boolean
    /** Animation speed adjustable. */
    hasSpeed: boolean
}

// https://docs.qmk.fm/features/rgb_matrix — RGB_MATRIX_* enum order.
export const RGB_MATRIX_EFFECTS = [
    'None',
    'Solid Color',
    'Alphas Mods',
    'Gradient Up Down',
    'Gradient Left Right',
    'Breathing',
    'Band Sat',
    'Band Val',
    'Band Pinwheel Sat',
    'Band Pinwheel Val',
    'Band Spiral Sat',
    'Band Spiral Val',
    'Cycle All',
    'Cycle Left Right',
    'Cycle Up Down',
    'Cycle Out In',
    'Cycle Out In Dual',
    'Rainbow Moving Chevron',
    'Cycle Pinwheel',
    'Cycle Spiral',
    'Dual Beacon',
    'Rainbow Beacon',
    'Rainbow Pinwheels',
    'Flower Blooming',
    'Raindrops',
    'Jellybean Raindrops',
    'Hue Breathing',
    'Hue Pendulum',
    'Hue Wave',
    'Pixel Fractal',
    'Pixel Flow',
    'Pixel Rain',
    'Typing Heatmap',
    'Digital Rain',
    'Solid Reactive Simple',
    'Solid Reactive',
    'Solid Reactive Wide',
    'Solid Reactive Multiwide',
    'Solid Reactive Cross',
    'Solid Reactive Multicross',
    'Solid Reactive Nexus',
    'Solid Reactive Multinexus',
    'Splash',
    'Multisplash',
    'Solid Splash',
    'Solid Multisplash',
    'Starlight',
    'Starlight Smooth',
    'Starlight Dual Hue',
    'Starlight Dual Sat',
    'Riverflow',
] as const

// https://docs.qmk.fm/features/rgblight — RGBLIGHT_MODE_* groups.
export const RGBLIGHT_EFFECTS = [
    'Static Light',
    'Breathing',
    'Rainbow Mood',
    'Rainbow Swirl',
    'Snake',
    'Knight',
    'Christmas',
    'Static Gradient',
    'RGB Test',
    'Alternating',
    'Twinkle',
] as const

// https://docs.qmk.fm/features/led_matrix — LED_MATRIX_* enum order (monochrome).
export const LED_MATRIX_EFFECTS = [
    'None',
    'Solid',
    'Alphas Mods',
    'Breathing',
    'Band',
    'Band Pinwheel',
    'Band Spiral',
    'Cycle Left Right',
    'Cycle Up Down',
    'Cycle Out In',
    'Dual Beacon',
    'Solid Reactive Simple',
    'Solid Reactive Wide',
    'Solid Reactive Multiwide',
    'Solid Reactive Cross',
    'Solid Reactive Multicross',
    'Solid Reactive Nexus',
    'Solid Reactive Multinexus',
    'Solid Splash',
    'Solid Multisplash',
    'Wave Left Right',
    'Wave Up Down',
] as const

// https://zmk.dev/docs/config/lighting — underglow effect enum.
export const ZMK_UNDERGLOW_EFFECTS = [
    'Solid',
    'Breathe',
    'Spectrum',
    'Swirl',
] as const

export const RGB_MATRIX_CATALOG: LightingCatalog = {
    kind: 'rgb_matrix',
    effects: RGB_MATRIX_EFFECTS,
    hasColor: true,
    hasSpeed: true,
}

export const RGBLIGHT_CATALOG: LightingCatalog = {
    kind: 'rgblight',
    effects: RGBLIGHT_EFFECTS,
    hasColor: true,
    hasSpeed: true,
}

export const LED_MATRIX_CATALOG: LightingCatalog = {
    kind: 'led_matrix',
    effects: LED_MATRIX_EFFECTS,
    hasColor: false,
    hasSpeed: true,
}

export const ZMK_UNDERGLOW_CATALOG: LightingCatalog = {
    kind: 'zmk_underglow',
    effects: ZMK_UNDERGLOW_EFFECTS,
    hasColor: true,
    hasSpeed: true,
}

// Effects whose palette is fixed/animated and ignore the single-colour picker.
export const COLORLESS_EFFECT =
    /cycle|rainbow|spiral|pinwheel|beacon|splash|rain|heatmap|spectrum|swirl|christmas|test|alternating|gradient|wave|flower|starlight|riverflow|fractal|flow|breathe|breathing|band|direct/i
