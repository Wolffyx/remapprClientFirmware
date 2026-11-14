// pattern-check: skip — picks the matrix wiring by source precedence; plain data out, no abstraction
//
// Where a shield's key matrix wiring comes from. Three places can hold it, in
// this order:
//
//   1. `board.matrix` — the board generator's own section;
//   2. `keyboard.hardware.kscan` — the schema-validated wiring (raw specs, the
//      diode direction and debounce), which the generator used to ignore;
//   3. `keyboard.pins` — the builder's friendly labels.
//
// Each list (rows, columns) is taken from the first source that has it, and
// every pin keeps the JSON path it came from, so a diagnostic points at it.
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'
import type { ConfigKeymap, DiodeDirection } from '../../types'

export interface SourcedPin {
    raw: string
    path: DiagnosticPath
}

export interface MatrixWiring {
    diode: DiodeDirection
    rows: SourcedPin[]
    cols: SourcedPin[]
    debouncePressMs?: number
    debounceReleaseMs?: number
}

const sourced = (
    list: readonly string[] | undefined,
    path: DiagnosticPath,
): SourcedPin[] | null =>
    list && list.length > 0
        ? list.map((raw, i) => ({ raw, path: [...path, i] }))
        : null

/** The matrix wiring, or null when the board uses direct-pin wiring, which
 *  has no generated driver yet (an error). */
export function matrixWiring(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): MatrixWiring | null {
    const kb = config.keyboard
    const kscan = kb.hardware?.kscan
    if (kscan?.type === 'direct' || kb.matrix?.mode === 'direct') {
        diag.error(
            `direct-pin wiring (one GPIO per key) cannot be generated yet: the ` +
                `firmware has no direct-pin scan node for the shield to declare`,
            kscan?.type === 'direct'
                ? ['keyboard', 'hardware', 'kscan']
                : ['keyboard', 'matrix', 'mode'],
        )
        return null
    }
    const bm = config.board?.matrix
    const ks = kscan?.type === 'matrix' ? kscan : undefined
    const KS: DiagnosticPath = ['keyboard', 'hardware', 'kscan']
    const rows =
        sourced(bm?.rows, ['board', 'matrix', 'rows']) ??
        sourced(ks?.rowGpios, [...KS, 'rowGpios']) ??
        sourced(kb.pins?.rows, ['keyboard', 'pins', 'rows']) ??
        []
    const cols =
        sourced(bm?.cols, ['board', 'matrix', 'cols']) ??
        sourced(ks?.colGpios, [...KS, 'colGpios']) ??
        sourced(kb.pins?.cols, ['keyboard', 'pins', 'cols']) ??
        []
    if (bm?.diode && ks && bm.diode !== ks.diodeDirection)
        diag.warn(
            `board.matrix.diode "${bm.diode}" overrides kscan diodeDirection ` +
                `"${ks.diodeDirection}"`,
            ['board', 'matrix', 'diode'],
        )
    return {
        diode:
            bm?.diode ??
            ks?.diodeDirection ??
            kb.matrix?.diodeDirection ??
            'col2row',
        rows,
        cols,
        debouncePressMs: ks?.debouncePressMs,
        debounceReleaseMs: ks?.debounceReleaseMs,
    }
}
