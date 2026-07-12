// Pattern check: Strategy (Tier 1) — extended — a new per-target KeymapCompiler
// registered into the existing compiler Strategy registry (compiler.ts), like the
// zmk / qmk / remappr strategies; the download/builder picks a target uniformly.
//
// The `remappr-board` compiler lowers a canonical ConfigKeymap into a Zephyr
// SHIELD for the remappr firmware (boards/shields/<id>/): a Remappr-native
// devicetree overlay (remappr,kbd-matrix + input-keymap + remappr,keymap nodes,
// keymap-dsl §6/§7 tokens) plus Kconfig.shield / Kconfig.defconfig. Mirrors the
// proven nrf52840_test shield format, NOT ZMK devicetree. The runtime config blob
// (the `remappr` compiler) stays authoritative for bindings — the overlay's
// default keymap is a bootstrap, so complex bindings lower to a no-op (&pass) with
// a diagnostic rather than duplicating the whole behavior engine into devicetree.

import type { ExportedFile } from '../../../types'
import { HID_USAGE_BY_CANONICAL } from '../../../catalog/entries'
import { type KeymapCompiler, registerCompiler, runCompile } from '../../compiler'
import type { DiagnosticBag } from '../../diagnostics'
import { resolveController } from '../../controller'
import { matrixDims, resolveKeyMatrix } from '../../matrix'
import { gpioSpec, type PinRole, resolveZmkPin } from '../../pinmaps'
import type {
    CanonAction,
    CanonGeometry,
    CanonLayer,
    ConfigKeymap,
    DiodeDirection,
} from '../../types'

/** HID Usage Page 0x07 (Keyboard/Keypad) — the only page a `&key` action emits. */
const HID_PAGE_KEYBOARD = 7

/** Devicetree-safe shield slug (lowercase, `_`-joined) — e.g. `nrf52840_test`. */
function shieldSlug(config: ConfigKeymap): string {
    const raw = config.keyboard.id || config.meta.name || 'remappr'
    return (
        raw
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'remappr'
    )
}

/** Per-visual-row key counts, from geometry (keys are in row-major order). Feeds
 *  the `remappr,keymap` `rows` array + `columns` (its max). */
function visualRowCounts(keys: CanonGeometry[]): number[] {
    const counts: number[] = []
    let curY: number | null = null
    for (const k of keys) {
        const y = Math.round(k.y)
        if (curY === null || y !== curY) {
            counts.push(0)
            curY = y
        }
        counts[counts.length - 1]++
    }
    return counts.length ? counts : [keys.length]
}

/** Resolve one GPIO entry to a devicetree spec (inside `<...>`). A raw `&`-spec
 *  passes through verbatim; a friendly label resolves on a known controller board,
 *  else emits unchanged with a diagnostic. */
function resolveGpio(
    raw: string,
    role: PinRole,
    board: string | undefined,
    diag: DiagnosticBag,
    path: (string | number)[],
): string {
    const s = raw.trim()
    if (s.startsWith('&')) return s
    const core = board ? resolveZmkPin(board, s) : null
    if (core) return gpioSpec(core, role)
    diag.warn(
        `unresolved GPIO label "${raw}" — emitting verbatim; set board.controller ` +
            `to a known board or provide a raw "&gpioN pin FLAGS" spec`,
        path,
    )
    return s
}

/** A `row-gpios`/`col-gpios` property with one `<spec>` per line. */
function gpioProp(
    name: string,
    specs: string[],
    role: PinRole,
    board: string | undefined,
    diag: DiagnosticBag,
    path: (string | number)[],
): string[] {
    if (specs.length === 0) return []
    const rows = specs.map(
        (s, i) => `\t\t\t<${resolveGpio(s, role, board, diag, [...path, i])}>`,
    )
    return [`\t\t${name} =`, `${rows.join(',\n')};`]
}

/** One layer binding → a keymap-dsl action token. Only plain keypress / gap lower
 *  to the default keymap; the config blob carries everything else. */
