// Pattern check: no GoF pattern (-) — rejected — lower/raise are pure mapping
// transforms between the canonical Remappr config (source of truth) and the
// neutral editor runtime; a single concrete mapping, not a swappable family.
//
// Bridges the decoded Remappr config and the neutral editing runtime:
//   • lowerConfigToNeutral — config → runtime KeyActions so the editor renders
//     the live keymap. The runtime models only six kinds; rich canonical actions
//     (lighting / output / macros / tap-dance / mod-morph / modded key_press / …)
//     lower to `transparent` for display + a `warn`. They survive in the config.
//   • raiseNeutralToConfig — runtime → config, MERGING onto the previous config.
//     A binding the user did NOT change (its neutral form equals the lowering of
//     the prior canonical binding) keeps the prior binding verbatim, so a key
//     edit elsewhere can't silently strip a Ctrl+C / lighting / macro the runtime
//     never modeled. Only positions the user actually retyped are re-raised.
import type {
    CanonAction,
    CanonHoldTarget,
    CanonKeyPress,
    ConfigKeymap,
    Modifier,
} from '../config'
import { DiagnosticBag, type Diagnostic } from '../config'
import type { KeyAction, Layer } from '../types'
import {
    buildRemapprKeyAction,
    HID_KP,
    REMAPPR_KIND_KEYPRESS,
    REMAPPR_KIND_LAYER_MOMENTARY,
    REMAPPR_KIND_LAYER_TAP,
    REMAPPR_KIND_LAYER_TOGGLE,
    REMAPPR_KIND_MACRO,
    REMAPPR_KIND_MOD_MORPH,
    REMAPPR_KIND_MOD_TAP,
    REMAPPR_KIND_TAP_DANCE,
    REMAPPR_KIND_TRANSPARENT,
} from './actions'
import { remapprCodec } from './codec'

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
const MOD_LABEL: Record<Modifier, string> = {
    LEFT_CTRL: 'Ctrl',
    LEFT_SHIFT: 'Shift',
    LEFT_ALT: 'Alt',
    LEFT_GUI: 'Gui',
    RIGHT_CTRL: 'RCtrl',
    RIGHT_SHIFT: 'RShift',
    RIGHT_ALT: 'RAlt',
    RIGHT_GUI: 'RGui',
}

const transparent = (): KeyAction =>
    buildRemapprKeyAction(REMAPPR_KIND_TRANSPARENT, [])

/** Composite pools (id-only) used to resolve a macro/tap-dance/mod-morph `ref`
 *  to its pool index for the display KeyAction (§24). */
interface CompositePools {
    macros: { id: string }[]
    tapDances: { id: string }[]
    modMorphs: { id: string }[]
}

const poolsOf = (config: ConfigKeymap): CompositePools => ({
    macros: config.macros ?? [],
    tapDances: config.tapDances ?? [],
    modMorphs: config.modMorphs ?? [],
})

/** Lower a single canonical action to a neutral KeyAction (pure; `diag`/`path`
 *  optional so the merge step can lower without emitting warnings). */
