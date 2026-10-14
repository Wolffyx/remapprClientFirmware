// pattern-check: skip — unit tests for the demo device registry.
import { describe, expect, it } from 'vitest'
import { connectDemoDevice, DEMO_DEVICES, demoDeviceModel } from './demoDevices'

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

    it('previews the Corne from the demo seed', () => {
        const m = demoDeviceModel('corne')
        expect(m.controls.filter((c) => c.shape === 'key')).toHaveLength(36)
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