function actionToken(
    a: CanonAction,
    diag: DiagnosticBag,
    path: (string | number)[],
): string {
    switch (a.type) {
        case 'key_press': {
            if (a.mods && a.mods.length > 0) {
                diag.warn(
                    `modified keypress not lowered to the default keymap ` +
                        `(config blob carries it)`,
                    path,
                )
                return '&pass'
            }
            const u = HID_USAGE_BY_CANONICAL.get(a.key)
            if (!u || u.page !== HID_PAGE_KEYBOARD) {
                diag.warn(
                    `key "${a.key}" has no keyboard-page HID usage for the ` +
                        `default keymap`,
                    path,
                )
                return '&pass'
            }
            return `&key 0x${u.usage.toString(16).toUpperCase().padStart(2, '0')}`
        }
        case 'transparent':
            return '&pass'
        case 'none':
            return '&block'
        default:
            diag.warn(
                `binding "${a.type}" not lowered to the default keymap ` +
                    `(config blob carries it)`,
                path,
            )
            return '&pass'
    }
}

/** Wrap a flat token stream into visual rows for a readable phandle-array body. */
function chunkByRows(tokens: string[], rowCounts: number[]): string {
    const lines: string[] = []
    let i = 0
    for (const n of rowCounts) {
        lines.push('\t\t\t\t' + tokens.slice(i, i + n).join(' '))
        i += n
    }
    if (i < tokens.length) lines.push('\t\t\t\t' + tokens.slice(i).join(' '))
    return lines.join('\n')
}

function emitLayer(
    layer: CanonLayer,
    index: number,
    rowCounts: number[],
    diag: DiagnosticBag,
): string[] {
    const tokens = layer.bindings.map((b, i) =>
        actionToken(b, diag, ['layers', index, 'bindings', i]),
    )
    return [
        `\t\tlayer_${index} {`,
        `\t\t\tcompatible = "remappr,keymap-layer";`,
        `\t\t\tindex = <${index}>;`,
        `\t\t\tactions = <`,
        chunkByRows(tokens, rowCounts),
        `\t\t\t>;`,
        `\t\t};`,
    ]
}

function storageDefconfig(config: ConfigKeymap): string[] {
    const board = config.board
    const fromFirmware = config.firmware?.remappr?.storage
    const storage = (board?.storage ?? fromFirmware) as string | undefined
    if (storage !== 'zms' && storage !== 'nvs') return []
    const sym =
        storage === 'zms'
            ? 'REMAPPR_SETTINGS_BACKEND_ZMS'
            : 'REMAPPR_SETTINGS_BACKEND_NVS'
    return [
        ``,
        `choice REMAPPR_SETTINGS_BACKEND`,
        `\tdefault ${sym}`,
        `endchoice`,
    ]
}

