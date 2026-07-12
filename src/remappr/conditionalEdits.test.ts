// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// config with conditional (tri-)layers, exercising the concrete-service
// setConditionalLayers/getConditionalLayers whole-list overlay (staged edits
// fold into commit/export, an empty list clears, discard reverts).
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../config'

import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService, type RemapprServiceDeps } from './service'

// Four named layers so tri-layers reference real names; one seed conditional —
// the classic raise + lower → adjust.
const CONFIG = parseKeymap(`{
    "version": 2, "kind": "remappr.keymap",
    "meta": { "name": "CondTest" },
    "keyboard": { "id": "ct", "name": "CondTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [
        { "name": "base",   "keys": ["A", "B"] },
        { "name": "raise",  "keys": ["A", "B"] },
        { "name": "lower",  "keys": ["A", "B"] },
        { "name": "adjust", "keys": ["A", "B"] }
    ],
    "conditionalLayers": [
        { "ifLayers": ["raise", "lower"], "thenLayer": "adjust" }
    ]
}`)

const stubRpc = {
    onClosed: () => () => undefined,
    subscribeInput: () => () => undefined,
    close: async () => undefined,
    // discardChanges fires a ROLLBACK_CONFIG (plaintext, no session) and ignores
    // the result — answer OK so the rollback resolves.
    callPlain: async () => ({ status: 0, data: new Uint8Array() }),
} as unknown as RemapprRpc

function makeService(readOnly = false): RemapprKeyboardService {
    const deps: RemapprServiceDeps = {
        rpc: stubRpc,
        deviceInfo: { name: 'CondTest', firmware: 'remappr' },
        config: CONFIG,
        configVersion: 1,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly,
    }
    return new RemapprKeyboardService(deps)
}

async function exportedConfig(svc: RemapprKeyboardService): Promise<{
    conditionalLayers?: { ifLayers: string[]; thenLayer: string }[]
}> {
    const [file] = await svc.exportConfig()
    return JSON.parse(String(file.content))
}

describe('Remappr config-blob conditional (tri-)layer edits', () => {
    it('reads device-truth tri-layers, then the staged list once edited', () => {
        const svc = makeService()
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['raise', 'lower'], thenLayer: 'adjust' },
        ])
        expect(svc.hasPendingChanges()).toBe(false)

        svc.setConditionalLayers([
            { ifLayers: ['raise', 'lower'], thenLayer: 'adjust' },
            { ifLayers: ['base'], thenLayer: 'raise' },
        ])
        expect(svc.hasPendingChanges()).toBe(true)
        expect(svc.getConditionalLayers()).toHaveLength(2)
        expect(svc.getConditionalLayers()[1]).toEqual({
            ifLayers: ['base'],
            thenLayer: 'raise',
        })
    })

    it('returns a deep copy — mutating the read-out array does not leak in', () => {
        const svc = makeService()
        const got = svc.getConditionalLayers()
        got[0].ifLayers.push('adjust')
        got.push({ ifLayers: ['base'], thenLayer: 'raise' })
        // Untouched staging: a fresh read still reflects device truth only.
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['raise', 'lower'], thenLayer: 'adjust' },
        ])
        expect(svc.hasPendingChanges()).toBe(false)
    })

    it('folds a tri-layer edit into the committed/exported config', async () => {
        const svc = makeService()
        svc.setConditionalLayers([
            { ifLayers: ['raise', 'lower'], thenLayer: 'adjust' },
            { ifLayers: ['base'], thenLayer: 'raise' },
        ])
        const doc = await exportedConfig(svc)
        // export uses the same withEdits fold commit() builds from.
        expect(doc.conditionalLayers).toHaveLength(2)
        expect(doc.conditionalLayers).toContainEqual({
            ifLayers: ['base'],
            thenLayer: 'raise',
        })
    })

    it('an empty list clears every tri-layer from the exported config', async () => {
        const svc = makeService()
        svc.setConditionalLayers([])
        expect(svc.hasPendingChanges()).toBe(true)
        expect(svc.getConditionalLayers()).toEqual([])

        const doc = await exportedConfig(svc)
        // Serializer omits an empty pool → no conditionalLayers key survives.
        expect(doc.conditionalLayers ?? []).toEqual([])
    })

    it('discardChanges drops the staged tri-layer edit', async () => {
        const svc = makeService()
        svc.setConditionalLayers([])
        expect(svc.hasPendingChanges()).toBe(true)

        await svc.discardChanges()
        expect(svc.hasPendingChanges()).toBe(false)
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['raise', 'lower'], thenLayer: 'adjust' },
        ])
    })

    it('rejects an edit on a read-only service', () => {
        const ro = makeService(true)
        expect(() =>
            ro.setConditionalLayers([{ ifLayers: ['base'], thenLayer: 'raise' }]),
        ).toThrow()
    })
})
