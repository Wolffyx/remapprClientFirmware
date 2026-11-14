// pattern-check: skip — pure geometry → placement-token mapping, one caller
//
// The `placement` of a `remappr,keymap` node: one KEY() per position with the
// key's own geometry (keymap-dsl §6), which GET_KEY_LAYOUT ships to the app to
// draw the board. A bare KEY() per key, as before, dropped every key on a grid
// cursor and lost 2u keys, split gaps and rotation, so the app drew the wrong
// board.
//
// The firmware's tokens take whole key-units and whole degrees, unsigned:
//
//   - positions are shifted so none is negative;
//   - a rotation is written as its clockwise equivalent, 0..359;
//   - fractional values (a 1.25u modifier, a 1.5u Tab) are rounded, with one
//     warning; the firmware owes finer tokens (keymap-dsl §6).
import type { DiagnosticBag } from '../../diagnostics'
import type { CanonGeometry } from '../../types'

const fractional = (n: number): boolean => !Number.isInteger(n)

/** The lowest coordinate a key's tokens will carry, on one axis. */
const lowest = (keys: CanonGeometry[], axis: 'x' | 'y'): number =>
    Math.min(
        0,
        ...keys.map((k) => {
            const pivot = axis === 'x' ? k.rx : k.ry
            return k.r && pivot !== undefined ? Math.min(k[axis], pivot) : k[axis]
        }),
    )

/** One KEY(...) per key, every key at its own position. */
export function placementTokens(
    keys: CanonGeometry[],
    diag: DiagnosticBag,
): string[] {
    const dx = -Math.floor(lowest(keys, 'x'))
    const dy = -Math.floor(lowest(keys, 'y'))
    let rounded = 0
    const tokens = keys.map((k) => {
        const rotated = !!k.r
        const values = [k.x, k.y, k.w, k.h, k.r, ...(rotated ? [k.rx ?? 0, k.ry ?? 0] : [])]
        if (values.some(fractional)) rounded++
        const parts = [`&x ${Math.round(k.x + dx)}`, `&y ${Math.round(k.y + dy)}`]
        const w = Math.max(1, Math.round(k.w))
        const h = Math.max(1, Math.round(k.h))
        if (w !== 1) parts.push(`&w ${w}`)
        if (h !== 1) parts.push(`&h ${h}`)
        if (rotated) parts.push(`&rot ${((Math.round(k.r) % 360) + 360) % 360}`)
        if (rotated && k.rx !== undefined) parts.push(`&rotx ${Math.round(k.rx + dx)}`)
        if (rotated && k.ry !== undefined) parts.push(`&roty ${Math.round(k.ry + dy)}`)
        return `KEY(${parts.join(' ')})`
    })
    if (rounded > 0)
        diag.warn(
            `${rounded} key(s) have fractional geometry; the firmware's placement ` +
                `takes whole key-units and degrees, so they are rounded and the ` +
                `app draws them slightly off`,
            ['keyboard', 'keys'],
        )
    return tokens
}
