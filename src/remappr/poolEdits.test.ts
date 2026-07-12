// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// config bearing hold-tap + mod-morph def pools, exercising the concrete-service
// setHoldTap/setModMorph overlays (staged edits fold into commit/export).
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../config'

import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService, type RemapprServiceDeps } from './service'

// v2 dict form (down-migrates to canonical pools): one custom hold-tap + one
// mod-morph def, plus a two-key base layer.
const CONFIG = parseKeymap(`{
    "version": 2, "kind": "remappr.keymap",
    "meta": { "name": "PoolTest" },
    "keyboard": { "id": "pt", "name": "PoolTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [ { "name": "base", "keys": ["A", "B"] } ],
    "holdTaps": { "home-row": {
        "flavor": "balanced",
        "timing": { "tappingTermMs": 220, "quickTapMs": 150 },
        "flags": { "retroTap": true } } },
    "modMorphs": { "shift-del": {
        "on": ["LShift"], "base": "Backspace", "morphed": "Delete",
        "keepMods": ["LShift"] } }
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
        deviceInfo: { name: 'PoolTest', firmware: 'remappr' },
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
    holdTaps?: { tappingTermMs?: number }[]
    modMorphs?: { mods?: string[] }[]
}> {
    const [file] = await svc.exportConfig()
    return JSON.parse(String(file.content))
}

describe('Remappr config-blob pool edits (hold-tap / mod-morph)', () => {
    it('reads the def pools with staged edits overlaid', () => {
        const svc = makeService()
        expect(svc.getHoldTaps()[0].tappingTermMs).toBe(220)
        expect(svc.hasPendingChanges()).toBe(false)

        svc.setHoldTap(0, { tappingTermMs: 333, quickTapMs: 99 })
        expect(svc.hasPendingChanges()).toBe(true)
        expect(svc.getHoldTaps()[0].tappingTermMs).toBe(333)
        expect(svc.getHoldTaps()[0].quickTapMs).toBe(99)
        // Untouched fields survive the patch merge.
        expect(svc.getHoldTaps()[0].retroTap).toBe(true)
    })

    it('folds a hold-tap edit into the committed/exported config', async () => {
        const svc = makeService()
        svc.setHoldTap(0, { tappingTermMs: 333 })
        const doc = await exportedConfig(svc)
        // The raised config commit() builds from carries the edit (export uses the
        // same withEdits path), scoped to holdTaps to stay serialize-form-agnostic.
        expect(JSON.stringify(doc.holdTaps)).toContain('333')
    })

    it('folds a mod-morph edit into the committed/exported config', async () => {
        const svc = makeService()
        expect(svc.getModMorphs()[0].mods).toHaveLength(1)
        svc.setModMorph(0, { mods: ['LEFT_SHIFT', 'LEFT_CTRL'] })
        expect(svc.getModMorphs()[0].mods).toHaveLength(2)

        const doc = await exportedConfig(svc)
        expect(doc.modMorphs?.[0].mods).toHaveLength(2)
    })

    it('discardChanges drops staged pool edits', async () => {
        const svc = makeService()
        svc.setHoldTap(0, { tappingTermMs: 333 })
        svc.setModMorph(0, { mods: ['LEFT_SHIFT', 'LEFT_CTRL'] })
        expect(svc.hasPendingChanges()).toBe(true)

        await svc.discardChanges()
        expect(svc.hasPendingChanges()).toBe(false)
        expect(svc.getHoldTaps()[0].tappingTermMs).toBe(220)
        expect(svc.getModMorphs()[0].mods).toHaveLength(1)
    })

    it('rejects an out-of-range index and a read-only edit', () => {
        const svc = makeService()
        expect(() => svc.setHoldTap(9, { tappingTermMs: 1 })).toThrow()
        expect(() => svc.setModMorph(9, { mods: [] })).toThrow()

        const ro = makeService(true)
        expect(() => ro.setHoldTap(0, { tappingTermMs: 1 })).toThrow()
    })
})
