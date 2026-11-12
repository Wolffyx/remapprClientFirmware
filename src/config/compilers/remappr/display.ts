// Pattern check: no GoF pattern (-) — rejected — pure encode/decode functions for TBL_DISPLAY mirroring joystick.ts / radio.ts; per-kind fields via a small dispatch map.
//
// What a device's displays show (a document's `displays`) <-> TBL_DISPLAY
// (table 31, version 1). Byte layout mirrors firmware include/remappr/screen.h
// and lib/config_blob/decode_display.c (display part design §3):
//
//   u8 page_count, u8 widget_count, u16 strings_len, u16 bitmaps_len, u16 0
//   page_count x {u8 part, u8 first_widget, u8 widget_count, u8 flags}
//   widget_count x {u8 kind, u8 flags, u8 x, u8 y, u8 w, u8 h, u8 font,
//                   u8 source, u16 arg, u16 arg2}
//   string pool, bitmap pool
import {
    CLOCK_FORMATS,
    PAGE_DEFAULT,
    SCREEN_ALIGN,
    SCREEN_FONTS,
    SCREEN_KINDS,
    type ScreenWidgetKind,
    W_ALIGN_MASK,
    W_ALIGN_SHIFT,
    W_FRAME,
    W_INVERT,
    screenSourceId,
    screenSourceName,
} from '../../../clients/remappr/screenRegistry'
import type {
    ConfigDisplay,
    ConfigScreenPage,
    ConfigScreenWidget,
} from '../../types'
import { ByteReader } from './decode'

/** What one device holds (firmware REMAPPR_SCREEN_*_MAX). */
export const SCREEN_LIMITS = {
    pages: 16,
    widgets: 64,
    strings: 1024,
    bitmaps: 4096,
} as const

const HDR_LEN = 8
const PAGE_LEN = 4
const WIDGET_LEN = 12

/** A display document that cannot be written, and where. */
export interface DisplayProblem {
    path: (string | number)[]
    message: string
}

interface WidgetRecord {
    kind: number
    flags: number
    x: number
    y: number
    w: number
    h: number
    font: number
    source: number
    arg: number
    arg2: number
}

/** Pools shared by every widget of the table (strings deduplicated). */
interface Pools {
    strings: number[]
    stringAt: Map<string, number>
    bitmaps: number[]
}

const ascii = (s: string): number[] =>
    Array.from(s, (c) => {
        const code = c.charCodeAt(0)
        return code >= 0x20 && code <= 0x7e ? code : 0x3f // '?'
    })

function fromBase64(data: string): number[] | undefined {
    try {
        return Array.from(atob(data), (c) => c.charCodeAt(0))
    } catch {
        return undefined // not base64: reported by the caller
    }
}

const toBase64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))

type KindFields = (
    w: ConfigScreenWidget,
    pools: Pools,
) => Pick<WidgetRecord, 'source' | 'arg' | 'arg2'> | string

/* Kind -> its source / arg / arg2, or why it cannot be written (Dispatch Map). */
const KIND_FIELDS: Record<ScreenWidgetKind, KindFields> = {
    text: (w, pools) => {
        const bytes = ascii(w.text ?? '')
        const key = String.fromCharCode(...bytes)
        let at = pools.stringAt.get(key)
        if (at === undefined) {
            at = pools.strings.length
            pools.strings.push(...bytes)
            pools.stringAt.set(key, at)
        }
        return { source: 0, arg: at, arg2: bytes.length }
    },
    value: (w) => sourceFields(w, 0),
    bar: (w) => sourceFields(w, w.max ?? 0),
    image: (w, pools) => {
        const img = w.image
        const rows = img ? fromBase64(img.data) : undefined
        if (!img || !rows) return 'image data is not base64'
        const need = Math.ceil(img.width / 8) * img.height
        if (rows.length !== need) {
            return `image needs ${need} bytes for ${img.width}x${img.height}, has ${rows.length}`
        }
        const at = pools.bitmaps.length
        pools.bitmaps.push(...rows)
        return { source: 0, arg: at, arg2: img.width | (img.height << 8) }
    },
    clock: (w) => ({
        source: CLOCK_FORMATS[w.format ?? 'hm'],
        arg: 0,
        arg2: 0,
    }),
    rect: () => ({ source: 0, arg: 0, arg2: 0 }),
}

