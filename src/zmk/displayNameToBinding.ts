// Pattern check: no GoF pattern (-) — rejected — data-only refactor; multi-variant lookup keyed by &prefix, reverse-indexed at module load. Slug fallback unchanged.
//
// ZMK firmware reports each behavior's `displayName` over RPC. Names are not
// formally specified; upstream zmk-studio firmware has historically used
// "Mod-Tap" / "Layer-Tap" / "Momentary Layer" / etc., but third-party
// firmwares and future ZMK releases may drift. Multi-variant entries absorb
// reasonable spelling differences without forcing a slug-fallback (which
// emits the wrong &prefix for behaviors whose binding name doesn't match
// the slugified display name — e.g. "Mouse Button Press" → &mouse_button_press
// instead of &mkp).
//
// Coverage matches the ZMK behaviors index page
// (https://zmk.dev/docs/keymaps/behaviors).

const BINDING_VARIANTS: Record<string, readonly string[]> = {
    '&kp': ['Key Press', 'Modifier'],
    '&mt': ['Mod-Tap', 'Mod Tap', 'Hold Tap (Mod-Tap)'],
    '&lt': ['Layer-Tap', 'Layer Tap'],
    '&mo': ['Layer', 'Layer (Momentary)', 'Momentary Layer'],
    '&to': ['To Layer'],
    '&tog': ['Toggle Layer'],
    '&sl': ['Sticky Layer'],
    '&sk': ['Sticky Key'],
    '&kt': ['Key Toggle'],
    '&trans': ['Transparent'],
    '&none': ['None'],
    '&caps_word': ['Caps Word'],
    '&key_repeat': ['Key Repeat'],
    '&gresc': ['Grave Escape'],
    '&bt': ['Bluetooth'],
    '&out': ['Output Selection', 'Outputs'],
    '&rgb_ug': ['RGB Underglow', 'Underglow'],
    '&bl': ['Backlight'],
    '&ext_power': ['External Power', 'Ext Power'],
    '&soft_off': ['Soft Off'],
    '&studio_unlock': ['Studio Unlock'],
    '&sys_reset': ['Reset', 'System Reset', 'Sys Reset'],
    '&bootloader': ['Bootloader'],
    '&mkp': ['Mouse Button Press', 'Mouse Button', 'Mouse Key Press'],
    // Some firmwares report mouse move/scroll under their DT node label
    // (lowercase, e.g. "mouse_move") rather than a friendly display name.
    '&mmv': ['Mouse Move', 'mouse_move'],
    '&msc': ['Mouse Scroll', 'mouse_scroll'],
}

const DISPLAY_TO_PREFIX: Map<string, string> = (() => {
    const m = new Map<string, string>()
    for (const [prefix, variants] of Object.entries(BINDING_VARIANTS)) {
        for (const v of variants) m.set(v, prefix)
    }
    return m
})()

// Some firmwares report a system behavior under its devicetree node label
// (e.g. a `&soft_off` instance surfaces as "z_so_off") instead of a friendly
// display name. Those slug-fallback to an unknown &prefix, so they classify as
// user macros and hide from the action dropdown (issue #149). Recognise the
// common ones by name pattern and map them onto their canonical &prefix — this
// only affects the LABEL / classification / cap icon, never identity (a binding
// always carries the real behavior id). The system word must be the whole label
// or its trailing token (anchored at the end) so a user macro like
// "reset_layers" isn't mistaken for &sys_reset while "z_so_off" still resolves.
const SYSTEM_NAME_RULES: ReadonlyArray<{ re: RegExp; prefix: string }> = [
    { re: /(^|_)(soft_?off|so_?off)$/i, prefix: '&soft_off' },
    { re: /(^|_)(sys_?reset|reset)$/i, prefix: '&sys_reset' },
    { re: /(^|_)(bootloader|boot)$/i, prefix: '&bootloader' },
    { re: /(^|_)(studio_?unlock|unlock)$/i, prefix: '&studio_unlock' },
]

/**
 * Recognise a system behavior reported under a node-name label. Returns the
 * canonical &prefix when `displayName` isn't already a known display name but
 * matches a system-behavior pattern; otherwise undefined.
 */
export function recognizeSystemName(displayName: string): string | undefined {
    if (!displayName || DISPLAY_TO_PREFIX.has(displayName)) return undefined
    for (const { re, prefix } of SYSTEM_NAME_RULES) {
        if (re.test(displayName)) return prefix
    }
    return undefined
}

export function displayNameToBinding(displayName: string): string {
    if (!displayName) return ''
    const direct = DISPLAY_TO_PREFIX.get(displayName)
    if (direct) return direct
    const system = recognizeSystemName(displayName)
    if (system) return system
    const slug = displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return slug ? `&${slug}` : ''
}

/**
 * The friendly name to show for a behavior. Reported display names pass through
 * unchanged; a system behavior recognised only by its node label (e.g.
 * "z_so_off") is retitled to its canonical name ("Soft Off"). Cosmetic only.
 */
export function prettyBehaviorName(displayName: string): string {
    const prefix = recognizeSystemName(displayName)
    if (!prefix) return displayName
    return BINDING_VARIANTS[prefix]?.[0] ?? displayName
}

export const KNOWN_BINDING_PREFIXES: readonly string[] =
    Object.keys(BINDING_VARIANTS)