function lowerAction(
    a: CanonAction,
    layerNames: string[],
    pools: CompositePools,
    diag?: DiagnosticBag,
    path: (string | number)[] = [],
): KeyAction {
    const warn = (m: string): void => diag?.warn(m, path)
    const layerIndexOf = (name: string): number => {
        const i = layerNames.indexOf(name)
        if (i < 0) {
            warn(`unknown layer "${name}"; defaulted to 0`)
            return 0
        }
        return i
    }
    const encode = (id: string): number | null => {
        const enc = remapprCodec.encode(id)
        if (!enc) {
            warn(`keycode "${id}" is not HID-encodable for the editor runtime`)
            return null
        }
        return enc.value
    }

    switch (a.type) {
        case 'key_press': {
            const v = encode(a.key)
            if (v === null) return transparent()
            const modifiers = a.mods?.length
                ? a.mods.map((m) => MOD_LABEL[m]).join('+')
                : undefined
            return buildRemapprKeyAction(
                REMAPPR_KIND_KEYPRESS,
                [v],
                layerNames,
                modifiers,
            )
        }
        case 'tap_hold': {
            const tap = encode(a.tap.key)
            if (tap === null) return transparent()
            if (a.hold.type === 'modifier') {
                return buildRemapprKeyAction(
                    REMAPPR_KIND_MOD_TAP,
                    [tap, HID_KP(MOD_HID[a.hold.modifier])],
                    layerNames,
                )
            }
            return buildRemapprKeyAction(
                REMAPPR_KIND_LAYER_TAP,
                [tap, layerIndexOf(a.hold.layer)],
                layerNames,
            )
        }
        case 'layer': {
            if (a.mode === 'momentary') {
                return buildRemapprKeyAction(
                    REMAPPR_KIND_LAYER_MOMENTARY,
                    [layerIndexOf(a.layer)],
                    layerNames,
                )
            }
            if (a.mode === 'toggle') {
                return buildRemapprKeyAction(
                    REMAPPR_KIND_LAYER_TOGGLE,
                    [layerIndexOf(a.layer)],
                    layerNames,
                )
            }
            warn(
                `layer mode "${a.mode}" is not representable in the editor runtime; shown as transparent`,
            )
            return transparent()
        }
        case 'macro':
            return composite(REMAPPR_KIND_MACRO, pools.macros, a.ref)
        case 'tap_dance':
            return composite(REMAPPR_KIND_TAP_DANCE, pools.tapDances, a.ref)
        case 'mod_morph':
            return composite(REMAPPR_KIND_MOD_MORPH, pools.modMorphs, a.ref)
        case 'transparent':
            return transparent()
        default:
            warn(
                `"${a.type}" is not representable in the editor runtime; shown as transparent (preserved in config)`,
            )
            return transparent()
    }
}

// A composite reference (§24): params[0] = pool index, displayName = the real
// name (= the ref id) so the key renders "Macro: macro_hi" instead of blank.
function composite(
    kind: string,
    pool: { id: string }[],
    ref: string,
): KeyAction {
    const idx = pool.findIndex((p) => p.id === ref)
    return buildRemapprKeyAction(kind, [idx < 0 ? 0 : idx], [], undefined, ref)
}

/* ── lower: config → runtime ───────────────────────────────────────────── */

export interface LowerResult {
    /** Runtime layers (name + KeyActions), index-aligned with config.layers. */
    layers: { name: string; keys: KeyAction[] }[]
    diagnostics: Diagnostic[]
}

/** Lower a decoded config into neutral runtime layers (the editing buffer). */
export function lowerConfigToNeutral(config: ConfigKeymap): LowerResult {
    const diag = new DiagnosticBag()
    const names = config.layers.map((l) => l.name)
    const pools = poolsOf(config)
    const layers = config.layers.map((layer, li) => ({
        name: layer.name,
        keys: layer.bindings.map((b, bi) =>
            lowerAction(b, names, pools, diag, ['layers', li, 'bindings', bi]),
        ),
    }))
    return { layers, diagnostics: [...diag.all] }
}

/* ── raise: runtime → config (merged) ──────────────────────────────────── */

const keyPress = (key: string): CanonKeyPress => ({ type: 'key_press', key })

