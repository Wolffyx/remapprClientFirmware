// Pattern check: no GoF pattern (-) — rejected — lower/raise are pure mapping
// transforms between the canonical config and the mock runtime model; a single
// concrete mapping (not a swappable family), no abstraction warranted.
//
// Bridges the remappr config (source of truth) and the MOCK runtime keymap.
//   • lowerConfigToMock — config → runtime KeyActions, so the demo editor renders
//     the config's bindings. The runtime models only 6 kinds, so rich config
//     features (lighting / output / macros / tap-dance / caps-word / …) lower to
//     `transparent` + a `warn` — they survive only in the config.
//   • raiseMockToConfig — runtime → config, MERGING into the previous config so
//     those lossy, config-only features are preserved at positions the user did
//     not change. A representable runtime edit (a key, a mod-tap, a layer-tap)
//     wins; a `transparent` over a rich prior binding keeps the rich binding.
// This bridge is mock-specific by design; real adapters get their own per-
// firmware ActionType-slot converters later.

import type {
    CanonAction,
    CanonHoldTarget,
    CanonKeyPress,
    ConfigKeymap,
    Modifier,
} from '@firmware/config'
import { DiagnosticBag, type Diagnostic } from '@firmware/config'
import type { KeyAction, Layer, PhysicalLayout } from '@firmware/types'
import {
    buildMockKeyAction,
    HID_KP,
    MOCK_KIND_KEYPRESS,
    MOCK_KIND_LAYER_MOMENTARY,
    MOCK_KIND_LAYER_TAP,
    MOCK_KIND_LAYER_TOGGLE,
    MOCK_KIND_MOD_TAP,
    MOCK_KIND_TRANSPARENT,
} from './actions'
import { mockCodec } from './codec'

/** Left/right modifier → bare HID usage id (encoded with HID_KP at use sites). */
const MOD_HID: Record<Modifier, number> = {
    LEFT_CTRL: 0xe0,
    LEFT_SHIFT: 0xe1,
    LEFT_ALT: 0xe2,
    LEFT_GUI: 0xe3,
    RIGHT_CTRL: 0xe4,
    RIGHT_SHIFT: 0xe5,
    RIGHT_ALT: 0xe6,
    RIGHT_GUI: 0xe7,
}
const HID_TO_MOD = new Map<number, Modifier>(
    (Object.entries(MOD_HID) as [Modifier, number][]).map(([m, id]) => [id, m]),
)

/** Config action types the runtime cannot represent — preserved across a raise. */
const NON_REPRESENTABLE = new Set<CanonAction['type']>([
    'sticky_key',
    'caps_word',
    'none',
    'output',
    'lighting',
    'bootloader',
    'reset',
    'macro',
    'tap_dance',
])

const isNonRepresentable = (a: CanonAction | undefined): boolean =>
    !!a &&
    (NON_REPRESENTABLE.has(a.type) ||
        // layer 'to'/'sticky' have no runtime kind either.
        (a.type === 'layer' && (a.mode === 'to' || a.mode === 'sticky')))

/* ── lower: config → runtime ───────────────────────────────────────────── */

export interface LowerResult {
    /** Runtime layers (name + KeyActions), index-aligned with config.layers. */
    layers: { name: string; keys: KeyAction[] }[]
    diagnostics: Diagnostic[]
}

/** Lower a canonical config into mock runtime layers (the demo editing buffer). */
export function lowerConfigToMock(config: ConfigKeymap): LowerResult {
    const diag = new DiagnosticBag()
    const names = config.layers.map((l) => l.name)
    const layerIndexOf = (name: string, path: (string | number)[]): number => {
        const i = names.indexOf(name)
        if (i < 0) {
            diag.warn(`unknown layer "${name}"; defaulted to 0`, path)
            return 0
        }
        return i
    }

    const encode = (id: string, path: (string | number)[]): number | null => {
        const enc = mockCodec.encode(id)
        if (!enc) {
            diag.warn(
                `keycode "${id}" not encodable for the demo runtime`,
                path,
            )
            return null
        }
        return enc.value
    }

    const transparent = (): KeyAction =>
        buildMockKeyAction(MOCK_KIND_TRANSPARENT, [], names)

    const lowerAction = (
        a: CanonAction,
        path: (string | number)[],
    ): KeyAction => {
        switch (a.type) {
            case 'key_press': {
                if (a.mods?.length) {
                    diag.warn(
                        'modifiers on a keypress are dropped (the demo runtime has no modified keypress)',
                        path,
                    )
                }
                const v = encode(a.key, path)
                return v === null
                    ? transparent()
                    : buildMockKeyAction(MOCK_KIND_KEYPRESS, [v], names)
            }
            case 'tap_hold': {
                const tap = encode(a.tap.key, path)
                if (tap === null) return transparent()
                if (a.hold.type === 'modifier') {
                    return buildMockKeyAction(
                        MOCK_KIND_MOD_TAP,
                        [tap, HID_KP(MOD_HID[a.hold.modifier])],
                        names,
                    )
                }
                return buildMockKeyAction(
                    MOCK_KIND_LAYER_TAP,
                    [tap, layerIndexOf(a.hold.layer, path)],
                    names,
                )
            }
            case 'layer': {
                if (a.mode === 'momentary') {
                    return buildMockKeyAction(
                        MOCK_KIND_LAYER_MOMENTARY,
                        [layerIndexOf(a.layer, path)],
                        names,
                    )
                }
                if (a.mode === 'toggle') {
                    return buildMockKeyAction(
                        MOCK_KIND_LAYER_TOGGLE,
                        [layerIndexOf(a.layer, path)],
                        names,
                    )
                }
                diag.warn(
                    `layer mode "${a.mode}" is not representable in the demo runtime; shown as transparent`,
                    path,
                )
                return transparent()
            }
            case 'transparent':
                return transparent()
            default:
                diag.warn(
                    `"${a.type}" is not representable in the demo runtime; shown as transparent (preserved in config)`,
                    path,
                )
                return transparent()
        }
    }

    const layers = config.layers.map((layer, li) => ({
        name: layer.name,
        keys: layer.bindings.map((b, bi) =>
            lowerAction(b, ['layers', li, 'bindings', bi]),
        ),
    }))

    return { layers, diagnostics: [...diag.all] }
}