function sourceFields(
    w: ConfigScreenWidget,
    arg2: number,
): Pick<WidgetRecord, 'source' | 'arg' | 'arg2'> | string {
    const id = w.source === undefined ? undefined : screenSourceId(w.source)
    if (id === undefined) return `"${w.source}" is not a value a screen can show`
    return { source: id, arg: 0, arg2 }
}

function widgetRecord(
    w: ConfigScreenWidget,
    pools: Pools,
): WidgetRecord | string {
    const fields = KIND_FIELDS[w.kind](w, pools)
    if (typeof fields === 'string') return fields
    const flags =
        (w.invert ? W_INVERT : 0) |
        (SCREEN_ALIGN[w.align ?? 'left'] << W_ALIGN_SHIFT) |
        (w.frame ? W_FRAME : 0)
    return {
        kind: SCREEN_KINDS[w.kind],
        flags,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        font: SCREEN_FONTS[w.font ?? 'small'],
        ...fields,
    }
}

function limitProblems(
    pages: number,
    widgets: number,
    pools: Pools,
): DisplayProblem[] {
    const over: [string, number, number][] = [
        ['pages', pages, SCREEN_LIMITS.pages],
        ['widgets', widgets, SCREEN_LIMITS.widgets],
        ['bytes of text', pools.strings.length, SCREEN_LIMITS.strings],
        ['bytes of images', pools.bitmaps.length, SCREEN_LIMITS.bitmaps],
    ]
    return over
        .filter(([, n, max]) => n > max)
        .map(([what, n, max]) => ({
            path: [],
            message: `${n} ${what} on the displays, the device holds ${max}`,
        }))
}

function writeTable(
    pages: number[][],
    widgets: WidgetRecord[],
    pools: Pools,
): Uint8Array {
    const out = new Uint8Array(
        HDR_LEN +
            pages.length * PAGE_LEN +
            widgets.length * WIDGET_LEN +
            pools.strings.length +
            pools.bitmaps.length,
    )
    const dv = new DataView(out.buffer)
    out[0] = pages.length
    out[1] = widgets.length
    dv.setUint16(2, pools.strings.length, true)
    dv.setUint16(4, pools.bitmaps.length, true)
    let at = HDR_LEN
    for (const p of pages) {
        out.set(p, at)
        at += PAGE_LEN
    }
    for (const w of widgets) {
        out.set([w.kind, w.flags, w.x, w.y, w.w, w.h, w.font, w.source], at)
        dv.setUint16(at + 8, w.arg, true)
        dv.setUint16(at + 10, w.arg2, true)
        at += WIDGET_LEN
    }
    out.set(pools.strings, at)
    out.set(pools.bitmaps, at + pools.strings.length)
    return out
}

/**
 * A document's displays -> the TBL_DISPLAY payload, or the problems that
 * keep it from being written (an unknown value, bad image data, more than
 * the device holds). Paths are relative to the `displays` array.
 */
export function encodeDisplays(
    displays: readonly ConfigDisplay[],
): { payload?: Uint8Array; problems: DisplayProblem[] } {
    const pools: Pools = { strings: [], stringAt: new Map(), bitmaps: [] }
    const pages: number[][] = []
    const widgets: WidgetRecord[] = []
    const problems: DisplayProblem[] = []
    displays.forEach((d, di) =>
        d.pages.forEach((p, pi) => {
            pages.push([
                d.part,
                widgets.length,
                p.widgets.length,
                p.default ? PAGE_DEFAULT : 0,
            ])
            p.widgets.forEach((w, wi) => {
                const rec = widgetRecord(w, pools)
                if (typeof rec === 'string') {
                    problems.push({ path: [di, 'pages', pi, 'widgets', wi], message: rec })
                    return
                }
                widgets.push(rec)
            })
        }),
    )
    problems.push(...limitProblems(pages.length, widgets.length, pools))
    if (problems.length > 0) return { problems }
    return { payload: writeTable(pages, widgets, pools), problems }
}

/* ---- decode ------------------------------------------------------------------ */

