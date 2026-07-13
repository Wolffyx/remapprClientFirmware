// Pattern check: no GoF pattern (-) — rejected — canonical→surface denormalization + JSON emit; pure transformation, no abstraction.
//
// Re-saves a canonical ConfigKeymap as friendly JSON. Defaults to the compact,
// reads-like-English surface form (bare-string keys, "Ctrl+C" combos, presets,
// friendly keycode names). Per-binding override: if the user originally wrote a
// canonical id (or any alias) it is preserved via `_keySrc`. Top-level + object
// key order is fixed so re-saves are stable diffs.

import { friendlyName, resolveKeycode, type Modifier } from './keycodes'
import {
    cloneController,
    cloneFirmwareConfig,
    cloneHardware,
    cloneLighting,
    cloneVial,
    parseKeymap,
} from './normalize'
import { type TargetDefaults, resolveDefaults } from './defaults'
import { migrateToV2 } from './migrate'
import type {
    CanonAction,
    CanonEncoderBinding,
    CanonSliderBinding,
    CanonHoldTarget,
    CanonKeyPress,
    CanonMacroStep,
    ConfigKeymap,
} from './types'

// The defaults to strip against for the current serialize pass. tap_hold timings
// are target-dependent (see defaults.ts), and denormalizeAction is called deep
// inside the tree (layers, encoders, combos, …) — threading the target through
// every call is noise, so toSurfaceObject sets this once at the top. Safe because
// serialize is fully synchronous (no await) and single-threaded: one pass owns it
// start-to-finish. External callers (e.g. the inspector) get the universal base.
let activeDefaults: TargetDefaults = resolveDefaults(null)

const FRIENDLY_MOD: Record<Modifier, string> = {
    LEFT_CTRL: 'Ctrl',
    LEFT_SHIFT: 'Shift',
    LEFT_ALT: 'Alt',
    LEFT_GUI: 'Gui',
    RIGHT_CTRL: 'RCtrl',
    RIGHT_SHIFT: 'RShift',
    RIGHT_ALT: 'RAlt',
    RIGHT_GUI: 'RGui',
}

// Preserve the user's spelling when it still resolves to the same key; else friendly.
const keyToken = (id: string, src?: string): string =>
    src && resolveKeycode(src) === id ? src : friendlyName(id)

type Surface = string | Record<string, unknown>

function denormalizeKeyPress(kp: CanonKeyPress): Surface {
    const token = keyToken(kp.key, kp._keySrc)
    if (kp.mods?.length) {
        return [...kp.mods.map((m) => FRIENDLY_MOD[m]), token].join('+')
    }
    return token
}

const denormalizeHold = (h: CanonHoldTarget): Record<string, unknown> =>
    h.type === 'modifier'
        ? { type: 'modifier', modifier: h.modifier }
        : { type: 'layer', layer: h.layer }

// Emit a timing only when it's set AND differs from the target default — a value
// equal to the firmware default is implied (the build re-applies it). resolve /
// flavor have no numeric default, so they round-trip whenever set.
const withTimings = (
    a: Extract<CanonAction, { type: 'tap_hold' }>,
): Record<string, unknown> => {
    const d = activeDefaults.tapHold
    return {
        ...(a.tappingTermMs !== undefined && a.tappingTermMs !== d.tappingTermMs
            ? { tappingTermMs: a.tappingTermMs }
            : {}),
        ...(a.quickTapMs !== undefined && a.quickTapMs !== d.quickTapMs
            ? { quickTapMs: a.quickTapMs }
            : {}),
        ...(a.requirePriorIdleMs
            ? { requirePriorIdleMs: a.requirePriorIdleMs }
            : {}),
        ...(a.retroTap ? { retroTap: a.retroTap } : {}),
        ...(a.holdTriggerKeyPositions?.length
            ? { holdTriggerKeyPositions: [...a.holdTriggerKeyPositions] }
            : {}),
        ...(a.holdTriggerOnRelease ? { holdTriggerOnRelease: true } : {}),
        ...(a.resolve !== undefined ? { resolve: a.resolve } : {}),
        ...(a.flavor !== undefined ? { flavor: a.flavor } : {}),
    }
}

