// Pattern check: no GoF pattern (-) — rejected — tests for the demo's layout upload; drives the public sideload facade.
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '@firmware/config'
import keycultSource from '@firmware/kle/fixtures/aftermarket-keycult-tkl.vial.json?raw'

import { MOCK_KIND_KEYPRESS, MOCK_KIND_TRANSPARENT } from './actions'
import { MockKeyboardService } from './service'

describe('demo — Load layout JSON', () => {
    it('offers one layout format', () => {
        const svc = new MockKeyboardService()
        expect(svc.sideload.formats.map((f) => f.id)).toEqual(['layout-json'])
        expect(svc.sideload.formats[0].kind).toBe('layout')
    })

    it('becomes the uploaded board, keeping bindings by position', async () => {
        const svc = new MockKeyboardService()
        await svc.unlock()
        const before = await svc.getKeymap()
        const topics: string[] = []
        svc.subscribe((n) => topics.push(n.topic))

        const result = await svc.sideload.importFile(
            'layout-json',
            keycultSource,
        )
        expect(result.keymapChanged).toBe(true)
        expect(topics).toContain('layout-changed')

        const km = await svc.getKeymap()
        expect(km.layouts[0].keys).toHaveLength(87)
        expect(km.layouts[0].encoders).toEqual([{ x: 1850, y: 0 }])
        expect(svc.capabilities.encoders).toBe(1)
        for (const layer of km.layers) {
            expect(layer.keys).toHaveLength(87)
            expect(layer.encoders).toHaveLength(1)
        }
        // First 36 bindings carried over; the rest are new, transparent keys.
        expect(km.layers[0].keys[0].params).toEqual(
            before.layers[0].keys[0].params,
        )
        expect(km.layers[0].keys[86].kind).toBe(MOCK_KIND_TRANSPARENT)
        // The Corne's volume knob carried over to the new knob.
        expect(km.layers[0].encoders![0].cw.kind).toBe(MOCK_KIND_KEYPRESS)
    })

    it('serves the new board as the config source', async () => {
        const svc = new MockKeyboardService()
        await svc.unlock()
        await svc.sideload.importFile('layout-json', keycultSource)
        const cfg = parseKeymap((await svc.getConfigSource())!)
        expect(cfg.keyboard.keys).toHaveLength(87)
        expect(cfg.keyboard.matrix).toMatchObject({ rows: 6, cols: 17 })
        expect(cfg.keyboard.keys[0].matrix).toEqual([0, 0])
        expect(cfg.keyboard.encoders).toEqual([{ x: 18.5, y: 0 }])
        expect(cfg.layers[0].bindings).toHaveLength(87)
    })

    it('discard returns to the uploaded board, not the Corne', async () => {
        const svc = new MockKeyboardService()
        await svc.unlock()
        await svc.sideload.importFile('layout-json', keycultSource)
        await svc.discardChanges()
        const km = await svc.getKeymap()
        expect(km.layouts[0].keys).toHaveLength(87)
    })

    it('rejects a file that is not a keyboard definition', async () => {
        const svc = new MockKeyboardService()
        await svc.unlock()
        await expect(
            svc.sideload.importFile('layout-json', '{"hello":1}'),
        ).rejects.toThrow(/matrix/)
        expect((await svc.getKeymap()).layouts[0].keys).toHaveLength(36)
    })
})