function emitBoard(config: ConfigKeymap, diag: DiagnosticBag): ExportedFile[] {
    const slug = shieldSlug(config)
    const SHIELD = slug.toUpperCase()
    const ctrl = resolveController(config)
    const board = config.board

    const diode: DiodeDirection =
        board?.matrix?.diode ??
        config.keyboard.matrix?.diodeDirection ??
        'col2row'
    // col2row: rows are inputs, columns strobe outputs (and vice-versa).
    const rowRole: PinRole = diode === 'col2row' ? 'input' : 'output'
    const colRole: PinRole = diode === 'col2row' ? 'output' : 'input'

    const rowGpios = board?.matrix?.rows ?? config.keyboard.pins?.rows ?? []
    const colGpios = board?.matrix?.cols ?? config.keyboard.pins?.cols ?? []
    if (rowGpios.length === 0 && colGpios.length === 0)
        diag.warn(
            `no matrix pins — set board.matrix.rows/cols (or keyboard.pins) to a ` +
                `GPIO spec list`,
            ['board', 'matrix'],
        )

    const dims = matrixDims(config)
    const rowSize = rowGpios.length || dims.rows || 1
    const colSize = colGpios.length || dims.cols || 1

    // resolveKeyMatrix falls back to a geometry-derived matrix when no wiring is
    // given; that packing rarely matches the physical row/col gpios, so warn.
    const explicitWiring =
        !!config.keyboard.hardware?.transform ||
        config.keyboard.keys.some((k) => k.matrix)
    if (!explicitWiring)
        diag.warn(
            `matrix cells auto-derived from key geometry — verify each ` +
                `CELL(row, col) against your row/col wiring, or provide ` +
                `keyboard.hardware.transform`,
            ['keyboard', 'hardware', 'transform'],
        )

    const cells = resolveKeyMatrix(config)
    const rowCounts = visualRowCounts(config.keyboard.keys)
    const columns = Math.max(1, ...rowCounts)

    const cellTokens = cells.map(([r, c]) => `CELL(${r}, ${c})`)
    const placementTokens = config.keyboard.keys.map(() => 'KEY()')

    const overlay: string[] = [
        `/*`,
        ` * ${config.meta.name} — Remappr shield (generated by remappr).`,
        ` *`,
        ` * Drop this directory into a remappr-firmware checkout under`,
        ` * boards/shields/${slug}/ and build with -DSHIELD=${slug}. Verify the`,
        ` * row/col GPIO specs against your wiring — remappr derives the matrix`,
        ` * cells from physical key position, not the electrical matrix.`,
        ` *`,
        ` * SPDX-License-Identifier: Apache-2.0`,
        ` */`,
        ``,
        `#include <zephyr/dt-bindings/input/input-event-codes.h>`,
        `#include <zephyr/dt-bindings/input/keymap.h>`,
        `#include <dt-bindings/remappr/keys.h>`,
        `#include <dt-bindings/remappr/layout.h>`,
        `#include <zephyr/sys/util_macro.h>`,
        `#include <remappr/keymap-tokens.dtsi>`,
        `#include <remappr/behavior-tokens.dtsi>`,
        ``,
        `/ {`,
        `\tkbd_matrix: kbd-matrix {`,
        `\t\tcompatible = "remappr,kbd-matrix";`,
        `\t\tdiode-direction = "${diode}";`,
        ...(board?.matrix?.pollMs
            ? [`\t\tpoll-period-ms = <${board.matrix.pollMs}>;`]
            : []),
        ...gpioProp('row-gpios', rowGpios, rowRole, ctrl.board, diag, [
            'board',
            'matrix',
            'rows',
        ]),
        ...gpioProp('col-gpios', colGpios, colRole, ctrl.board, diag, [
            'board',
            'matrix',
            'cols',
        ]),
        ``,
        `\t\tkeymap {`,
        `\t\t\tcompatible = "input-keymap";`,
        `\t\t\tkeymap = <REMAPPR_MATRIX_KEYMAP(`,
        chunkByRows(cellTokens, rowCounts),
        `\t\t\t)>;`,
        `\t\t\trow-size = <${rowSize}>;`,
        `\t\t\tcol-size = <${colSize}>;`,
        `\t\t};`,
        `\t};`,
        ``,
        `\tremappr_keymap: remappr-keymap {`,
        `\t\tcompatible = "remappr,keymap";`,
        `\t\tscan = <&kbd_matrix>;`,
        `\t\tcolumns = <${columns}>;`,
        `\t\trows = <${rowCounts.join(' ')}>;`,
        `\t\tmax-layers = <${config.layers.length}>;`,
        `\t\tplacement = <`,
        chunkByRows(placementTokens, rowCounts),
        `\t\t>;`,
        ...config.layers.flatMap((l, i) => emitLayer(l, i, rowCounts, diag)),
        `\t};`,
        `};`,
        ``,
    ]

    const kconfigShield = [
        `config SHIELD_${SHIELD}`,
        `\tdef_bool $(shields_list_contains,${slug})`,
        ``,
    ].join('\n')

    const kconfigDefconfig = [
        `if SHIELD_${SHIELD}`,
        ``,
        `# The matrix + keymap drivers auto-enable from devicetree; the input`,
        `# subsystem itself must be on.`,
        `config INPUT`,
        `\tdefault y`,
        ...storageDefconfig(config),
        ``,
        `endif # SHIELD_${SHIELD}`,
        ``,
    ].join('\n')

    const dir = `boards/shields/${slug}`
    return [
        { filename: `${dir}/${slug}.overlay`, mime: 'text/plain', content: overlay.join('\n') },
        { filename: `${dir}/Kconfig.shield`, mime: 'text/plain', content: kconfigShield },
        { filename: `${dir}/Kconfig.defconfig`, mime: 'text/plain', content: kconfigDefconfig },
    ]
}

export const remapprBoardCompiler: KeymapCompiler = {
    target: 'remappr-board',
    compile: (config) => runCompile(config, emitBoard),
}

registerCompiler(remapprBoardCompiler)
