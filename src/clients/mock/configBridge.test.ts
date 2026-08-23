// pattern-check: skip — converter test, no production logic
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseKeymap, resolveKeycode } from '@firmware/config'
import {
    configToPhysicalLayout,
    lowerConfigToMock,
    raiseMockToConfig,
} from './configBridge'
import {
    HID_KP,
    MOCK_KIND_KEYPRESS,
    MOCK_KIND_LAYER_MOMENTARY,
    MOCK_KIND_LAYER_TAP,
    MOCK_KIND_MOD_TAP,
    MOCK_KIND_TRANSPARENT,
} from './actions'
import { mockCodec } from './codec'

const seed = readFileSync(
    fileURLToPath(new URL('./seed.keymap.json', import.meta.url)),
    'utf8',
)
const config = parseKeymap(seed)
const parseId = (token: string): string => resolveKeycode(token)!
const enc = (token: string): number => mockCodec.encode(parseId(token))!.value

describe('configBridge.lowerConfigToMock', () => {
    const { layers } = lowerConfigToMock(config)
    const base = layers.find((l) => l.name === 'base')!
    const lower = layers.find((l) => l.name === 'lower')!
    const raise = layers.find((l) => l.name === 'raise')!

    it('lowers all three layers to MOCK_KEY_COUNT (36) keys', () => {
        for (const l of layers) expect(l.keys).toHaveLength(36)
    })

    it('reproduces the QWERTY base: plain key, home-row mod-tap, thumb layer-taps', () => {
        // [0] Q -> keypress
        expect(base.keys[0]).toMatchObject({
            kind: MOCK_KIND_KEYPRESS,
            params: [HID_KP(0x14)],
        })
        // [5] mod_tap A / Left GUI -> [encode(A), HID_KP(0xe3)]
        expect(base.keys[5]).toMatchObject({
            kind: MOCK_KIND_MOD_TAP,
            params: [HID_KP(0x04), HID_KP(0xe3)],
        })
        // [16] layer_tap Space -> raise (index 2)
        expect(base.keys[16]).toMatchObject({
            kind: MOCK_KIND_LAYER_TAP,
            params: [HID_KP(0x2c), 2],
        })
        // [34] layer_tap Backspace -> lower (index 1)
        expect(base.keys[34]).toMatchObject({
            kind: MOCK_KIND_LAYER_TAP,
            params: [HID_KP(0x2a), 1],
        })
    })

    it('lowers a momentary layer binding to the right index', () => {
        // lower[9] = momentary -> raise (index 2)
        expect(lower.keys[9]).toMatchObject({
            kind: MOCK_KIND_LAYER_MOMENTARY,
            params: [2],
        })
    })

    it('degrades non-representable bindings to transparent + warns', () => {
        // raise[0] = output usb -> transparent
        expect(raise.keys[0].kind).toBe(MOCK_KIND_TRANSPARENT)
        const { diagnostics } = lowerConfigToMock(config)
        expect(
            diagnostics.some(
                (d) =>
                    d.level === 'warn' && /not representable/.test(d.message),
            ),
        ).toBe(true)
    })
})

describe('configBridge.configToPhysicalLayout', () => {
    it('scales config units (U) to runtime centi-units, preserving key order', () => {
        const layout = configToPhysicalLayout(config)
        expect(layout.keys).toHaveLength(config.keyboard.keys.length)
        const k0 = config.keyboard.keys[0]
        expect(layout.keys[0]).toMatchObject({
            x: Math.round(k0.x * 100),
            y: Math.round(k0.y * 100),
            w: Math.round((k0.w || 1) * 100),
            h: Math.round((k0.h || 1) * 100),
        })
    })

    it('carries rotation (degrees → centi-degrees) only when present', () => {
        const rotated = {
            ...config,
            keyboard: {
                ...config.keyboard,
                keys: [{ x: 1, y: 2, w: 1, h: 1, r: 8, rx: 1.5, ry: 2.5 }],
            },
        }
        const [k] = configToPhysicalLayout(rotated).keys
        expect(k).toMatchObject({ r: 800, rx: 150, ry: 250 })
        // A flat key omits rotation fields entirely.
        const flat = configToPhysicalLayout(config).keys[0]
        expect(flat.r).toBeUndefined()
    })
})

describe('configBridge.raiseMockToConfig (merge)', () => {
    it('round-trips representable bindings (key / mod-tap / layer-tap)', () => {
        const { layers } = lowerConfigToMock(config)
        const raised = raiseMockToConfig(layers, config)
        const base = raised.layers.find((l) => l.name === 'base')!
        expect(base.bindings[0]).toMatchObject({
            type: 'key_press',
            key: parseId('Q'),
        })
        expect(base.bindings[5]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'modifier', modifier: 'LEFT_GUI' },
        })
        expect(base.bindings[16]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'layer', layer: 'raise' },
        })
    })

    it('preserves lossy config-only bindings the runtime cannot model', () => {
        const { layers } = lowerConfigToMock(config)
        const raised = raiseMockToConfig(layers, config)
        const raise = raised.layers.find((l) => l.name === 'raise')!
        // The runtime showed these as transparent; merge keeps the rich config.
        expect(raise.bindings[0]).toMatchObject({
            type: 'output',
            action: 'usb',
        })
        expect(raise.bindings[4]).toMatchObject({ type: 'lighting' })
        expect(raise.bindings[11]).toMatchObject({ type: 'macro' })
        // Config-level data survives untouched.
        expect(raised.combos).toHaveLength(2)
        expect(raised.macros).toHaveLength(1)
        expect(raised.tapDances).toHaveLength(1)
    })

    it('an edit raises into the config without wiping lossy bindings', () => {
        const { layers } = lowerConfigToMock(config)
        // Simulate the user remapping base key 0: Q -> X.
        const edited = layers.map((l) => ({ ...l, keys: l.keys.slice() }))
        edited[0].keys[0] = {
            kind: MOCK_KIND_KEYPRESS,
            params: [enc('X')],
            label: { primary: 'Key Press' },
        }
        const raised = raiseMockToConfig(edited, config)
        const base = raised.layers.find((l) => l.name === 'base')!
        const raise = raised.layers.find((l) => l.name === 'raise')!
        expect(base.bindings[0]).toMatchObject({
            type: 'key_press',
            key: parseId('X'),
        })
        // The lighting/output bindings are still intact.
        expect(raise.bindings[0]).toMatchObject({ type: 'output' })
    })
})
