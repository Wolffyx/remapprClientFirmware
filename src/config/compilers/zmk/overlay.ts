// pattern-check: skip — overlay file assembly composing hardware emitters
//
// The ZMK `.overlay` / split `.dtsi`+`.overlay` files: physical-layout node, the
// matrix-transform (electrical from the builder, else geometry-derived), the
// kscan + chosen + peripheral nodes (from hardware.ts), and the NOT-GENERATED
// checklist. emitOverlay is unibody; emitSplitOverlay emits the corne-style
// shared base + per-half col-gpios.

import type { ExportedFile } from '../../../types'
import type { DiagnosticBag } from '../../diagnostics'
import { resolveController, zmkSplitShields } from '../../controller'
import { deriveMatrix, matrixDiodeDirection, matrixSplit } from '../../matrix'
import type { ConfigKeymap } from '../../types'
import {
    physicalLayoutNode,
    type ZmkLayout,
    type ZmkLayoutPlan,
} from './layouts'
import { sanitize } from './maps'
import { emitBattery, emitScreen } from '../zephyrParts'
import {
    emitBacklightPwm,
    emitChosen,
    emitExtPowerGeneric,
    emitKscan,
    emitStudioAcm,
    emitSynthKscan,
    emitWs2812,
    notGeneratedBlock,
    resolvedGpioListProp,
} from './hardware'

// Dense-rank distinct values to contiguous indices (0,1,2,…). Raw position can
// skip values (a vertical gap, a split half), which would leave holes in the
// matrix; ranking collapses each distinct row/column line to one matrix index.
function denseRank(values: number[]): Map<number, number> {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    return new Map(sorted.map((v, i) => [v, i]))
}

interface MatrixCells {
    /** One RC per config key, in key order. */
    cells: { row: number; col: number }[]
    rows: number
    columns: number
    note: string
}

// The `zmk,matrix-transform` cells. With a builder-supplied electrical transform
// (`keyboard.hardware.transform`) the real kscan wiring is used verbatim. Without
// one, the map is DERIVED from physical geometry: dense-rank distinct y → row and
// distinct x → col so the matrix is contiguous (no gaps). The derived map is a
// scaffold, not the true electrical matrix (ZMK does not expose kscan wiring over
// the connection) — so it is warned. Either way the map order matches the keymap
// binding order (physical-layout key order), which is what ZMK requires.
function matrixCells(config: ConfigKeymap, diag: DiagnosticBag): MatrixCells {
    const real = config.keyboard.hardware?.transform
    if (real) {
        return {
            cells: real.map.map(([row, col]) => ({ row, col })),
            rows: real.rows,
            columns: real.columns,
            note: '/* From the board electrical wiring (builder). */',
        }
    }
    const rowRank = denseRank(config.keyboard.keys.map((k) => Math.round(k.y)))
    const colRank = denseRank(config.keyboard.keys.map((k) => Math.round(k.x)))
    diag.warn(
        'matrix-transform RC() values are derived from physical key position, ' +
            'not the board kscan wiring (ZMK does not expose it over the ' +
            'connection). Verify/replace them against your board before flashing.',
        ['keyboard', 'keys'],
    )
    return {
        cells: config.keyboard.keys.map((k) => ({
            row: rowRank.get(Math.round(k.y)) ?? 0,
            col: colRank.get(Math.round(k.x)) ?? 0,
        })),
        rows: rowRank.size,
        columns: colRank.size,
        note: '/* DERIVED from key geometry — confirm against your kscan. */',
    }
}

// One `zmk,matrix-transform` node for `layout`: its keys' cells, one line per
// matrix row (break whenever the row index changes — keymap order is row-major
// for the common case), mirroring a hand-written map.
function transformNode(layout: ZmkLayout, m: MatrixCells): string[] {
    const lines: string[] = []
    let current = -1
    let line: string[] = []
    const flush = (): void => {
        if (line.length) lines.push('            ' + line.join(' '))
        line = []
    }
    for (const ki of layout.keys) {
        const c = m.cells[ki] ?? { row: 0, col: 0 }
        if (c.row !== current) {
            flush()
            current = c.row
        }
        line.push(`RC(${c.row},${c.col})`)
    }
    flush()
    return [
        `    ${layout.transformLabel}: ${layout.transformNode} {`,
        `        compatible = "zmk,matrix-transform";`,
        `        ${m.note}`,
        `        columns = <${m.columns}>;`,
        `        rows = <${m.rows}>;`,
        `        map = <`,
        ...lines,
        `        >;`,
        `    };`,
    ]
}

