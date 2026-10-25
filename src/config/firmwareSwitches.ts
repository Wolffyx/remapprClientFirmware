// Pattern check: Strategy (Tier 1) — applied — one switch table per firmware target (rows, set, reset, supported features) behind a common interface, picked by target id; each firmware declares its own options, no cross-firmware list.
//
// The builder's per-firmware tabs. Each target lists its switches: a plain
// name, the exact line it writes, whether it is on, and what turned it on (a
// design feature card, or something in the design such as mouse keys). A
// switch the user flips is stored as an override in `firmwareConfig`; flipping
// it back to its derived value drops the override, so "changed" counts only
// real differences. Each table also says which design features it has options
// for — the feature cards' firmware chips come from that.
import {
    QMK_FEATURES,
    ZMK_FLAG_OVERRIDE,
    qmkFeaturesAuto,
    resolveQmkFeatures,
    resolveZmkConfFlags,
    zmkConfAuto,
    type AutoValue,
    type QmkFeature,
    type ZmkConfFlags,
} from './firmwareConf'
import type { BuilderFirmwareId } from './firmwareTargets'
import type { CanonFirmwareConfig, ConfigKeymap, DesignFeature } from './types'
import type { DeviceForm } from '../devices/types'
import { screenFor } from './compilers/zephyrParts'

export interface FirmwareSwitch {
    /** Stable within its table. */
    readonly id: string
    readonly name: string
    /** The exact option it writes, as it reads in the file. */
    readonly line: string
    readonly on: boolean
    /** What turned it on (a feature card's name or a part of the design);
     *  absent when it is off, set by hand, or a plain default. */
    readonly from?: string
    /** Set by hand to something other than its derived value. */
    readonly changed: boolean
    /** A sub-option of the switch above it. */
    readonly sub?: boolean
    /** Not a choice here: the firmware always does it, or another setting
     *  (a pin, a target) decides it. `from` then says which. */
    readonly fixed?: boolean
    /** For a fixed switch that is off: what turns it on. */
    readonly hint?: string
}

export interface SwitchTable {
    /** The file the lines go to. */
    readonly file: string
    /** Design features this firmware has options for. */
    readonly features: readonly DesignFeature[]
    /** Screen controller chips this firmware has a driver for (names as in
     *  config/displays.ts). Its export does not write a screen yet. */
    readonly displays: readonly string[]
    switches(config: ConfigKeymap): FirmwareSwitch[]
    set(config: ConfigKeymap, id: string, on: boolean): ConfigKeymap
    /** Drop every override this table owns. */
    reset(config: ConfigKeymap): ConfigKeymap
}

function withFirmwareConfig(
    config: ConfigKeymap,
    fc: CanonFirmwareConfig,
): ConfigKeymap {
    return {
        ...config,
        keyboard: {
            ...config.keyboard,
            firmwareConfig: Object.keys(fc).length ? fc : undefined,
        },
    }
}

const shown = (auto: AutoValue, on: boolean, changed: boolean) =>
    on && !changed && auto.from ? { from: auto.from } : {}

// ── ZMK ─────────────────────────────────────────────────────────────────────

interface ZmkRow {
    id: keyof ZmkConfFlags
    name: string
    symbol: string
    sub?: boolean
    /** Off writes `=n` instead of leaving the line out. */
    explicitOff?: boolean
}

const ZMK_ROWS: readonly ZmkRow[] = [
    { id: 'usb', name: 'USB', symbol: 'CONFIG_ZMK_USB' },
    { id: 'ble', name: 'Bluetooth', symbol: 'CONFIG_ZMK_BLE' },
    { id: 'studio', name: 'Edit live with ZMK Studio', symbol: 'CONFIG_ZMK_STUDIO' },
    {
        id: 'studioCdc',
        name: 'over USB',
        symbol: 'CONFIG_ZMK_STUDIO_TRANSPORT_UART',
        sub: true,
    },
    {
        id: 'studioLocking',
        name: 'ask to unlock first',
        symbol: 'CONFIG_ZMK_STUDIO_LOCKING',
        sub: true,
        explicitOff: true,
    },
    { id: 'sleep', name: 'Sleep when idle', symbol: 'CONFIG_ZMK_SLEEP' },
    { id: 'softOff', name: 'Soft off', symbol: 'CONFIG_ZMK_PM_SOFT_OFF' },
    { id: 'pointing', name: 'Pointing and mouse keys', symbol: 'CONFIG_ZMK_POINTING' },
    { id: 'underglow', name: 'RGB underglow', symbol: 'CONFIG_ZMK_RGB_UNDERGLOW' },
    { id: 'backlight', name: 'Backlight', symbol: 'CONFIG_ZMK_BACKLIGHT' },
    { id: 'encoders', name: 'Encoders', symbol: 'CONFIG_EC11' },
    { id: 'display', name: 'Screen', symbol: 'CONFIG_ZMK_DISPLAY' },
    { id: 'extPower', name: 'External power', symbol: 'CONFIG_ZMK_EXT_POWER' },
    { id: 'usbLogging', name: 'Debug log over USB', symbol: 'CONFIG_ZMK_USB_LOGGING' },
]

