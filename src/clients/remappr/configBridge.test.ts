// pattern-check: skip vitest cases over the config <-> runtime bridge
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../../config'
import { buildRemapprBlob } from '../../config/compilers/remappr'
import {
    BehaviorType,
    SystemAction,
    TableId,
} from '../../config/compilers/remappr/blobWriter'
import { decodeRemapprBlob } from '../../config/compilers/remappr/decode'
import {
    assembleBlob,
    behaviorBytes,
    keymapCore,
    tableOf,
} from '../../config/__tests__/blobFixtures'
import {
    buildRemapprKeyAction,
    REMAPPR_KIND_BATTERY_SHOW,
    REMAPPR_KIND_KEPT,
    REMAPPR_KIND_TRANSPARENT,
} from './actions'
import { lowerConfigToNeutral, raiseNeutralToConfig } from './configBridge'

const transparentKey = () => buildRemapprKeyAction(REMAPPR_KIND_TRANSPARENT, [])

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

// A binding the canonical form cannot hold carries its device record (`_wire`).
// Shown as Transparent, picking Transparent (the editor's clear) would look
// untouched and the merge would keep the device's clear_storage key.
describe('config bridge: bindings kept as read from the device', () => {
    const clear = behaviorBytes({ type: BehaviorType.System, tap: SystemAction.clear_storage })
    const device = assembleBlob(keymapCore([behaviorBytes({ type: BehaviorType.Key, tap: 0x04 }), clear]))
    const config = decodeRemapprBlob(device).config!
    const behaviors = (c: typeof config): number[] =>
        tableOf(buildRemapprBlob(c, { configVersion: 2 }).blob, TableId.Behavior)!.payload

    it('shows the cell as kept, not as Transparent', () => {
        const key = lowerConfigToNeutral(config).layers[0].keys[1]
        expect(key.kind).toBe(REMAPPR_KIND_KEPT)
        expect(key.label.primary).toBe('Kept')
    })

    it('keeps the record when the cell is left alone', () => {
        const { layers } = lowerConfigToNeutral(config)
        const raised = raiseNeutralToConfig(layers, config)
        expect(behaviors(raised)).toEqual(tableOf(device, TableId.Behavior)!.payload)
    })

    it('clears the record when the cell is set to Transparent', () => {
        const { layers } = lowerConfigToNeutral(config)
        const edited = [{ ...layers[0], keys: [layers[0].keys[0], transparentKey()] }]
        const raised = raiseNeutralToConfig(edited, config)
        expect(raised.layers[0].bindings[1]).toEqual({ type: 'transparent' })
        const b = behaviors(raised)
        const types = Array.from({ length: b[0] }, (_, i) => b[2 + 16 * i])
        expect(types).not.toContain(BehaviorType.System)
    })
})
