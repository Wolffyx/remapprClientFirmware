// Pattern check: no GoF pattern (-) — rejected — one pure Floyd–Steinberg function plus packing helpers; nothing to abstract.
//
// A picture -> what an IMAGE widget carries: 1-bit rows (bit 7 = leftmost,
// rows of whole bytes), base64 (display part design §3, ConfigScreenWidget
// `image`). The caller scales the picture to the widget and hands its pixels
// in; this does the rest, so it runs anywhere (no DOM).

/** Widest / tallest image a widget holds (u8 w and h in TBL_DISPLAY). */
export const SCREEN_IMAGE_MAX = 255

export interface DitherOpts {
    /** Grey level (0..255) at and above which a pixel is lit (default 128). */
    threshold?: number
    /** Light the dark parts instead (a dark drawing on a light background). */
    invert?: boolean
    /** Spread each pixel's rounding error to its neighbours (Floyd–Steinberg,
     *  default true); false = a plain threshold, for line art. */
    dither?: boolean
}

/** RGBA pixels (canvas ImageData order) -> grey levels 0..255, transparent
 *  parts as black (unlit). */
export function rgbaToGrey(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
    const grey = new Float32Array(width * height)
    for (let i = 0; i < grey.length; i++) {
        const o = i * 4
        const luma = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]
        grey[i] = (luma * (rgba[o + 3] ?? 255)) / 255
    }
    return grey
}

/** Grey levels (width x height, 0..255) -> lit / unlit per pixel. */
export function ditherGrey(
    grey: ArrayLike<number>,
    width: number,
    height: number,
    opts: DitherOpts = {},
): Uint8Array {
    const threshold = opts.threshold ?? 128
    const spread = opts.dither ?? true
    const work = Float32Array.from(grey, (g) => (opts.invert ? 255 - g : g))
    const lit = new Uint8Array(width * height)
    const push = (x: number, y: number, e: number): void => {
        if (x >= 0 && x < width && y < height) work[y * width + x] += e
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const old = work[y * width + x]
            const on = old >= threshold
            lit[y * width + x] = on ? 1 : 0
            if (!spread) continue
            const err = old - (on ? 255 : 0)
            push(x + 1, y, (err * 7) / 16)
            push(x - 1, y + 1, (err * 3) / 16)
            push(x, y + 1, (err * 5) / 16)
            push(x + 1, y + 1, err / 16)
        }
    }
    return lit
}

/** Lit pixels (width x height, one byte each) -> 1-bit rows, MSB first. */
export function packRows(lit: ArrayLike<number>, width: number, height: number): Uint8Array {
    const rs = (width + 7) >> 3
    const rows = new Uint8Array(rs * height)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (lit[y * width + x]) rows[y * rs + (x >> 3)] |= 0x80 >> (x & 7)
        }
    }
    return rows
}

export const rowsToBase64 = (rows: Uint8Array): string => {
    let s = ''
    for (const b of rows) s += String.fromCharCode(b)
    return btoa(s)
}

/** RGBA pixels -> an IMAGE widget's `image`. */
export function imageFromRgba(
    rgba: ArrayLike<number>,
    width: number,
    height: number,
    opts: DitherOpts = {},
): { width: number; height: number; data: string } {
    const lit = ditherGrey(rgbaToGrey(rgba, width, height), width, height, opts)
    return { width, height, data: rowsToBase64(packRows(lit, width, height)) }
}