const KIND_BY_CODE = new Map<number, ScreenWidgetKind>(
    Object.entries(SCREEN_KINDS).map(([k, v]) => [v, k as ScreenWidgetKind]),
)
const ALIGN_BY_CODE = Object.keys(SCREEN_ALIGN) as ConfigScreenWidget['align'][]
const FORMAT_BY_CODE = Object.keys(CLOCK_FORMATS) as ConfigScreenWidget['format'][]

/** The kind-specific fields of a decoded widget. */
function kindView(
    kind: ScreenWidgetKind,
    rec: WidgetRecord,
    strings: Uint8Array,
    bitmaps: Uint8Array,
): Partial<ConfigScreenWidget> {
    if (kind === 'text') {
        return { text: String.fromCharCode(...strings.subarray(rec.arg, rec.arg + rec.arg2)) }
    }
    if (kind === 'value') return { source: screenSourceName(rec.source) }
    if (kind === 'bar') return { source: screenSourceName(rec.source), max: rec.arg2 }
    if (kind === 'clock') return { format: FORMAT_BY_CODE[rec.source] ?? 'hm' }
    if (kind !== 'image') return {}
    const width = rec.arg2 & 0xff
    const height = rec.arg2 >> 8
    const len = Math.ceil(width / 8) * height
    return { image: { width, height, data: toBase64(bitmaps.subarray(rec.arg, rec.arg + len)) } }
}

function widgetView(
    rec: WidgetRecord,
    strings: Uint8Array,
    bitmaps: Uint8Array,
): ConfigScreenWidget | undefined {
    const kind = KIND_BY_CODE.get(rec.kind)
    if (!kind) return undefined
    const align = ALIGN_BY_CODE[(rec.flags & W_ALIGN_MASK) >> W_ALIGN_SHIFT]
    return {
        kind,
        x: rec.x,
        y: rec.y,
        w: rec.w,
        h: rec.h,
        ...(rec.font === SCREEN_FONTS.large ? { font: 'large' as const } : {}),
        ...(align && align !== 'left' ? { align } : {}),
        ...(rec.flags & W_INVERT ? { invert: true } : {}),
        ...(rec.flags & W_FRAME ? { frame: true } : {}),
        ...kindView(kind, rec, strings, bitmaps),
    }
}

function readWidget(r: ByteReader): WidgetRecord {
    const [kind, flags, x, y, w, h, font, source] = Array.from({ length: 8 }, () => r.u8())
    return { kind, flags, x, y, w, h, font, source, arg: r.u16(), arg2: r.u16() }
}

/**
 * TBL_DISPLAY payload in [start, end) -> displays, grouped by part in page
 * order. Returns an error message for a frame too short for its counts or a
 * widget kind this client does not know.
 */
export function readDisplayTable(
    bytes: Uint8Array,
    start: number,
    end: number,
): ConfigDisplay[] | string {
    if (end - start < HDR_LEN) return 'display table header truncated'
    const r = new ByteReader(bytes)
    r.seek(start)
    const pageCount = r.u8()
    const widgetCount = r.u8()
    const stringsLen = r.u16()
    const bitmapsLen = r.u16()
    r.u16()
    const need = HDR_LEN + pageCount * PAGE_LEN + widgetCount * WIDGET_LEN + stringsLen + bitmapsLen
    if (start + need > end) return 'display table truncated'
    const pages = Array.from({ length: pageCount }, () => [r.u8(), r.u8(), r.u8(), r.u8()])
    const recs = Array.from({ length: widgetCount }, () => readWidget(r))
    const poolAt = start + HDR_LEN + pageCount * PAGE_LEN + widgetCount * WIDGET_LEN
    const strings = bytes.subarray(poolAt, poolAt + stringsLen)
    const bitmaps = bytes.subarray(poolAt + stringsLen, poolAt + stringsLen + bitmapsLen)
    const byPart = new Map<number, ConfigScreenPage[]>()
    for (const [part, first, count, flags] of pages) {
        const widgets = recs
            .slice(first, first + count)
            .map((rec) => widgetView(rec, strings, bitmaps))
        if (widgets.some((w) => w === undefined)) return 'unknown widget kind'
        const page: ConfigScreenPage = {
            ...(flags & PAGE_DEFAULT ? { default: true } : {}),
            widgets: widgets as ConfigScreenWidget[],
        }
        byPart.set(part, [...(byPart.get(part) ?? []), page])
    }
    return [...byPart].map(([part, ps]) => ({ part, pages: ps }))
}