export function denormalizeAction(a: CanonAction): Surface {
    switch (a.type) {
        case 'key_press':
            return denormalizeKeyPress(a)
        case 'tap_hold': {
            // Honor the form the user wrote: preset if they used one, else raw tap_hold.
            if (a._preset === 'mod_tap' && a.hold.type === 'modifier') {
                return {
                    type: 'mod_tap',
                    tap: denormalizeKeyPress(a.tap),
                    mod: a.hold.modifier,
                    ...withTimings(a),
                }
            }
            if (a._preset === 'layer_tap' && a.hold.type === 'layer') {
                return {
                    type: 'layer_tap',
                    tap: denormalizeKeyPress(a.tap),
                    layer: a.hold.layer,
                    ...withTimings(a),
                }
            }
            return {
                type: 'tap_hold',
                tap: denormalizeKeyPress(a.tap),
                hold: denormalizeHold(a.hold),
                ...withTimings(a),
            }
        }
        case 'layer':
            return { type: 'layer', mode: a.mode, layer: a.layer }
        case 'sticky_key':
            return { type: 'sticky_key', key: keyToken(a.key, a._keySrc) }
        case 'output':
            return {
                type: 'output',
                action: a.action,
                ...(a.profile !== undefined ? { profile: a.profile } : {}),
            }
        case 'lighting':
            return {
                type: 'lighting',
                target: a.target,
                action: a.action,
                ...(a.hue !== undefined ? { hue: a.hue } : {}),
                ...(a.saturation !== undefined
                    ? { saturation: a.saturation }
                    : {}),
                ...(a.brightness !== undefined
                    ? { brightness: a.brightness }
                    : {}),
                ...(a.level !== undefined ? { level: a.level } : {}),
            }
        case 'macro':
            return {
                type: 'macro',
                ref: a.ref,
                ...(a.param !== undefined
                    ? { param: keyToken(a.param, a._paramSrc) }
                    : {}),
            }
        case 'tap_dance':
            return { type: 'tap_dance', ref: a.ref }
        case 'mod_morph':
            return { type: 'mod_morph', ref: a.ref }
        case 'hold_tap':
            return {
                type: 'hold_tap',
                ref: a.ref,
                holdParam: a.holdParam,
                tapParam: a.tapParam,
            }
        case 'key_toggle':
            return { type: 'key_toggle', key: keyToken(a.key, a._keySrc) }
        case 'ext_power':
            return { type: 'ext_power', action: a.action }
        case 'mouse_key':
            return { type: 'mouse_key', button: a.button }
        case 'mouse_move':
            return { type: 'mouse_move', direction: a.direction }
        case 'mouse_scroll':
            return { type: 'mouse_scroll', direction: a.direction }
        // pattern-check: skip — canonical→surface mapping cases for §5.2 kinds
        case 'auto_shift':
            return {
                type: 'auto_shift',
                key: keyToken(a.key, a._keySrc),
                mods: [...a.mods],
            }
        case 'layer_mod':
            return { type: 'layer_mod', layer: a.layer, mods: [...a.mods] }
        case 'tap_toggle':
            return { type: 'tap_toggle', layer: a.layer }
        case 'set_base_saved':
            return { type: 'set_base_saved', layer: a.layer }
        case 'auto_layer':
            return { type: 'auto_layer', layer: a.layer }
        case 'gui_lock':
            return { type: 'gui_lock', action: a.action }
        case 'secure':
            return { type: 'secure', action: a.action }
        case 'autocorrect':
            return { type: 'autocorrect', action: a.action }
        case 'tune_tap_term':
            return { type: 'tune_tap_term', ms: a.ms }
        case 'unicode':
            return { type: 'unicode', codepoint: a.codepoint }
        case 'macro_record':
            return { type: 'macro_record', slot: a.slot }
        case 'macro_play':
            return { type: 'macro_play', slot: a.slot }
        case 'leader':
            return {
                type: 'leader',
                ...(a.windowMs !== undefined ? { windowMs: a.windowMs } : {}),
            }
        case 'peripheral':
            return { type: 'peripheral', kind: a.kind, code: a.code }
        default:
            // soft_off | studio_unlock | grave_escape | key_repeat | caps_word |
            // transparent | none | bootloader | reset | alt_repeat | layer_lock
            return { type: a.type }
    }
}

const denormalizeEncoder = (
    e: CanonEncoderBinding,
): Record<string, unknown> => ({
    cw: denormalizeAction(e.cw),
    ccw: denormalizeAction(e.ccw),
    ...(e.press ? { press: denormalizeAction(e.press) } : {}),
})

