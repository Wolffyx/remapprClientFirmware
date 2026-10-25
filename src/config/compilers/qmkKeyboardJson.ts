// Pattern check: no GoF pattern (-) — rejected — a single pure function assembling
// the QMK `keyboard.json` object from the canonical config; data transform, no
// abstraction (mirrors the bundle's other string/JSON skeleton generators).
//
// Emits the modern QMK `keyboard.json` (the merged info.json + rules.mk + matrix
// config), matching a real in-tree keyboard (studied: qmk_firmware
// keyboards/eason/aeroboard). It carries everything needed to BUILD: USB identity,
// MCU identity (processor/bootloader/board OR the development_board shortcut),
// matrix_pins + diode_direction (or a direct-pin grid), feature toggles, and a
// `LAYOUT` whose entries pair each key's electrical `matrix:[r,c]` with its x/y/w/h
// — sourced from `materializeMatrix` (authoritative [row,col]) and
// `resolveController` (identity). `keymap.c` uses the matching `LAYOUT(` macro.

import type { Diagnostic } from '../diagnostics'
import { materializeMatrix } from '../matrix'
import { resolveController } from '../controller'
import { resolveQmkFeatures } from '../firmwareConf'
import { resolveQmkPin } from '../pinmaps'
import type { CanonController, ConfigKeymap } from '../types'

/** One key in a QMK `LAYOUT`: electrical position + physical placement. */
interface QmkLayoutKey {
    matrix: [number, number]
    x: number
    y: number
    w?: number
    h?: number
}

export interface QmkKeyboardJsonResult {
    json: Record<string, unknown>
    diagnostics: Diagnostic[]
}

/** MCU identity: the `development_board` shortcut wins (it sets the other three),
 *  else the explicit processor/bootloader/board trio. */
function identity(ctrl: CanonController): Record<string, string> {
    if (ctrl.developmentBoard)
        return { development_board: ctrl.developmentBoard }
    return {
        ...(ctrl.processor ? { processor: ctrl.processor } : {}),
        ...(ctrl.bootloader ? { bootloader: ctrl.bootloader } : {}),
        ...(ctrl.board ? { board: ctrl.board } : {}),
    }
}

/** Build the QMK `keyboard.json` object + any export diagnostics. */
export function buildQmkKeyboardJson(
    config: ConfigKeymap,
): QmkKeyboardJsonResult {
    const diagnostics: Diagnostic[] = []
    const warn = (message: string, path: (string | number)[] = []): void => {
        diagnostics.push({ level: 'warn', message, path })
    }

    const mat = materializeMatrix(config)
    const kb = mat.keyboard
    const meta = config.meta
    const ctrl = resolveController(config)
    const board = ctrl.board
    const dims = kb.matrix ?? { rows: 1, cols: 1, diodeDirection: 'col2row' }

    // USB identity — QMK requires vid/pid; default + warn when the builder left
    // them unset so the export still compiles.
    const vid = meta.vendorId ?? '0xFEED'
    const pid = meta.productId ?? '0x0000'
    if (!meta.vendorId || !meta.productId)
        warn(
            'USB vendor/product id missing — defaulted in keyboard.json; set them in the builder identity panel',
            ['meta'],
        )
    const usb: Record<string, string> = {
        vid,
        pid,
        ...(ctrl.deviceVersion ? { device_version: ctrl.deviceVersion } : {}),
    }

    // Pin wiring → matrix_pins. Friendly row/col labels become a cols/rows matrix;
    // else per-key `pin` becomes a direct-pin grid placed by [row,col].
    let matrixPins: Record<string, unknown> | null = null
    let diode: string | null = null
    const pins = kb.pins
    if (pins && pins.rows.length && pins.cols.length) {
        matrixPins = {
            cols: pins.cols.map((p) => resolveQmkPin(board, p)),
            rows: pins.rows.map((p) => resolveQmkPin(board, p)),
        }
        diode = (dims.diodeDirection ?? 'col2row').toUpperCase()
    } else if (kb.keys.some((k) => k.pin)) {
        const grid: string[][] = Array.from({ length: dims.rows }, () =>
            Array.from({ length: dims.cols }, () => 'NO_PIN'),
        )
        kb.keys.forEach((k) => {
            const [r, c] = k.matrix ?? [0, 0]
            if (k.pin && grid[r]) grid[r][c] = resolveQmkPin(board, k.pin)
        })
        matrixPins = { direct: grid }
        if (kb.keys.some((k) => !k.pin))
            warn(
                'some keys have no direct pin — emitted as NO_PIN in matrix_pins.direct',
                ['keyboard', 'keys'],
            )
    } else {
        warn(
            'no pin mapping — set row/col pins (or per-key pins) in the builder so keyboard.json carries matrix_pins',
            ['keyboard', 'pins'],
        )
    }

    const layout: QmkLayoutKey[] = kb.keys.map((k) => ({
        matrix: k.matrix ?? [0, 0],
        x: k.x,
        y: k.y,
        ...(k.w !== 1 ? { w: k.w } : {}),
        ...(k.h !== 1 ? { h: k.h } : {}),
    }))

    const json: Record<string, unknown> = {
        keyboard_name: meta.name,
        ...(meta.author ? { maintainer: meta.author } : {}),
        usb,
        ...identity(ctrl),
        ...(matrixPins ? { matrix_pins: matrixPins } : {}),
        ...(diode ? { diode_direction: diode } : {}),
        features: resolveQmkFeatures(config),
        layouts: { LAYOUT: { layout } },
    }

    return { json, diagnostics }
}
