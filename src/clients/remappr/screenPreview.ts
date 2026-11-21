// Pattern check: no GoF pattern (-) — rejected — pure drawing functions over one canvas struct mirroring firmware canvas.c; widget drawing is a Dispatch Map (Tier 0) by kind.
//
// What a display shows, drawn here the way the device draws it, so an editor
// can preview a page pixel for pixel. Mirrors firmware lib/ui/canvas/canvas.c
// (1-bit canvas, the 5x7 font, rotation + invert at flush) and
// subsys/remappr/ui/screen/screen.c (how each widget kind is drawn, "--" for
// a value the device does not have). Keep in step with both.
import type { ConfigScreenPage, ConfigScreenWidget } from '../../config/types'
import { FONT_5X7, FONT_CELL_H, FONT_CELL_W, FONT_FIRST, FONT_ROWS } from './screenFont'

/** A 1-bit canvas: rows of whole bytes, bit 7 = leftmost (canvas.c). */
export interface ScreenCanvas {
    readonly w: number
    readonly h: number
    readonly buf: Uint8Array
}

/** Longest value text a widget shows (firmware REMAPPR_SCREEN_TEXT_MAX). */
export const SCREEN_VALUE_TEXT_MAX = 24

const stride = (c: ScreenCanvas): number => (c.w + 7) >> 3
const inside = (c: ScreenCanvas, x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < c.w && y < c.h

export function createCanvas(w: number, h: number): ScreenCanvas {
    return { w, h, buf: new Uint8Array(((w + 7) >> 3) * h) }
}

export function canvasSet(c: ScreenCanvas, x: number, y: number, on: boolean): void {
    if (!inside(c, x, y)) return
    const i = y * stride(c) + (x >> 3)
    const bit = 0x80 >> (x & 7)
    c.buf[i] = on ? c.buf[i] | bit : c.buf[i] & ~bit
}

export function canvasGet(c: ScreenCanvas, x: number, y: number): boolean {
    if (!inside(c, x, y)) return false
    return (c.buf[y * stride(c) + (x >> 3)] & (0x80 >> (x & 7))) !== 0
}

/** [x0, x1) x [y0, y1) clipped to the canvas, or null when nothing is left. */
function clip(c: ScreenCanvas, x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, x)
    const y0 = Math.max(0, y)
    const x1 = Math.min(c.w, x + w)
    const y1 = Math.min(c.h, y + h)
    return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null
}

function eachPixel(
    c: ScreenCanvas,
    box: [number, number, number, number],
    fn: (x: number, y: number) => void,
): void {
    const r = clip(c, ...box)
    if (!r) return
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) fn(x, y)
}

export function canvasFill(
    c: ScreenCanvas,
    x: number,
    y: number,
    w: number,
    h: number,
    on = true,
): void {
    eachPixel(c, [x, y, w, h], (px, py) => canvasSet(c, px, py, on))
}

export function canvasInvert(c: ScreenCanvas, x: number, y: number, w: number, h: number): void {
    eachPixel(c, [x, y, w, h], (px, py) => canvasSet(c, px, py, !canvasGet(c, px, py)))
}

export function canvasFrame(c: ScreenCanvas, x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return
    canvasFill(c, x, y, w, 1)
    canvasFill(c, x, y + h - 1, w, 1)
    canvasFill(c, x, y, 1, h)
    canvasFill(c, x + w - 1, y, 1, h)
}

export const textWidth = (len: number, scale = 1): number => len * FONT_CELL_W * scale

/** The glyph rows of byte @p code ('?' for anything outside 0x20-0x7E). */
function glyph(code: number): readonly number[] {
    const i = code - FONT_FIRST
    return FONT_5X7[i >= 0 && i < FONT_5X7.length ? i : 0x3f - FONT_FIRST]
}

/** Draws @p bytes (one glyph each) at (x, y), `scale` px per font pixel.
 *  @return the width drawn. */
export function canvasText(
    c: ScreenCanvas,
    x: number,
    y: number,
    bytes: ArrayLike<number>,
    scale = 1,
): number {
    for (let i = 0; i < bytes.length; i++) {
        const g = glyph(bytes[i])
        const cx = x + i * FONT_CELL_W * scale
        for (let r = 0; r < FONT_ROWS; r++) {
            for (let col = 0; col < 5; col++) {
                if ((g[r] >> (4 - col)) & 1) {
                    canvasFill(c, cx + col * scale, y + r * scale, scale, scale)
                }
            }
        }
    }
    return textWidth(bytes.length, scale)
}

/** Lights the set bits of 1-bit @p rows (w x h, rows of whole bytes, MSB
 *  first) at (x, y). */