/* ── raise: runtime → config (merged) ──────────────────────────────────── */

const keyPress = (key: string): CanonKeyPress => ({ type: 'key_press', key })

/** Raise one runtime KeyAction to a canonical action, or `null` if unrecognized. */
function raiseAction(ka: KeyAction, layerNames: string[]): CanonAction | null {
    switch (ka.kind) {
        case MOCK_KIND_TRANSPARENT:
            return { type: 'transparent' }
        case MOCK_KIND_KEYPRESS: {
            const id = mockCodec.decode(ka.params[0] ?? 0)
            return id ? keyPress(id.canonicalId) : { type: 'transparent' }
        }
        case MOCK_KIND_MOD_TAP: {
            const id = mockCodec.decode(ka.params[0] ?? 0)
            const mod = HID_TO_MOD.get((ka.params[1] ?? 0) & 0xff)
            if (!id || !mod) return { type: 'transparent' }
            const hold: CanonHoldTarget = { type: 'modifier', modifier: mod }
            return {
                type: 'tap_hold',
                tap: keyPress(id.canonicalId),
                hold,
                _preset: 'mod_tap',
            }
        }
        case MOCK_KIND_LAYER_TAP: {
            const id = mockCodec.decode(ka.params[0] ?? 0)
            const layer = layerNames[ka.params[1] ?? 0]
            if (!id || layer === undefined) return { type: 'transparent' }
            return {
                type: 'tap_hold',
                tap: keyPress(id.canonicalId),
                hold: { type: 'layer', layer },
                _preset: 'layer_tap',
            }
        }
        case MOCK_KIND_LAYER_MOMENTARY: {
            const layer = layerNames[ka.params[0] ?? 0]
            return layer === undefined
                ? { type: 'transparent' }
                : { type: 'layer', mode: 'momentary', layer }
        }
        case MOCK_KIND_LAYER_TOGGLE: {
            const layer = layerNames[ka.params[0] ?? 0]
            return layer === undefined
                ? { type: 'transparent' }
                : { type: 'layer', mode: 'toggle', layer }
        }
        default:
            return null
    }
}

/**
 * Raise runtime layers back into the config, merging onto `prevConfig`: a
 * representable runtime binding wins; a `transparent` over a rich, non-
 * representable prior binding keeps the prior (so a key edit can't silently wipe
 * a lighting/macro/tap-dance binding the runtime never modeled). Config-level
 * data (combos, macros, tap-dances, geometry, per-layer encoders) is preserved.
 */
export function raiseMockToConfig(
    runtimeLayers: readonly Pick<Layer, 'name' | 'keys'>[],
    prevConfig: ConfigKeymap,
): ConfigKeymap {
    const layerNames = runtimeLayers.map((l) => l.name)

    const layers = runtimeLayers.map((rl, li) => {
        const prevLayer = prevConfig.layers[li]
        const bindings = rl.keys.map((ka, bi) => {
            const raised = raiseAction(ka, layerNames)
            const prev = prevLayer?.bindings[bi]
            // Unrecognized kind, or transparent over a rich prior → keep prior.
            if (raised === null) return prev ?? { type: 'transparent' }
            if (raised.type === 'transparent' && isNonRepresentable(prev)) {
                return prev as CanonAction
            }
            return raised
        })
        return {
            name: rl.name,
            ...(prevLayer?.description
                ? { description: prevLayer.description }
                : {}),
            bindings,
            ...(prevLayer?.encoders ? { encoders: prevLayer.encoders } : {}),
        }
    })

    return { ...prevConfig, layers }
}

/* ── geometry: config → runtime physical layout ────────────────────────── */

/**
 * Lower the config's canonical geometry (units, degrees) into a runtime
 * PhysicalLayout (centi-units, centi-degrees) so a mock service seeded from a
 * builder board renders that board's shape in the editor instead of the static
 * Corne demo. The key order matches `config.keyboard.keys` (and thus each
 * layer's bindings), so position indices line up across the bridge.
 */
export function configToPhysicalLayout(config: ConfigKeymap): PhysicalLayout {
    const U = 100
    const keys = config.keyboard.keys.map((k) => ({
        x: Math.round(k.x * U),
        y: Math.round(k.y * U),
        w: Math.round((k.w || 1) * U),
        h: Math.round((k.h || 1) * U),
        ...(k.r ? { r: Math.round(k.r * U) } : {}),
        ...(k.rx !== undefined ? { rx: Math.round(k.rx * U) } : {}),
        ...(k.ry !== undefined ? { ry: Math.round(k.ry * U) } : {}),
    }))
    return { id: 0, name: config.meta.name || 'Custom', keys }
}
