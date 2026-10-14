// pattern-check: skip — runs the ControlsApi contract over every demo device.
import { describe, expect, it } from 'vitest'
import { runControlsContractSuite } from '@firmware/__tests__/controlsContract'
import { APEX_STICK } from './apexStick'
import { GENERIC_GAMEPAD } from './genericGamepad'
import { HALO_M2 } from './haloM2'
import { MockDeviceService } from './MockDeviceService'
import { VECTOR_PAD } from './vectorPad'

for (const def of [HALO_M2, VECTOR_PAD, APEX_STICK, GENERIC_GAMEPAD]) {
    runControlsContractSuite(def.model.name, {
        makeService: () => new MockDeviceService(def),
    })
}

describe('MockDeviceService', () => {
    it('applies per-profile overrides on top of the default profile', async () => {
        const s = new MockDeviceService(HALO_M2)
        const gaming = await s.controls.getBindings('p1')
        expect(gaming.back).toEqual({ a: 'key:R' })
        expect(gaming.sensor).toMatchObject({ active: 1, poll: 4000 })
        const base = await s.controls.getBindings('p0')
        expect(base.back).toEqual({
            a: 'mouse:Back',
            hold: 'mouse:Sniper (hold)',
        })
    })

    it('leaves the write methods out for a device it can only read', () => {
        const s = new MockDeviceService(GENERIC_GAMEPAD)
        expect(s.controls.setBinding).toBeUndefined()
        expect(s.controls.addProfile).toBeUndefined()
        expect(s.capabilities.readOnly).toBe(true)
        expect(s.kind).toBe('joystick')
    })

    it('adds a profile copied from the active one', async () => {
        const s = new MockDeviceService(VECTOR_PAD)
        const p = await s.controls.addProfile!('Racing')
        const { profiles } = await s.controls.getProfiles()
        expect(profiles.at(-1)).toEqual(p)
        expect(await s.controls.getBindings(p.id)).toEqual(
            await s.controls.getBindings('p0'),
        )
    })

    it('restores stock bindings on reset and says so', async () => {
        const s = new MockDeviceService(APEX_STICK)
        const changes: unknown[] = []
        s.controls.onChanged((c) => changes.push(c))
        await s.controls.setBinding!('p0', 'trig', { a: null })
        await s.resetSettings()
        expect((await s.controls.getBindings('p0')).trig).toEqual({
            a: 'pad:Button 1',
        })
        expect(changes).toEqual([{ type: 'profiles' }])
    })

    it('exports every profile as JSON', async () => {
        const [file] = await new MockDeviceService(HALO_M2).exportConfig()
        const doc = JSON.parse(String(file!.content))
        expect(doc.profiles.map((p: { name: string }) => p.name)).toEqual([
            'Default',
            'Gaming',
            'Work',
        ])
    })
})
