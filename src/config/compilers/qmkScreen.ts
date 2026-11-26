// Pattern check: Dispatch Map (Tier 0) — applied — screen chip → QMK driver
// lines as one table (OLED driver or Quantum Painter), no branch per chip.
//
// The board's screen as QMK rules.mk / config.h lines. Option names come from
// docs.qmk.fm/features/oled_driver (OLED_ENABLE, OLED_DRIVER = ssd1306 for
// SSD1306 / SH1106 / SH1107, OLED_TRANSPORT i2c|spi, OLED_IC, OLED_DISPLAY_*,
// OLED_DISPLAY_ADDRESS default 0x3C, OLED_DC_PIN / OLED_CS_PIN required on
// SPI, OLED_RST_PIN optional) and docs.qmk.fm/quantum_painter
// (QUANTUM_PAINTER_ENABLE, QUANTUM_PAINTER_DRIVERS += st7789_spi; no AVR).
import { resolveController } from '../controller'
import { resolveQmkPin } from '../pinmaps'
import type { CanonDisplay, CanonPart, ConfigKeymap } from '../types'
import { boardScreen } from './zephyrParts'

interface QmkLines {
    rules: string[]
    configH: string[]
}

/** OLED driver size presets (docs: 128x32 is the default). */
const OLED_SIZE: Readonly<Record<string, string | null>> = {
    '128x32': null,
    '128x64': 'OLED_DISPLAY_128X64',
    '64x32': 'OLED_DISPLAY_64X32',
    '64x48': 'OLED_DISPLAY_64X48',
    '64x128': 'OLED_DISPLAY_64X128',
    '128x128': 'OLED_DISPLAY_128X128',
}

type Writer = (d: CanonDisplay, pin: (key: string) => string | null) => QmkLines

/** The QMK OLED driver, for an SSD1306 or SH1106. */
const oled =
    (ic: string | null): Writer =>
    (d, pin) => {
        const size = `${d.width}x${d.height}`
        const preset = OLED_SIZE[size]
        const configH = [
            ...(ic ? [`#define OLED_IC ${ic}`] : []),
            ...(preset === undefined
                ? [`// ${size}: no OLED_DISPLAY_ preset — set OLED_DISPLAY_CUSTOM and its sizes.`]
                : preset
                  ? [`#define ${preset}`]
                  : []),
        ]
        if (d.bus === 'i2c' && d.address !== undefined && d.address !== 0x3c)
            configH.push(`#define OLED_DISPLAY_ADDRESS 0x${d.address.toString(16).toUpperCase()}`)
        if (d.bus === 'spi') {
            for (const [key, name] of [
                ['dc', 'OLED_DC_PIN'],
                ['cs', 'OLED_CS_PIN'],
                ['rst', 'OLED_RST_PIN'],
            ] as const) {
                const p = pin(key)
                configH.push(p ? `#define ${name} ${p}` : `// #define ${name} — set its pin in the builder`)
            }
        }
        configH.push(`// Draw on it in oled_task_user() (keymap.c).`)
        return {
            rules: [`OLED_ENABLE = yes`, `OLED_DRIVER = ssd1306`, `OLED_TRANSPORT = ${d.bus === 'spi' ? 'spi' : 'i2c'}`],
            configH,
        }
    }

/** Quantum Painter's ST7789 driver: the panel is made in keymap.c. */
const st7789: Writer = (d, pin) => ({
    rules: [`QUANTUM_PAINTER_ENABLE = yes`, `QUANTUM_PAINTER_DRIVERS += st7789_spi`],
    configH: [
        `// ST7789 ${d.width}×${d.height} via Quantum Painter (Arm only, no AVR): create it with`,
        `// qp_st7789_make_spi_device(${d.width}, ${d.height}, CS ${pin('cs') ?? '?'}, DC ${pin('dc') ?? '?'}, RST ${pin('rst') ?? '?'}, …) in keymap.c.`,
    ],
})

const WRITERS: Readonly<Record<string, Writer>> = {
    SSD1306: oled(null),
    SH1106: oled('OLED_IC_SH1106'),
    ST7789: st7789,
}

function partPin(p: CanonPart, board: string | undefined): (key: string) => string | null {
    return (key) => {
        const label = p.pins?.[key]?.trim()
        return label ? resolveQmkPin(board, label) : null
    }
}

/** The screen's rules.mk and config.h lines (empty without a screen). */
export function qmkScreenLines(config: ConfigKeymap): QmkLines {
    const screen = boardScreen(config)
    if (!screen) return { rules: [], configH: [] }
    const d = screen.display
    const writer = WRITERS[d.chip]
    if (!writer || d.bus === 'uart')
        return { rules: [], configH: [`// Screen ${d.chip} (${d.bus.toUpperCase()}): QMK has no driver for it.`] }
    const out = writer(d, partPin(screen, resolveController(config).board))
    if (d.rotation)
        out.configH.push(`// Turned ${d.rotation}°: rotate it in oled_init_user() (see the OLED driver docs).`)
    return { rules: [`# Screen: ${d.chip} ${d.width}×${d.height}`, ...out.rules], configH: [`// ── Screen ──`, ...out.configH] }
}