const zmkLine = (row: ZmkRow, on: boolean): string => {
    if (on) return `${row.symbol}=y`
    return row.explicitOff ? `${row.symbol}=n` : row.symbol
}

const zmkTable: SwitchTable = {
    file: '.conf',
    features: ['wireless', 'liveEdit', 'battery', 'lighting', 'pointing', 'encoders'],
    // ZMK's in-tree shields on its Zephyr 3.5: solomon,ssd1306fb (corne),
    // sharp,ls0xx (nice_view), gooddisplay,il0323 (corneish_zen).
    displays: ['SSD1306', 'Sharp memory LCD', 'IL0323'],
    switches(config) {
        const auto = zmkConfAuto(config)
        const on = resolveZmkConfFlags(config)
        const fc = config.keyboard.firmwareConfig ?? {}
        return ZMK_ROWS.map((row) => {
            const o = fc[ZMK_FLAG_OVERRIDE[row.id]]
            const changed = typeof o === 'boolean' && o !== auto[row.id].on
            return {
                id: row.id,
                name: row.name,
                line: zmkLine(row, on[row.id]),
                on: on[row.id],
                changed,
                ...(row.sub ? { sub: true } : {}),
                ...shown(auto[row.id], on[row.id], changed),
            }
        })
    },
    set(config, id, value) {
        const flag = id as keyof ZmkConfFlags
        const key = ZMK_FLAG_OVERRIDE[flag]
        const fc: CanonFirmwareConfig = { ...config.keyboard.firmwareConfig }
        if (zmkConfAuto(config)[flag].on === value) delete fc[key]
        else (fc as Record<string, unknown>)[key] = value
        const next = withFirmwareConfig(config, fc)
        if (flag !== 'studioCdc' && flag !== 'studio') return next
        // Studio over USB also needs the CDC endpoint node in the overlay.
        const cdc = resolveZmkConfFlags(next).studioCdc
        return {
            ...next,
            keyboard: {
                ...next.keyboard,
                hardware: { ...next.keyboard.hardware, studioAcm: cdc || undefined },
            },
        }
    },
    reset(config) {
        const fc: CanonFirmwareConfig = { ...config.keyboard.firmwareConfig }
        for (const row of ZMK_ROWS) delete fc[ZMK_FLAG_OVERRIDE[row.id]]
        return withFirmwareConfig(config, fc)
    },
}

// ── QMK family (QMK, VIA, Vial share keyboard.json) ─────────────────────────

const QMK_NAME: Record<QmkFeature, string> = {
    bootmagic: 'Bootmagic (hold a key at plug-in to reset)',
    extrakey: 'Media and system keys',
    mousekey: 'Mouse keys',
    nkro: 'N-key rollover',
    rgblight: 'RGB lighting',
    backlight: 'Backlight',
    encoder: 'Encoders',
    pointing_device: 'Pointing device',
}

function qmkFeatureRows(config: ConfigKeymap): FirmwareSwitch[] {
    const auto = qmkFeaturesAuto(config)
    const on = resolveQmkFeatures(config)
    const over = config.keyboard.firmwareConfig?.qmkFeatures ?? {}
    return QMK_FEATURES.map((f) => {
        const value = on[f] ?? false
        const changed = over[f] !== undefined && over[f] !== auto[f].on
        return {
            id: f,
            name: QMK_NAME[f],
            line: `"${f}": ${value}`,
            on: value,
            changed,
            ...shown(auto[f], value, changed),
        }
    })
}

