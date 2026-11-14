// Pattern check: Dispatch Map (Tier 0) — applied — the per-SoC label parser is
// picked from a map keyed by SoC family; PinBook is a small collector class.
//
// One pin resolver for every pin the board generator writes: matrix rows and
// columns, encoder phases, sensor pins, the WS2812 data pin. Before this each
// emitter had its own copy and they disagreed: encoder pins skipped the ST
// form, and nRF `P0.13` labels resolved only for the WS2812 pin.
//
// The board comes from `board.controller` (a Zephyr board id, or a custom board
// with its SoC), else `keyboard.controller.board`. Its SoC family decides which
// port-pin label form is valid, so `PA3` on an nRF board is an error rather
// than a pin on a port that does not exist.
import { resolveController } from '../../controller'
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'
import {
    resolveNrfPin,
    resolveRpPin,
    resolveStPin,
    resolveZmkPin,
} from '../../pinmaps'
import type { ConfigKeymap } from '../../types'

export type Soc = 'nrf' | 'stm32' | 'rp2040' | 'unknown'

/** The board a shield is generated for. */
export interface BoardTarget {
    /** Zephyr board id (a custom board's name), when known. */
    board?: string
    soc: Soc
}

/** SoC families by the names their boards and parts carry. Order matters:
 *  `sparkfun_pro_micro_rp2040` is an RP2040 board, not an nRF one. */
const SOC_NAMES: [Soc, RegExp][] = [
    ['rp2040', /rp2040|rp2350|pico/],
    ['nrf', /nrf|nice_nano|xiao_ble|bluemicro|puchi_ble/],
    ['stm32', /stm32|nucleo|disco|blackpill|bluepill|weact/],
]

export function socOf(name: string | undefined): Soc {
    const n = (name ?? '').toLowerCase()
    return SOC_NAMES.find(([, re]) => re.test(n))?.[0] ?? 'unknown'
}

/** The board and SoC from `board.controller`, else `keyboard.controller`. */
export function boardTarget(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): BoardTarget {
    const fromKeyboard = resolveController(config).board
    const c = config.board?.controller
    if (c === undefined || c === '')
        return { board: fromKeyboard, soc: socOf(fromKeyboard) }
    if (typeof c !== 'string') return { board: c.name, soc: socOf(c.soc) }
    if (fromKeyboard && fromKeyboard !== c)
        diag.warn(
            `board.controller "${c}" and keyboard.controller "${fromKeyboard}" ` +
                `differ; the shield is generated for "${c}"`,
            ['board', 'controller'],
        )
    return { board: c, soc: socOf(c) }
}

/** Port-pin label forms per SoC. An unknown SoC accepts the ST and nRF forms,
 *  which cannot be mistaken for each other. */
const LABEL_FORMS: Record<Soc, (label: string) => string | null> = {
    nrf: resolveNrfPin,
    stm32: resolveStPin,
    rp2040: resolveRpPin,
    unknown: (l) => resolveStPin(l) ?? resolveNrfPin(l),
}

const FORM_HINT: Record<Soc, string> = {
    nrf: 'an nRF port pin like "P0.13"',
    stm32: 'an ST port pin like "PA3"',
    rp2040: 'an RP2040 pin like "GP12"',
    unknown: 'a port pin ("PA3", "P0.13")',
}

/** A label's phandle+pin core: a known board's pin table, then the SoC's
 *  port-pin form. Null when neither knows it. */
export function resolvePinCore(
    label: string,
    target: BoardTarget,
): string | null {
    return (
        resolveZmkPin(target.board, label) ?? LABEL_FORMS[target.soc](label)
    )
}

/** Resolves every pin of one shield, and reports the ones that do not resolve
 *  as errors: a label written verbatim into devicetree never builds. */
export class PinBook {
    constructor(
        readonly target: BoardTarget,
        private readonly diag: DiagnosticBag,
    ) {}

    /** The text inside `<...>` for one pin: a raw `&`-spec verbatim, or the
     *  resolved core with `flags`. An unresolved label is an error and comes
     *  back as written. */
    spec(raw: string, flags: string, path: DiagnosticPath): string {
        const s = raw.trim()
        if (s.startsWith('&')) return s
        const core = resolvePinCore(s, this.target)
        if (core) return `${core} ${flags}`
        this.diag.error(
            `GPIO "${raw}" does not resolve on ${this.describe()}: give ` +
                `${FORM_HINT[this.target.soc]}, a label of a known board, or a ` +
                `raw "&gpioN pin FLAGS" spec`,
            path,
        )
        return s
    }

    private describe(): string {
        const soc = this.target.soc === 'unknown' ? '' : ` (${this.target.soc})`
        return this.target.board
            ? `board "${this.target.board}"${soc}`
            : `this board${soc}; set board.controller`
    }
}
