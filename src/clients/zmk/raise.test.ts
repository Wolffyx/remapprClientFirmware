import { describe, expect, it } from 'vitest'
import { zmkNeutralToConfig } from './raise'
import {
    getCompiler,
    parseKeymap,
    serializeKeymap,
    resolveKeycode,
} from '@firmware/config'
import { HID_USAGE_BY_CANONICAL } from '@firmware/catalog/entries'
import type {
    DeviceInfo,
    KeyAction,
    Keymap,
    PhysicalLayout,
} from '@firmware/types'

// Build the packed HID param ((mods<<24)|(page<<16)|id) the device would report
// for a canonical key, optionally OR-ing an implicit-modifier bitmask.
function usage(token: string, modBits = 0): number {
    const id = resolveKeycode(token)
    if (!id) throw new Error(`no canonical id for ${token}`)
    const u = HID_USAGE_BY_CANONICAL.get(id)
    if (!u) throw new Error(`no HID usage for ${id}`)
    return (modBits << 24) | (u.page << 16) | u.usage
}

function ka(prefix: string, params: number[], primary = ''): KeyAction {
    return { kind: '0', params, label: { primary, bindingPrefix: prefix } }
}

// A row of `n` 1u keys in centi-units (config divides by 100 → key units).
function layout(n: number): PhysicalLayout {
    return {
        id: 0,
        name: 'test',
        keys: Array.from({ length: n }, (_, i) => ({
            x: i * 100,
            y: 0,
            w: 100,
            h: 100,
        })),
    }
}

function keymap(layers: { name: string; keys: KeyAction[] }[]): Keymap {
    const width = layers.reduce((m, l) => Math.max(m, l.keys.length), 1)
    return {
        layers: layers.map((l, id) => ({ id, name: l.name, keys: l.keys })),
        availableLayers: layers.length,
        activeLayoutId: 0,
        layouts: [layout(width)],
    }
}

const DEV: DeviceInfo = { name: 'Test Corne', firmware: 'zmk' }

