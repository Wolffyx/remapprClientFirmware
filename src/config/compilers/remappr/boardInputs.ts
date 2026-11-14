// Pattern check: no GoF pattern (-) — rejected — pure key-split function and DT-fragment emitters, single caller.
//
// Inputs that are not matrix keys, for the board generator:
//   • board.buttons → a gpio-keys child per button (its pin and input code) and
//                     a remappr,extra-input node that gives the code an engine
//                     position and the key's rect in the drawn layout.
//   • board.sliders → remappr,slider on an ADC channel.
//
// The firmware puts extra-input positions after the keymap's, in node order,
// and the config's positions are the keyboard.keys indices. So the button
// keys must be the last keys, in board.buttons order: then key i is engine
// position i for every key, and the matrix nodes take only the keys before
// them.
import type { DiagnosticBag } from '../../diagnostics'
import { ROLE_FLAGS } from '../../pinmaps'
import type { CanonGeometry, ConfigKeymap } from '../../types'
import type { AdcBook } from './boardAdc'
import type { PeripheralFragment } from './boardHardware'
import type { PinBook } from './boardPins'
import type { Origin } from './boardPlacement'

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

/** Default codes: F13..F24, which type a key of their own until the config
 *  binds the button. */
const DEFAULT_CODES = Array.from({ length: 12 }, (_, i) => `INPUT_KEY_F${13 + i}`)

/** How many keys are matrix keys: those before the first button. The button
 *  keys must follow them, in board.buttons order, with nothing after. */
export function matrixKeyCount(config: ConfigKeymap, diag: DiagnosticBag): number {
    const n = config.keyboard.keys.length
    const buttons = config.board?.buttons ?? []
    if (buttons.length === 0) return n
    const m = n - buttons.length
    buttons.forEach((b, i) => {
        if (b.key === m + i) return
        diag.error(
            `button ${i} is key ${b.key}; buttons must be the last keys, in ` +
                `board.buttons order (key ${m + i} here), since their engine ` +
                `positions follow the matrix keys'`,
            ['board', 'buttons', i, 'key'],
        )
    })
    config.keyboard.keys.slice(Math.max(0, m)).forEach((k, i) => {
        if (k.matrix)
            diag.error(
                `key ${m + i} is a button and has a matrix cell`,
                ['keyboard', 'keys', m + i, 'matrix'],
            )
    })
    return Math.max(0, m)
}

/** A key's rect and rotation in 1/100 key-unit and 1/100 degree, shifted
 *  like the placement. The firmware rotates an extra input about its rect's
 *  centre, so another pivot is warned about. */
function rectOf(
    k: CanonGeometry,
    origin: Origin,
    diag: DiagnosticBag,
    path: (string | number)[],
): string[] {
    const c = (v: number): number => Math.round(v * 100)
    const rect = `\t\trect = <${c(k.x + origin.dx)} ${c(k.y + origin.dy)} ${c(k.w)} ${c(k.h)}>;`
    if (!k.r) return [rect]
    const cx = k.x + k.w / 2
    const cy = k.y + k.h / 2
    if ((k.rx !== undefined && k.rx !== cx) || (k.ry !== undefined && k.ry !== cy))
        diag.warn(
            `this button turns about its centre: the firmware has no other pivot ` +
                `for an off-matrix key`,
            path,
        )
    const rot = Math.round(k.r * 100)
    return [rect, `\t\trot = <${rot < 0 ? `(${rot})` : rot}>;`]
}

/** gpio-keys + remappr,extra-input from board.buttons. */
export function emitButtons(
    config: ConfigKeymap,
    origin: Origin,
    book: PinBook,
    diag: DiagnosticBag,
): PeripheralFragment {
    const buttons = config.board?.buttons
    if (!buttons || buttons.length === 0) return EMPTY
    const codes = new Map<string, number>()
    let nextDefault = 0
    const keys: string[] = []
    const extra: string[] = []
    buttons.forEach((b, i) => {
        const path = ['board', 'buttons', i]
        const code = b.code ?? DEFAULT_CODES[nextDefault++]
        if (!code) {
            diag.error(`more than 12 buttons: give each one a code`, [...path, 'code'])
            return
        }
        const prior = codes.get(code)
        if (prior !== undefined)
            diag.error(`buttons ${prior} and ${i} both report ${code}`, [...path, 'code'])
        codes.set(code, i)
        const pin = book.spec(b.pin, ROLE_FLAGS.direct, [...path, 'pin'])
        keys.push(
            `\t\tbutton_${i} {`,
            `\t\t\tgpios = <${pin}>;`,
            `\t\t\tzephyr,code = <${code}>;`,
            `\t\t};`,
        )
        const k = config.keyboard.keys[b.key]
        extra.push(
            `\tbutton_${i}_key {`,
            `\t\tcompatible = "remappr,extra-input";`,
            `\t\tinput-code = <${code}>;`,
            ...(k ? rectOf(k, origin, diag, ['keyboard', 'keys', b.key]) : []),
            `\t};`,
        )
    })
    return {
        includes: [],
        nodes: [
            `/ {`,
            `\tremappr_buttons {`,
            `\t\tcompatible = "gpio-keys";`,
            ...keys,
            `\t};`,
            ``,
            `\t/* One engine position per button, after the matrix keys'. */`,
            ...extra,
            `};`,
        ],
        kconfig: [],
    }
}

/** remappr,slider nodes from board.sliders. */
export function emitSliders(config: ConfigKeymap, adc: AdcBook): PeripheralFragment {
    const sliders = config.board?.sliders
    if (!sliders || sliders.length === 0) return EMPTY
    const nodes: string[] = [`/ {`]
    sliders.forEach((s, i) => {
        const path = ['board', 'sliders', i]
        nodes.push(
            `\tslider_${i}: slider_${i} {`,
            `\t\tcompatible = "remappr,slider";`,
            `\t\tio-channels = <${adc.use(s.adc, [...path, 'adc'])}>;`,
            ...(s.function ? [`\t\tfunction = "${s.function}";`] : []),
            ...(s.deadband !== undefined ? [`\t\tdeadband = <${s.deadband}>;`] : []),
            ...(s.pollMs !== undefined ? [`\t\tpoll-ms = <${s.pollMs}>;`] : []),
            `\t};`,
        )
    })
    nodes.push(`};`)
    return { includes: [], nodes, kconfig: [] }
}
