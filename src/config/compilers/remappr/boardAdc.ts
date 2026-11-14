// Pattern check: no GoF pattern (-) — rejected — a small collector of ADC
// channels (like PinBook for pins) that writes one block per ADC.
//
// ADC channels for the board generator. A battery divider and an analog slider
// each read one channel; the channel's own node (gain, reference, the analog
// input) goes on the ADC as `channel@N`, the way Zephyr's ADC bindings want it.
// A channel the JSON gives no `setup` for is one the board already configures,
// and the shield only refers to it.
import type { DiagnosticBag, DiagnosticPath } from '../../diagnostics'
import type { BoardAdcChannel, DtToken } from '../../types'
import type { Soc } from './boardPins'
import { dtLabel } from './dtText'

const cellOf = (t: DtToken): string => String(t)

/** The ADC channels of one shield: a ledger against a channel read twice,
 *  and the `channel@N` nodes to write. */
export class AdcBook {
    private readonly used = new Map<string, DiagnosticPath>()
    private readonly nodes = new Map<string, string[][]>()
    private nrfInputs = false

    constructor(
        private readonly soc: Soc,
        private readonly diag: DiagnosticBag,
    ) {}

    /** The `io-channels` cells for one channel (`&adc 4`), its channel node
     *  recorded when it has a setup. */
    use(ch: BoardAdcChannel, path: DiagnosticPath): string {
        const adc = dtLabel(ch.adc, this.diag, [...path, 'adc'])
        const key = `${adc}/${ch.channel}`
        const prior = this.used.get(key)
        if (prior)
            this.diag.error(
                `ADC channel ${ch.channel} on ${adc} is read twice`,
                path,
            )
        this.used.set(key, path)
        if (ch.setup) this.addNode(adc, ch, path)
        return `&${adc} ${ch.channel}`
    }

    private addNode(
        adc: string,
        ch: BoardAdcChannel,
        path: DiagnosticPath,
    ): void {
        const s = ch.setup!
        if (this.soc === 'nrf' && s.inputPositive === undefined)
            this.diag.error(
                `an nRF SAADC channel needs setup.inputPositive (e.g. ` +
                    `"NRF_SAADC_AIN4")`,
                [...path, 'setup', 'inputPositive'],
            )
        if (typeof s.inputPositive === 'string' && s.inputPositive.startsWith('NRF_SAADC_'))
            this.nrfInputs = true
        const n = ch.channel
        const node = [
            `\tchannel@${n} {`,
            `\t\treg = <${n}>;`,
            `\t\tzephyr,gain = "${s.gain}";`,
            `\t\tzephyr,reference = "${s.reference}";`,
            `\t\tzephyr,acquisition-time = <${cellOf(s.acquisitionTime ?? 'ADC_ACQ_TIME_DEFAULT')}>;`,
            ...(s.inputPositive !== undefined
                ? [`\t\tzephyr,input-positive = <${cellOf(s.inputPositive)}>;`]
                : []),
            `\t\tzephyr,resolution = <${s.resolution}>;`,
            ...(s.oversampling !== undefined
                ? [`\t\tzephyr,oversampling = <${s.oversampling}>;`]
                : []),
            `\t};`,
        ]
        const list = this.nodes.get(adc) ?? []
        list.push(node)
        this.nodes.set(adc, list)
    }

    /** Headers the channel nodes need. */
    includes(): string[] {
        if (this.nodes.size === 0) return []
        return [
            `#include <zephyr/dt-bindings/adc/adc.h>`,
            ...(this.nrfInputs ? [`#include <zephyr/dt-bindings/adc/nrf-saadc.h>`] : []),
        ]
    }

    /** One `&adc { channel@N ... }` block per ADC with a channel setup. */
    blocks(): string[] {
        return [...this.nodes].flatMap(([adc, channels]) => [
            ``,
            `&${adc} {`,
            `\tstatus = "okay";`,
            `\t#address-cells = <1>;`,
            `\t#size-cells = <0>;`,
            ...channels.flatMap((c) => [``, ...c]),
            `};`,
        ])
    }
}
