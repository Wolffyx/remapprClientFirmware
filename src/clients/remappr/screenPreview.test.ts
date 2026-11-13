// pattern-check: skip vitest cases mirroring firmware tests/canvas and tests/screen
import { describe, expect, it } from 'vitest'
import type { ConfigScreenWidget } from '../../config/types'
import {
    canvasBitmap,
    canvasFill,
    canvasFrame,
    canvasGet,
    canvasSet,
    canvasText,
    clockText,
    createCanvas,
    drawWidget,
    logicalSize,
    logicalToPanelRect,
    panelToLogical,
    renderScreenPage,
    textWidth,
    toPanel,
} from './screenPreview'
import { imageFromRgba, packRows, ditherGrey, rgbaToGrey } from './screenImage'

/** Rows of '#' / '.' for a w x h region of a panel bitmap. */
const art = (px: Uint8Array, pw: number, x: number, y: number, w: number, h: number): string[] =>
    Array.from({ length: h }, (_, r) =>
        Array.from({ length: w }, (_, c) => (px[(y + r) * pw + x + c] ? '#' : '.')).join(''),
    )

describe('screen canvas (firmware tests/canvas)', () => {
    it('pixels and clipping', () => {
        const cv = createCanvas(16, 16)
        canvasFill(cv, -4, -4, 40, 40, true)
        expect(canvasGet(cv, 0, 0) && canvasGet(cv, 15, 15)).toBe(true)
        expect(canvasGet(cv, 16, 0)).toBe(false)
        expect(cv.buf[0]).toBe(0xff)
        const b = createCanvas(16, 16)
        canvasSet(b, 0, 0, true)
        expect(b.buf[0]).toBe(0x80) // bit 7 = leftmost
        canvasFrame(b, 2, 2, 4, 3)
        expect(canvasGet(b, 2, 2) && canvasGet(b, 5, 4)).toBe(true)
        expect(canvasGet(b, 3, 3)).toBe(false) // outline only
    })

    it('text', () => {
        const cv = createCanvas(64, 16)
        expect(canvasText(cv, 0, 0, [0x49], 1)).toBe(6) // "I"
        expect(canvasGet(cv, 0, 0)).toBe(false)
        expect(canvasGet(cv, 1, 0) && canvasGet(cv, 3, 0)).toBe(true)
        expect(canvasGet(cv, 2, 3)).toBe(true)
        expect(canvasGet(cv, 1, 3)).toBe(false)
        expect(canvasGet(cv, 5, 0)).toBe(false) // spacing column
        expect(textWidth(3, 2)).toBe(36)
        const q = createCanvas(16, 16)
        canvasText(q, 0, 0, [0x01], 1) // outside 0x20-0x7E draws '?'
        expect(canvasGet(q, 1, 0)).toBe(true) // '?' top row .###.
    })

    it('bitmap rows, MSB first', () => {
        const cv = createCanvas(16, 16)
        canvasBitmap(cv, 1, 1, 3, 2, [0xa0, 0x40])
        expect(canvasGet(cv, 1, 1) && canvasGet(cv, 3, 1)).toBe(true)
        expect(canvasGet(cv, 2, 1)).toBe(false)
        expect(canvasGet(cv, 2, 2)).toBe(true)
    })

    it('rotation, clockwise, as the panel shows it', () => {
        expect(logicalSize(16, 8, 1)).toEqual({ width: 8, height: 16 })
        const r = createCanvas(8, 16)
        canvasSet(r, 0, 0, true)
        // 90: logical top-left lands at the physical top-right.
        const p90 = toPanel(r, 16, 8, 1, false)
        expect(p90[15]).toBe(1)
        expect(p90[0]).toBe(0)
        const sq = createCanvas(16, 16)
        canvasSet(sq, 0, 0, true)
        expect(toPanel(sq, 16, 16, 2, false)[15 * 16 + 15]).toBe(1) // 180: bottom-right
        expect(toPanel(sq, 16, 16, 3, false)[15 * 16]).toBe(1) // 270: bottom-left
        // Invert at flush: everything else lit.
        const inv = toPanel(sq, 16, 16, 0, true)
        expect(inv[0]).toBe(0)
        expect(inv[1]).toBe(1)
    })
})

describe('panel <-> logical', () => {
    it('round-trips every pixel at every rotation', () => {
        for (const rot of [0, 1, 2, 3]) {
            const { width, height } = logicalSize(16, 8, rot)
            const c = createCanvas(width, height)
            canvasSet(c, 2, 5, true)
            const px = toPanel(c, 16, 8, rot, false)
            const at = px.indexOf(1)
            expect(panelToLogical(at % 16, Math.floor(at / 16), 16, 8, rot)).toEqual({ x: 2, y: 5 })
            expect(logicalToPanelRect({ x: 2, y: 5, w: 1, h: 1 }, 16, 8, rot)).toEqual({
                x: at % 16,
                y: Math.floor(at / 16),
                w: 1,
                h: 1,
            })
        }
    })

    it('a box turns with the panel', () => {
        // 90 on a 128x64 panel: logical 64x128; box (0,0,10,4) -> top-right strip.
        expect(logicalToPanelRect({ x: 0, y: 0, w: 10, h: 4 }, 128, 64, 1)).toEqual({ x: 124, y: 0, w: 4, h: 10 })
    })
})

