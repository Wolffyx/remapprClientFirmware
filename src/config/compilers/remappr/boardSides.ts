// Pattern check: no GoF pattern (-) — rejected — pure functions slicing one config into per-side views; one caller (board.ts).
//
// A split board (universal device model §3.6) is one product JSON: every key
// carries the `side` it is wired to and `board.sides` lists each side's own
// board fields over the shared ones. Board-gen builds one shield per side, each
// half its own image serving its own layout (the §7.6 heterogeneous path: the
// app composes the halves with each member's position_base). A same-image split
// needs firmware support that does not exist yet, so it is refused here; a part
// tagged `side` is refused by the schema (BoardWithSidesSchema).

import type { DiagnosticBag } from '../../diagnostics'
import type { BoardSide, ConfigBoard, ConfigClusterSide, ConfigKeymap } from '../../types'

/** The shield-name suffix of a cluster side: left, right, then side2, side3… */
export const sideSuffix = (side: number): string => ['left', 'right'][side] ?? `side${side}`

/** One side's config, cut from the whole board. */
export interface SideView {
    side: number
    config: ConfigKeymap
}

const SAME_IMAGE =
    'needs side-gated parts in the firmware (universal device model §2.2), which it ' +
    'does not have yet'

/** Every key on a listed side, and the sides in ascending runs: the cluster
 *  numbers each side's positions after the sides before it (TBL_CLUSTER v2),
 *  so one blob addresses both halves only when the keys are in that order. */
function checkKeySides(config: ConfigKeymap, known: Set<number>, diag: DiagnosticBag): void {
    let last = -1
    config.keyboard.keys.forEach((k, i) => {
        const path = ['keyboard', 'keys', i, 'side']
        if (k.side === undefined || !known.has(k.side)) {
            diag.error(`key ${i} is on no side of board.sides`, path)
            return
        }
        if (k.side < last)
            diag.error(
                `key ${i} (side ${k.side}) follows a side ${last} key: keys must be ` +
                    `grouped by side, in ascending side order`,
                path,
            )
        last = Math.max(last, k.side)
    })
}

/** One side's view: its keys (with the layers and the electrical transform cut
 *  to match), its board fields over the shared ones, and the role its ports
 *  give it (a side with an upstream port is a follower). */
function sideView(
    config: ConfigKeymap,
    shared: ConfigBoard,
    entry: BoardSide,
    diag: DiagnosticBag,
): SideView {
    const { side, ...own } = entry
    const keys = config.keyboard.keys
    const idx = keys.flatMap((k, i) => (k.side === side ? [i] : []))
    const transform = config.keyboard.hardware?.transform
    const board: ConfigBoard = { ...shared, ...own }
    // A button names its key by whole-board index; the half counts its own.
    if (board.buttons)
        board.buttons = board.buttons.map((b, i) => {
            const key = idx.indexOf(b.key)
            if (key < 0)
                diag.error(`button ${i} is key ${b.key}, which is not on side ${side}`, [
                    'board',
                    'buttons',
                    i,
                    'key',
                ])
            return { ...b, key: Math.max(key, 0) }
        })
    const upstream = (board.nodeBus ?? []).some((p) => p.direction === 'upstream')
    return {
        side,
        config: {
            ...config,
            keyboard: {
                ...config.keyboard,
                keys: idx.map((i) => keys[i]),
                ...(transform
                    ? {
                          hardware: {
                              ...config.keyboard.hardware,
                              transform: { ...transform, map: idx.map((i) => transform.map[i]) },
                          },
                      }
                    : {}),
            },
            layers: config.layers.map((l) => ({
                ...l,
                bindings: idx.flatMap((i) => (i < l.bindings.length ? [l.bindings[i]] : [])),
            })),
            board,
            node: { ...config.node, role: upstream ? 'follower' : 'coordinator' },
        },
    }
}

/** The per-side views of a split board, in ascending side order; none for a
 *  board without `board.sides` (it builds as one shield). */
export function sideViews(config: ConfigKeymap, diag: DiagnosticBag): SideView[] {
    const { sides = [], ...shared }: ConfigBoard = config.board ?? {}
    if (sides.length === 0) {
        if (config.keyboard.keys.some((k) => k.side !== undefined))
            diag.error(
                `keys carry "side" but board.sides is not set: a same-image split ${SAME_IMAGE}`,
                ['keyboard', 'keys'],
            )
        return []
    }
    const known = new Set<number>()
    sides.forEach((s, i) => {
        if (known.has(s.side)) diag.error(`side ${s.side} is listed twice`, ['board', 'sides', i])
        known.add(s.side)
    })
    checkKeySides(config, known, diag)
    return [...sides].sort((a, b) => a.side - b.side).map((s) => sideView(config, shared, s, diag))
}

/** A side of `n` positions as the firmware reports a node (one row of up to
 *  255, then more rows), so the side's span (rows × cols) holds that half. */
function sideGrid(n: number): { rows: number; cols: number } {
    const cols = Math.min(n, 255)
    return { rows: cols ? Math.ceil(n / cols) : 0, cols }
}

/** The TBL_CLUSTER v2 side map (§5.3) a split board implies: each side's keys,
 *  encoders and sliders, in ascending side order. */
function derivedClusterSides(config: ConfigKeymap): ConfigClusterSide[] {
    const { sides = [], ...shared }: ConfigBoard = config.board ?? {}
    return [...sides]
        .sort((a, b) => a.side - b.side)
        .map((s) => ({
            side: s.side,
            ...sideGrid(config.keyboard.keys.filter((k) => k.side === s.side).length),
            encoders: (s.encoders ?? shared.encoders ?? []).length,
            sliders: (s.sliders ?? shared.sliders ?? []).length,
        }))
}

const sideKey = (s: ConfigClusterSide): string =>
    `${s.side}:${s.rows * s.cols}:${s.encoders ?? 0}:${s.sliders ?? 0}`

/** The side map for the blob: node.clusterSides when written, else the one
 *  board.sides implies; a written map that disagrees with board.sides warns. */
export function clusterSidesFor(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): ConfigClusterSide[] | undefined {
    const written = config.node?.clusterSides
    if (!config.board?.sides?.length) return written
    const derived = derivedClusterSides(config)
    if (!written) return derived
    if (written.map(sideKey).join() !== derived.map(sideKey).join())
        diag.warn(
            'node.clusterSides disagrees with board.sides (keys, encoders or sliders ' +
                'per side); the written map is used',
            ['node', 'clusterSides'],
        )
    return written
}
