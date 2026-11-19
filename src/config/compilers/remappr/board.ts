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
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'
import { matrixDims, resolveKeyMatrix } from '../../matrix'
import { type PinRole, ROLE_FLAGS } from '../../pinmaps'
import type {
    CanonAction,
    CanonGeometry,
    CanonLayer,
    ConfigKeymap,
} from '../../types'
import { AdcBook } from './boardAdc'
import {
    emitEncoders,
    emitRgb,
    emitSensor,
    type PeripheralFragment,
} from './boardHardware'
import {
    type MatrixWiring,
    matrixWiring,
    type SourcedPin,
} from './boardMatrix'
import { boardTarget, PinBook } from './boardPins'
import { emitNodeBus, emitRadioConfig, emitRadioLink } from './boardLink'
import {
    buttonCodes,
    emitButtonPositions,
    emitButtons,
    emitSliders,
    matrixKeyCount,
} from './boardInputs'
import { emitDisplays, emitHaptic, emitLedZones } from './boardOutput'
import { layoutOrigin, type Origin, placementTokens } from './boardPlacement'
import { emitBattery, emitPowerOff, emitStatusLeds } from './boardPower'
import { dtComment } from './dtText'

/** HID Usage Page 0x07 (Keyboard/Keypad) — the only page a `&key` action emits. */
const HID_PAGE_KEYBOARD = 7

/** Each line once, in first-seen order (two fragments may need one header). */
const unique = (lines: string[]): string[] => [...new Set(lines)]

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

