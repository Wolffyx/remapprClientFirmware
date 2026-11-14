// Pattern check: Dispatch Map (Tier 0) — applied — widget kind → wire packer / reader maps; one table, no class family.
//
// What the node's displays show (`node.display`) <-> TBL_DISPLAY (id 31, v1).
// Byte layout mirrors firmware include/remappr/screen.h and
// lib/config_blob/decode_display.c (display part design §3): pages, then
// widgets, then a string pool (TEXT) and a bitmap pool (IMAGE) the widgets
// point into. Which part a page names is the device's check (it knows its
// parts); everything else the firmware refuses is checked here first.
import type { DiagnosticBag } from '../../diagnostics'
import type {
    ConfigDisplay,
    ConfigDisplayPage,
    ConfigDisplayWidget,
    DisplaySource,
    DisplayWidgetBox,
} from '../../types'
import {
    bytesToHex,
    type DisplayPageRecord,
    type DisplayTable,
    type DisplayWidgetRecord,
    hexToBytes,
    SCREEN_BITMAPS_MAX,
    SCREEN_PAGE_DEFAULT,
    SCREEN_PAGES_MAX,
    SCREEN_STRINGS_MAX,
    SCREEN_TBL_HDR_LEN,
    SCREEN_TBL_PAGE_LEN,
    SCREEN_TBL_WIDGET_LEN,
    SCREEN_W_ALIGN_MASK,
    SCREEN_W_ALIGN_SHIFT,
    SCREEN_W_FRAME,
    SCREEN_W_INVERT,
    SCREEN_WIDGETS_MAX,
    ScreenKind,
} from './blobWriter'
import { ByteReader, type TableFrame } from './decode'

const SOURCES: Readonly<Record<Exclude<DisplaySource, number>, number>> = {
    activeLayer: 0x01,
    battery: 0x02,
    charging: 0x03,
    connection: 0x04,
    capsLock: 0x05,
    numLock: 0x06,
    wpm: 0x07,
    deviceName: 0x08,
}
const SOURCE_BY_CODE = new Map(
    Object.entries(SOURCES).map(([k, v]) => [v, k as Exclude<DisplaySource, number>]),
)
const ALIGNS = ['left', 'centre', 'right'] as const
const CLOCKS = ['hm', 'hms', 'date'] as const

const sourceCode = (s: DisplaySource): number =>
    typeof s === 'number' ? s : SOURCES[s]
const sourceOf = (code: number): DisplaySource => SOURCE_BY_CODE.get(code) ?? code

const TEXT = new TextEncoder()
const UTF8 = new TextDecoder()

/** The string and bitmap pools a table is being packed into. */
interface Pools {
    strings: number[]
    bitmaps: number[]
}

type Packed = Pick<DisplayWidgetRecord, 'source' | 'arg' | 'arg2'>

/** Per kind: the widget's source / arg / arg2, adding to the pools. */
const PACK: {
    [K in ConfigDisplayWidget['kind']]: (
        w: Extract<ConfigDisplayWidget, { kind: K }>,
        pools: Pools,
    ) => Packed
} = {
    text: (w, pools) => {
        const bytes = TEXT.encode(w.text)
        const arg = pools.strings.length
        pools.strings.push(...bytes)
        return { source: 0, arg, arg2: bytes.length }
    },
    value: (w) => ({ source: sourceCode(w.source), arg: 0, arg2: 0 }),
    bar: (w) => ({ source: sourceCode(w.source), arg: 0, arg2: w.full }),
    image: (w, pools) => {
        const arg = pools.bitmaps.length
        pools.bitmaps.push(...hexToBytes(w.bitmap))
        return { source: 0, arg, arg2: (w.width & 0xff) | ((w.height & 0xff) << 8) }
    },
    clock: (w) => ({ source: CLOCKS.indexOf(w.format), arg: 0, arg2: 0 }),
    rect: () => ({ source: 0, arg: 0, arg2: 0 }),
}