export function canvasBitmap(
    c: ScreenCanvas,
    x: number,
    y: number,
    w: number,
    h: number,
    rows: ArrayLike<number>,
): void {
    const rs = (w + 7) >> 3
    for (let r = 0; r < h; r++) {
        for (let col = 0; col < w; col++) {
            if ((rows[r * rs + (col >> 3)] ?? 0) & (0x80 >> (col & 7))) {
                canvasSet(c, x + col, y + r, true)
            }
        }
    }
}

/* ---- rotation ------------------------------------------------------------ */

/** Display part ROTATION codes: clockwise quarter turns. */
export type ScreenRotation = 0 | 1 | 2 | 3

/** The size widgets see on a pw x ph panel turned @p rot. */
export function logicalSize(
    pw: number,
    ph: number,
    rot: number,
): { width: number; height: number } {
    return rot & 1 ? { width: ph, height: pw } : { width: pw, height: ph }
}

/* Physical (px, py) -> logical: l = a*px + b*py, a negative coefficient adding
 * that dimension - 1 (canvas.c rot_map). */
const ROT_MAP: readonly (readonly [number, number, number, number])[] = [
    [1, 0, 0, 1],
    [0, 1, -1, 0],
    [-1, 0, 0, -1],
    [0, -1, 1, 0],
]

const coord = (a: number, b: number, px: number, py: number, pw: number, ph: number): number =>
    a * px + b * py + (a < 0 ? pw - 1 : 0) + (b < 0 ? ph - 1 : 0)

/**
 * The panel's pixels (pw x ph, one byte each, 1 = lit) for logical canvas
 * @p c turned @p rot and maybe inverted, as the display part flushes them.
 */
export function toPanel(
    c: ScreenCanvas,
    pw: number,
    ph: number,
    rot: number,
    invert: boolean,
): Uint8Array {
    const [ax, bx, ay, by] = ROT_MAP[rot >= 0 && rot < 4 ? rot : 0]
    const out = new Uint8Array(pw * ph)
    for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
            const lx = coord(ax, bx, px, py, pw, ph)
            const ly = coord(ay, by, px, py, pw, ph)
            out[py * pw + px] = canvasGet(c, lx, ly) !== invert ? 1 : 0
        }
    }
    return out
}

/** Panel pixel (px, py) -> the logical pixel it shows. */
export function panelToLogical(
    px: number,
    py: number,
    pw: number,
    ph: number,
    rot: number,
): { x: number; y: number } {
    const [ax, bx, ay, by] = ROT_MAP[rot >= 0 && rot < 4 ? rot : 0]
    return { x: coord(ax, bx, px, py, pw, ph), y: coord(ay, by, px, py, pw, ph) }
}

/* Logical (lx, ly) -> panel: the inverse of ROT_MAP per rotation. */
const INVERSE: readonly ((lx: number, ly: number, pw: number, ph: number) => [number, number])[] = [
    (lx, ly) => [lx, ly],
    (lx, ly, pw) => [pw - 1 - ly, lx],
    (lx, ly, pw, ph) => [pw - 1 - lx, ph - 1 - ly],
    (lx, ly, _pw, ph) => [ly, ph - 1 - lx],
]

/** Logical box (a widget's x, y, w, h) -> the panel box it lands on. */
export function logicalToPanelRect(
    box: { x: number; y: number; w: number; h: number },
    pw: number,
    ph: number,
    rot: number,
): { x: number; y: number; w: number; h: number } {
    const inv = INVERSE[rot >= 0 && rot < 4 ? rot : 0]
    const [ax, ay] = inv(box.x, box.y, pw, ph)
    const [bx, by] = inv(box.x + box.w - 1, box.y + box.h - 1, pw, ph)
    const x = Math.min(ax, bx)
    const y = Math.min(ay, by)
    return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 }
}

/* ---- widgets (screen.c) ---------------------------------------------------- */

/** A value a widget shows: a number, a text, or (the time) a Date. */
export type ScreenValue = number | string | Date

/** The value of a source by document name (`battery`, `host.cpu`, ...), or
 *  undefined when the device would not have one (drawn as "--"). */
export type ScreenValues = (source: string) => ScreenValue | undefined

const TIME_SOURCE = 'host.time'

/** Text -> the bytes the device stores (UTF-8; a byte outside printable
 *  ASCII draws as '?'). */
const textBytes = (s: string): Uint8Array => new TextEncoder().encode(s)

/** Printable ASCII only, as the compiler writes a TEXT widget. */
const asciiBytes = (s: string): number[] =>
    Array.from(s, (ch) => {
        const code = ch.charCodeAt(0)
        return code >= 0x20 && code <= 0x7e ? code : 0x3f
    })

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local seconds since 1970 of a Date (the device keeps no zone). */
const localSeconds = (d: Date): number =>
    Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60

function valueBytes(v: ScreenValue | undefined): Uint8Array {
    if (v === undefined) return textBytes('--')
    if (typeof v === 'string' && v.length > 0) {
        return textBytes(v).subarray(0, SCREEN_VALUE_TEXT_MAX)
    }
    const num = v instanceof Date ? localSeconds(v) : Number(v) || 0
    return textBytes(String(Math.trunc(num) | 0))
}

