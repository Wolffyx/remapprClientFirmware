// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// config with a node section, exercising the concrete-service getNode/setNode
// whole-node overlay (§N4b role / §N4c forwardMode + cluster map): a patch merges
// onto config.node preserving unedited fields, an undefined value reverts a key,
// the read-out is a deep copy, edits fold into commit/export, and discard reverts.
import { describe, expect, it } from 'vitest'

import { parseKeymap, type ConfigNode } from '../config'

import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService, type RemapprServiceDeps } from './service'

// A node seeded as a mode-B keyboard follower — enough to prove a role/forwardMode
// edit merges without dropping the pre-existing personality field.
const CONFIG = parseKeymap(`{
    "version": 2, "kind": "remappr.keymap",
    "meta": { "name": "NodeTest" },
    "keyboard": { "id": "nt", "name": "NodeTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [ { "name": "base", "keys": ["A", "B"] } ],
    "node": { "personality": "keyboard", "forwardMode": "resolved" }
}`)

const stubRpc = {
    onClosed: () => () => undefined,
    subscribeInput: () => () => undefined,
    close: async () => undefined,
    callPlain: async () => ({ status: 0, data: new Uint8Array() }),
} as unknown as RemapprRpc

function makeService(readOnly = false): RemapprKeyboardService {
    const deps: RemapprServiceDeps = {
        rpc: stubRpc,
        deviceInfo: { name: 'NodeTest', firmware: 'remappr' },
        config: CONFIG,
        configVersion: 1,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly,
    }
    return new RemapprKeyboardService(deps)
}

async function exportedNode(svc: RemapprKeyboardService): Promise<ConfigNode> {
    const [file] = await svc.exportConfig()
    return (JSON.parse(String(file.content)).node ?? {}) as ConfigNode
}

const CLUSTER: ConfigNode['cluster'] = [
    { uid: 'deadbeef', positionBase: 0, rows: 6, cols: 5 },
    { uid: '010203040506', positionBase: 30, rows: 4, cols: 4 },
]

describe('Remappr config-blob whole-node edits', () => {
    it('reads device-truth node, then the staged patch once edited', () => {
        const svc = makeService()
        expect(svc.getNode()).toEqual({
            personality: 'keyboard',
            forwardMode: 'resolved',
        })
        expect(svc.hasPendingChanges()).toBe(false)

        svc.setNode({ role: 'coordinator', forwardMode: 'physical' })
        expect(svc.hasPendingChanges()).toBe(true)
        // The patch merges — the untouched personality survives.
        expect(svc.getNode()).toEqual({
            personality: 'keyboard',
            role: 'coordinator',
            forwardMode: 'physical',
        })
    })

    it('an undefined value reverts that key to committed truth', () => {
        const svc = makeService()
        svc.setNode({ forwardMode: 'physical' })
        expect(svc.getNode().forwardMode).toBe('physical')

        svc.setNode({ forwardMode: undefined })
        // Dropped back to the committed 'resolved', not deleted.
        expect(svc.getNode().forwardMode).toBe('resolved')
    })

    it('stages a whole cluster map and returns a deep copy', () => {
        const svc = makeService()
        svc.setNode({ role: 'coordinator', cluster: CLUSTER })

        const got = svc.getNode()
        expect(got.cluster).toHaveLength(2)
        expect(got.cluster?.[1]).toEqual({
            uid: '010203040506',
            positionBase: 30,
            rows: 4,
            cols: 4,
        })
        // Mutating the read-out array/rows must not leak into staged state.
        got.cluster?.push({ uid: 'ff', positionBase: 99, rows: 1, cols: 1 })
        got.cluster![0].positionBase = 999
        expect(svc.getNode().cluster).toHaveLength(2)
        expect(svc.getNode().cluster?.[0].positionBase).toBe(0)
    })

    it('folds a node edit into the committed/exported config', async () => {
        const svc = makeService()
        svc.setNode({ role: 'coordinator', forwardMode: 'physical', cluster: CLUSTER })

        const node = await exportedNode(svc)
        expect(node.role).toBe('coordinator')
        expect(node.forwardMode).toBe('physical')
        expect(node.personality).toBe('keyboard') // untouched field preserved
        expect(node.cluster).toHaveLength(2)
    })

    it('discardChanges drops the staged node edit', async () => {
        const svc = makeService()
        svc.setNode({ role: 'coordinator', cluster: CLUSTER })
        expect(svc.hasPendingChanges()).toBe(true)

        await svc.discardChanges()
        expect(svc.hasPendingChanges()).toBe(false)
        expect(svc.getNode()).toEqual({
            personality: 'keyboard',
            forwardMode: 'resolved',
        })
    })

    it('rejects an edit on a read-only service', () => {
        const ro = makeService(true)
        expect(() => ro.setNode({ role: 'coordinator' })).toThrow()
    })
})