describe('zmkNeutralToConfig', () => {
    it('raises a plain key press', () => {
        const { config } = zmkNeutralToConfig(
            keymap([{ name: 'base', keys: [ka('&kp', [usage('A')])] }]),
            DEV,
        )
        expect(config.layers[0].bindings[0]).toEqual({
            type: 'key_press',
            key: resolveKeycode('A'),
        })
    })

    it('raises implicit modifiers on a key press', () => {
        const lc = 1 << 0 // LEFT_CTRL bit
        const { config } = zmkNeutralToConfig(
            keymap([{ name: 'base', keys: [ka('&kp', [usage('C', lc)])] }]),
            DEV,
        )
        expect(config.layers[0].bindings[0]).toMatchObject({
            type: 'key_press',
            key: resolveKeycode('C'),
            mods: ['LEFT_CTRL'],
        })
    })

    it('raises mod-tap and layer-tap presets', () => {
        const { config } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [
                        ka('&mt', [usage('Left Shift'), usage('A')]),
                        ka('&lt', [1, usage('Space')]),
                    ],
                },
                { name: 'lower', keys: [ka('&trans', [0])] },
            ]),
            DEV,
        )
        expect(config.layers[0].bindings[0]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'modifier', modifier: 'LEFT_SHIFT' },
        })
        expect(config.layers[0].bindings[1]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'layer', layer: 'lower' },
        })
    })

    it('raises layer and system behaviors', () => {
        const { config } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [
                        ka('&mo', [1]),
                        ka('&tog', [1]),
                        ka('&bt', [1]), // BT_NXT
                        ka('&out', [0]), // OUT_TOG (0 per outputs.h)
                        ka('&trans', [0]),
                        ka('&none', [0]),
                    ],
                },
                { name: 'lower', keys: [] },
            ]),
            DEV,
        )
        const b = config.layers[0].bindings
        expect(b[0]).toEqual({
            type: 'layer',
            mode: 'momentary',
            layer: 'lower',
        })
        expect(b[1]).toEqual({ type: 'layer', mode: 'toggle', layer: 'lower' })
        expect(b[2]).toEqual({ type: 'output', action: 'bluetooth_next' })
        expect(b[3]).toEqual({ type: 'output', action: 'toggle' })
        expect(b[4]).toEqual({ type: 'transparent' })
        expect(b[5]).toEqual({ type: 'none' })
    })

    it('decodes mouse, rgb, backlight and corrected output behaviors', () => {
        const MOVE_RIGHT = 600 << 16 // pointing.h MOVE_X(600)
        const SCRL_UP = 10 // pointing.h MOVE_Y(+SCRL_VAL)
        const { config } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [
                        ka('&out', [0]), // OUT_TOG — was wrongly USB before
                        ka('&mmv', [MOVE_RIGHT]),
                        ka('&msc', [SCRL_UP]),
                        ka('&rgb_ug', [0]), // RGB_TOG
                        ka('&bl', [2]), // BL_TOG
                        ka('&bt', [3, 1]), // BT_SEL profile 1
                    ],
                },
            ]),
            DEV,
        )
        const b = config.layers[0].bindings
        expect(b[0]).toEqual({ type: 'output', action: 'toggle' })
        expect(b[1]).toEqual({ type: 'mouse_move', direction: 'right' })
        expect(b[2]).toEqual({ type: 'mouse_scroll', direction: 'up' })
        expect(b[3]).toEqual({
            type: 'lighting',
            target: 'underglow',
            action: 'toggle',
        })
        expect(b[4]).toEqual({
            type: 'lighting',
            target: 'backlight',
            action: 'toggle',
        })
        expect(b[5]).toEqual({
            type: 'output',
            action: 'bluetooth',
            profile: 1,
        })
    })

    it('decodes the enum-tail commands (OUT_NONE, BT_DISC, BL_CYCLE)', () => {
        const { config } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [
                        ka('&out', [3]), // OUT_NONE
                        ka('&bt', [5, 2]), // BT_DISC profile 2
                        ka('&bl', [5]), // BL_CYCLE
                    ],
                },
            ]),
            DEV,
        )
        const b = config.layers[0].bindings
        expect(b[0]).toEqual({ type: 'output', action: 'none' })
        expect(b[1]).toEqual({
            type: 'output',
            action: 'bluetooth_disconnect',
            profile: 2,
        })
        expect(b[2]).toEqual({
            type: 'lighting',
            target: 'backlight',
            action: 'cycle',
        })
    })

    it('degrades truly unmappable bindings to transparent with a diagnostic', () => {
        const { config, diagnostics } = zmkNeutralToConfig(
            // &kp with an undecodable usage → transparent
            keymap([{ name: 'base', keys: [ka('&kp', [0x00ffff00])] }]),
            DEV,
        )
        expect(config.layers[0].bindings[0]).toEqual({ type: 'transparent' })
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0].level).toBe('warn')
    })

    it('derives key geometry in key units (centi → units)', () => {
        const { config } = zmkNeutralToConfig(
            keymap([
                { name: 'base', keys: [ka('&trans', [0]), ka('&trans', [0])] },
            ]),
            DEV,
        )
        expect(config.keyboard.keys).toEqual([
            { x: 0, y: 0, w: 1, h: 1, r: 0 },
            { x: 1, y: 0, w: 1, h: 1, r: 0 },
        ])
        expect(config.meta.target).toBe('zmk')
    })

    it('keeps distinct layer references when device reports blank layer names', () => {
        // Three blank-named layers, each &to a different index. Regression: blank
        // names collapsed in the compiler's name→index map → all refs hit the
        // last layer. Synthesized layer_<i> names must keep them distinct.
        const { config } = zmkNeutralToConfig(
            keymap([
                { name: '', keys: [ka('&to', [1]), ka('&mo', [2])] },
                { name: '', keys: [ka('&to', [2]), ka('&trans', [0])] },
                { name: '', keys: [ka('&to', [0]), ka('&trans', [0])] },
            ]),
            DEV,
        )
        // unique, non-empty names
        const names = config.layers.map((l) => l.name)
        expect(new Set(names).size).toBe(3)
        expect(names.every((n) => n.length > 0)).toBe(true)

        // compile back to ZMK and confirm the &to targets are 1, 2, 0 (not all 2)
        const keymapFile = String(
            getCompiler('zmk')
                .compile(config)
                .files.find((f) => f.filename.endsWith('.keymap'))!.content,
        )
        expect(keymapFile).toContain('&to 1')
        expect(keymapFile).toContain('&to 2')
        expect(keymapFile).toContain('&to 0')
        expect(keymapFile).toContain('&mo 2')
    })

    it('preserves custom-behavior references as macro stubs', () => {
        const { config, diagnostics } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [
                        ka('&m_hello', [0], 'm_hello'), // zero-param macro
                        ka('&m_param', [usage('C')], 'm_param'), // one-param macro
                        ka('&td_xyz', [0], 'td_xyz'), // tap-dance → macro stub
                    ],
                },
            ]),
            DEV,
        )
        const b = config.layers[0].bindings
        expect(b[0]).toEqual({ type: 'macro', ref: 'm_hello' })
        expect(b[1]).toEqual({
            type: 'macro',
            ref: 'm_param',
            param: resolveKeycode('C'),
        })
        expect(b[2]).toEqual({ type: 'macro', ref: 'td_xyz' })
        // a stub definition exists for each, so the config validates
        expect(config.macros?.map((m) => m.id).sort()).toEqual([
            'm_hello',
            'm_param',
            'td_xyz',
        ])
        expect(config.macros?.find((m) => m.id === 'm_param')?.params).toBe(1)
        expect(diagnostics.length).toBe(3)

        // round-trips through validation, and compiles to refs + stub nodes
        const reparsed = parseKeymap(serializeKeymap(config))
        expect(reparsed.macros).toHaveLength(3)
        const keymapFile = String(
            getCompiler('zmk')
                .compile(reparsed)
                .files.find((f) => f.filename.endsWith('.keymap'))!.content,
        )
        expect(keymapFile).toContain('&m_hello')
        expect(keymapFile).toContain('&m_param C')
        expect(keymapFile).toContain('&td_xyz')
        expect(keymapFile).toContain('TODO: stub')
    })

    it('keeps a standard behavior with an unmappable command transparent, not a stub', () => {
        // RGB_COLOR_HSB (cmd 14) has no canonical lighting action. It must
        // degrade to transparent — never become a fake macro stub node.
        const { config } = zmkNeutralToConfig(
            keymap([
                { name: 'base', keys: [ka('&rgb_ug', [14], 'RGB Underglow')] },
            ]),
            DEV,
        )
        expect(config.layers[0].bindings[0]).toEqual({ type: 'transparent' })
        expect(config.macros).toBeUndefined()
    })

    it('round-trips through serialize → parseKeymap', () => {
        const { config } = zmkNeutralToConfig(
            keymap([
                {
                    name: 'base',
                    keys: [ka('&kp', [usage('A')]), ka('&mo', [1])],
                },
                { name: 'lower', keys: [ka('&trans', [0]), ka('&trans', [0])] },
            ]),
            DEV,
        )
        const reparsed = parseKeymap(serializeKeymap(config))
        expect(reparsed.layers[0].bindings[0]).toMatchObject({
            type: 'key_press',
        })
        expect(reparsed.meta.target).toBe('zmk')
    })
})
