// pattern-check: skip — unit test for the config-editing guard + the demo mock's
// in-memory config-blob editing surface.
import { describe, expect, it } from 'vitest'

import type { KeyboardService } from '../service'
import { MockKeyboardService } from '../mock/service'

import { supportsConfigEditing } from './configEditing'

describe('supportsConfigEditing guard', () => {
    it('accepts the demo mock (it exposes the full editing surface)', () => {
        expect(supportsConfigEditing(new MockKeyboardService())).toBe(true)
    })

    it('rejects null / undefined / a service without the surface', () => {
        expect(supportsConfigEditing(null)).toBe(false)
        expect(supportsConfigEditing(undefined)).toBe(false)
        expect(
            supportsConfigEditing({
                commit: async () => undefined,
            } as unknown as KeyboardService),
        ).toBe(false)
    })
})

describe('MockKeyboardService config-blob editing (demo)', () => {
    it('advertises a full feature bitmask so the editors are ungated', () => {
        expect(new MockKeyboardService().limits?.featureBitmask).toBe(0xffffffff)
    })

    it('round-trips a timing-defaults edit; undefined drops it back to seed', () => {
        const svc = new MockKeyboardService()
        expect(svc.getConfigDefaults().tappingTermMs).toBe(200)
        svc.setConfigDefaults({ tappingTermMs: 333 })
        expect(svc.getConfigDefaults().tappingTermMs).toBe(333)
        svc.setConfigDefaults({ tappingTermMs: undefined })
        expect(svc.getConfigDefaults().tappingTermMs).toBe(200)
    })

    it('round-trips a node role/forwardMode edit; undefined drops to seed', () => {
        const svc = new MockKeyboardService()
        const seed = svc.getNode()
        svc.setNode({ role: 'coordinator', forwardMode: 'physical' })
        expect(svc.getNode().role).toBe('coordinator')
        expect(svc.getNode().forwardMode).toBe('physical')
        svc.setNode({ role: undefined, forwardMode: undefined })
        expect(svc.getNode().role).toBe(seed.role)
        expect(svc.getNode().forwardMode).toBe(seed.forwardMode)
    })

    it('round-trips a conditional-layer edit and reflects it in getConfigSource', async () => {
        const svc = new MockKeyboardService()
        // The demo seed ships one sample tri-layer so the editor opens with data.
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['lower'], thenLayer: 'raise' },
        ])
        svc.setConditionalLayers([
            { ifLayers: ['lower', 'raise'], thenLayer: 'base' },
        ])
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['lower', 'raise'], thenLayer: 'base' },
        ])
        expect(String(await svc.getConfigSource())).toContain('conditionalLayers')
    })

    it('round-trips an autocorrect dictionary edit into the config source', async () => {
        const svc = new MockKeyboardService()
        expect(svc.getAutocorrect()).toEqual([])
        svc.setAutocorrect([{ typo: 'teh', correction: 'the' }])
        expect(svc.getAutocorrect()).toEqual([{ typo: 'teh', correction: 'the' }])
        expect(String(await svc.getConfigSource())).toContain('autocorrect')
    })

    it('keeps an emptied dictionary as an edit, not as "never touched"', async () => {
        // An empty list is the request to DROP the device's dictionary, so it has
        // to survive into the config the commit compiles.
        const svc = new MockKeyboardService()
        svc.setAutocorrect([{ typo: 'teh', correction: 'the' }])
        svc.setAutocorrect([])
        expect(svc.getAutocorrect()).toEqual([])
        expect(String(await svc.getConfigSource())).toContain('autocorrect')
    })

    it('edits an in-range seeded hold-tap and rejects an out-of-range index', () => {
        const svc = new MockKeyboardService()
        expect(svc.getHoldTaps().length).toBeGreaterThan(0)
        svc.setHoldTap(0, { tappingTermMs: 321 })
        expect(svc.getHoldTaps()[0].tappingTermMs).toBe(321)
        expect(() => svc.setHoldTap(99, { tappingTermMs: 1 })).toThrow()
    })

    it('discardChanges reverts staged config-blob edits to the seed', async () => {
        const svc = new MockKeyboardService()
        svc.setConfigDefaults({ tappingTermMs: 333 })
        svc.setConditionalLayers([{ ifLayers: ['lower'], thenLayer: 'base' }])
        await svc.discardChanges()
        expect(svc.getConfigDefaults().tappingTermMs).toBe(200)
        expect(svc.getConditionalLayers()).toEqual([
            { ifLayers: ['lower'], thenLayer: 'raise' },
        ])
    })
})
