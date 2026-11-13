// pattern-check: skip — unit tests for the demo device registry.
import { describe, expect, it } from 'vitest'
import {
    connectDemoDevice,
    connectMockDeviceWithModel,
    DEMO_DEVICES,
    demoDeviceModel,
    demoDevicePreview,
} from './demoDevices'

describe('demo devices', () => {
    it('offers every device form', () => {
        expect(DEMO_DEVICES.map((d) => d.form)).toEqual([
            'keyboard',
            'macropad',
            'mouse',
            'gamepad',
            'flightstick',
            'gamepad',
        ])
        expect(DEMO_DEVICES.filter((d) => !d.ready).map((d) => d.id)).toEqual([
            'generic-gamepad',
        ])
    })

    it('previews the Deck 9 as 9 keys and 2 knobs', () => {
        const m = demoDeviceModel('deck9')
        expect(m.form).toBe('macropad')
        expect(m.controls.filter((c) => c.kind === 'encoder')).toHaveLength(2)
        expect(m.controls.filter((c) => c.shape === 'key')).toHaveLength(9)
    })

    it('offers the Deck 9 in three layouts with the same keys and knobs', async () => {
        const svc = await connectDemoDevice('deck9')
        const { layouts } = await svc.getPhysicalLayouts()
        expect(layouts.map((l) => l.name)).toEqual([
            'Deck 9',
            'Deck 9 row',
            'Deck 9 knobs left',
        ])
        for (const l of layouts) {
            expect(l.keys).toHaveLength(9)
            expect(l.encoders).toHaveLength(2)
        }
    })

    it('previews the Corne from the demo seed', () => {
        const m = demoDeviceModel('corne')
        expect(m.controls.filter((c) => c.shape === 'key')).toHaveLength(36)
    })

    it('previews a control device tinted by its default bindings', () => {
        const p = demoDevicePreview('halo-m2')
        expect(p.bindings.lmb).toEqual({ a: 'mouse:Left click' })
        expect(p.catalog.fields.button).toEqual(['a', 'hold'])
        expect(demoDevicePreview('corne').bindings).toEqual({})
    })

    it('connects keyboards to the keymap and the rest to controls', async () => {
        const deck = await connectDemoDevice('deck9')
        expect(deck.controls).toBeUndefined()
        expect((await deck.getKeymap()).layers).toHaveLength(2)
        const mouse = await connectDemoDevice('halo-m2')
        expect(mouse.controls).toBeDefined()
        expect(mouse.kind).toBe('mouse')
        expect(mouse.capabilities.demo).toBe(true)
        await Promise.all([deck.disconnect(), mouse.disconnect()])
    })
})

describe('builder hand-off', () => {
    it('opens a model from the Builder as an editable demo device', async () => {
        const model = demoDeviceModel('apex-stick')
        const svc = connectMockDeviceWithModel({ ...model, name: 'My stick' })
        expect(svc.deviceInfo.name).toBe('My stick')
        expect(svc.controls?.setBinding).toBeDefined()
        expect((await svc.controls!.getModel()).controls).toHaveLength(
            model.controls.length,
        )
        await svc.disconnect()
    })

    it('lets a demo device be re-drawn for the session', async () => {
        const svc = await connectDemoDevice('generic-gamepad')
        const changes: unknown[] = []
        svc.controls!.onChanged((c) => changes.push(c))
        const model = await svc.controls!.getModel()
        const next = {
            ...model,
            controls: model.controls.map((c) => ({ ...c, x: c.x + 0.5 })),
        }
        await svc.controls!.layout!.apply(next)
        expect((await svc.controls!.getModel()).defaulted).toBeUndefined()
        expect(changes).toEqual([{ type: 'model' }])
        await svc.disconnect()
    })
})
