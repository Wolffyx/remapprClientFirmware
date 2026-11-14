// Pattern check: no GoF pattern (-) — rejected — pure DT-fragment emitters for haptic, LED zones and display parts.
//
// Outputs beyond the LED strip, for the board generator:
//   • board.haptic   → remappr,haptic on a PWM channel (the period is a fact of
//                      the actuator, so the JSON gives it)
//   • board.ledZones → remappr,led-zone slices of the WS2812 strip, checked
//                      against its chain-length and each other
//   • board.displays → remappr,display parts, on a panel the board has or on
//                      one the shield declares on its bus from the JSON
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'
import type { BoardPanel, ConfigKeymap } from '../../types'
import { type PeripheralFragment, settingDefaults } from './boardHardware'
import { dtCompatible, dtLabel, dtPhandleOk, dtString } from './dtText'

const EMPTY: PeripheralFragment = { includes: [], nodes: [], kconfig: [] }

/** remappr,haptic from board.haptic. The haptic service runs over the node
 *  bus (a trigger is a flooded verb), so without a port it is not turned on. */
export function emitHaptic(config: ConfigKeymap, diag: DiagnosticBag): PeripheralFragment {
    const h = config.board?.haptic
    if (!h) return EMPTY
    const path = ['board', 'haptic']
    const pwm = dtLabel(h.pwm, diag, [...path, 'pwm'])
    const pinctrl = h.pinctrl ?? []
    pinctrl.forEach((p, i) => {
        if (!dtPhandleOk(p))
            diag.error(`pinctrl entry "${p}" is not a phandle like "&pwm0_default"`, [...path, 'pinctrl', i])
    })
    const bus = (config.board?.nodeBus ?? []).length > 0
    if (!bus)
        diag.warn(
            `the haptic service takes its triggers over the node bus, and the board ` +
                `has no node-bus port: the actuator is declared but nothing drives it`,
            path,
        )
    const polarity = h.inverted ? 'PWM_POLARITY_INVERTED' : 'PWM_POLARITY_NORMAL'
    return {
        includes: [`#include <zephyr/dt-bindings/pwm/pwm.h>`],
        nodes: [
            ...(pinctrl.length
                ? [
                      `&${pwm} {`,
                      `\tpinctrl-0 = <${pinctrl.map((p) => p.trim()).join(' ')}>;`,
                      `\tpinctrl-names = "default";`,
                      `\tstatus = "okay";`,
                      `};`,
                      ``,
                  ]
                : []),
            `/ {`,
            `\tremappr_haptic: haptic {`,
            `\t\tcompatible = "remappr,haptic";`,
            `\t\tpwms = <&${pwm} ${h.channel} ${h.periodNs} ${polarity}>;`,
            `\t};`,
            `};`,
        ],
        kconfig: bus ? [``, `# The haptic actuator (remappr,haptic).`, `config REMAPPR_HAPTIC_SVC`, `\tdefault y`] : [],
    }
}

/** remappr,led-zone from board.ledZones: slices of the WS2812 strip. */
export function emitLedZones(config: ConfigKeymap, diag: DiagnosticBag): PeripheralFragment {
    const zones = config.board?.ledZones
    if (!zones || zones.length === 0) return EMPTY
    const path = ['board', 'ledZones']
    const chain = config.keyboard.hardware?.ws2812?.chainLength
    if (chain === undefined)
        diag.error(`LED zones slice the WS2812 strip, and the board has none`, path)
    const seen = new Map<string, number>()
    const sorted = zones.map((z, i) => ({ ...z, i })).sort((a, b) => a.offset - b.offset)
    sorted.forEach((z, k) => {
        const end = z.offset + z.length
        if (chain !== undefined && end > chain)
            diag.error(`zone ${z.i} ends at LED ${end}, past the ${chain}-LED chain`, [...path, z.i])
        const next = sorted[k + 1]
        if (next && next.offset < end)
            diag.error(`zones ${z.i} and ${next.i} overlap`, [...path, next.i])
        const prior = seen.get(z.target)
        if (prior !== undefined)
            diag.error(`zones ${prior} and ${z.i} both serve ${z.target}`, [...path, z.i, 'target'])
        seen.set(z.target, z.i)
    })
    const nodes = zones.flatMap((z, i) => [
        `\t${z.target.replace('-', '_')}_zone: zone_${i} {`,
        `\t\tcompatible = "remappr,led-zone";`,
        `\t\ttarget = "${z.target}";`,
        `\t\toffset = <${z.offset}>;`,
        `\t\tlength = <${z.length}>;`,
        `\t};`,
    ])
    return { includes: [], nodes: [`/ {`, ...nodes, `};`], kconfig: [] }
}

