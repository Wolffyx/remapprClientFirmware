// pattern-check: skip vitest cases over the config <-> runtime bridge
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../../config'
import { REMAPPR_KIND_BATTERY_SHOW } from './actions'
import { lowerConfigToNeutral, raiseNeutralToConfig } from './configBridge'

const KEYMAP = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "B", "target": "zmk" },
    "keyboard": { "id": "b", "name": "B", "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [{ "name": "base", "bindings": ["A", { "type": "battery_show" }] }]
}`)

describe('config bridge: show battery', () => {
    it('lowers battery_show to its own kind with the battery legend', () => {
        const { layers, diagnostics } = lowerConfigToNeutral(KEYMAP)
        expect(diagnostics).toHaveLength(0)
        const key = layers[0].keys[1]
        expect(key.kind).toBe(REMAPPR_KIND_BATTERY_SHOW)
        expect(key.label.primary).toBe('Show Battery')
        expect(key.label.paramParts).toEqual([{ icon: 'battery', text: 'Batt' }])
    })

    it('raises a picked Show Battery back to battery_show', () => {
        const { layers } = lowerConfigToNeutral(KEYMAP)
        const edited = [{ ...layers[0], keys: [layers[0].keys[1], layers[0].keys[1]] }]
        const raised = raiseNeutralToConfig(edited, KEYMAP)
        expect(raised.layers[0].bindings[0]).toEqual({ type: 'battery_show' })
    })
})
