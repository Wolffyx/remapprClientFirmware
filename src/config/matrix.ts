// Pattern check: no GoF pattern (-) — rejected — pure geometry→matrix derivation
// + a clone-and-fill materializer; immutable data transforms, no abstraction.
//
// Derives a per-key electrical matrix `[row, col]` from physical key positions,
// and materializes it onto a config so every firmware compiler has authoritative
// wiring. The generalized `keys[].matrix` is the friendly source of truth; this
// fills it (and the board `keyboard.matrix` descriptor) when the user hasn't
// wired keys by hand. Lives in the config layer (not the builder) so the QMK /
// VIA / Vial / ZMK emitters can all rely on a populated matrix.
//
// Stagger- and split-aware: see localMatrix / columnGroups. Ported from the
// builder's geometry helpers (builderMatrix.ts now re-exports from here).

import type { CanonGeometry, ConfigKeymap, DiodeDirection } from './types'

/** A derived electrical matrix: dimensions + one [row, col] per key (index-aligned). */
export interface DerivedMatrix {
    rows: number
    columns: number
    map: [number, number][]
}

/** Distinct sorted ⅛U bands of a coordinate accessor across all keys. */
const bands = (
    keys: CanonGeometry[],
    pick: (k: CanonGeometry) => number,
): number[] =>
    [...new Set(keys.map((k) => Math.round(pick(k) * 4)))].sort((a, b) => a - b)

/** Split a key set into left→right column groups separated by a clear (≥`gapU`)
 *  horizontal gap — one group for a contiguous board, one per half for a split. */
function columnGroups(keys: CanonGeometry[], gapU = 0.6): number[][] {
    const order = keys.map((_k, i) => i).sort((a, b) => keys[a].x - keys[b].x)
    const groups: number[][] = []
    let cur: number[] = []
    let cover = -Infinity
    for (const i of order) {
        const k = keys[i]
        if (cur.length && k.x > cover + gapU) {
            groups.push(cur)
            cur = []
        }
        cur.push(i)
        cover = Math.max(cover, k.x + k.w)
    }
    if (cur.length) groups.push(cur)
    return groups
}

/** Wire one contiguous cluster to a [row,col] grid, banding the cleaner axis so
 *  column-staggered (Corne) and row-staggered (ANSI) layouts both wire sensibly. */
function localMatrix(keys: CanonGeometry[]): DerivedMatrix {
    if (!keys.length) return { rows: 1, columns: 1, map: [] }
    const xb = bands(keys, (k) => k.x)
    const yb = bands(keys, (k) => k.y)
    const colMajor = xb.length <= yb.length
    const primary = colMajor ? xb : yb
    const primaryOf = (k: CanonGeometry): number =>
        Math.max(0, primary.indexOf(Math.round((colMajor ? k.x : k.y) * 4)))
    const buckets = new Map<number, number[]>()
    keys.forEach((k, i) => {
        const p = primaryOf(k)
        const list = buckets.get(p) ?? []
        list.push(i)
        buckets.set(p, list)
    })
    const map: [number, number][] = new Array(keys.length)
    let crossMax = 1
    for (const [p, idxs] of buckets) {
        const ranked = [...idxs].sort((a, b) =>
            colMajor ? keys[a].y - keys[b].y : keys[a].x - keys[b].x,
        )
        crossMax = Math.max(crossMax, ranked.length)
        ranked.forEach((i, rank) => {
            map[i] = colMajor ? [rank, p] : [p, rank]
        })
    }
    return colMajor
        ? { rows: crossMax, columns: primary.length, map }
        : { rows: primary.length, columns: crossMax, map }
}

/** Derive a [row, col]-per-key matrix from physical position. Split-aware (each
 *  piece wired independently, columns offset so the right half continues the
 *  left's numbering) and stagger-aware. `map` is index-aligned to `keys`. */
export function deriveMatrix(keys: CanonGeometry[]): DerivedMatrix {
    if (!keys.length) return { rows: 1, columns: 1, map: [] }
    const groups = columnGroups(keys)
    const map: [number, number][] = new Array(keys.length)
    let colOffset = 0
    let rowMax = 1
    for (const group of groups) {
        const sub = group.map((i) => keys[i])
        const local = localMatrix(sub)
        group.forEach((origIdx, j) => {
            const [r, c] = local.map[j]
            map[origIdx] = [r, c + colOffset]
        })
        colOffset += local.columns
        rowMax = Math.max(rowMax, local.rows)
    }
    return { rows: rowMax, columns: Math.max(1, colOffset), map }
}

// pattern-check: skip pure geometry grouping helper reusing columnGroups/localMatrix, no abstraction
/** One electrical half of a split board: its own column count, the column offset
 *  that places it in the unified matrix (0 for the left, left-column-count for the
 *  right), and the indices (into `keys`) of the keys it owns. */
