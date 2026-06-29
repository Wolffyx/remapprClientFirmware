// pattern-check: skip — test wiring: constructs a writable RemapprKeyboardService
// over a real macro-bearing config fixture (stub RPC, no sealed writes) to exercise
// the §24 named-macro key-assignment path (listNames → tile → buildKeyAction →
// setKey → relabel). No GoF abstraction.
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../config'

import { REMAPPR_KIND_MACRO } from './actions'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService, type RemapprServiceDeps } from './service'

// A 3-key config: position 0 is already bound to the macro `macro_hi`; the pool
// also holds `macro_copy` so index-vs-name resolution is non-trivial.
const CONFIG = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "MacroTest", "target": "zmk" },
    "keyboard": { "id": "mt", "name": "MacroTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [
        { "name": "base", "bindings": [
            { "type": "macro", "ref": "macro_hi" }, "A", { "type": "transparent" }
        ] }
    ],
    "macros": [
        { "id": "macro_hi", "params": 0, "steps": [
            { "type": "tap", "key": "H" }, { "type": "tap", "key": "I" } ] },
        { "id": "macro_copy", "params": 0, "steps": [
            { "type": "press", "key": "LCTRL" }, { "type": "tap", "key": "C" },
            { "type": "release", "key": "LCTRL" } ] }
    ]
}`)

// The naming path never touches the wire (setKey/getKeymap/buildKeyAction are all
// in-memory), so the RPC only needs its lifecycle hooks present.
const stubRpc = {
    onClosed: () => () => undefined,
    subscribeInput: () => () => undefined,
    close: async () => undefined,
} as unknown as RemapprRpc

function makeService(): RemapprKeyboardService {
    const deps: RemapprServiceDeps = {
        rpc: stubRpc,
        deviceInfo: { name: 'MacroTest', firmware: 'remappr' },
        config: CONFIG,
        configVersion: 1,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly: false,
    }
    return new RemapprKeyboardService(deps)
}

describe('Remappr named-macro key assignment (§24)', () => {
    it('exposes the real macro names via macros.listNames()', () => {
        const svc = makeService()
        expect(svc.macros?.listNames?.()).toEqual(['macro_hi', 'macro_copy'])
    })

    it('buildKeyAction resolves a macro index to its keycap name', () => {
        const svc = makeService()
        const action = svc.buildKeyAction(REMAPPR_KIND_MACRO, [1])
        expect(action.kind).toBe(REMAPPR_KIND_MACRO)
        expect(action.params).toEqual([1])
        expect(action.label.primary).toBe('Macro')
        expect(action.label.secondary).toBe('macro_copy')
    })

    it('lowers an existing macro binding to its name (config → keycap)', async () => {
        const svc = makeService()
        const keymap = await svc.getKeymap()
        const k0 = keymap.layers[0].keys[0]
        expect(k0.kind).toBe(REMAPPR_KIND_MACRO)
        expect(k0.label.secondary).toBe('macro_hi')
    })

    it('persists the macro name across setKey → getKeymap relabel', async () => {
        const svc = makeService()
        const before = await svc.getKeymap()
        const layerId = before.layers[0].id
        // Rebind position 1 (was "A") to macro index 0 via a behaviorRef tile.
        await svc.setKey(
            layerId,
            1,
            svc.buildKeyAction(REMAPPR_KIND_MACRO, [0]),
        )
        const after = await svc.getKeymap()
        const bound = after.layers[0].keys[1]
        expect(bound.kind).toBe(REMAPPR_KIND_MACRO)
        expect(bound.params).toEqual([0])
        expect(bound.label.secondary).toBe('macro_hi')
    })
})
