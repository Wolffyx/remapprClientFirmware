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
import {
    type DiagnosticBag,
    type DiagnosticPath,
    formatPath,
} from '../../diagnostics'
import {
    resolveNrfPin,
    resolveRpPin,
    resolveStPin,
    resolveZmkPin,
} from '../../pinmaps'
import type { ConfigKeymap } from '../../types'
import { dtCellsOk } from './dtText'

/** A raw spec: a phandle, then cells, with nothing that ends the cell list. */
const RAW_SPEC = /^&[A-Za-z_][A-Za-z0-9_]*(\s|$)/

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

/** The phandle + pin of a raw spec or resolved core, flags dropped, as one
 *  comparable key: "&gpioa 3 GPIO_ACTIVE_LOW" → "&gpioa 3". */
const identity = (spec: string): string =>
    spec.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase()

interface Claim {
    path: DiagnosticPath
    /** Set for a pin the board reserves, with what it is for. */
    reservedFor?: string
}

/** Resolves every pin of one shield and keeps a ledger of them. A label that
 *  does not resolve is an error (written verbatim into devicetree it never
 *  builds), and so is a pin used twice or one the board reserves for a bus it
 *  already owns (`board.reservedPins`). Pins on a board's nexus
 *  (`&pro_micro 4`) only compare with the same nexus. */
export class PinBook {
    private readonly claims = new Map<string, Claim>()

    constructor(
        readonly target: BoardTarget,
        private readonly diag: DiagnosticBag,
    ) {}

    /** Record the board's reserved pins; call before any `spec`. */
    reserve(pins: readonly { pin: string; use: string }[]): void {
        pins.forEach((r, i) => {
            const path = ['board', 'reservedPins', i, 'pin']
            const core = this.core(r.pin.trim(), path)
            if (core) this.claims.set(identity(core), { path, reservedFor: r.use })
        })
    }

    /** Record a pin the shield uses without writing it (the WS2812 data pin,
     *  which the SPI pinctrl carries). Unresolved labels are skipped. */
    claim(raw: string, path: DiagnosticPath): void {
        const s = raw.trim()
        const core = s.startsWith('&') ? s : resolvePinCore(s, this.target)
        if (core && dtCellsOk(core)) this.take(core, path)
    }

    /** The text inside `<...>` for one pin: a raw `&`-spec verbatim, or the
     *  resolved core with `flags`. An unresolved label is an error and comes
     *  back as written; a pin already taken is an error too. */
    spec(raw: string, flags: string, path: DiagnosticPath): string {
        const s = raw.trim()
        const core = this.core(s, path)
        if (!core) return s
        this.take(core, path)
        return s.startsWith('&') ? s : `${core} ${flags}`
    }

    private take(core: string, path: DiagnosticPath): void {
        const id = identity(core)
        const prior = this.claims.get(id)
        if (!prior) {
            this.claims.set(id, { path })
            return
        }
        const why = prior.reservedFor
            ? `is reserved for ${prior.reservedFor} (${formatPath(prior.path)})`
            : `is used twice: ${formatPath(prior.path)} and ${formatPath(path)}`
        this.diag.error(`pin ${id} ${why}`, path)
    }

    /** A raw `&`-spec as is, a label's resolved core, or null (an error). */
    private core(s: string, path: DiagnosticPath): string | null {
        if (s.startsWith('&')) return this.raw(s, path)
        const core = resolvePinCore(s, this.target)
        if (core) return core
        this.diag.error(
            `GPIO "${s}" does not resolve on ${this.describe()}: give ` +
                `${FORM_HINT[this.target.soc]}, a label of a known board, or a ` +
                `raw "&gpioN pin FLAGS" spec`,
            path,
        )
        return null
    }

    private raw(s: string, path: DiagnosticPath): string | null {
        if (RAW_SPEC.test(s) && dtCellsOk(s)) return s
        this.diag.error(
            `GPIO spec "${s}" is not a devicetree phandle and cells ` +
                `("&gpioN pin FLAGS")`,
            path,
        )
        return null
    }

    private describe(): string {
        const soc = this.target.soc === 'unknown' ? '' : ` (${this.target.soc})`
        return this.target.board
            ? `board "${this.target.board}"${soc}`
            : `this board${soc}; set board.controller`
    }
}