export interface MatrixGroup {
    columns: number
    rows: number
    colOffset: number
    keyIndices: number[]
}

/** Decompose a key set into electrical halves the way `deriveMatrix` wires them —
 *  one `MatrixGroup` per contiguous column cluster (one for a unibody board, one
 *  per half for a split). Lets the ZMK split emitter wire each half's own kscan
 *  (`columns` col-gpios) and offset the right transform by the left's column count. */
export function matrixSplit(keys: CanonGeometry[]): MatrixGroup[] {
    const groups = columnGroups(keys)
    const out: MatrixGroup[] = []
    let colOffset = 0
    for (const group of groups) {
        const local = localMatrix(group.map((i) => keys[i]))
        out.push({
            columns: local.columns,
            rows: local.rows,
            colOffset,
            keyIndices: group,
        })
        colOffset += local.columns
    }
    return out
}

/** Resolve the per-key matrix for an already-loaded config, honoring precedence:
 *  explicit `keys[].matrix` > `hardware.transform.map` > position-derived. */
export function resolveKeyMatrix(config: ConfigKeymap): [number, number][] {
    const keys = config.keyboard.keys
    const transform = config.keyboard.hardware?.transform
    const derived = keys.some((k) => !k.matrix) ? deriveMatrix(keys) : null
    return keys.map(
        (k, i) => k.matrix ?? transform?.map[i] ?? derived?.map[i] ?? [0, 0],
    )
}

/** Current matrix dimensions for a config: the largest of the board descriptor's
 *  stored dims, a legacy transform's declared dims, the friendly pin-label counts,
 *  and the actual per-key usage (max resolved row/col + 1). The pin/descriptor
 *  floors let the builder hold "unused" rows/columns (added via the overlay's
 *  "+" before any key is wired to them); usage covers freshly-derived boards. */
export function matrixDims(config: ConfigKeymap): {
    rows: number
    cols: number
} {
    const kb = config.keyboard
    let rows = Math.max(
        kb.matrix?.rows ?? 0,
        kb.hardware?.transform?.rows ?? 0,
        kb.pins?.rows?.length ?? 0,
    )
    let cols = Math.max(
        kb.matrix?.cols ?? 0,
        kb.hardware?.transform?.columns ?? 0,
        kb.pins?.cols?.length ?? 0,
    )
    if (kb.keys.length) {
        for (const [r, c] of resolveKeyMatrix(config)) {
            rows = Math.max(rows, r + 1)
            cols = Math.max(cols, c + 1)
        }
    }
    return { rows, cols }
}

/** Return a copy of the config with every key's `matrix` and the board
 *  `keyboard.matrix` descriptor populated, so emitters always have authoritative
 *  wiring. Existing explicit values win; the rest are derived. Diode direction
 *  falls back to the kscan's, then `col2row`; mode defaults to `matrix`. */
// pattern-check: skip — bug fix (#198): one precedence helper shared by the matrix + ZMK kscan paths
/** The board's diode direction: the builder's matrix descriptor, then a legacy
 *  matrix kscan, then `col2row`. */
export function matrixDiodeDirection(config: ConfigKeymap): DiodeDirection {
    const kscan = config.keyboard.hardware?.kscan
    return (
        config.keyboard.matrix?.diodeDirection ??
        (kscan?.type === 'matrix' ? kscan.diodeDirection : undefined) ??
        'col2row'
    )
}

export function materializeMatrix(config: ConfigKeymap): ConfigKeymap {
    const resolved = resolveKeyMatrix(config)
    // Floor the stamped dimensions to the same sources matrixDims() uses — the
    // board descriptor, a legacy transform, and the friendly pin-label counts —
    // not just per-key usage. A board can declare unused rows/cols (added via the
    // overlay "+" before any key is wired to them); stamping usage-only would make
    // keyboard.matrix under-count relative to the pin arrays the VIA/QMK emitters
    // also read, so VIA's matrix would disagree with the firmware's MATRIX_ROWS/COLS.
    const kb = config.keyboard
    let rows = Math.max(
        kb.matrix?.rows ?? 0,
        kb.hardware?.transform?.rows ?? 0,
        kb.pins?.rows?.length ?? 0,
    )
    let cols = Math.max(
        kb.matrix?.cols ?? 0,
        kb.hardware?.transform?.columns ?? 0,
        kb.pins?.cols?.length ?? 0,
    )
    for (const [r, c] of resolved) {
        rows = Math.max(rows, r + 1)
        cols = Math.max(cols, c + 1)
    }
    const diodeDirection = matrixDiodeDirection(config)
    const mode = config.keyboard.matrix?.mode ?? 'matrix'
    return {
        ...config,
        keyboard: {
            ...config.keyboard,
            keys: config.keyboard.keys.map((k, i) => ({
                ...k,
                matrix: resolved[i],
            })),
            matrix: { rows, cols, diodeDirection, mode },
        },
    }
}