// Every physical layout + its transform, then the position map (variants only).
function layoutNodes(
    config: ConfigKeymap,
    plan: ZmkLayoutPlan,
    m: MatrixCells,
): string[] {
    const blocks = [
        ...plan.layouts.flatMap((l) => [
            physicalLayoutNode(config, l),
            transformNode(l, m),
        ]),
        ...(plan.positionMap.length ? [[...plan.positionMap]] : []),
    ]
    return blocks.flatMap((b, i) => (i ? [``, ...b] : b))
}

// Emit the `zmk,physical-layout` node from the config geometry + a
// `zmk,matrix-transform`. When the builder supplies `keyboard.hardware`, the real
// kscan + chosen nodes and the electrical transform are emitted too, making the
// overlay flashable; the NOT-GENERATED checklist then shrinks to the SoC /
// peripheral nodes that still must come from the board's own overlay.
export function emitOverlay(
    config: ConfigKeymap,
    diag: DiagnosticBag,
    plan: ZmkLayoutPlan,
): ExportedFile {
    const hw = config.keyboard.hardware
    const matrix = matrixCells(config, diag)
    // Real kscan wins; else synthesize one from friendly pin labels.
    const explicitKscan = hw?.kscan ? emitKscan(hw.kscan) : null
    const synthKscan = explicitKscan ? null : emitSynthKscan(config, diag)
    const kscanLines = explicitKscan ?? synthKscan
    const hasKscan = kscanLines != null

    const ctrl = resolveController(config)
    const target = [
        ...(ctrl.board ? [` * Target board: ${ctrl.board}.`] : []),
        ...(ctrl.shield ? [` * Shield: ${ctrl.shield}.`] : []),
    ]
    const header = synthKscan
        ? [
              `/* Generated by remappr — ZMK overlay for ${config.keyboard.name}.`,
              ...target,
              ` * Physical layout, matrix-transform, chosen and a kscan SYNTHESIZED`,
              ` * from the builder's friendly pin labels are generated. Verify the`,
              ` * pin assignments + diode-direction, and add SoC/peripheral nodes`,
              ` * (pinctrl, LED drivers, …) from your board overlay. */`,
          ]
        : hasKscan
          ? [
                `/* Generated by remappr — ZMK overlay for ${config.keyboard.name}.`,
                ...target,
                ` * Physical layout, electrical matrix-transform, kscan, chosen and`,
                ` * any peripherals configured here (backlight/underglow/ext-power) are`,
                ` * generated. Remaining board-specific nodes (SoC pinctrl for the kscan,`,
                ` * anything not set in the builder) are listed in the checklist below. */`,
            ]
          : [
                `/* Generated by remappr — ZMK physical layout for ${config.keyboard.name}.`,
                ...target,
                ` * Key geometry + a geometry-DERIVED matrix-transform are generated.`,
                ` * Remaining hardware nodes (kscan, pinctrl, backlight/underglow`,
                ` * drivers) are board-specific — keep them in your board/shield overlay.`,
                ` * The matrix-transform RC() map is a scaffold from physical position,`,
                ` * NOT the real kscan wiring — verify it before flashing. */`,
            ]

    // Full-parity peripheral nodes (gated on the builder's hardware fields).
    const extPowerNode = hw?.extPowerCtrl
        ? emitExtPowerGeneric(hw.extPowerCtrl, diag, ctrl.board)
        : []
    const bl = hw?.backlightPwm
        ? emitBacklightPwm(hw.backlightPwm, diag, ctrl.board)
        : null
    const ws = hw?.ws2812 ? emitWs2812(hw.ws2812, diag, ctrl.board) : null
    const studio = hw?.studioAcm ? emitStudioAcm() : []

    const rootPeripherals = [
        ...(extPowerNode.length ? [``, ...extPowerNode] : []),
        ...(bl ? [``, ...bl.root] : []),
    ]
    const pinctrlGroups = [...(bl?.pinctrl ?? []), ...(ws?.pinctrl ?? [])]
    const pinctrlBlock = pinctrlGroups.length
        ? [``, `&pinctrl {`, ...pinctrlGroups, `};`]
        : []
    const peripheralBlocks = [
        ...(bl && bl.block.length ? [``, ...bl.block] : []),
        ...(ws ? [``, ...ws.block] : []),
        ...(studio.length ? [``, ...studio] : []),
    ]
    const chosen = emitChosen(hasKscan, hw, plan.layouts[0]!.label)
    const parts = partBlocks(config, diag)

    const lines = [
        ...header,
        `#include <physical_layouts.dtsi>`,
        `#include <dt-bindings/zmk/matrix_transform.h>`,
        ...(hasKscan || hw?.extPowerCtrl || parts.length
            ? [`#include <dt-bindings/gpio/gpio.h>`]
            : []),
        ...(hw?.ws2812 ? [`#include <zephyr/dt-bindings/led/led.h>`] : []),
        ``,
        `/ {`,
        ...(chosen.length ? [...chosen, ``] : []),
        ...layoutNodes(config, plan, matrix),
        ...(kscanLines ? [``, ...kscanLines] : []),
        ...rootPeripherals,
        `};`,
        ...pinctrlBlock,
        ...peripheralBlocks,
        ...parts,
        ``,
        ...notGeneratedBlock(hasKscan, hw),
        ``,
    ]
    return {
        filename: `${sanitize(config.keyboard.id || config.keyboard.name)}.overlay`,
        mime: 'text/plain',
        content: lines.join('\n'),
    }
}

