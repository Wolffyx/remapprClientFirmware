// pattern-check: skip — round-trip tests for mock encoders/dynamic/macros bundles
import { describe, expect, it } from 'vitest'
import { MockKeyboardService } from './service'
import { buildMockKeyAction, MOCK_KIND_KEYPRESS } from './actions'

function freshMock(): MockKeyboardService {
    const svc = new MockKeyboardService()
    return svc
}

describe('mock encoders bundle', () => {
    it('exposes encoders capability + bundle', async () => {
        const svc = freshMock()
        await svc.unlock()
        expect(svc.capabilities.encoders).toBe(2)
        expect(svc.encoders).toBeDefined()
    })

    it('round-trips encoder actions per direction', async () => {
        const svc = freshMock()
        await svc.unlock()
        const km = await svc.getKeymap()
        const layerId = km.layers[0].id
        const action = buildMockKeyAction(MOCK_KIND_KEYPRESS, [0x070004], [])
        await svc.encoders.setEncoder(layerId, 0, 0, action)
        await svc.encoders.setEncoder(layerId, 1, 1, action)
        const km2 = await svc.getKeymap()
        const encs = svc['layers'][0].encoders
        expect(encs?.[0].cw).toEqual(action)
        expect(encs?.[1].ccw).toEqual(action)
        expect(km2.layers[0].id).toBe(layerId)
    })
})

describe('mock dynamic bundle', () => {
    it('exposes counts matching capabilities', () => {
        const svc = freshMock()
        expect(svc.dynamic.getCounts()).toEqual({
            tapDance: 4,
            combo: 4,
            keyOverride: 4,
        })
    })

    it('round-trips tap-dance, combo, key-override, ARK', async () => {
        const svc = freshMock()
        await svc.unlock()
        const td = {
            onTap: 1,
            onHold: 2,
            onDoubleTap: 3,
            onTapHold: 4,
            tappingTerm: 250,
        }
        await svc.dynamic.setTapDance(0, td)
        expect(await svc.dynamic.getTapDance(0)).toEqual(td)

        const combo = {
            keys: [10, 20, 30, 40] as [number, number, number, number],
            output: 99,
        }
        await svc.dynamic.setCombo(1, combo)
        expect(await svc.dynamic.getCombo(1)).toEqual(combo)

        const ko = {
            trigger: 5,
            replacement: 6,
            layers: 0xff,
            triggerMods: 1,
            negativeModMask: 0,
            suppressedMods: 0,
            options: {
                activationTriggerDown: true,
                activationRequiredModDown: false,
                activationNegativeModUp: false,
                oneMod: true,
                noReregisterTrigger: false,
                noUnregisterOnOtherKeyDown: false,
                enabled: true,
            },
        }
        await svc.dynamic.setKeyOverride(2, ko)
        expect(await svc.dynamic.getKeyOverride(2)).toEqual(ko)

        const ark = {
            keycode: 7,
            altKeycode: 8,
            allowedMods: 0xf,
            options: {
                defaultToThisAltKey: true,
                bidirectional: false,
                ignoreModHandedness: false,
                enabled: true,
            },
        }
        await svc.dynamic.setAltRepeatKey!(3, ark)
        expect(await svc.dynamic.getAltRepeatKey!(3)).toEqual(ark)
    })
})

describe('mock macros bundle', () => {
    it('exposes count matching capabilities', () => {
        const svc = freshMock()
        expect(svc.macros.getCount()).toBe(3)
    })

    it('round-trips macro actions', async () => {
        const svc = freshMock()
        await svc.unlock()
        const actions = [
            { kind: 'tap' as const, keycode: 4 },
            { kind: 'delay' as const, ms: 100 },
            { kind: 'text' as const, text: 'hi' },
        ]
        await svc.macros.setMacro!(0, actions)
        expect(await svc.macros.getMacro(0)).toEqual(actions)
    })
})
