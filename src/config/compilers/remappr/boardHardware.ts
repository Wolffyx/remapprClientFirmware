// Pattern check: no GoF pattern (-) — rejected — pure DT-fragment emitters
// (ws2812 strip + gpio-qdec) for the remappr board generator; string templating
// over config, no abstraction.
//
// Optional peripheral overlay nodes for the remappr-board shield, split out of
// board.ts to keep the matrix generator focused. Both are firmware-native and
// gated on explicit hardware config (absent → empty fragment):
//   • RGB  — a WS2812 SPI led-strip + `chosen remappr,led-strip` (the render
//            target the runtime paints per-key colors onto). Reuses the generic
//            ws2812 SPI emitter; only the `chosen` hookup is remappr-specific.
//   • encoders — stock `gpio-qdec` rotation nodes from board.encoders. Rotation →
//            behavior-engine binding is firmware-side + HIL-deferred, so this
//            declares the hardware only (warned).
import type { DiagnosticBag } from '../../diagnostics'
import { gpioSpec, resolveZmkPin } from '../../pinmaps'
import type { ConfigKeymap } from '../../types'
import { emitWs2812 } from '../zmk/hardware'

/** A peripheral's contribution to the shield: header `#include`s, top-level DT
 *  blocks (appended after the main `/ {}`), and Kconfig.defconfig lines. */
export interface PeripheralFragment {
    includes: string[]
    nodes: string[]
    kconfig: string[]
}

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

/** Resolve an encoder phase/GPIO to a devicetree spec: a raw `&`-spec passes
 *  through verbatim; a friendly label resolves on a known controller board with
 *  the `direct` role (PULL_UP | ACTIVE_LOW — what a quadrature encoder wants),
 *  else emits unchanged with a diagnostic. */
function resolveEncoderPin(
    raw: string,
    board: string | undefined,
    diag: DiagnosticBag,
    path: (string | number)[],
): string {
    const s = raw.trim()
    if (s.startsWith('&')) return s
    const core = board ? resolveZmkPin(board, s) : null
    if (core) return gpioSpec(core, 'direct')
    diag.warn(
        `unresolved encoder GPIO "${raw}" — emitting verbatim; set ` +
            `board.controller to a known board or give a raw "&gpioN pin FLAGS" spec`,
        path,
    )
    return s
}

/** WS2812 per-key RGB from `keyboard.hardware.ws2812` (chain-length = LED count).
 *  Emits the SPI led_strip block + a `chosen remappr,led-strip` the runtime RGB
 *  service renders the per-key map / effects onto. No ws2812 → empty fragment. */
export function emitRgb(
    config: ConfigKeymap,
    board: string | undefined,
    diag: DiagnosticBag,
): PeripheralFragment {
    const ws = config.keyboard.hardware?.ws2812
    if (!ws) return EMPTY
    const { pinctrl, block } = emitWs2812(ws, diag, board)
    const nodes = [
        `&pinctrl {`,
        ...pinctrl,
        `};`,
        ``,
        ...block,
        ``,
        `/ {`,
        `\tchosen {`,
        `\t\t/* Runtime RGB service renders the per-key map / effects here. */`,
        `\t\tremappr,led-strip = <&led_strip>;`,
        `\t};`,
        `};`,
    ]
    return {
        includes: [`#include <zephyr/dt-bindings/led/led.h>`],
        nodes,
        kconfig: [
            ``,
            `# WS2812 per-key RGB (chain-length ${ws.chainLength}) — the strip renders`,
            `# the runtime per-key colour map. Verify the SPI instance + data pin.`,
            `config REMAPPR_RGB_LED`,
            `\tdefault y`,
            `config SPI`,
            `\tdefault y`,
            `config WS2812_STRIP_SPI`,
            `\tdefault y`,
        ],
    }
}

/** Stock `gpio-qdec` rotary encoders from `board.encoders`. Each emits a qdec node
 *  (A/B phases, detent steps, relative axis). The qdec driver produces an
 *  INPUT_REL event; binding that rotation into the remappr behavior engine is
 *  firmware-side and HIL-deferred, so this declares the hardware only (warned).
 *  No encoders → empty fragment. */
export function emitEncoders(
    config: ConfigKeymap,
    board: string | undefined,
    diag: DiagnosticBag,
): PeripheralFragment {
    const encoders = config.board?.encoders
    if (!encoders || encoders.length === 0) return EMPTY
    diag.warn(
        `${encoders.length} encoder(s) emitted as gpio-qdec nodes — rotation → ` +
            `behavior-engine binding is not yet wired in production firmware ` +
            `(bench synth-key path only), so turns won't drive keymap actions yet`,
        ['board', 'encoders'],
    )
    const nodes: string[] = [`/ {`]
    encoders.forEach((enc, i) => {
        const a = resolveEncoderPin(enc.a, board, diag, [
            'board',
            'encoders',
            i,
            'a',
        ])
        const b = resolveEncoderPin(enc.b, board, diag, [
            'board',
            'encoders',
            i,
            'b',
        ])
        nodes.push(
            `\tqdec_${i}: qdec_${i} {`,
            `\t\tcompatible = "gpio-qdec";`,
            `\t\tgpios = <${a}>, <${b}>;`,
            `\t\tsteps-per-period = <${enc.steps ?? 4}>;`,
            `\t\tzephyr,axis = <${enc.axis ?? 'INPUT_REL_WHEEL'}>;`,
            `\t\tsample-time-us = <2000>;`,
            `\t\tidle-timeout-ms = <200>;`,
            `\t\tidle-poll-time-us = <5000>;`,
            `\t};`,
        )
    })
    nodes.push(`};`)
    return {
        includes: [],
        nodes,
        kconfig: [
            ``,
            `# ${encoders.length} rotary encoder(s) — stock gpio-qdec. Rotation →`,
            `# behavior-engine binding is HIL-deferred (see the overlay warning).`,
            `config INPUT_GPIO_QDEC`,
            `\tdefault y`,
        ],
    }
}
