// pattern-check: skip pure string-template derivation, no abstraction
//
// Single source of truth for the firmware CONFIG files: the ZMK `.conf` (Kconfig)
// and the QMK-family `config.h` / `rules.mk`. Both the project-bundle emitter
// (bundle.ts) and the builder's live preview (BuilderMetaForm) call these so the
// file the user sees in the UI is byte-identical to what ships in the archive.
//
// Flags are TRI-STATE: `firmwareConfig.<x>` undefined ⇒ auto-derive from the used
// behaviors + declared hardware; explicit true/false ⇒ user override. `someAction`
// (the behavior walker) lives here so bundle.ts can import it back without a cycle.

import type {
    CanonAction,
    CanonFirmwareConfig,
    ConfigKeymap,
    DesignFeature,
} from './types'
import { screenFor } from './compilers/zephyrParts'
import { qmkScreenLines } from './compilers/qmkScreen'

/** Walk every action in the config (layers, encoders, combos) for feature flags. */
export function someAction(
    config: ConfigKeymap,
    pred: (a: CanonAction) => boolean,
): boolean {
    for (const layer of config.layers) {
        if (layer.bindings.some(pred)) return true
        for (const e of layer.encoders ?? []) {
            if (pred(e.cw) || pred(e.ccw) || (e.press && pred(e.press)))
                return true
        }
    }
    return (config.combos ?? []).some((c) => pred(c.action))
}

const isMouse = (a: CanonAction): boolean =>
    a.type === 'mouse_key' ||
    a.type === 'mouse_move' ||
    a.type === 'mouse_scroll'

/** The resolved (override ?? auto-derived) ZMK feature set — also drives the UI. */
export interface ZmkConfFlags {
    usb: boolean
    ble: boolean
    studio: boolean
    studioLocking: boolean
    studioCdc: boolean
    softOff: boolean
    extPower: boolean
    pointing: boolean
    backlight: boolean
    underglow: boolean
    usbLogging: boolean
    sleep: boolean
    encoders: boolean
    display: boolean
}

/** A derived default and what set it (a design feature's name, or what in the
 *  design asks for it); no `from` = a plain default. */
export interface AutoValue {
    on: boolean
    from?: string
}

/** Display names of the design features, for "from <feature>" hints. */
export const DESIGN_FEATURE_NAME: Record<DesignFeature, string> = {
    wireless: 'Wireless',
    liveEdit: 'Edit live',
    battery: 'Battery & sleep',
    lighting: 'Lighting',
    pointing: 'Motion sensor',
    encoders: 'Encoders',
    analog: 'Analog inputs',
    display: 'Screen',
}

/** First reason that holds, else off. */
function firstOf(...rules: [boolean, string][]): AutoValue {
    const hit = rules.find(([on]) => on)
    return hit ? { on: true, from: hit[1] } : { on: false }
}

/** What the design asks for, before any override. */
function designUses(config: ConfigKeymap) {
    const uses = (p: (a: CanonAction) => boolean): boolean =>
        someAction(config, p)
    const features = new Set(config.keyboard.features ?? [])
    const lighting = config.keyboard.lighting
    const feature = (f: DesignFeature): [boolean, string] => [
        features.has(f),
        DESIGN_FEATURE_NAME[f],
    ]
    return {
        picked: config.keyboard.features !== undefined,
        feature,
        mouse: uses(isMouse),
        softOff: uses((a) => a.type === 'soft_off'),
        extPower: uses((a) => a.type === 'ext_power'),
        // Underglow/backlight are owned by the builder's Lighting section
        // (keyboard.lighting), on top of any lighting behavior in the keymap.
        underglow:
            !!lighting?.underglow ||
            uses((a) => a.type === 'lighting' && a.target === 'underglow'),
        backlight:
            !!lighting?.backlight ||
            uses((a) => a.type === 'lighting' && a.target === 'backlight'),
        encoderKeys: config.keyboard.keys.some((k) => k.element === 'encoder'),
    }
}

