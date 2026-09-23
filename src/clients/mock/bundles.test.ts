// pattern-check: skip — round-trip tests for mock encoders/dynamic/macros bundles
import { describe, expect, it } from 'vitest'
import { MockKeyboardService } from './service'
import {
    buildMockKeyAction,
    MOCK_KIND_KEYPRESS,
    MOCK_KIND_RGB,
} from './actions'

function freshMock(): MockKeyboardService {
    const svc = new MockKeyboardService()
    return svc
}

describe('mock encoders bundle', () => {
    it('exposes one knob per seed-config encoder slot', async () => {
        const svc = freshMock()
        await svc.unlock()
        expect(svc.capabilities.encoders).toBe(1)
        expect(svc.encoders).toBeDefined()
    })

    it('shows the seed knob: a layout slot and bindings on every layer', async () => {
        const svc = freshMock()
        const km = await svc.getKeymap()
        expect(km.layouts[0].encoders).toHaveLength(1)
        for (const layer of km.layers) expect(layer.encoders).toHaveLength(1)
        // base: Volume Up / Volume Down (seed.keymap.json).
        const base = km.layers[0].encoders![0]
        expect(base.cw.kind).toBe(MOCK_KIND_KEYPRESS)
        expect(base.ccw.kind).toBe(MOCK_KIND_KEYPRESS)
        expect(base.cw.params).not.toEqual(base.ccw.params)
    })

    it('round-trips encoder actions per direction (0 = cw)', async () => {
        const svc = freshMock()
        await svc.unlock()
        const km = await svc.getKeymap()
        const layerId = km.layers[0].id
        const before = km.layers[0].encoders![0]
        const action = buildMockKeyAction(MOCK_KIND_KEYPRESS, [0x070004], [])
        await svc.encoders.setEncoder(layerId, 0, 0, action)
        const km2 = await svc.getKeymap()
        expect(km2.layers[0].encoders![0].cw.params).toEqual(action.params)
        expect(km2.layers[0].encoders![0].ccw.params).toEqual(
            before.ccw.params,
        )
        await svc.encoders.setEncoder(layerId, 0, 1, action)
        const km3 = await svc.getKeymap()
        expect(km3.layers[0].encoders![0].ccw.params).toEqual(action.params)
        await expect(
            svc.encoders.setEncoder(layerId, 1, 0, action),
        ).rejects.toThrow(/out of range/)
    })

    it('raises a knob edit back into the config', async () => {
        const svc = freshMock()
        await svc.unlock()
        const km = await svc.getKeymap()
        const action = buildMockKeyAction(MOCK_KIND_KEYPRESS, [0x070004], [])
        await svc.encoders.setEncoder(km.layers[0].id, 0, 0, action)
        const edited = await svc.getKeymap()
        const cfg = svc.configBridge.raiseKeymap(edited.layers, svc['cfg'])
        expect(cfg.layers[0].encoders?.[0].cw).toEqual({
            type: 'key_press',
            key: 'key.keyboard_a',
        })
        // Untouched direction and the raise layer's lighting knob survive.
        expect(cfg.layers[0].encoders?.[0].ccw).toEqual(
            svc['cfg'].layers[0].encoders?.[0].ccw,
        )
        expect(cfg.layers[2].encoders?.[0].cw).toMatchObject({
            type: 'lighting',
        })
    })
})

describe('mock underglow bindings', () => {
    it('lowers the raise knob (underglow brightness) to RGB commands with an icon', async () => {
        const svc = freshMock()
        const km = await svc.getKeymap()
        const knob = km.layers[2].encoders![0]
        expect(knob.cw.kind).toBe(MOCK_KIND_RGB)
        expect(knob.cw.params).toEqual([7]) // RGB_BRI
        expect(knob.ccw.params).toEqual([8]) // RGB_BRD
        expect(knob.cw.label.paramParts?.some((p) => p.icon)).toBe(true)
    })

    it('raises an RGB command back to a lighting action', async () => {
        const svc = freshMock()
        await svc.unlock()
        const km = await svc.getKeymap()
        const hueUp = buildMockKeyAction(MOCK_KIND_RGB, [3], [])
        await svc.encoders.setEncoder(km.layers[2].id, 0, 0, hueUp)
        const edited = await svc.getKeymap()
        const cfg = svc.configBridge.raiseKeymap(edited.layers, svc['cfg'])
        expect(cfg.layers[2].encoders?.[0].cw).toEqual({
            type: 'lighting',
            target: 'underglow',
            action: 'hue_up',
        })
        expect(cfg.layers[2].encoders?.[0].ccw).toMatchObject({
            type: 'lighting',
            action: 'brightness_down',
        })
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
