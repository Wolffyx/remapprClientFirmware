// pattern-check: skip — pure validators and escapers for text written into devicetree
//
// Free strings from the JSON that the board generator writes into devicetree.
// Each one is checked or escaped here, so a character that means something to
// dtc (a comment close, a `;`, a stray `&`) cannot change the file's structure.
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'

/** Text for inside a block comment: no comment close and no line break. */
export function dtComment(s: string): string {
    return s.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /')
}

const LABEL = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A node label (`spi3`, `arduino_spi`), written with or without its `&`.
 *  Comes back without it; anything else is an error. */
export function dtLabel(
    raw: string,
    diag: DiagnosticBag,
    path: DiagnosticPath,
): string {
    const s = raw.trim().replace(/^&/, '')
    if (!LABEL.test(s))
        diag.error(`"${raw}" is not a devicetree node label`, path)
    return s
}

const COMPATIBLE = /^[A-Za-z0-9][A-Za-z0-9,._+-]*$/

/** A `compatible` string (`pixart,paw3395`). */
export function dtCompatible(
    raw: string,
    diag: DiagnosticBag,
    path: DiagnosticPath,
): string {
    if (!COMPATIBLE.test(raw))
        diag.error(`"${raw}" is not a devicetree compatible string`, path)
    return raw
}

/** Characters that end a cell list or a property, or open a node or string. */
const STRUCTURAL = /[;{}<>"\r\n]/

/** A raw value written between `<` and `>` (a GPIO spec, a phandle, a dmas
 *  entry). It may hold cells, phandles and `( | )` expressions, never
 *  anything that ends the cell list. True when it is safe. */
export function dtCellsOk(raw: string): boolean {
    return !STRUCTURAL.test(raw)
}

const PHANDLE = /^&[A-Za-z_][A-Za-z0-9_]*$/
const DMAS = /^<[^;{}<>"\r\n]*>(\s*,\s*<[^;{}<>"\r\n]*>)*$/

/** A bare phandle (`&spi1_mosi_pa7`), as a pinctrl entry. */
export function dtPhandleOk(raw: string): boolean {
    return PHANDLE.test(raw.trim())
}

/** A `dmas` value: one or more `<...>` cell groups, comma-separated. */
export function dtDmasOk(raw: string): boolean {
    return DMAS.test(raw.trim())
}

/** Text for inside a devicetree string: printable, no quote or backslash. */
export function dtString(
    raw: string,
    diag: DiagnosticBag,
    path: DiagnosticPath,
): string {
    if (/["\\\x00-\x1f]/.test(raw))
        diag.error(`"${raw}" cannot be a devicetree string (quote, backslash or control character)`, path)
    return raw
}