/** Every ZMK flag's auto value (no overrides) and what turned it on. */
export function zmkConfAuto(
    config: ConfigKeymap,
): Record<keyof ZmkConfFlags, AutoValue> {
    const hw = config.keyboard.hardware
    const u = designUses(config)
    // Without picked features, Studio stays on by default (as before cards).
    const studio = u.picked ? firstOf(u.feature('liveEdit')) : { on: true }
    return {
        usb: { on: true },
        ble: firstOf(u.feature('wireless')),
        studio,
        studioLocking: { on: true },
        studioCdc: { on: studio.on, from: studio.from },
        softOff: firstOf([u.softOff, 'a soft-off key']),
        extPower: firstOf(
            [u.extPower, 'an external-power key'],
            [!!hw?.extPowerCtrl, 'the external-power pin'],
        ),
        pointing: firstOf(u.feature('pointing'), [u.mouse, 'mouse keys']),
        backlight: firstOf(
            [u.backlight, 'Lighting'],
            [!!hw?.backlightPwm, 'the backlight pin'],
        ),
        underglow: firstOf(
            u.feature('lighting'),
            [u.underglow, 'Lighting'],
            [!!hw?.ws2812, 'the LED data pin'],
        ),
        usbLogging: { on: false },
        sleep: firstOf(u.feature('battery')),
        encoders: firstOf(u.feature('encoders'), [
            u.encoderKeys,
            'encoder keys',
        ]),
        display: firstOf([screenFor(config, 'zmk'), 'the screen']),
    }
}

/** The `firmwareConfig` override key behind each ZMK flag. */
export const ZMK_FLAG_OVERRIDE: Record<
    keyof ZmkConfFlags,
    keyof CanonFirmwareConfig
> = {
    usb: 'usb',
    ble: 'ble',
    studio: 'studio',
    studioLocking: 'studioLocking',
    studioCdc: 'studioUsbCdc',
    softOff: 'softOff',
    extPower: 'extPower',
    pointing: 'pointing',
    backlight: 'backlight',
    underglow: 'underglow',
    usbLogging: 'usbLogging',
    sleep: 'sleep',
    encoders: 'encoders',
    display: 'display',
}

/** Resolve every ZMK flag from `firmwareConfig` overrides + used behaviors/hardware. */
export function resolveZmkConfFlags(config: ConfigKeymap): ZmkConfFlags {
    const fc = config.keyboard.firmwareConfig ?? {}
    const auto = zmkConfAuto(config)
    const out = {} as ZmkConfFlags
    for (const k of Object.keys(auto) as (keyof ZmkConfFlags)[]) {
        const o = fc[ZMK_FLAG_OVERRIDE[k]]
        out[k] = typeof o === 'boolean' ? o : auto[k].on
    }
    // Studio over USB follows the resolved Studio switch unless overridden.
    if (fc.studioUsbCdc === undefined) out.studioCdc = out.studio
    return out
}

/** QMK `keyboard.json` features the builder manages, in emit order. The first
 *  four are always written; the rest only when on. */
export const QMK_FEATURES = [
    'bootmagic',
    'extrakey',
    'mousekey',
    'nkro',
    'rgblight',
    'backlight',
    'encoder',
    'pointing_device',
] as const

export type QmkFeature = (typeof QMK_FEATURES)[number]

const QMK_ALWAYS_WRITTEN = new Set<QmkFeature>([
    'bootmagic',
    'extrakey',
    'mousekey',
    'nkro',
])

/** Every managed QMK feature's auto value (no overrides) and what set it. */
export function qmkFeaturesAuto(
    config: ConfigKeymap,
): Record<QmkFeature, AutoValue> {
    const u = designUses(config)
    const lightingKeys = someAction(
        config,
        (a) => a.type === 'lighting' && a.target !== 'backlight',
    )
    return {
        bootmagic: { on: false },
        extrakey: { on: true },
        mousekey: firstOf([u.mouse, 'mouse keys']),
        nkro: { on: true },
        rgblight: firstOf(u.feature('lighting'), [
            !!config.keyboard.lighting?.underglow || lightingKeys,
            'Lighting',
        ]),
        backlight: firstOf([u.backlight, 'Lighting']),
        encoder: firstOf(u.feature('encoders'), [
            u.encoderKeys || config.layers.some((l) => l.encoders?.length),
            'encoder keys',
        ]),
        pointing_device: firstOf(u.feature('pointing')),
    }
}

/** The `keyboard.json` `features` object: overrides over the auto values. */
export function resolveQmkFeatures(
    config: ConfigKeymap,
): Record<string, boolean> {
    const auto = qmkFeaturesAuto(config)
    const over = config.keyboard.firmwareConfig?.qmkFeatures ?? {}
    const out: Record<string, boolean> = {}
    for (const f of QMK_FEATURES) {
        const on = over[f] ?? auto[f].on
        if (on || QMK_ALWAYS_WRITTEN.has(f)) out[f] = on
    }
    return out
}

/** Comment a flag line out when its feature is off (Kconfig hint convention). */
const flag = (on: boolean, line: string): string => (on ? line : `# ${line}`)