function setQmkFeature(
    config: ConfigKeymap,
    id: string,
    value: boolean,
): ConfigKeymap {
    const feature = id as QmkFeature
    if (!QMK_FEATURES.includes(feature)) return config
    const over = { ...config.keyboard.firmwareConfig?.qmkFeatures }
    if (qmkFeaturesAuto(config)[feature].on === value) delete over[feature]
    else over[feature] = value
    const fc: CanonFirmwareConfig = { ...config.keyboard.firmwareConfig }
    if (Object.keys(over).length) fc.qmkFeatures = over
    else delete fc.qmkFeatures
    return withFirmwareConfig(config, fc)
}

function resetQmk(config: ConfigKeymap): ConfigKeymap {
    const fc: CanonFirmwareConfig = { ...config.keyboard.firmwareConfig }
    delete fc.qmkFeatures
    return withFirmwareConfig(config, fc)
}

const QMK_FEATURE_CARDS: readonly DesignFeature[] = ['lighting', 'pointing', 'encoders']

/** QMK's OLED driver (SSD1306 / SH1106 / SH1107 over I²C or SPI) and Quantum
 *  Painter (ST7789 and other SPI LCDs, Arm only): docs.qmk.fm/features/
 *  oled_driver and docs.qmk.fm/quantum_painter. */
const QMK_DISPLAYS = ['SSD1306', 'SH1106', 'ST7789']

const qmkTable: SwitchTable = {
    file: 'keyboard.json',
    features: QMK_FEATURE_CARDS,
    displays: QMK_DISPLAYS,
    switches: qmkFeatureRows,
    set: setQmkFeature,
    reset: resetQmk,
}

/** VIA and Vial: the QMK switches plus the line that makes them editable
 *  live — picking the target is what turns it on. */
function liveEditTable(name: string, line: string): SwitchTable {
    return {
        file: 'keyboard.json',
        features: ['liveEdit', ...QMK_FEATURE_CARDS],
        displays: QMK_DISPLAYS,
        switches: (config) => [
            {
                id: 'liveEdit',
                name: `Edit live with ${name}`,
                line,
                on: true,
                changed: false,
                fixed: true,
                from: `the ${name} target`,
            },
            ...qmkFeatureRows(config),
        ],
        set: setQmkFeature,
        reset: resetQmk,
    }
}

// ── Remappr ─────────────────────────────────────────────────────────────────

/** Remappr's radio, live editing and idle sleep are part of the firmware; its
 *  board files turn on the rest from the pins the design sets. */
const remapprTable: SwitchTable = {
    file: 'Kconfig.defconfig',
    features: [
        'wireless',
        'liveEdit',
        'battery',
        'lighting',
        'pointing',
        'encoders',
        'analog',
    ],
    // Its Zephyr's display bindings: solomon,ssd1306fb, sinowealth,sh1106
    // (on the rig), sitronix,st7789v, sharp,ls0xx.
    displays: ['SSD1306', 'SH1106', 'ST7789', 'Sharp memory LCD'],
    switches(config) {
        const built = (id: string, name: string): FirmwareSwitch => ({
            id,
            name,
            line: 'built in',
            on: true,
            changed: false,
            fixed: true,
        })
        const byPin = (
            id: string,
            name: string,
            line: string,
            on: boolean,
            from: string,
        ): FirmwareSwitch => ({
            id,
            name,
            line,
            on,
            changed: false,
            fixed: true,
            ...(on ? { from } : { hint: `set ${from} to turn it on` }),
        })
        return [
            built('wireless', 'Wireless'),
            built('liveEdit', 'Edit live'),
            built('sleep', 'Sleep when idle'),
            byPin(
                'lighting',
                'RGB lighting',
                'config REMAPPR_RGB_LED',
                !!config.keyboard.hardware?.ws2812,
                'the LED data pin',
            ),
            byPin(
                'encoders',
                'Encoders',
                'config INPUT_GPIO_QDEC',
                !!config.board?.encoders?.length,
                'the encoder pins',
            ),
            byPin(
                'pointing',
                'Pointing sensor',
                'sensor node in the overlay',
                !!config.board?.sensor,
                'the sensor pins',
            ),
            byPin(
                'display',
                'Screen',
                'config REMAPPR_OLED',
                screenFor(config, 'remappr'),
                'a screen it has a driver for',
            ),
            byPin(
                'battery',
                'Battery',
                'battery node in the overlay',
                !!config.keyboard.hardware?.battery?.pin,
                'the battery sense pin',
            ),
        ]
    },
    set: (config) => config,
    reset: (config) => config,
}