describe('screen widgets (firmware screen.c)', () => {
    const w = (p: Partial<ConfigScreenWidget>): ConfigScreenWidget => ({
        kind: 'text',
        x: 0,
        y: 0,
        w: 32,
        h: 8,
        ...p,
    })

    it('text: as many characters as fit, aligned, centred vertically', () => {
        const cv = createCanvas(32, 16)
        drawWidget(cv, w({ text: 'IIIIII', w: 20, h: 16, align: 'right' }), () => undefined)
        // fit = 20 / 6 = 3 glyphs, 18 px wide, dx = 2, dy = (16 - 8) / 2 = 4.
        expect(canvasGet(cv, 2 + 1, 4)).toBe(true)
        expect(canvasGet(cv, 2 + 1, 3)).toBe(false)
        expect(canvasGet(cv, 21, 4)).toBe(false) // no fourth glyph
    })

    it('value: the text, the number, or "--"', () => {
        const values = (s: string): number | string | undefined =>
            ({ battery: 87, activeLayer: 'Base' })[s]
        const a = createCanvas(32, 8)
        const b = createCanvas(32, 8)
        canvasText(b, 0, 0, [0x38, 0x37], 1)
        drawWidget(a, w({ kind: 'value', source: 'battery' }), values)
        expect(a.buf).toEqual(b.buf)
        const none = createCanvas(32, 8)
        const dash = createCanvas(32, 8)
        canvasText(dash, 0, 0, [0x2d, 0x2d], 1)
        drawWidget(none, w({ kind: 'value', source: 'host.cpu' }), values)
        expect(none.buf).toEqual(dash.buf)
    })

    it('bar: frame and a fill of (w - 2) * value / max', () => {
        const cv = createCanvas(32, 8)
        drawWidget(cv, w({ kind: 'bar', w: 12, h: 4, source: 'host.cpu', max: 100 }), () => 50)
        const px = toPanel(cv, 32, 8, 0, false)
        expect(art(px, 32, 0, 0, 12, 4)).toEqual([
            '############',
            '######.....#',
            '######.....#',
            '############',
        ])
    })

    it('rect, frame and invert', () => {
        const cv = createCanvas(8, 4)
        drawWidget(cv, w({ kind: 'rect', w: 4, h: 3, frame: true, invert: true }), () => undefined)
        expect(art(toPanel(cv, 8, 4, 0, false), 8, 0, 0, 5, 3)).toEqual(['.....', '.##..', '.....'])
    })

    it('clock: from the time value, dashes without one', () => {
        // 2026-11-12 14:05:09 local seconds since 1970.
        const t = Date.UTC(2026, 10, 12, 14, 5, 9) / 1000
        expect(clockText('hm', t)).toBe('14:05')
        expect(clockText('hms', t)).toBe('14:05:09')
        expect(clockText('date', t)).toBe('2026-11-12')
        expect(clockText('hms', undefined)).toBe('--:--:--')
        expect(clockText('date', undefined)).toBe('----------')
    })

    it('renders a page on a rotated, inverted panel', () => {
        const page = { widgets: [w({ kind: 'rect', x: 0, y: 0, w: 1, h: 1 })] }
        // 16x8 panel turned 90: the logical top-left pixel is physical (15, 0).
        const px = renderScreenPage(page, { width: 16, height: 8, rotation: 1 })
        expect(px.length).toBe(128)
        expect(px[15]).toBe(1)
        expect(px.reduce((a, b) => a + b, 0)).toBe(1)
        const inv = renderScreenPage(page, { width: 16, height: 8, rotation: 1, invert: true })
        expect(inv.reduce((a, b) => a + b, 0)).toBe(127)
    })
})

describe('screen image', () => {
    it('packs rows MSB first, whole bytes per row', () => {
        expect(Array.from(packRows([1, 0, 1, 0, 0, 0, 0, 0, 1, 0], 10, 1))).toEqual([0xa0, 0x80])
    })

    it('lights bright pixels, transparent as unlit, inverts on ask', () => {
        const rgba = [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0]
        const grey = rgbaToGrey(rgba, 3, 1)
        expect(Array.from(ditherGrey(grey, 3, 1, { dither: false }))).toEqual([1, 0, 0])
        expect(Array.from(ditherGrey(grey, 3, 1, { dither: false, invert: true }))).toEqual([0, 1, 1])
    })

    it('dithers mid grey to about half lit', () => {
        const lit = ditherGrey(new Array(64).fill(128), 8, 8)
        const on = lit.reduce((a, b) => a + b, 0)
        expect(on).toBeGreaterThan(24)
        expect(on).toBeLessThan(40)
    })

    it('gives what an IMAGE widget carries', () => {
        const img = imageFromRgba(new Array(9 * 2 * 4).fill(255), 9, 2)
        expect(img.width).toBe(9)
        expect(atob(img.data).length).toBe(4) // 2 bytes x 2 rows
    })
})
