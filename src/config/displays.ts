// Pattern check: no GoF pattern (-) — rejected — screen module facts as a data
// table plus pure lookups; every module is a row, no per-module code.
//
// The screens a design can carry: common modules, each with its controller
// chip, bus and size, so picking one tile sets everything the pins and the
// firmware need. Sources: ZMK's in-tree shields (corne.dtsi SSD1306 128×32
// at 0x3C, nice_view.overlay sharp,ls0xx 160×68, corneish_zen IL0323 80×128),
// the Remappr rig overlay (SH1106 128×64 at 0x3C), the QMK OLED driver's
// tested table (SSD1306 128×64) and Quantum Painter's device table (ST7789
// 240×240). Which firmware drives which chip is each firmware's own table
// (FIRMWARE_SWITCHES `displays`).
import type { CanonDisplay, DisplayBus } from './types'

/** A pin a screen needs besides its bus's own lines. */
export type DisplayPin = 'cs' | 'dc' | 'rst' | 'busy' | 'tx' | 'rx'

export interface DisplayModule {
    readonly id: string
    readonly name: string
    /** Controller chip, as each firmware's driver table names it. */
    readonly chip: string
    readonly bus: DisplayBus
    readonly width: number
    readonly height: number
    /** I²C address. */
    readonly address?: number
    /** Its own pins, besides the bus. */
    readonly pins: readonly DisplayPin[]
}

export const DISPLAY_MODULES: readonly DisplayModule[] = [
    { id: 'ssd1306-128x32', name: 'OLED 128×32', chip: 'SSD1306', bus: 'i2c', width: 128, height: 32, address: 0x3c, pins: [] },
    { id: 'ssd1306-128x64', name: 'OLED 128×64', chip: 'SSD1306', bus: 'i2c', width: 128, height: 64, address: 0x3c, pins: [] },
    { id: 'sh1106-128x64', name: 'OLED 128×64', chip: 'SH1106', bus: 'i2c', width: 128, height: 64, address: 0x3c, pins: [] },
    { id: 'nice-view', name: 'nice!view', chip: 'Sharp memory LCD', bus: 'spi', width: 160, height: 68, pins: ['cs'] },
    { id: 'il0323-80x128', name: 'E-paper 80×128', chip: 'IL0323', bus: 'spi', width: 80, height: 128, pins: ['cs', 'dc', 'rst', 'busy'] },
    { id: 'st7789-240x240', name: 'Colour LCD 240×240', chip: 'ST7789', bus: 'spi', width: 240, height: 240, pins: ['cs', 'dc', 'rst'] },
]

/** A screen set up by hand ("Other…") needs these on each bus. */
const BUS_PINS: Readonly<Record<DisplayBus, readonly DisplayPin[]>> = {
    i2c: [],
    spi: ['cs', 'dc', 'rst'],
    uart: ['tx', 'rx'],
}

export const DISPLAY_PIN_NAMES: Readonly<Record<DisplayPin, string>> = {
    cs: 'chip select',
    dc: 'data / command',
    rst: 'reset',
    busy: 'busy',
    tx: 'TX',
    rx: 'RX',
}

export function displayModule(id: string | undefined): DisplayModule | undefined {
    return DISPLAY_MODULES.find((m) => m.id === id)
}

/** The screen settings a module tile sets. */
export function displayFromModule(m: DisplayModule): CanonDisplay {
    return {
        module: m.id,
        chip: m.chip,
        bus: m.bus,
        width: m.width,
        height: m.height,
        ...(m.address !== undefined ? { address: m.address } : {}),
    }
}

/** The pins `d` needs besides its bus: its module's, else its bus's. */
export function displayPins(d: CanonDisplay): readonly DisplayPin[] {
    return displayModule(d.module)?.pins ?? BUS_PINS[d.bus]
}
