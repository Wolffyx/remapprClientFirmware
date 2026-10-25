// Pattern check: no GoF pattern (-) — rejected — unit tests over target data.
import { describe, expect, it } from 'vitest'
import { BUILDER_FIRMWARE_TARGETS, targetBuildsForm } from '../firmwareTargets'
import { DeviceConfigSchema, newDeviceConfig } from '../device'

const target = (id: string) => BUILDER_FIRMWARE_TARGETS.find((t) => t.id === id)!

describe('which targets build which devices', () => {
    it('builds keyboards on every target, other devices where declared', () => {
        for (const t of BUILDER_FIRMWARE_TARGETS)
            expect(targetBuildsForm(t, 'keyboard')).toBe(true)
        expect(targetBuildsForm(target('remappr'), 'mouse')).toBe(true)
        expect(targetBuildsForm(target('zmk'), 'mouse')).toBe(false)
        expect(targetBuildsForm(target('qmk'), 'gamepad')).toBe(false)
    })

    it('starts a valid device document per form', () => {
        const mouse = newDeviceConfig('mouse', 'My mouse')!
        expect(DeviceConfigSchema.parse(mouse).personality).toBe('mouse')
        expect(newDeviceConfig('flightstick', 'Stick')!.personality).toBe('joystick')
        expect(newDeviceConfig('keyboard', 'K')).toBeNull()
    })
})