export const FIRMWARE_SWITCHES: Record<BuilderFirmwareId, SwitchTable> = {
    zmk: zmkTable,
    qmk: qmkTable,
    via: liveEditTable('VIA', 'VIA_ENABLE = yes'),
    vial: liveEditTable('Vial', 'VIAL_ENABLE = yes'),
    remappr: remapprTable,
}

/** The firmware has options for `feature` (a screen: a driver for one). */
export function supportsFeature(
    target: BuilderFirmwareId,
    feature: DesignFeature,
): boolean {
    const table = FIRMWARE_SWITCHES[target]
    if (feature === 'display') return table.displays.length > 0
    return table.features.includes(feature)
}

// ── Feature cards ───────────────────────────────────────────────────────────

export interface DesignFeatureCard {
    readonly id: DesignFeature
    readonly name: string
    readonly blurb: string
    /** What it needs wired, when anything. */
    readonly needs?: string
    /** Connection and power, or a part on the design. */
    readonly group: 'connection' | 'part'
}

/** The cards, in order — the same for every design: any part can go on any
 *  keyboard or device. What each turns on is up to each firmware's table. */
export const DESIGN_FEATURES: readonly DesignFeatureCard[] = [
    {
        id: 'wireless',
        name: 'Wireless',
        blurb: 'Bluetooth, or a 2.4 GHz dongle.',
        group: 'connection',
    },
    {
        id: 'liveEdit',
        name: 'Edit live from the app',
        blurb: 'Change keys and buttons without reflashing.',
        group: 'connection',
    },
    {
        id: 'battery',
        name: 'Battery & sleep',
        blurb: 'Sleeps when idle; a key or move wakes it.',
        needs: 'battery sense pin',
        group: 'connection',
    },
    {
        id: 'lighting',
        name: 'Lighting',
        blurb: 'Underglow or per-key LEDs.',
        needs: 'LED data pin',
        group: 'connection',
    },
    {
        id: 'pointing',
        name: 'Motion sensor',
        blurb: 'Optical sensor or trackball, on SPI.',
        needs: 'SPI bus, chip select, motion pin',
        group: 'part',
    },
    {
        id: 'encoders',
        name: 'Encoders',
        blurb: 'A scroll wheel or rotary knobs.',
        needs: '2 pins each',
        group: 'part',
    },
    {
        id: 'analog',
        name: 'Analog inputs',
        blurb: 'Sticks, triggers, sliders.',
        needs: '1 analog pin per axis',
        group: 'part',
    },
    {
        id: 'display',
        name: 'Screen',
        blurb: 'An OLED, LCD or e-paper screen.',
        needs: 'its bus’s pins',
        group: 'part',
    },
]

/** Firmware ids that have a driver for screen chip `chip`. */
export function firmwareForDisplay(chip: string): BuilderFirmwareId[] {
    return (Object.keys(FIRMWARE_SWITCHES) as BuilderFirmwareId[]).filter(
        (id) => FIRMWARE_SWITCHES[id].displays.includes(chip),
    )
}

/** The cards a new design starts with, by its kind. Only a suggestion:
 *  every card stays there for every design. */
export const SUGGESTED_FEATURES: Readonly<
    Record<DeviceForm, readonly DesignFeature[]>
> = {
    keyboard: ['wireless', 'liveEdit', 'battery'],
    macropad: ['liveEdit', 'encoders'],
    mouse: ['wireless', 'liveEdit', 'battery', 'pointing', 'encoders'],
    gamepad: ['wireless', 'liveEdit', 'battery', 'analog'],
    flightstick: ['wireless', 'liveEdit', 'battery', 'analog'],
}

/** `config` with `feature` picked or not. */
export function setDesignFeature(
    config: ConfigKeymap,
    feature: DesignFeature,
    on: boolean,
): ConfigKeymap {
    const cur = new Set(config.keyboard.features ?? [])
    if (on) cur.add(feature)
    else cur.delete(feature)
    const features = DESIGN_FEATURES.map((f) => f.id).filter((f) => cur.has(f))
    return { ...config, keyboard: { ...config.keyboard, features } }
}
