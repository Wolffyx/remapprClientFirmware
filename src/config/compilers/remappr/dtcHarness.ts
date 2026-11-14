// pattern-check: skip — test-only helper: runs the C preprocessor and dtc on a
// generated shield overlay, the same two steps a Zephyr build runs on it.
//
// Test support only; nothing in the library imports it. The board generator's
// tests used to assert substrings, which is how several overlays that do not
// compile got through. This runs the real toolchain instead:
//
//   1. cpp with the Zephyr and firmware include paths, as the build does;
//   2. a stub base tree that defines every label the overlay references but
//      does not define itself (the board's gpio, spi, pinctrl and dma nodes);
//   3. dtc on the result.
//
// It needs `cpp`, `dtc`, a Zephyr tree and a remappr-firmware tree. Set
// ZEPHYR_BASE and REMAPPR_FIRMWARE, or keep them under
// ~/Projects/remappr-ws/{zephyr,remappr-firmware}. Without them `dtcToolchain()`
// returns null and the callers skip.
import { execFileSync, spawnSync } from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface DtcToolchain {
    zephyr: string
    firmware: string
}

export interface DtcResult {
    ok: boolean
    /** The preprocessor's or dtc's stderr (empty on success). */
    log: string
}

const onPath = (tool: string): boolean =>
    spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0

/** The Zephyr + firmware trees and tools, or null when any is missing. */
export function dtcToolchain(): DtcToolchain | null {
    const ws = join(homedir(), 'Projects', 'remappr-ws')
    const zephyr = process.env.ZEPHYR_BASE ?? join(ws, 'zephyr')
    const firmware = process.env.REMAPPR_FIRMWARE ?? join(ws, 'remappr-firmware')
    const headers = [
        join(zephyr, 'include/zephyr/dt-bindings/input/keymap.h'),
        join(firmware, 'include/dt-bindings/remappr/layout.h'),
        join(firmware, 'dts/remappr/keymap-tokens.dtsi'),
    ]
    if (!headers.every((h) => existsSync(h))) return null
    if (!onPath('cpp') || !onPath('dtc')) return null
    return { zephyr, firmware }
}

const INCLUDES = (tc: DtcToolchain): string[] => [
    `-I${join(tc.zephyr, 'include')}`,
    `-I${join(tc.zephyr, 'dts/common')}`,
    `-I${join(tc.firmware, 'include')}`,
    `-I${join(tc.firmware, 'dts')}`,
]