/** The board's screen and battery divider, each after a blank line (the
 *  overlay header includes gpio.h whenever there are any). */
function partBlocks(config: ConfigKeymap, diag: DiagnosticBag): string[] {
    return [emitScreen(config, 'zmk', diag), emitBattery(config, 'zmk', diag)].flatMap((f) =>
        f.nodes.length ? ['', ...f.nodes] : [],
    )
}

// Emit a real ZMK SPLIT shield: a shared `<base>.dtsi` (physical-layout + unified
// matrix-transform + a rows-only kscan + chosen + peripherals) and two thin
// overlays `<base>_left.overlay` / `<base>_right.overlay` that #include it and set
// each half's own col-gpios — the right one offsetting the transform by the left's
// column count. Mirrors the upstream corne shield. Falls back to the unibody overlay
// when the geometry doesn't split into exactly two column groups.
export function emitSplitOverlay(
    config: ConfigKeymap,
    diag: DiagnosticBag,
    plan: ZmkLayoutPlan,
): ExportedFile[] {
    const split = zmkSplitShields(config)
    const groups = matrixSplit(config.keyboard.keys)
    if (!split || groups.length !== 2) return [emitOverlay(config, diag, plan)]
    const [left, right] = groups
    const L = left.columns
    const hw = config.keyboard.hardware
    const board = resolveController(config).board

    // Honor the builder's diode direction on the split path too (the unibody
    // emitKscan already does). Forcing col2row on a row2col board emits a wrong
    // kscan that won't register keys. The pin roles flip with the direction:
    // col2row → rows are inputs / cols outputs; row2col → rows outputs / cols inputs.
    const diodeDirection = matrixDiodeDirection(config)
    const rowRole = diodeDirection === 'col2row' ? 'input' : 'output'
    const colRole = diodeDirection === 'col2row' ? 'output' : 'input'

    // Unified transform from the SAME derivation as the split groups, so the
    // right half's col-offset (= left column count) lines up with the map.
    const dm = deriveMatrix(config.keyboard.keys)
    diag.warn(
        'split matrix-transform RC() values are derived from physical key position, ' +
            'not the board kscan wiring — verify them against your halves before flashing.',
        ['keyboard', 'keys'],
    )
    const matrix: MatrixCells = {
        cells: dm.map.map(([row, col]) => ({ row, col })),
        rows: dm.rows,
        columns: dm.columns,
        note: '/* DERIVED from key geometry — confirm against your kscan. */',
    }

    // Per-half col labels: slice the unified col pins; an under-filled right half
    // reuses the left's (identical-half boards share the same column pins). Pad to
    // each half's column count so the kscan node always has the right shape.
    const pad = (arr: string[], n: number): string[] =>
        arr.length >= n
            ? arr.slice(0, n)
            : [...arr, ...Array(n - arr.length).fill('')]
    const pins = config.keyboard.pins
    const allCols = pins?.cols ?? []
    const rowLabels = pad(pins?.rows ?? [], dm.rows)
    const leftCols = pad(allCols.slice(0, L), L)
    const rightSlice = allCols.slice(L, L + right.columns)
    const rightCols = pad(
        rightSlice.length ? rightSlice : allCols.slice(0, right.columns),
        right.columns,
    )

    // Shared rows-only kscan (col-gpios are set per half in the overlays).
    const kscanRows = [
        `    kscan0: kscan {`,
        `        compatible = "zmk,kscan-gpio-matrix";`,
        `        wakeup-source;`,
        `        /* diode-direction from the builder — verify against your wiring. */`,
        `        diode-direction = "${diodeDirection}";`,
        ...resolvedGpioListProp('row-gpios', rowLabels, board, rowRole, diag),
        `        /* col-gpios set per half in ${split.left}.overlay / ${split.right}.overlay */`,
        `    };`,
    ]

    // Peripherals live in the shared dtsi → present on both halves (correct for
    // underglow/backlight/ext-power; the studio CDC is only used by the half on USB).
    const extPowerNode = hw?.extPowerCtrl
        ? emitExtPowerGeneric(hw.extPowerCtrl, diag, board)
        : []
    const bl = hw?.backlightPwm
        ? emitBacklightPwm(hw.backlightPwm, diag, board)
        : null
    const ws = hw?.ws2812 ? emitWs2812(hw.ws2812, diag, board) : null
    const studio = hw?.studioAcm ? emitStudioAcm() : []
    const rootPeripherals = [
        ...(extPowerNode.length ? [``, ...extPowerNode] : []),
        ...(bl ? [``, ...bl.root] : []),
    ]
    const pinctrlGroups = [...(bl?.pinctrl ?? []), ...(ws?.pinctrl ?? [])]
    const pinctrlBlock = pinctrlGroups.length
        ? [``, `&pinctrl {`, ...pinctrlGroups, `};`]
        : []
    const peripheralBlocks = [
        ...(bl && bl.block.length ? [``, ...bl.block] : []),
        ...(ws ? [``, ...ws.block] : []),
        ...(studio.length ? [``, ...studio] : []),
    ]
    const chosen = emitChosen(true, hw, plan.layouts[0]!.label)
    const parts = partBlocks(config, diag)

    const dtsi = [
        `/* Generated by remappr — SHARED split base for ${config.keyboard.name}.`,
        ` * #included by ${split.left}.overlay and ${split.right}.overlay. Holds the`,
        ` * physical layout, unified matrix-transform, a rows-only kscan and chosen.`,
        ` * Each half sets its own col-gpios; the right half offsets the transform. */`,
        `#include <physical_layouts.dtsi>`,
        `#include <dt-bindings/zmk/matrix_transform.h>`,
        `#include <dt-bindings/gpio/gpio.h>`,
        ...(ws ? [`#include <zephyr/dt-bindings/led/led.h>`] : []),
        ``,
        `/ {`,
        ...(chosen.length ? [...chosen, ``] : []),
        ...layoutNodes(config, plan, matrix),
        ``,
        ...kscanRows,
        ...rootPeripherals,
        `};`,
        ...pinctrlBlock,
        ...peripheralBlocks,
        ...parts,
        ``,
        ...notGeneratedBlock(true, hw),
        ``,
    ]

    const leftOverlay = [
        `/* Generated by remappr — ${split.left} half. Sets this half's col-gpios. */`,
        `#include "${split.base}.dtsi"`,
        ``,
        `&kscan0 {`,
        ...resolvedGpioListProp('col-gpios', leftCols, board, colRole, diag),
        `};`,
        ``,
    ]
    const rightOverlay = [
        `/* Generated by remappr — ${split.right} half. col-offset shifts this half's`,
        ` * ${right.columns} columns into the right block of the ${dm.columns}-column transform. */`,
        `#include "${split.base}.dtsi"`,
        ``,
        ...plan.layouts.flatMap((l) => [
            `&${l.transformLabel} {`,
            `    col-offset = <${L}>;`,
            `};`,
            ``,
        ]),
        `&kscan0 {`,
        ...resolvedGpioListProp('col-gpios', rightCols, board, colRole, diag),
        `};`,
        ``,
    ]

    return [
        {
            filename: `${split.base}.dtsi`,
            mime: 'text/plain',
            content: dtsi.join('\n'),
        },
        {
            filename: `${split.left}.overlay`,
            mime: 'text/plain',
            content: leftOverlay.join('\n'),
        },
        {
            filename: `${split.right}.overlay`,
            mime: 'text/plain',
            content: rightOverlay.join('\n'),
        },
    ]
}
