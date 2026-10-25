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

/** Distinct sorted ¼U bands of a coordinate accessor across all keys. */
const bands = (
    keys: CanonGeometry[],
    pick: (k: CanonGeometry) => number,
): number[] =>
    [...new Set(keys.map((k) => Math.round(pick(k) * 4)))].sort((a, b) => a - b)

interface Point {
    x: number
    y: number
}

/** A key's centre in key units, rotation applied (about rx/ry, or its own
 *  top-left when those are absent), so rotated thumb keys land where they show. */
export function keyCentre(k: CanonGeometry): Point {
    const cx = k.x + k.w / 2
    const cy = k.y + k.h / 2
    if (!k.r) return { x: cx, y: cy }
    const ox = k.rx ?? k.x
    const oy = k.ry ?? k.y
    const a = (k.r * Math.PI) / 180
    const dx = cx - ox
    const dy = cy - oy
    return {
        x: ox + dx * Math.cos(a) - dy * Math.sin(a),
        y: oy + dx * Math.sin(a) + dy * Math.cos(a),
    }
}

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

/** Group values into lines: sorted, a value joins the latest line it is
 *  within `tol` of — unless that line already has a key at the same spot
 *  across it (within `tol`), as when a tilted row reaches down into the next
 *  one. Otherwise it starts a new line. Returns each value's line index. */
function lines(values: number[], across: number[], tol = 0.5): number[] {
    const order = values.map((_v, i) => i).sort((a, b) => values[a] - values[b])
    const out = new Array<number>(values.length)
    const open: { last: number; across: number[] }[] = []
    for (const i of order) {
        let line = -1
        for (let l = open.length - 1; l >= 0; l--) {
            const o = open[l]
            if (values[i] - o.last > tol) continue
            if (o.across.every((a) => Math.abs(a - across[i]) >= tol)) {
                line = l
                break
            }
        }
        if (line < 0) {
            open.push({ last: values[i], across: [] })
            line = open.length - 1
        }
        open[line].last = values[i]
        open[line].across.push(across[i])
        out[i] = line
    }
    return out
}

/** Match sorted `vals` to increasing slots of `refs` (sorted), minimising the
 *  total distance; slots past the reference continue at its pitch. Returns
 *  the slot index for each value. */
function monotoneMatch(vals: number[], refs: number[]): number[] {
    const n = vals.length
    const pitch =
        refs.length > 1 ? (refs[refs.length - 1] - refs[0]) / (refs.length - 1) : 1
    const slots = [...refs]
    while (slots.length < n) slots.push((slots.at(-1) ?? 0) + (pitch || 1))
    const m = slots.length
    // cost[i][j]: best total for vals[0..i] with vals[i] on slot j.
    const cost = vals.map(() => new Array<number>(m).fill(Infinity))
    const from = vals.map(() => new Array<number>(m).fill(-1))
    for (let i = 0; i < n; i++) {
        let best = Infinity
        let bestJ = -1
        for (let j = i; j < m - (n - 1 - i); j++) {
            if (i > 0 && cost[i - 1][j - 1] < best) {
                best = cost[i - 1][j - 1]
                bestJ = j - 1
            }
            const base = i === 0 ? 0 : best
            cost[i][j] = base + Math.abs(vals[i] - slots[j])
            from[i][j] = i === 0 ? -1 : bestJ
        }
    }
    let j = cost[n - 1].indexOf(Math.min(...cost[n - 1]))
    const out = new Array<number>(n)
    for (let i = n - 1; i >= 0; i--) {
        out[i] = j
        j = from[i][j]
    }
    return out
}

/** Wire one contiguous cluster to a [row,col] grid. The cleaner axis (fewer ¼U
 *  bands) gives the lines — columns on a column-staggered board, rows on a
 *  row-staggered one — grouped by key centre within ½U so offset or rotated
 *  thumbs join their line. Along each line, keys take the slots of the fullest
 *  line by nearest position, so a short line keeps its keys on the right rows
 *  (or columns) instead of packing them from the start. */
function localMatrix(keys: CanonGeometry[]): DerivedMatrix {
    if (!keys.length) return { rows: 1, columns: 1, map: [] }
    const colMajor =
        bands(keys, (k) => k.x).length <= bands(keys, (k) => k.y).length
    const c = keys.map(keyCentre)
    const along = (p: Point): number => (colMajor ? p.x : p.y)
    const across = (p: Point): number => (colMajor ? p.y : p.x)
    const lineOf = lines(c.map(along), c.map(across))
    const members = new Map<number, number[]>()
    lineOf.forEach((l, i) => members.set(l, [...(members.get(l) ?? []), i]))
    for (const idxs of members.values())
        idxs.sort((a, b) => across(c[a]) - across(c[b]))
    // The fullest line sets the slots; each line is shifted by its own median
    // offset first, so column (or row) stagger does not move keys a slot.
    const ref = [...members.values()].reduce((a, b) => (b.length > a.length ? b : a))
    const refPos = ref.map((i) => across(c[i]))
    const map: [number, number][] = new Array(keys.length)
    let crossMax = 1
    for (const [line, idxs] of members) {
        const pos = idxs.map((i) => across(c[i]))
        const near = pos.map((p) =>
            refPos.reduce((b, r) => (Math.abs(r - p) < Math.abs(b - p) ? r : b)),
        )
        const shift = median(pos.map((p, k) => p - near[k]))
        const slot = monotoneMatch(
            pos.map((p) => p - shift),
            refPos,
        )
        idxs.forEach((i, k) => {
            map[i] = colMajor ? [slot[k], line] : [line, slot[k]]
            crossMax = Math.max(crossMax, slot[k] + 1)
        })
    }
    const nLines = members.size
    return colMajor
        ? { rows: crossMax, columns: nLines, map }
        : { rows: nLines, columns: crossMax, map }
}

function median(v: number[]): number {
    const s = [...v].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
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
    const fixed = keys.map((k, i) => k.matrix ?? transform?.map[i])
    if (fixed.every(Boolean)) return fixed as [number, number][]
    const derived = deriveMatrix(keys).map
    // A key kept by hand holds its slot: a derived key that lands on it moves
    // to the nearest free column in its row.
    const taken = new Set(
        fixed.flatMap((f) => (f ? [`${f[0]},${f[1]}`] : [])),
    )
    return keys.map((_k, i) => {
        const f = fixed[i]
        if (f) return f
        const [r, c] = derived[i] ?? [0, 0]
        const cell = freeCell(taken, r, c)
        taken.add(`${cell[0]},${cell[1]}`)
        return cell
    })
}

/** `[r, c]`, or the nearest free column in row `r` when it is taken. */
function freeCell(taken: Set<string>, r: number, c: number): [number, number] {
    for (let d = 0; d < 256; d++) {
        if (!taken.has(`${r},${c + d}`)) return [r, c + d]
        if (c - d >= 0 && !taken.has(`${r},${c - d}`)) return [r, c - d]
    }
    return [r, c]
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