const denormalizeSlider = (s: CanonSliderBinding): Record<string, unknown> => ({
    map: s.map,
    ...(s.min !== undefined ? { min: s.min } : {}),
    ...(s.max !== undefined ? { max: s.max } : {}),
    ...(s.action ? { action: denormalizeAction(s.action) } : {}),
})

const denormalizeMacroStep = (s: CanonMacroStep): Record<string, unknown> => {
    if (s.type === 'wait') return { type: 'wait', ms: s.ms }
    if (s.type === 'text') return { type: 'text', text: s.text }
    if (s.type === 'tap_time') return { type: 'tap_time', ms: s.ms }
    if (s.type === 'param')
        return {
            type: 'param',
            ...(s.from !== undefined ? { from: s.from } : {}),
            ...(s.to !== undefined ? { to: s.to } : {}),
        }
    if (s.type === 'pause_for_release') return { type: s.type }
    return { type: s.type, key: keyToken(s.key, s._keySrc) }
}

// pattern-check: skip — pure trailing-slice of default elements, no abstraction
/** Drop trailing transparent bindings: they are the implicit pad value, so a
 *  layer that only sets its first N keys serializes to just those N (normalize
 *  re-fills the rest). Keeps middle transparents — positions must stay aligned. */
function trimTrailingTransparent(bindings: CanonAction[]): CanonAction[] {
    let end = bindings.length
    while (end > 0 && bindings[end - 1].type === 'transparent') end--
    return bindings.slice(0, end)
}