/** A `row-gpios`/`col-gpios` property with one `<spec>` per line. */
function gpioProp(
    name: string,
    pins: SourcedPin[],
    role: PinRole,
    book: PinBook,
): string[] {
    if (pins.length === 0) return []
    const rows = pins.map(
        (p) => `\t\t\t<${book.spec(p.raw, ROLE_FLAGS[role], p.path)}>`,
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

/** The config as the matrix nodes see it: its first `m` keys (the rest are
 *  off-matrix buttons), with the layers and the transform cut to match. */
function matrixView(config: ConfigKeymap, m: number): ConfigKeymap {
    const n = config.keyboard.keys.length
    if (m === n) return config
    const hw = config.keyboard.hardware
    return {
        ...config,
        keyboard: {
            ...config.keyboard,
            keys: config.keyboard.keys.slice(0, m),
            ...(hw?.transform
                ? { hardware: { ...hw, transform: { ...hw.transform, map: hw.transform.map.slice(0, m) } } }
                : {}),
        },
        layers: config.layers.map((l) => ({ ...l, bindings: l.bindings.slice(0, m) })),
    }
}

/** Personalities whose board may have no key matrix (their inputs are wired
 *  elsewhere), so a board without matrix pins is not a mistake. */
const MATRIX_OPTIONAL = new Set(['mouse', 'joystick', 'dongle'])

/** The key matrix wiring to emit, or null for a board that has none. A
 *  keyboard without matrix pins is an error: `remappr,kbd-matrix` requires
 *  both row-gpios and col-gpios, so that node never builds. */
function planMatrix(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): MatrixWiring | null {
    const wiring = matrixWiring(config, diag)
    if (!wiring) return null
    const nr = wiring.rows.length
    const nc = wiring.cols.length
    const personality = config.node?.personality
    if (nr === 0 && nc === 0 && personality && MATRIX_OPTIONAL.has(personality)) {
        diag.warn(
            `no matrix pins: the ${personality} shield declares no key matrix ` +
                `and no default keymap`,
            ['board', 'matrix'],
        )
        return null
    }
    const where = 'set board.matrix.rows/cols, keyboard.hardware.kscan or keyboard.pins'
    if (nr === 0 && nc === 0)
        diag.error(`no matrix pins: ${where}`, ['board', 'matrix'])
    else if (nr === 0) diag.error(`no row pins: ${where}`, ['board', 'matrix', 'rows'])
    else if (nc === 0)
        diag.error(`no column pins: ${where}`, ['board', 'matrix', 'cols'])
    return wiring
}

/** Where a key's matrix cell was written, for a diagnostic. */
function cellPath(config: ConfigKeymap, i: number): DiagnosticPath {
    if (config.keyboard.keys[i].matrix) return ['keyboard', 'keys', i, 'matrix']
    if (config.keyboard.hardware?.transform)
        return ['keyboard', 'hardware', 'transform', 'map', i]
    return ['keyboard', 'keys', i]
}

type OptionTag = [number, number] | undefined

/** Two choices of one VIA layout option (ANSI vs ISO Enter): only one of them
 *  is on the board, so they share a matrix cell by design. */
const isAlternate = (a: OptionTag, b: OptionTag): boolean =>
    !!a && !!b && a[0] === b[0] && a[1] !== b[1]

/** Every cell must fit the GPIO counts (the firmware build-asserts it) and no
 *  two keys may share one (the second would never be read), unless they are
 *  choices of one layout option.
 *
 *  Returns the position each key's matrix entry reports. The firmware counts
 *  the entries (one per position) and keeps the last of a cell's entries, so
 *  every choice of a shared cell keeps its entry but reports the cell's
 *  default choice (the lowest; VIA's default is choice 0). */
function checkCells(
    config: ConfigKeymap,
    cells: [number, number][],
    wiring: MatrixWiring,
    diag: DiagnosticBag,
): number[] {
    const nr = wiring.rows.length
    const nc = wiring.cols.length
    const keys = config.keyboard.keys
    const byCell = new Map<string, number[]>()
    cells.forEach(([r, c], i) => {
        const path = cellPath(config, i)
        if (nr && r >= nr)
            diag.error(`key ${i} is on row ${r}, but the matrix has ${nr} row GPIO(s)`, path)
        if (nc && c >= nc)
            diag.error(`key ${i} is on column ${c}, but the matrix has ${nc} column GPIO(s)`, path)
        const sharing = byCell.get(`${r},${c}`) ?? []
        byCell.set(`${r},${c}`, [...sharing, i])
        const clash = sharing.find((p) => !isAlternate(keys[p]?.option, keys[i]?.option))
        if (clash === undefined) return
        diag.error(
            `keys ${clash} and ${i} share matrix cell (${r}, ${c}); one of them ` +
                `can never be read`,
            path,
        )
    })
    const reports = cells.map((_, i) => i)
    for (const group of byCell.values()) {
        const choice = (i: number): number => keys[i]?.option?.[1] ?? 0
        const owner = group.reduce((a, b) => (choice(b) < choice(a) ? b : a))
        group.forEach((i) => (reports[i] = owner))
    }
    return reports
}

/** An encoder or slider key is only a matrix key when its wiring says so (an
 *  encoder's push switch). Without that it would get a made-up cell, which can
 *  collide with a real key. Its hardware is declared apart: the rotation in
 *  board.encoders, the wiper in board.sliders, a push switch on its own pin in
 *  board.buttons; the key itself has no engine position to draw yet. */
function checkElements(config: ConfigKeymap, diag: DiagnosticBag): void {
    if (config.keyboard.hardware?.transform) return
    config.keyboard.keys.forEach((k, i) => {
        if (!k.element || k.matrix) return
        const what = k.element === 'encoder' ? 'an encoder' : 'a slider'
        const where = k.element === 'encoder' ? 'board.encoders' : 'board.sliders'
        diag.error(
            `key ${i} is ${what} with no matrix cell. Declare its hardware in ` +
                `${where} (a push switch on its own pin in board.buttons) and ` +
                `give the key a matrix cell only if its switch is in the matrix`,
            ['keyboard', 'keys', i, 'element'],
        )
    })
}

/** The `remappr,kbd-matrix` node with its `input-keymap` child. */
function matrixNode(
    config: ConfigKeymap,
    wiring: MatrixWiring,
    book: PinBook,
    rowCounts: number[],
    diag: DiagnosticBag,
): string[] {
    const diode = wiring.diode
    // col2row: rows are inputs, columns strobe outputs (and vice-versa).
    const rowRole: PinRole = diode === 'col2row' ? 'input' : 'output'
    const colRole: PinRole = diode === 'col2row' ? 'output' : 'input'

    // resolveKeyMatrix falls back to a geometry-derived matrix when no wiring is
    // given; that packing rarely matches the physical row/col gpios, so warn.
    const explicitWiring =
        !!config.keyboard.hardware?.transform ||
        config.keyboard.keys.some((k) => k.matrix)
    if (!explicitWiring)
        diag.warn(
            `matrix cells auto-derived from key geometry — verify each ` +
                `matrix cell against your row/col wiring, or provide ` +
                `keyboard.hardware.transform`,
            ['keyboard', 'hardware', 'transform'],
        )
    checkElements(config, diag)
    const cells = resolveKeyMatrix(config)
    const reports = checkCells(config, cells, wiring, diag)
    const dims = matrixDims(config)
    const bm = config.board?.matrix
    const pollMs = bm?.pollMs
    if (wiring.debouncePressMs !== undefined && bm?.debouncePressMode !== 'defer')
        diag.warn(
            `debounce-press-ms only applies with debouncePressMode "defer"; the ` +
                `default eager mode reports a press on the first active scan`,
            ['board', 'matrix', 'debouncePressMode'],
        )

    // One MATRIX_KEY per position, code = REMAPPR_KB_POS_BASE + position (a
    // layout-option choice reports its cell's default choice). Not the
    // REMAPPR_MATRIX_KEYMAP(CELL...) macro: it is built on FOR_EACH_IDX, which
    // Zephyr caps at 64 arguments, so a 65th key was a dtc syntax error and no
    // TKL or full-size board compiled.
    const cellTokens = cells.map(
        ([r, c], i) => `MATRIX_KEY(${r}, ${c}, REMAPPR_KB_POS_BASE + ${reports[i]})`,
    )
    return [
        `\tkbd_matrix: kbd-matrix {`,
        `\t\tcompatible = "remappr,kbd-matrix";`,
        `\t\tdiode-direction = "${diode}";`,
        ...(pollMs ? [`\t\tpoll-period-ms = <${pollMs}>;`] : []),
        ...(bm?.sleepPollMs ? [`\t\tsleep-poll-period-ms = <${bm.sleepPollMs}>;`] : []),
        ...(bm?.settleUs !== undefined ? [`\t\tsettle-time-us = <${bm.settleUs}>;`] : []),
        ...(bm?.debouncePressMode
            ? [`\t\tdebounce-press-mode = "${bm.debouncePressMode}";`]
            : []),
        ...(wiring.debouncePressMs !== undefined
            ? [`\t\tdebounce-press-ms = <${wiring.debouncePressMs}>;`]
            : []),
        ...(wiring.debounceReleaseMs !== undefined
            ? [`\t\tdebounce-release-ms = <${wiring.debounceReleaseMs}>;`]
            : []),
        ...gpioProp('row-gpios', wiring.rows, rowRole, book),
        ...gpioProp('col-gpios', wiring.cols, colRole, book),
        ``,
        `\t\tkeymap {`,
        `\t\t\tcompatible = "input-keymap";`,
        `\t\t\tkeymap = <`,
        chunkByRows(cellTokens, rowCounts),
        `\t\t\t>;`,
        `\t\t\trow-size = <${wiring.rows.length || dims.rows || 1}>;`,
        `\t\t\tcol-size = <${wiring.cols.length || dims.cols || 1}>;`,
        `\t\t};`,
        `\t};`,
        ``,
    ]
}

/** Layers the app may fill without a reflash when board.maxLayers is not set
 *  (the firmware sizes its layer store from max-layers). */
const DEFAULT_MAX_LAYERS = 4

/** The layer capacity: board.maxLayers, else the authored layers with room to
 *  grow. Equal to the authored count, as before, a one-layer bootstrap could
 *  never take a second layer from the app. */
function maxLayers(config: ConfigKeymap, diag: DiagnosticBag): number {
    const authored = config.layers.length
    const set = config.board?.maxLayers
    if (set === undefined) return Math.max(authored, DEFAULT_MAX_LAYERS)
    if (set < authored)
        diag.error(
            `board.maxLayers ${set} is below the ${authored} layers authored`,
            ['board', 'maxLayers'],
        )
    return Math.max(set, authored)
}

/** The `remappr,keymap` node: placement, layer capacity and the default
 *  layers, scanning the matrix node. */
/** How the keymap node's positions are read: from the kbd_matrix scan, or
 *  (a board whose keys are all buttons) from these off-matrix input codes. */
type KeymapSource = { scan: true } | { extraCodes: string[] }

function keymapNode(
    config: ConfigKeymap,
    layout: { rowCounts: number[]; origin: Origin },
    source: KeymapSource,
    diag: DiagnosticBag,
): string[] {
    const { rowCounts, origin } = layout
    const placement = placementTokens(config.keyboard.keys, diag, origin)
    return [
        `\tremappr_keymap: remappr-keymap {`,
        `\t\tcompatible = "remappr,keymap";`,
        ...('scan' in source
            ? [`\t\tscan = <&kbd_matrix>;`]
            : [`\t\textra-input-codes = <${source.extraCodes.join(' ')}>;`]),
        `\t\tcolumns = <${Math.max(1, ...rowCounts)}>;`,
        `\t\trows = <${rowCounts.join(' ')}>;`,
        `\t\tmax-layers = <${maxLayers(config, diag)}>;`,
        `\t\tplacement = <`,
        chunkByRows(placement, rowCounts),
        `\t\t>;`,
        ...config.layers.flatMap((l, i) => emitLayer(l, i, rowCounts, diag)),
        `\t};`,
    ]
}

function emitBoard(config: ConfigKeymap, diag: DiagnosticBag): ExportedFile[] {
    const slug = shieldSlug(config)
    const SHIELD = slug.toUpperCase()
    const target = boardTarget(config, diag)
    const book = new PinBook(target, diag)
    book.reserve(config.board?.reservedPins ?? [])

    // The matrix nodes take the keys before the off-matrix buttons; both lay
    // out from one origin so the drawn board lines up.
    const origin = layoutOrigin(config.keyboard.keys)
    const m = matrixKeyCount(config, diag)
    const mx = matrixView(config, m)
    const rowCounts = visualRowCounts(mx.keyboard.keys)
    const wiring = m > 0 ? planMatrix(mx, diag) : null
    const codes = buttonCodes(config, diag)
    const buttonsOnly = m === 0 && codes.length > 0
    const keyNodes = wiring
        ? [
              ...matrixNode(mx, wiring, book, rowCounts, diag),
              ...keymapNode(mx, { rowCounts, origin }, { scan: true }, diag),
          ]
        : buttonsOnly
          ? keymapNode(
                config,
                { rowCounts: visualRowCounts(config.keyboard.keys), origin },
                { extraCodes: codes },
                diag,
            )
          : []

    // Optional peripheral overlay nodes (empty fragments when unconfigured).
    const adc = new AdcBook(target.soc, diag)
    const frags: PeripheralFragment[] = [
        emitRgb(config, book, diag),
        emitEncoders(config, book, diag),
        emitSensor(config, book, diag),
        emitBattery(config, book, adc, diag),
        emitStatusLeds(config, book, diag),
        emitPowerOff(config, book),
        emitNodeBus(config, book, diag),
        emitRadioLink(config, book, diag),
        emitRadioConfig(config, diag),
        emitButtons(config, codes, book),
        ...(buttonsOnly ? [] : [emitButtonPositions(config, codes, origin, diag)]),
        emitSliders(config, adc),
        emitHaptic(config, diag),
        emitLedZones(config, diag),
        emitDisplays(config, diag),
    ]

    const overlay: string[] = [
        `/*`,
        ` * ${dtComment(config.meta.name)} — Remappr shield (generated by remappr).`,
        ` *`,
        ` * Drop this directory into a remappr-firmware checkout under`,
        ` * boards/shields/${slug}/ and build with -Dremappr_SHIELD=${slug}. Verify the`,
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
        `#include <remappr/keymap-tokens.dtsi>`,
        `#include <remappr/behavior-tokens.dtsi>`,
        ...unique([...frags.flatMap((f) => f.includes), ...adc.includes()]),
        ...(keyNodes.length ? [``, `/ {`, ...keyNodes, `};`] : []),
        ...frags.flatMap((f) => (f.nodes.length ? ['', ...f.nodes] : [])),
        ...adc.blocks(),
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
        ...frags.flatMap((f) => f.kconfig),
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