/** One panel property, by its JSON value's type. */
function propLine(
    name: string,
    v: number | number[] | boolean | string,
    diag: DiagnosticBag,
    path: DiagnosticPath,
): string[] {
    if (v === false) return []
    if (v === true) return [`\t\t${name};`]
    if (typeof v === 'number') return [`\t\t${name} = <${v}>;`]
    if (Array.isArray(v)) return [`\t\t${name} = <${v.join(' ')}>;`]
    return [`\t\t${name} = "${dtString(v, diag, path)}";`]
}

/** A panel node on its bus, from the JSON. */
function panelBlock(
    p: BoardPanel,
    label: string,
    diag: DiagnosticBag,
    path: DiagnosticPath,
): string[] {
    const part = dtCompatible(p.part, diag, [...path, 'part'])
    const bus = dtLabel(p.bus, diag, [...path, 'bus'])
    const unit = part.split(',').pop() || 'panel'
    const props = Object.entries(p.props ?? {}).flatMap(([k, v]) =>
        propLine(k, v, diag, [...path, 'props', k]),
    )
    return [
        `&${bus} {`,
        `\tstatus = "okay";`,
        ...(p.busHz ? [`\tclock-frequency = <${p.busHz}>;`] : []),
        ``,
        `\t${label}: ${unit}@${p.reg.toString(16)} {`,
        `\t\tcompatible = "${part}";`,
        `\t\treg = <0x${p.reg.toString(16)}>;`,
        `\t\twidth = <${p.width}>;`,
        `\t\theight = <${p.height}>;`,
        ...props,
        `\t};`,
        `};`,
        ``,
    ]
}

/** remappr,display parts from board.displays. */
export function emitDisplays(config: ConfigKeymap, diag: DiagnosticBag): PeripheralFragment {
    const displays = config.board?.displays
    if (!displays || displays.length === 0) return EMPTY
    const panels: string[] = []
    const parts: string[] = []
    displays.forEach((d, i) => {
        const path = ['board', 'displays', i]
        let label: string
        if (typeof d.panel === 'string') label = dtLabel(d.panel, diag, [...path, 'panel'])
        else {
            label = `display_panel_${i}`
            panels.push(...panelBlock(d.panel, label, diag, [...path, 'panel']))
        }
        const defaults = settingDefaults(d.defaults ?? {}, diag, [...path, 'defaults'])
        parts.push(
            `\tdisplay_${i}: display_${i} {`,
            `\t\tcompatible = "remappr,display";`,
            `\t\tdisplay = <&${label}>;`,
            ...(defaults.length ? [`\t\tremappr,setting-defaults = <`, ...defaults, `\t\t>;`] : []),
            `\t};`,
        )
    })
    return {
        includes: [`#include <dt-bindings/remappr/sensor.h>`],
        nodes: [...panels, `/ {`, ...parts, `};`],
        kconfig: [
            ``,
            `# ${displays.length} display part(s) from board.displays.`,
            `config DISPLAY`,
            `\tdefault y`,
            `config REMAPPR_DISPLAY_PART`,
            `\tdefault y`,
        ],
    }
}