function preprocess(tc: DtcToolchain, file: string, dir: string): string {
    return execFileSync(
        'cpp',
        [
            '-nostdinc',
            '-undef',
            '-x',
            'assembler-with-cpp',
            '-D__DTS__',
            ...INCLUDES(tc),
            `-I${dir}`,
            file,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
}

/** Labels the preprocessed overlay references (`&name`) but never defines
 *  (`name:`): the board's own nodes, which the stub base tree stands in for. */
function missingLabels(pre: string): string[] {
    const body = pre.replace(/^#.*$/gm, '')
    const defined = new Set(
        [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_]/g)].map(
            (m) => m[1],
        ),
    )
    const used = new Set(
        [...body.matchAll(/&([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    )
    return [...used].filter((l) => !defined.has(l)).sort()
}

/** One stub node per missing label. Each can stand for a gpio, dma, adc or
 *  pwm controller, a uart, or a bus with children, which covers what a shield
 *  refers to on its board. */
function stubTree(labels: string[]): string {
    const nodes = labels.map(
        (l) =>
            `\t${l}: stub_${l} {\n` +
            `\t\tgpio-controller;\n\t\t#gpio-cells = <2>;\n` +
            `\t\t#dma-cells = <3>;\n` +
            `\t\t#io-channel-cells = <1>;\n` +
            `\t\t#pwm-cells = <3>;\n` +
            `\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t};`,
    )
    return ['/ {', ...nodes, '};'].join('\n')
}

/** Bindings for the stub board nodes: any properties, and a bus, so a child
 *  with `on-bus` (remappr,spi-link, a display panel) is checked against its
 *  own binding. A stub whose label names an I2C bus (`i2c0`, `arduino_i2c`)
 *  is an I2C bus, any other an SPI bus. */
const stubBinding = (bus: 'spi' | 'i2c'): string =>
    [
        'description: stub board node for the shield binding check',
        `compatible: "remappr-test,stub-${bus}"`,
        `bus: ${bus}`,
        'gpio-cells: [pin, flags]',
        'dma-cells: [channel, slot, config]',
        'io-channel-cells: [input]',
        'pwm-cells: [channel, period, flags]',
        '',
    ].join('\n')

/** Loads the preprocessed tree, gives every stub node (and any node the
 *  overlay re-typed, like `&spi3 { compatible = "nordic,nrf-spim"; }`) the
 *  stub binding, then builds an EDT over the Zephyr and firmware bindings.
 *  edtlib raises on a missing required property, a wrong type or a value
 *  outside an enum: the checks a Zephyr build makes on the shield. */
const EDT_SCRIPT = `
import sys
sys.path.insert(0, sys.argv[1])
from devicetree import dtlib, edtlib
src, out, *dirs = sys.argv[2:]
text = open(src).read()
stubs = [n.path for n in dtlib.DT(src).node_iter() if n.name.startswith("stub_")]
text += "".join(
    '\\n&{%s} { compatible = "remappr-test,stub-%s"; };'
    % (p, "i2c" if "i2c" in p else "spi") for p in stubs)
open(out, "w").write(text + "\\n")
try:
    edtlib.EDT(out, dirs, warn_reg_unit_address_mismatch=False)
except edtlib.EDTError as e:
    print(e, file=sys.stderr)
    sys.exit(1)
`

/** The edtlib binding check, when Python and Zephyr's devicetree package are
 *  there; null otherwise (the caller has the dtc result alone). */
function edtCheck(tc: DtcToolchain, dir: string, pre: string): DtcResult | null {
    const lib = join(tc.zephyr, 'scripts/dts/python-devicetree/src')
    if (!existsSync(join(lib, 'devicetree/edtlib.py')) || !onPath('python3'))
        return null
    const stubDir = join(dir, 'stub-bindings')
    mkdirSync(stubDir)
    for (const bus of ['spi', 'i2c'] as const)
        writeFileSync(join(stubDir, `remappr-test,stub-${bus}.yaml`), stubBinding(bus))
    const r = spawnSync(
        'python3',
        [
            '-c',
            EDT_SCRIPT,
            lib,
            pre,
            join(dir, 'edt.dts'),
            join(tc.zephyr, 'dts/bindings'),
            join(tc.firmware, 'dts/bindings'),
            stubDir,
        ],
        { encoding: 'utf8' },
    )
    if (r.status === 0) return { ok: true, log: '' }
    // edtlib's YAML loader is missing: no binding check here.
    if (/No module named/.test(r.stderr)) return null
    return { ok: false, log: r.stderr }
}

const HEADER = [
    '/dts-v1/;',
    '#include <zephyr/dt-bindings/gpio/gpio.h>',
    '#include <zephyr/dt-bindings/pinctrl/nrf-pinctrl.h>',
]

/** Preprocess and compile one overlay against a stub board. */
export function dtcCheck(tc: DtcToolchain, overlay: string): DtcResult {
    const dir = mkdtempSync(join(tmpdir(), 'remappr-dtc-'))
    try {
        writeFileSync(join(dir, 'shield.overlay'), overlay)
        writeFileSync(
            join(dir, 'probe.dts'),
            [...HEADER, '#include "shield.overlay"', ''].join('\n'),
        )
        const probe = preprocess(tc, join(dir, 'probe.dts'), dir)
        writeFileSync(
            join(dir, 'board.dts'),
            [
                ...HEADER,
                stubTree(missingLabels(probe)),
                '#include "shield.overlay"',
                '',
            ].join('\n'),
        )
        const pre = preprocess(tc, join(dir, 'board.dts'), dir)
        writeFileSync(join(dir, 'board.pre.dts'), pre)
        const dtc = spawnSync(
            'dtc',
            ['-q', '-I', 'dts', '-O', 'dtb', '-o', join(dir, 'out.dtb'), join(dir, 'board.pre.dts')],
            { encoding: 'utf8' },
        )
        if (dtc.status !== 0) return { ok: false, log: dtc.stderr }
        return edtCheck(tc, dir, join(dir, 'board.pre.dts')) ?? { ok: true, log: '' }
    } catch (e) {
        const err = e as { stderr?: string; message: string }
        return { ok: false, log: err.stderr || err.message }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}
