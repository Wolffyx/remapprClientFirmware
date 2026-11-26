// pattern-check: skip — unit tests for device layout variants and their document form.
import { describe, expect, it } from 'vitest'
import { defaultLayout } from './defaultLayout'
import { layoutFromModel, parseDeviceLayout } from './schema'
import type { DeviceModel } from './types'
import {
    addVariant,
    inVariant,
    removeVariant,
    renameVariant,
    variantControls,
} from './variants'

const base = defaultLayout('gamepad', 'Pad', { buttons: 4, axes: 0, hats: 0 })

function tagged(): { model: DeviceModel; id: string } {
    const { model, id } = addVariant(base)
    return {
        model: {
            ...model,
            controls: model.controls.map((c, i) =>
                i === 0 ? { ...c, variant: id } : c,
            ),
        },
        id,
    }
}

describe('device layout variants', () => {
    it('adds numbered variants with unique ids', () => {
        const a = addVariant(base)
        const b = addVariant(a.model)
        expect(a.id).toBe('variant_1')
        expect(b.id).toBe('variant_2')
        expect(b.model.layouts?.map((v) => v.name)).toEqual([
            'Variant 1',
            'Variant 2',
        ])
    })

    it('a variant is the common controls plus its own', () => {
        const { model, id } = tagged()
        const other = addVariant(model)
        expect(variantControls(model, id)).toHaveLength(model.controls.length)
        expect(variantControls(other.model, other.id)).toHaveLength(
            model.controls.length - 1,
        )
        expect(variantControls(model, '')).toHaveLength(model.controls.length)
        expect(inVariant(model.controls[0]!, other.id)).toBe(false)
    })

    it('renames, ignoring a blank name', () => {
        const { model, id } = addVariant(base)
        expect(renameVariant(model, id, '  Paddles ').layouts?.[0]?.name).toBe(
            'Paddles',
        )
        expect(renameVariant(model, id, '  ')).toBe(model)
    })

    it('removing a variant makes its controls common and drops empty layouts', () => {
        const { model, id } = tagged()
        const next = removeVariant(model, id)
        expect(next.layouts).toBeUndefined()
        expect(next.controls[0]).not.toHaveProperty('variant')
    })

    it('round-trips through the layout document', () => {
        const { model } = tagged()
        const r = parseDeviceLayout(JSON.stringify(layoutFromModel(model)))
        expect(r.ok && r.model.layouts).toEqual(model.layouts)
        expect(r.ok && r.model.controls[0]?.variant).toBe('variant_1')
    })

    it('rejects a control tagged into an unknown variant', () => {
        const doc = layoutFromModel({
            ...base,
            controls: base.controls.map((c, i) =>
                i === 0 ? { ...c, variant: 'nope' } : c,
            ),
        })
        const r = parseDeviceLayout(JSON.stringify(doc))
        expect(r.ok).toBe(false)
        expect(!r.ok && r.error).toContain('unknown variant "nope"')
    })

    it('rejects duplicate variant ids', () => {
        const doc = {
            ...layoutFromModel(base),
            layouts: [
                { id: 'a', name: 'A' },
                { id: 'a', name: 'B' },
            ],
        }
        const r = parseDeviceLayout(JSON.stringify(doc))
        expect(!r.ok && r.error).toContain('duplicate variant id "a"')
    })

    it('an old document without variants still parses', () => {
        const r = parseDeviceLayout(JSON.stringify(layoutFromModel(base)))
        expect(r.ok && r.model.layouts).toBeUndefined()
    })
})