const numberOf = (v: ScreenValue | undefined): number => {
    if (v === undefined || typeof v === 'string') return 0
    return v instanceof Date ? localSeconds(v) : Math.trunc(v) | 0
}

const CLOCK_NONE: Record<NonNullable<ConfigScreenWidget['format']>, string> = {
    hm: '--:--',
    hms: '--:--:--',
    date: '----------',
}

/** What a clock widget shows for time @p t (a Date or local seconds). */
export function clockText(
    format: ConfigScreenWidget['format'],
    t: ScreenValue | undefined,
): string {
    const f = format ?? 'hm'
    if (t === undefined || typeof t === 'string') return CLOCK_NONE[f]
    const secs = (t instanceof Date ? localSeconds(t) : t) >>> 0
    const s = secs % 86400
    if (f === 'date') {
        const d = new Date(Math.floor(secs / 86400) * 86400 * 1000)
        return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    }
    const hm = `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}`
    return f === 'hms' ? `${hm}:${pad2(s % 60)}` : hm
}

/** Text in the widget's box: as many characters as fit, aligned, centred
 *  vertically. */
function boxedText(c: ScreenCanvas, w: ConfigScreenWidget, bytes: ArrayLike<number>): void {
    const scale = w.font === 'large' ? 2 : 1
    const fit = Math.floor(w.w / (FONT_CELL_W * scale))
    const n = Math.min(bytes.length, fit)
    const tw = textWidth(n, scale)
    const align = w.align ?? 'left'
    const dx = align === 'right' ? w.w - tw : align === 'centre' ? Math.trunc((w.w - tw) / 2) : 0
    const dy = Math.max(0, Math.trunc((w.h - FONT_CELL_H * scale) / 2))
    canvasText(c, w.x + dx, w.y + dy, Array.from(bytes).slice(0, n), scale)
}

function fromBase64(data: string): Uint8Array {
    try {
        return Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))
    } catch {
        return new Uint8Array() // not base64: the compiler reports it on save
    }
}

type Drawer = (c: ScreenCanvas, w: ConfigScreenWidget, values: ScreenValues) => void

/* Kind -> drawer (Dispatch Map), as screen.c's drawers[]. */
const DRAWERS: Record<ConfigScreenWidget['kind'], Drawer> = {
    text: (c, w) => boxedText(c, w, asciiBytes(w.text ?? '')),
    value: (c, w, values) =>
        boxedText(c, w, valueBytes(w.source === undefined ? undefined : values(w.source))),
    bar: (c, w, values) => {
        const max = w.max ?? 0
        const num = numberOf(w.source === undefined ? undefined : values(w.source))
        canvasFrame(c, w.x, w.y, w.w, w.h)
        if (max <= 0) return
        const clamped = Math.min(Math.max(num, 0), max)
        canvasFill(c, w.x + 1, w.y + 1, Math.trunc(((w.w - 2) * clamped) / max), w.h - 2)
    },
    image: (c, w) => {
        if (!w.image) return
        canvasBitmap(c, w.x, w.y, w.image.width, w.image.height, fromBase64(w.image.data))
    },
    clock: (c, w, values) => boxedText(c, w, asciiBytes(clockText(w.format, values(TIME_SOURCE)))),
    rect: (c, w) => {
        if (!w.frame) canvasFill(c, w.x, w.y, w.w, w.h)
    },
}

export function drawWidget(c: ScreenCanvas, w: ConfigScreenWidget, values: ScreenValues): void {
    DRAWERS[w.kind](c, w, values)
    if (w.frame) canvasFrame(c, w.x, w.y, w.w, w.h)
    if (w.invert) canvasInvert(c, w.x, w.y, w.w, w.h)
}

export interface ScreenPreviewOpts {
    /** The panel as built (GET_IO DISPLAY a / b), before rotation. */
    width: number
    height: number
    /** ROTATION setting (0..3, clockwise quarter turns). */
    rotation?: number
    /** INVERT setting. */
    invert?: boolean
    values?: ScreenValues
}

/**
 * Page @p page as the panel shows it: `width` x `height` bytes, 1 = lit,
 * row by row, after the part's rotation and inversion.
 */
export function renderScreenPage(
    page: ConfigScreenPage | undefined,
    opts: ScreenPreviewOpts,
): Uint8Array {
    const rot = opts.rotation ?? 0
    const { width, height } = logicalSize(opts.width, opts.height, rot)
    const c = createCanvas(width, height)
    const values = opts.values ?? (() => undefined)
    for (const w of page?.widgets ?? []) drawWidget(c, w, values)
    return toPanel(c, opts.width, opts.height, rot, opts.invert ?? false)
}