function boxFlags(b: DisplayWidgetBox): number {
    const align = ALIGNS.indexOf(b.align ?? 'left')
    return (
        (b.invert ? SCREEN_W_INVERT : 0) |
        (align << SCREEN_W_ALIGN_SHIFT) |
        (b.frame ? SCREEN_W_FRAME : 0)
    )
}

function packWidget(w: ConfigDisplayWidget, pools: Pools): DisplayWidgetRecord {
    const pack = PACK[w.kind] as (x: ConfigDisplayWidget, p: Pools) => Packed
    return {
        kind: ScreenKind[w.kind],
        flags: boxFlags(w),
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        font: w.font === 'large' ? 1 : 0,
        ...pack(w, pools),
    }
}

/** Why `w` would be refused, or null. */
function widgetRefusal(w: ConfigDisplayWidget): string | null {
    if (w.kind !== 'image') return null
    const need = Math.ceil(w.width / 8) * w.height
    const have = w.bitmap.length / 2
    return have === need
        ? null
        : `a ${w.width}x${w.height} image takes ${need} bitmap bytes, not ${have}`
}

/**
 * `node.display` -> TBL_DISPLAY, or undefined (with an error) when the device
 * would refuse it: more pages, widgets or pool bytes than a device holds, or an
 * image whose bitmap does not match its size.
 */
export function displayRecord(
    d: ConfigDisplay,
    diag: DiagnosticBag,
): DisplayTable | undefined {
    const path = ['node', 'display']
    const pools: Pools = { strings: [], bitmaps: [] }
    const pages: DisplayPageRecord[] = []
    const widgets: DisplayWidgetRecord[] = []
    let ok = true
    d.pages.forEach((p, pi) => {
        pages.push({
            part: p.part,
            first: widgets.length,
            count: p.widgets.length,
            flags: p.default ? SCREEN_PAGE_DEFAULT : 0,
        })
        p.widgets.forEach((w, wi) => {
            const refused = widgetRefusal(w)
            if (refused) {
                diag.error(refused, [...path, 'pages', pi, 'widgets', wi])
                ok = false
            }
            widgets.push(packWidget(w, pools))
        })
    })
    const limits: [number, number, string][] = [
        [pages.length, SCREEN_PAGES_MAX, 'pages'],
        [widgets.length, SCREEN_WIDGETS_MAX, 'widgets'],
        [pools.strings.length, SCREEN_STRINGS_MAX, 'bytes of text'],
        [pools.bitmaps.length, SCREEN_BITMAPS_MAX, 'bytes of images'],
    ]
    for (const [n, max, what] of limits) {
        if (n <= max) continue
        diag.error(`the displays take ${n} ${what}; a device holds ${max}`, path)
        ok = false
    }
    if (!ok) return undefined
    return {
        pages,
        widgets,
        strings: Uint8Array.from(pools.strings),
        bitmaps: Uint8Array.from(pools.bitmaps),
    }
}

/* ── reader ──────────────────────────────────────────────────────────────── */

interface View {
    strings: Uint8Array
    bitmaps: Uint8Array
}

type Body = Omit<ConfigDisplayWidget, keyof DisplayWidgetBox>

/** Per kind: the widget's own fields from the wire; null when it does not
 *  fit the pools (the device refuses it too). */
const READ: Readonly<Record<number, (w: DisplayWidgetRecord, v: View) => Body | null>> = {
    [ScreenKind.text]: (w, v) =>
        w.arg + w.arg2 <= v.strings.length
            ? { kind: 'text', text: UTF8.decode(v.strings.subarray(w.arg, w.arg + w.arg2)) }
            : null,
    [ScreenKind.value]: (w) => ({ kind: 'value', source: sourceOf(w.source) }),
    [ScreenKind.bar]: (w) =>
        w.arg2 > 0 ? { kind: 'bar', source: sourceOf(w.source), full: w.arg2 } : null,
    [ScreenKind.image]: (w, v) => {
        const width = w.arg2 & 0xff
        const height = w.arg2 >> 8
        const len = Math.ceil(width / 8) * height
        if (!width || !height || w.arg + len > v.bitmaps.length) return null
        const bitmap = bytesToHex(v.bitmaps.subarray(w.arg, w.arg + len))
        return { kind: 'image', width, height, bitmap }
    },
    [ScreenKind.clock]: (w) =>
        CLOCKS[w.source] ? { kind: 'clock', format: CLOCKS[w.source] } : null,
    [ScreenKind.rect]: () => ({ kind: 'rect' }),
}