/** Raise one runtime KeyAction to a canonical action, or `null` if unrecognized. */
function raiseAction(
    ka: KeyAction,
    layerNames: string[],
    pools: CompositePools,
): CanonAction | null {
    switch (ka.kind) {
        case REMAPPR_KIND_TRANSPARENT:
            return { type: 'transparent' }
        case REMAPPR_KIND_KEYPRESS: {
            const id = remapprCodec.decode(ka.params[0] ?? 0)
            return id ? keyPress(id.canonicalId) : { type: 'transparent' }
        }
        case REMAPPR_KIND_MOD_TAP: {
            const id = remapprCodec.decode(ka.params[0] ?? 0)
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
        case REMAPPR_KIND_LAYER_TAP: {
            const id = remapprCodec.decode(ka.params[0] ?? 0)
            const layer = layerNames[ka.params[1] ?? 0]
            if (!id || layer === undefined) return { type: 'transparent' }
            return {
                type: 'tap_hold',
                tap: keyPress(id.canonicalId),
                hold: { type: 'layer', layer },
                _preset: 'layer_tap',
            }
        }
        case REMAPPR_KIND_LAYER_MOMENTARY: {
            const layer = layerNames[ka.params[0] ?? 0]
            return layer === undefined
                ? { type: 'transparent' }
                : { type: 'layer', mode: 'momentary', layer }
        }
        case REMAPPR_KIND_LAYER_TOGGLE: {
            const layer = layerNames[ka.params[0] ?? 0]
            return layer === undefined
                ? { type: 'transparent' }
                : { type: 'layer', mode: 'toggle', layer }
        }
        // Composite references (§24): map the pool index in params[0] back to its
        // canonical ref — the inverse of lowerAction's composite(). An out-of-range
        // index returns null so the merge keeps the prior binding (never wipes it).
        case REMAPPR_KIND_MACRO: {
            const ref = pools.macros[ka.params[0] ?? 0]?.id
            return ref ? { type: 'macro', ref } : null
        }
        case REMAPPR_KIND_TAP_DANCE: {
            const ref = pools.tapDances[ka.params[0] ?? 0]?.id
            return ref ? { type: 'tap_dance', ref } : null
        }
        case REMAPPR_KIND_MOD_MORPH: {
            const ref = pools.modMorphs[ka.params[0] ?? 0]?.id
            return ref ? { type: 'mod_morph', ref } : null
        }
        default:
            return null
    }
}

/** Representable-form equality: same kind + params (labels/modifiers ignored). */
function sameRuntimeForm(a: KeyAction, b: KeyAction): boolean {
    if (a.kind !== b.kind || a.params.length !== b.params.length) return false
    for (let i = 0; i < a.params.length; i++) {
        if (a.params[i] !== b.params[i]) return false
    }
    return true
}

/**
 * Raise runtime layers back into the config, merging onto `prevConfig`. For each
 * position: if the neutral binding still equals the lowering of the prior
 * canonical binding, the user did not touch it → keep the prior binding verbatim
 * (so Ctrl+C / lighting / macros / tap-dance the runtime can't model are not
 * wiped by an edit elsewhere). Otherwise raise the neutral binding. Config-level
 * data (combos, macros, tap-dances, mod-morphs, conditional layers) is preserved.
 */
export function raiseNeutralToConfig(
    runtimeLayers: readonly Pick<Layer, 'name' | 'keys'>[],
    prevConfig: ConfigKeymap,
): ConfigKeymap {
    const layerNames = runtimeLayers.map((l) => l.name)
    const prevPools = poolsOf(prevConfig)

    const layers = runtimeLayers.map((rl, li) => {
        const prevLayer = prevConfig.layers[li]
        const bindings = rl.keys.map((ka, bi) => {
            const prev = prevLayer?.bindings[bi]
            if (prev && sameRuntimeForm(ka, lowerAction(prev, layerNames, prevPools))) {
                return prev
            }
            const raised = raiseAction(ka, layerNames, prevPools)
            return raised ?? prev ?? { type: 'transparent' }
        })
        return {
            name: rl.name,
            ...(prevLayer?.description
                ? { description: prevLayer.description }
                : {}),
            bindings,
            ...(prevLayer?.encoders ? { encoders: prevLayer.encoders } : {}),
            ...(prevLayer?.encoderBindings
                ? { encoderBindings: prevLayer.encoderBindings }
                : {}),
            ...(prevLayer?.sliderBindings
                ? { sliderBindings: prevLayer.sliderBindings }
                : {}),
        }
    })

    return { ...prevConfig, layers }
}