// pattern-check: skip — geometry default-strip is inline comparison vs defaults table
/** Build the plain (surface-shaped) object that gets JSON-stringified. */
export function toSurfaceObject(km: ConfigKeymap): Record<string, unknown> {
    // Resolve target defaults once for this pass; withTimings reads them.
    activeDefaults = resolveDefaults(km.meta.target)
    const g = activeDefaults.geometry
    return {
        schemaVersion: km.schemaVersion,
        kind: km.kind,
        meta: {
            name: km.meta.name,
            ...(km.meta.author ? { author: km.meta.author } : {}),
            ...(km.meta.version ? { version: km.meta.version } : {}),
            ...(km.meta.description
                ? { description: km.meta.description }
                : {}),
            target: km.meta.target,
            ...(km.meta.vendorId ? { vendorId: km.meta.vendorId } : {}),
            ...(km.meta.productId ? { productId: km.meta.productId } : {}),
        },
        ...(km.defaults ? { defaults: km.defaults } : {}),
        keyboard: {
            id: km.keyboard.id,
            name: km.keyboard.name,
            // Geometry: omit every field at its default (x/y/w/h/r) — normalize
            // re-fills them. Keyboard-specific markers (rx/ry/variant/pin/
            // element) stay visible whenever set; they are board structure, not
            // strippable defaults.
            keys: km.keyboard.keys.map((k) => ({
                ...(k.x !== g.x ? { x: k.x } : {}),
                ...(k.y !== g.y ? { y: k.y } : {}),
                ...(k.w !== g.w ? { w: k.w } : {}),
                ...(k.h !== g.h ? { h: k.h } : {}),
                ...(k.r !== g.r ? { r: k.r } : {}),
                ...(k.rx !== undefined ? { rx: k.rx } : {}),
                ...(k.ry !== undefined ? { ry: k.ry } : {}),
                ...(k.matrix ? { matrix: [k.matrix[0], k.matrix[1]] } : {}),
                ...(k.variant ? { variant: k.variant } : {}),
                ...(k.pin ? { pin: k.pin } : {}),
                ...(k.element ? { element: k.element } : {}),
                ...(k.option ? { option: [k.option[0], k.option[1]] } : {}),
            })),
            ...(km.keyboard.encoders
                ? {
                      encoders: km.keyboard.encoders.map((e) => ({
                          x: e.x,
                          y: e.y,
                      })),
                  }
                : {}),
            ...(km.keyboard.matrix
                ? { matrix: { ...km.keyboard.matrix } }
                : {}),
            ...(km.keyboard.controller
                ? { controller: cloneController(km.keyboard.controller) }
                : {}),
            ...(km.keyboard.vial ? { vial: cloneVial(km.keyboard.vial) } : {}),
            // hardware is already canonical (no surface sugar) — emit it as-is
            // with stable key order via the same clone normalize uses.
            ...(km.keyboard.hardware
                ? { hardware: cloneHardware(km.keyboard.hardware) }
                : {}),
            ...(km.keyboard.pins
                ? {
                      pins: {
                          rows: [...km.keyboard.pins.rows],
                          cols: [...km.keyboard.pins.cols],
                      },
                  }
                : {}),
            ...(km.keyboard.firmware
                ? { firmware: [...km.keyboard.firmware] }
                : {}),
            ...(km.keyboard.lighting
                ? { lighting: cloneLighting(km.keyboard.lighting) }
                : {}),
            ...(km.keyboard.firmwareConfig
                ? {
                      firmwareConfig: cloneFirmwareConfig(
                          km.keyboard.firmwareConfig,
                      ),
                  }
                : {}),
            ...(km.keyboard.layouts
                ? { layouts: km.keyboard.layouts.map((l) => ({ ...l })) }
                : {}),
            ...(km.keyboard.layoutOptions
                ? {
                      layoutOptions: km.keyboard.layoutOptions.map((o) => ({
                          label: o.label,
                          ...(o.choices ? { choices: [...o.choices] } : {}),
                      })),
                  }
                : {}),
            ...(km.keyboard.split !== undefined
                ? { split: km.keyboard.split }
                : {}),
        },
        layers: km.layers.map((l) => ({
            name: l.name,
            ...(l.description ? { description: l.description } : {}),
            bindings: trimTrailingTransparent(l.bindings).map(
                denormalizeAction,
            ),
            ...(l.encoders
                ? { encoders: l.encoders.map(denormalizeEncoder) }
                : {}),
            ...(l.encoderBindings && Object.keys(l.encoderBindings).length
                ? {
                      encoderBindings: Object.fromEntries(
                          Object.entries(l.encoderBindings).map(([k, e]) => [
                              k,
                              denormalizeEncoder(e),
                          ]),
                      ),
                  }
                : {}),
            ...(l.sliderBindings && Object.keys(l.sliderBindings).length
                ? {
                      sliderBindings: Object.fromEntries(
                          Object.entries(l.sliderBindings).map(([k, s]) => [
                              k,
                              denormalizeSlider(s),
                          ]),
                      ),
                  }
                : {}),
        })),
        ...(km.combos
            ? {
                  combos: km.combos.map((c) => ({
                      name: c.name,
                      keys: c.keys,
                      action: denormalizeAction(c.action),
                      ...(c.timeoutMs !== undefined
                          ? { timeoutMs: c.timeoutMs }
                          : {}),
                      ...(c.layers ? { layers: c.layers } : {}),
                  })),
              }
            : {}),
        ...(km.tapDances
            ? {
                  tapDances: km.tapDances.map((t) => ({
                      id: t.id,
                      ...(t.description ? { description: t.description } : {}),
                      ...(t.tappingTermMs !== undefined
                          ? { tappingTermMs: t.tappingTermMs }
                          : {}),
                      taps: t.taps.map((tap) => ({
                          count: tap.count,
                          action: denormalizeAction(tap.action),
                      })),
                      ...(t.hold ? { hold: denormalizeHold(t.hold) } : {}),
                  })),
              }
            : {}),
        ...(km.macros
            ? {
                  macros: km.macros.map((m) => ({
                      id: m.id,
                      ...(m.description ? { description: m.description } : {}),
                      ...(m.params !== undefined ? { params: m.params } : {}),
                      steps: m.steps.map(denormalizeMacroStep),
                  })),
              }
            : {}),
        ...(km.modMorphs
            ? {
                  modMorphs: km.modMorphs.map((mm) => ({
                      id: mm.id,
                      ...(mm.description
                          ? { description: mm.description }
                          : {}),
                      mods: [...mm.mods],
                      ...(mm.keepMods ? { keepMods: [...mm.keepMods] } : {}),
                      bindings: [
                          denormalizeAction(mm.bindings[0]),
                          denormalizeAction(mm.bindings[1]),
                      ],
                  })),
              }
            : {}),
        // pattern-check: skip — holdTaps passthrough, mirror of normalize.ts
        ...(km.holdTaps
            ? {
                  holdTaps: km.holdTaps.map((h) => ({
                      id: h.id,
                      ...(h.description ? { description: h.description } : {}),
                      ...(h.flavor ? { flavor: h.flavor } : {}),
                      ...(h.tappingTermMs !== undefined
                          ? { tappingTermMs: h.tappingTermMs }
                          : {}),
                      ...(h.quickTapMs !== undefined
                          ? { quickTapMs: h.quickTapMs }
                          : {}),
                      ...(h.requirePriorIdleMs !== undefined
                          ? { requirePriorIdleMs: h.requirePriorIdleMs }
                          : {}),
                      ...(h.holdTriggerKeyPositions
                          ? {
                                holdTriggerKeyPositions:
                                    h.holdTriggerKeyPositions,
                            }
                          : {}),
                      ...(h.holdTriggerOnRelease !== undefined
                          ? { holdTriggerOnRelease: h.holdTriggerOnRelease }
                          : {}),
                      ...(h.retroTap !== undefined
                          ? { retroTap: h.retroTap }
                          : {}),
                      bindings: [h.bindings[0], h.bindings[1]],
                  })),
              }
            : {}),
        ...(km.conditionalLayers
            ? {
                  conditionalLayers: km.conditionalLayers.map((cl) => ({
                      ifLayers: [...cl.ifLayers],
                      thenLayer: cl.thenLayer,
                  })),
              }
            : {}),
        // pattern-check: skip — key-override / leader passthrough, mirror of the
        // combos/conditional blocks above; canonical keys → surface tokens.
        ...(km.keyOverrides
            ? {
                  keyOverrides: km.keyOverrides.map((ko) => ({
                      trigger: keyToken(ko.trigger),
                      triggerMods: [...ko.triggerMods],
                      ...(ko.negativeMods?.length
                          ? { negativeMods: [...ko.negativeMods] }
                          : {}),
                      ...(ko.suppressedMods?.length
                          ? { suppressedMods: [...ko.suppressedMods] }
                          : {}),
                      ...(ko.replacement
                          ? { replacement: keyToken(ko.replacement) }
                          : {}),
                      ...(ko.replacementMods?.length
                          ? { replacementMods: [...ko.replacementMods] }
                          : {}),
                      ...(ko.layers ? { layers: [...ko.layers] } : {}),
                  })),
              }
            : {}),
        ...(km.leaderSequences
            ? {
                  leaderSequences: km.leaderSequences.map((ls) => ({
                      sequence: ls.sequence.map((k) => keyToken(k)),
                      action: denormalizeAction(ls.action),
                  })),
              }
            : {}),
        // Semantic action bindings (§F) round-trip verbatim (canonical wire-mirror).
        ...(km.actionBindings
            ? { actionBindings: structuredClone(km.actionBindings) }
            : {}),
        // Whole-node sections round-trip verbatim (opaque data, no surface sugar).
        ...(km.node ? { node: structuredClone(km.node) } : {}),
        ...(km.firmware ? { firmware: structuredClone(km.firmware) } : {}),
        ...(km.board ? { board: structuredClone(km.board) } : {}),
    }
}