function boxOf(w: DisplayWidgetRecord): DisplayWidgetBox {
    const align = ALIGNS[(w.flags & SCREEN_W_ALIGN_MASK) >> SCREEN_W_ALIGN_SHIFT]
    return {
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        ...(w.font === 1 ? { font: 'large' as const } : {}),
        ...(align && align !== 'left' ? { align } : {}),
        ...(w.flags & SCREEN_W_INVERT ? { invert: true } : {}),
        ...(w.flags & SCREEN_W_FRAME ? { frame: true } : {}),
    }
}

function readWidget(r: ByteReader): DisplayWidgetRecord {
    const b = Array.from({ length: 8 }, () => r.u8())
    const [kind, flags, x, y, w, h, font, source] = b
    return { kind, flags, x, y, w, h, font, source, arg: r.u16(), arg2: r.u16() }
}

/**
 * TBL_DISPLAY payload -> `node.display`. Returns an error message when the
 * table is short for its counts, or holds what this client cannot show (an
 * unknown widget kind or flag, a widget past its pool): a save then carries
 * the device's table as read.
 */
export function readDisplayTable(
    bytes: Uint8Array,
    t: TableFrame,
): ConfigDisplay | string {
    if (t.end - t.start < SCREEN_TBL_HDR_LEN) return 'display table header truncated'
    const r = ByteReader.frame(bytes, t)
    const pageCount = r.u8()
    const widgetCount = r.u8()
    const stringsLen = r.u16()
    const bitmapsLen = r.u16()
    r.u16() // reserved
    const pagesAt = t.start + SCREEN_TBL_HDR_LEN
    const stringsAt =
        pagesAt + pageCount * SCREEN_TBL_PAGE_LEN + widgetCount * SCREEN_TBL_WIDGET_LEN
    if (stringsAt + stringsLen + bitmapsLen > t.end) return 'display table truncated'
    const pages = Array.from({ length: pageCount }, () => {
        const [part, first, count, flags] = [r.u8(), r.u8(), r.u8(), r.u8()]
        return { part, first, count, flags }
    })
    const records = Array.from({ length: widgetCount }, () => readWidget(r))
    const view: View = {
        strings: bytes.subarray(stringsAt, stringsAt + stringsLen),
        bitmaps: bytes.subarray(stringsAt + stringsLen, stringsAt + stringsLen + bitmapsLen),
    }
    const known = SCREEN_W_INVERT | SCREEN_W_ALIGN_MASK | SCREEN_W_FRAME
    const widgets: (ConfigDisplayWidget | null)[] = records.map((w) => {
        const body = READ[w.kind]?.(w, view)
        if (!body || w.flags & ~known || w.font > 1) return null
        return { ...boxOf(w), ...body } as ConfigDisplayWidget
    })
    const out: ConfigDisplayPage[] = []
    for (const p of pages) {
        const run = widgets.slice(p.first, p.first + p.count)
        if (run.length !== p.count || run.some((w) => w === null)) {
            return 'display table holds a widget this client cannot show'
        }
        if (p.flags & ~SCREEN_PAGE_DEFAULT) return 'display page flag unknown'
        out.push({
            part: p.part,
            ...(p.flags & SCREEN_PAGE_DEFAULT ? { default: true } : {}),
            widgets: run as ConfigDisplayWidget[],
        })
    }
    return { pages: out }
}