/** The complete ZMK `.conf` (Kconfig) for the config — overrides + auto-derived. */
export function deriveZmkConf(config: ConfigKeymap): string {
    const fc = config.keyboard.firmwareConfig ?? {}
    const on = resolveZmkConfFlags(config)
    const lines: string[] = [
        `# ZMK config for ${config.meta.name}`,
        `# Generated by remappr — toggles derive from your behaviors + hardware.`,
        ``,
        `# ── Transports ──`,
        flag(on.usb, `CONFIG_ZMK_USB=y`),
        flag(on.ble, `CONFIG_ZMK_BLE=y`),
        ``,
    ]

    if (on.pointing)
        lines.push(
            `# Pointing (&mkp / &mmv / &msc).`,
            `CONFIG_ZMK_POINTING=y`,
            ``,
        )

    if (on.studio) {
        lines.push(`# ── ZMK Studio ──`, `CONFIG_ZMK_STUDIO=y`)
        if (on.studioCdc)
            lines.push(
                `# Studio over USB needs a CDC ACM endpoint (studio_acm in the overlay).`,
                `CONFIG_SERIAL=y`,
                `CONFIG_USB_DEVICE_STACK=y`,
                `CONFIG_USB_CDC_ACM=y`,
                `CONFIG_CDC_ACM_SERIAL_INITIALIZE_AT_BOOT=y`,
                `CONFIG_ZMK_STUDIO_TRANSPORT_UART=y`,
            )
        // Locking is on by default; an explicit `=n` (not a comment) disables it.
        lines.push(
            on.studioLocking
                ? `CONFIG_ZMK_STUDIO_LOCKING=y`
                : `CONFIG_ZMK_STUDIO_LOCKING=n`,
        )
        lines.push(``)
    }

    if (on.softOff)
        lines.push(`# Soft-off (&soft_off).`, `CONFIG_ZMK_PM_SOFT_OFF=y`, ``)

    if (on.sleep) lines.push(`# Sleep when idle.`, `CONFIG_ZMK_SLEEP=y`, ``)

    if (on.encoders)
        lines.push(
            `# Rotary encoders (EC11).`,
            `CONFIG_EC11=y`,
            `CONFIG_EC11_TRIGGER_GLOBAL_THREAD=y`,
            ``,
        )

    if (on.display)
        lines.push(`# Screen (zephyr,display).`, `CONFIG_ZMK_DISPLAY=y`, ``)

    if (on.backlight)
        lines.push(
            `# Backlight (&bl) via PWM.`,
            `CONFIG_ZMK_BACKLIGHT=y`,
            `CONFIG_PWM=y`,
            ``,
        )
    else lines.push(`# CONFIG_ZMK_BACKLIGHT=y`)

    lines.push(flag(on.underglow, `CONFIG_ZMK_RGB_UNDERGLOW=y`))

    if (on.extPower)
        lines.push(`# Ext-power (&ext_power).`, `CONFIG_ZMK_EXT_POWER=y`)

    lines.push(
        ``,
        `# ── Optional ──`,
        flag(on.usbLogging, `CONFIG_ZMK_USB_LOGGING=y`),
    )

    if (fc.kconfig?.trim())
        lines.push(
            ``,
            `# ── Extra Kconfig (from builder) ──`,
            fc.kconfig.trim(),
        )

    return lines.join('\n') + '\n'
}

/** The QMK keymap `config.h` (pragma block + user `firmwareConfig.configH` extras).
 *  Vial's UID/unlock defines are concatenated by the caller (they come from the
 *  vial build result, not the config). */
export function deriveQmkConfigH(config: ConfigKeymap): string {
    const fc = config.keyboard.firmwareConfig ?? {}
    const lines = [
        `#pragma once`,
        `// remappr — board-level overrides go here.`,
        `// Matrix pins, diode direction, processor/bootloader and USB identity`,
        `// are data-driven in keyboard.json; add only extras config.h must`,
        `// carry (e.g. #define WS2812_SPI_DRIVER SPID2).`,
    ]
    const screen = qmkScreenLines(config).configH
    if (screen.length) lines.push(``, ...screen)
    if (fc.configH?.trim())
        lines.push(``, `// ── Extra (from builder) ──`, fc.configH.trim())
    return lines.join('\n') + '\n'
}

/** The QMK keymap `rules.mk`: VIA/Vial feature toggles + user `rulesMk` extras. */
export function deriveQmkRulesMk(
    config: ConfigKeymap,
    wantsVia: boolean,
    wantsVial: boolean,
): string {
    const fc = config.keyboard.firmwareConfig ?? {}
    let out =
        `# remappr keymap — feature toggles live in keyboard.json\n` +
        (wantsVia ? `VIA_ENABLE = yes\n` : ``) +
        (wantsVial ? `VIAL_ENABLE = yes\n` : ``)
    const screen = qmkScreenLines(config).rules
    if (screen.length) out += screen.join('\n') + '\n'
    if (fc.rulesMk?.trim())
        out += `# Extra (from builder)\n${fc.rulesMk.trim()}\n`
    return out
}