// pattern-check: skip — lib swap JSON5.stringify → built-in JSON.stringify
/** Serialize a canonical ConfigKeymap to friendly JSON (2-space indent). The
 *  surface sugar (bare-string keys, "Ctrl+C" combos, presets) is preserved in
 *  the object shape; only JSON5's cosmetic syntax (comments, unquoted keys) is
 *  gone — app-visible notes live in `description` fields instead. */
export function serializeKeymap(km: ConfigKeymap): string {
    return JSON.stringify(toSurfaceObject(km), null, 2)
}

// pattern-check: skip — thin composition of toSurfaceObject + migrateToV2, no abstraction
/** Serialize to the compact, hand-authorable v2 form (the mirror of the v2
 *  loader). Reuses the v1 default-stripping, then collapses the surface object to
 *  the `keys` + verb-grammar + def-dictionary shape. A doc saved this way and its
 *  verbose v1 spelling parse to identical bytes. */
export function serializeKeymapV2(km: ConfigKeymap): string {
    return JSON.stringify(migrateToV2(toSurfaceObject(km)), null, 2)
}

// pattern-check: skip — equivalence check picking literal vs canonical text
/** The JSON to present/export for the "Remappr config" surface. Prefers the
 *  user's literal `source` when it still normalizes to the same canonical doc —
 *  this preserves their formatting and explicitly-written default values (e.g.
 *  `"w": 1`) that a fresh serialize would strip. Falls back to a canonical
 *  serialize when source is absent or the config has since diverged (canvas edit). */
export function preferredSourceJson(
    km: ConfigKeymap,
    source: string | null,
): string {
    if (source) {
        try {
            if (serializeKeymap(parseKeymap(source)) === serializeKeymap(km))
                return source
        } catch {
            // stale/invalid source — fall back to canonical
        }
    }
    return serializeKeymap(km)
}
