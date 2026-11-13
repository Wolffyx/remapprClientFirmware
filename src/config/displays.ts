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
//
// `area` is the visible (active) area in mm — the size a screen is drawn at.
// From the panels' spec sheets: 0.91" 128×32 22.384×5.584 (EastRising
// ER-OLED0.91-1), 0.96" 128×64 21.74×10.86 (SunFounder / Wc096-12864),
// 1.3" 128×64 SH1106 29.42×14.7 (Pololu 3760), nice!view = Sharp
// LS011B7DH03 1.08" 25.28×10.744 (Sharp lineup / DigiKey), 1.02" e-paper
// 80×128 GooDisplay GDEW0102T4 14.00×21.76 portrait (GooDisplay selection
// guide), 1.3" 240×240 ST7789 23.4×23.4 (0.0975 mm pitch × 240).
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
    /** Diagonal of the visible area, inches (how modules are sold). */
    readonly diagonal: number
    /** Visible area, mm, in the picture's own orientation. */
    readonly area: { readonly w: number; readonly h: number }
    /** I²C address. */
    readonly address?: number
    /** Its own pins, besides the bus. */
    readonly pins: readonly DisplayPin[]
}

export const DISPLAY_MODULES: readonly DisplayModule[] = [
    { id: 'ssd1306-128x32', name: 'OLED 0.91″ 128×32', chip: 'SSD1306', bus: 'i2c', width: 128, height: 32, diagonal: 0.91, area: { w: 22.384, h: 5.584 }, address: 0x3c, pins: [] },
    { id: 'ssd1306-128x64', name: 'OLED 0.96″ 128×64', chip: 'SSD1306', bus: 'i2c', width: 128, height: 64, diagonal: 0.96, area: { w: 21.74, h: 10.86 }, address: 0x3c, pins: [] },
    { id: 'sh1106-128x64', name: 'OLED 1.3″ 128×64', chip: 'SH1106', bus: 'i2c', width: 128, height: 64, diagonal: 1.3, area: { w: 29.42, h: 14.7 }, address: 0x3c, pins: [] },
    { id: 'nice-view', name: 'nice!view 1.08″', chip: 'Sharp memory LCD', bus: 'spi', width: 160, height: 68, diagonal: 1.08, area: { w: 25.28, h: 10.744 }, pins: ['cs'] },
    { id: 'il0323-80x128', name: 'E-paper 1.02″ 80×128', chip: 'IL0323', bus: 'spi', width: 80, height: 128, diagonal: 1.02, area: { w: 14.0, h: 21.76 }, pins: ['cs', 'dc', 'rst', 'busy'] },
    { id: 'st7789-240x240', name: 'Colour LCD 1.3″ 240×240', chip: 'ST7789', bus: 'spi', width: 240, height: 240, diagonal: 1.3, area: { w: 23.4, h: 23.4 }, pins: ['cs', 'dc', 'rst'] },
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

/** One key unit, mm (the 19.05 mm / 0.75 in key pitch the layout grid uses). */
const KEY_UNIT_MM = 19.05

/** The size a screen is drawn at, in key units: its module's visible area;
 *  undefined for a screen set up by hand (no module). */
export function displaySize(
    d: CanonDisplay | undefined,
): { w: number; h: number } | undefined {
    const m = displayModule(d?.module)
    if (!m) return undefined
    const u = (mm: number): number => Math.round((mm / KEY_UNIT_MM) * 100) / 100
    return { w: u(m.area.w), h: u(m.area.h) }
}
