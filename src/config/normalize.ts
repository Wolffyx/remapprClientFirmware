// Pattern check: no GoF pattern (-) — rejected — surface→canonical transformation functions; pure data mapping, no abstraction.
//
// Lowers a validated SURFACE doc into the single canonical form. Every
// shorthand is expanded: bare/combo strings → key_press, mod_tap/layer_tap →
// tap_hold, leaving the compiler one shape per behavior. Original spellings are
// stashed on `_keySrc`/`_preset` so serialize can round-trip the user's style.

import { parseKeyToken, resolveKeycode } from './keycodes'
import { parseSurface, type SurfaceAction, type SurfaceKeymap } from './schema'
import type {
    CanonAction,
    CanonController,
    CanonFirmwareConfig,
    CanonVial,
    CanonEncoderBinding,
    CanonSliderBinding,
    CanonHoldTarget,
    CanonKeyPress,
    CanonLighting,
    CanonMacroStep,
    ConfigHardware,
    ConfigKeymap,
} from './types'

// pattern-check: skip — trivial JSON deep-clone helper for opaque passthrough data
/** Deep-clone plain JSON data (v2 node/firmware/board sections are opaque data
 *  with no functions/cycles), so canonical never aliases the surface object. */
function cloneJson<T>(v: T): T {
    return structuredClone(v)
}

// Pattern check: no GoF pattern (-) — rejected — passthrough deep-clone of the
// already-canonical lighting sub-object; pure data copy, no abstraction.
/** Deep-copy the builder's board lighting metadata (no surface sugar). */
export function cloneLighting(l: CanonLighting): CanonLighting {
    return {
        ...(l.underglow ? { underglow: { ...l.underglow } } : {}),
        ...(l.backlight ? { backlight: { ...l.backlight } } : {}),
    }
}

// Pattern check: no GoF pattern (-) — rejected — passthrough deep-clone of the
// already-canonical hardware sub-object; pure data copy, no abstraction.
// hardware has no surface sugar (GPIO specs + ints are canonical as-written), so
// normalize just deep-copies it so the canonical doc owns no references.
export function cloneHardware(hw: ConfigHardware): ConfigHardware {
    return {
        ...(hw.board !== undefined ? { board: hw.board } : {}),
        ...(hw.shield !== undefined ? { shield: hw.shield } : {}),
        ...(hw.kscan
            ? {
                  kscan:
                      hw.kscan.type === 'matrix'
                          ? {
                                type: 'matrix',
                                diodeDirection: hw.kscan.diodeDirection,
                                rowGpios: [...hw.kscan.rowGpios],
                                colGpios: [...hw.kscan.colGpios],
                                ...(hw.kscan.debouncePressMs !== undefined
                                    ? {
                                          debouncePressMs:
                                              hw.kscan.debouncePressMs,
                                      }
                                    : {}),
                                ...(hw.kscan.debounceReleaseMs !== undefined
                                    ? {
                                          debounceReleaseMs:
                                              hw.kscan.debounceReleaseMs,
                                      }
                                    : {}),
                            }
                          : {
                                type: 'direct',
                                inputGpios: [...hw.kscan.inputGpios],
                                ...(hw.kscan.debouncePressMs !== undefined
                                    ? {
                                          debouncePressMs:
                                              hw.kscan.debouncePressMs,
                                      }
                                    : {}),
                                ...(hw.kscan.debounceReleaseMs !== undefined
                                    ? {
                                          debounceReleaseMs:
                                              hw.kscan.debounceReleaseMs,
                                      }
                                    : {}),
                            },
              }
            : {}),
        ...(hw.transform
            ? {
                  transform: {
                      rows: hw.transform.rows,
                      columns: hw.transform.columns,
                      map: hw.transform.map.map(
                          ([r, c]) => [r, c] as [number, number],
                      ),
                  },
              }
            : {}),
        ...(hw.backlightPwm ? { backlightPwm: { ...hw.backlightPwm } } : {}),
        ...(hw.ws2812 ? { ws2812: { ...hw.ws2812 } } : {}),
        ...(hw.extPowerCtrl ? { extPowerCtrl: { ...hw.extPowerCtrl } } : {}),
        ...(hw.studioAcm !== undefined ? { studioAcm: hw.studioAcm } : {}),
    }
}

// pattern-check: skip additive passthrough clone mirroring cloneController, no abstraction
/** Deep-clone the canonical firmware-config sub-object (scalar toggles + strings). */
export function cloneFirmwareConfig(
    fc: CanonFirmwareConfig,
): CanonFirmwareConfig {
    const out: CanonFirmwareConfig = {}
    for (const k of Object.keys(fc) as (keyof CanonFirmwareConfig)[]) {
        const v = fc[k]
        if (v !== undefined) (out as Record<string, unknown>)[k] = v
    }
    return out
}

// pattern-check: skip additive passthrough clone mirroring cloneHardware, no abstraction
/** Deep-clone the already-canonical controller sub-object (no surface sugar). */
export function cloneController(c: CanonController): CanonController {
    return {
        ...(c.board !== undefined ? { board: c.board } : {}),
        ...(c.shield !== undefined ? { shield: c.shield } : {}),
        ...(c.processor !== undefined ? { processor: c.processor } : {}),
        ...(c.bootloader !== undefined ? { bootloader: c.bootloader } : {}),
        ...(c.developmentBoard !== undefined
            ? { developmentBoard: c.developmentBoard }
            : {}),
        ...(c.deviceVersion !== undefined
            ? { deviceVersion: c.deviceVersion }
            : {}),
    }
}

// pattern-check: skip additive passthrough clone mirroring cloneController, no abstraction
/** Deep-clone the canonical Vial sub-object (owns its uid + unlockKeys arrays). */
export function cloneVial(v: CanonVial): CanonVial {
    return {
        ...(v.uid !== undefined ? { uid: [...v.uid] } : {}),
        ...(v.unlockKeys !== undefined
            ? {
                  unlockKeys: v.unlockKeys.map(
                      ([r, c]) => [r, c] as [number, number],
                  ),
              }
            : {}),
        ...(v.insecure !== undefined ? { insecure: v.insecure } : {}),
    }
}

// Validated upstream, so resolveKeycode never returns null here; `??` keeps TS
// honest and degrades to the raw token rather than throwing.
const toCanonical = (token: string): string => resolveKeycode(token) ?? token

type TapTarget = Extract<SurfaceAction, { type: 'key_press' }> | string

function normalizeTapTarget(tap: TapTarget): CanonKeyPress {
    if (typeof tap === 'string') {
        const parsed = parseKeyToken(tap)
        return {
            type: 'key_press',
            key: parsed ? parsed.key : toCanonical(tap),
            ...(parsed && parsed.mods.length ? { mods: parsed.mods } : {}),
            _keySrc: tap,
        }
    }
    return {
        type: 'key_press',
        key: toCanonical(tap.key),
        ...(tap.mods?.length ? { mods: tap.mods } : {}),
        _keySrc: tap.key,
    }
}

const timings = (a: {
    tappingTermMs?: number
    quickTapMs?: number
    requirePriorIdleMs?: number
    retroTap?: boolean
    holdTriggerKeyPositions?: number[]
    holdTriggerOnRelease?: boolean
    resolve?: 'timeout' | 'prefer-hold' | 'prefer-tap'
    flavor?: Extract<CanonAction, { type: 'tap_hold' }>['flavor']
}): Pick<
    Extract<CanonAction, { type: 'tap_hold' }>,
    | 'tappingTermMs'
    | 'quickTapMs'
    | 'requirePriorIdleMs'
    | 'retroTap'
    | 'holdTriggerKeyPositions'
    | 'holdTriggerOnRelease'
    | 'resolve'
    | 'flavor'
> => ({
    ...(a.tappingTermMs !== undefined
        ? { tappingTermMs: a.tappingTermMs }
        : {}),
    ...(a.quickTapMs !== undefined ? { quickTapMs: a.quickTapMs } : {}),
    ...(a.requirePriorIdleMs !== undefined
        ? { requirePriorIdleMs: a.requirePriorIdleMs }
        : {}),
    ...(a.retroTap !== undefined ? { retroTap: a.retroTap } : {}),
    ...(a.holdTriggerKeyPositions !== undefined
        ? { holdTriggerKeyPositions: [...a.holdTriggerKeyPositions] }
        : {}),
    ...(a.holdTriggerOnRelease !== undefined
        ? { holdTriggerOnRelease: a.holdTriggerOnRelease }
        : {}),
    ...(a.resolve !== undefined ? { resolve: a.resolve } : {}),
    ...(a.flavor !== undefined ? { flavor: a.flavor } : {}),
})

export function normalizeAction(b: SurfaceAction): CanonAction {
    if (typeof b === 'string') {
        const parsed = parseKeyToken(b)
        return {
            type: 'key_press',
            key: parsed ? parsed.key : toCanonical(b),
            ...(parsed && parsed.mods.length ? { mods: parsed.mods } : {}),
            _keySrc: b,
        }
    }

    switch (b.type) {
        case 'key_press':
            return {
                type: 'key_press',
                key: toCanonical(b.key),
                ...(b.mods?.length ? { mods: b.mods } : {}),
                _keySrc: b.key,
            }
        case 'tap_hold':
            return {
                type: 'tap_hold',
                tap: normalizeTapTarget(b.tap),
                hold: b.hold as CanonHoldTarget,
                ...timings(b),
            }
        case 'mod_tap':
            return {
                type: 'tap_hold',
                tap: normalizeTapTarget(b.tap),
                hold: { type: 'modifier', modifier: b.mod },
                ...timings(b),
                _preset: 'mod_tap',
            }
        case 'layer_tap':
            return {
                type: 'tap_hold',
                tap: normalizeTapTarget(b.tap),
                hold: { type: 'layer', layer: b.layer },
                ...timings(b),
                _preset: 'layer_tap',
            }
        case 'layer':
            return { type: 'layer', mode: b.mode, layer: b.layer }
        case 'sticky_key':
            return {
                type: 'sticky_key',
                key: toCanonical(b.key),
                _keySrc: b.key,
            }
        case 'output':
            return {
                type: 'output',
                action: b.action,
                ...(b.profile !== undefined ? { profile: b.profile } : {}),
            }
        case 'lighting':
            return {
                type: 'lighting',
                target: b.target,
                action: b.action,
                ...(b.hue !== undefined ? { hue: b.hue } : {}),
                ...(b.saturation !== undefined
                    ? { saturation: b.saturation }
                    : {}),
                ...(b.brightness !== undefined
                    ? { brightness: b.brightness }
                    : {}),
                ...(b.level !== undefined ? { level: b.level } : {}),
            }
        case 'macro':
            return {
                type: 'macro',
                ref: b.ref,
                ...(b.param !== undefined
                    ? { param: toCanonical(b.param), _paramSrc: b.param }
                    : {}),
            }
        case 'tap_dance':
            return { type: 'tap_dance', ref: b.ref }
        case 'mod_morph':
            return { type: 'mod_morph', ref: b.ref }
        case 'hold_tap':
            return {
                type: 'hold_tap',
                ref: b.ref,
                holdParam: b.holdParam,
                tapParam: b.tapParam,
            }
        case 'key_toggle':
            return {
                type: 'key_toggle',
                key: toCanonical(b.key),
                _keySrc: b.key,
            }
        case 'ext_power':
            return { type: 'ext_power', action: b.action }
        case 'mouse_key':
            return { type: 'mouse_key', button: b.button }
        case 'mouse_move':
            return { type: 'mouse_move', direction: b.direction }
        case 'mouse_scroll':
            return { type: 'mouse_scroll', direction: b.direction }
        // pattern-check: skip — surface→canonical mapping cases for §5.2 kinds
        case 'auto_shift':
            return {
                type: 'auto_shift',
                key: toCanonical(b.key),
                mods: [...b.mods],
                _keySrc: b.key,
            }
        case 'layer_mod':
            return { type: 'layer_mod', layer: b.layer, mods: [...b.mods] }
        case 'tap_toggle':
            return { type: 'tap_toggle', layer: b.layer }
        case 'set_base_saved':
            return { type: 'set_base_saved', layer: b.layer }
        case 'auto_layer':
            return { type: 'auto_layer', layer: b.layer }
        case 'gui_lock':
            return { type: 'gui_lock', action: b.action }
        case 'secure':
            return { type: 'secure', action: b.action }
        case 'autocorrect':
            return { type: 'autocorrect', action: b.action }
        case 'tune_tap_term':
            return { type: 'tune_tap_term', ms: b.ms }
        case 'unicode':
            return { type: 'unicode', codepoint: b.codepoint }
        case 'macro_record':
            return { type: 'macro_record', slot: b.slot }
        case 'macro_play':
            return { type: 'macro_play', slot: b.slot }
        case 'leader':
            return {
                type: 'leader',
                ...(b.windowMs !== undefined ? { windowMs: b.windowMs } : {}),
            }
        case 'peripheral':
            return { type: 'peripheral', kind: b.kind, code: b.code }
        default:
            // caps_word | transparent | none | bootloader | reset | soft_off |
            // studio_unlock | grave_escape | key_repeat | alt_repeat | layer_lock
            return { type: b.type }
    }
}

function normalizeEncoder(
    e: NonNullable<SurfaceKeymap['layers'][number]['encoders']>[number],
): CanonEncoderBinding {
    return {
        cw: normalizeAction(e.cw),
        ccw: normalizeAction(e.ccw),
        ...(e.press ? { press: normalizeAction(e.press) } : {}),
    }
}

function normalizeSlider(
    s: NonNullable<SurfaceKeymap['layers'][number]['sliderBindings']>[string],
): CanonSliderBinding {
    return {
        map: s.map,
        ...(s.min !== undefined ? { min: s.min } : {}),
        ...(s.max !== undefined ? { max: s.max } : {}),
        ...(s.action ? { action: normalizeAction(s.action) } : {}),
    }
}

function normalizeMacroStep(
    s: NonNullable<SurfaceKeymap['macros']>[number]['steps'][number],
): CanonMacroStep {
    if (s.type === 'wait') return { type: 'wait', ms: s.ms }
    if (s.type === 'text') return { type: 'text', text: s.text }
    if (s.type === 'param')
        return {
            type: 'param',
            ...(s.from !== undefined ? { from: s.from } : {}),
            ...(s.to !== undefined ? { to: s.to } : {}),
        }
    if (s.type === 'tap_time') return { type: 'tap_time', ms: s.ms }
    if (s.type === 'pause_for_release') return { type: 'pause_for_release' }
    return { type: s.type, key: toCanonical(s.key), _keySrc: s.key }
}

// pattern-check: skip — positional bindings pad-to-keycount, pure data fill
// Pad a layer's (possibly under-specified) bindings up to the board's key count
// with transparent. Trailing transparents are dropped on serialize to keep the
// config compact; canonical re-fills them so the editor/compiler always see one
// binding per key.
const TRANSPARENT: CanonAction = { type: 'transparent' }
const padBindings = (
    bindings: CanonAction[],
    keyCount: number,
): CanonAction[] =>
    bindings.length >= keyCount
        ? bindings
        : [
              ...bindings,
              ...Array.from({ length: keyCount - bindings.length }, () => ({
                  ...TRANSPARENT,
              })),
          ]

export function normalizeKeymap(km: SurfaceKeymap): ConfigKeymap {
    const keyCount = km.keyboard.keys.length
    return {
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { ...km.meta, target: km.meta.target ?? null },
        ...(km.defaults ? { defaults: km.defaults } : {}),
        keyboard: {
            id: km.keyboard.id,
            name: km.keyboard.name,
            keys: km.keyboard.keys.map((k) => ({
                ...k,
                // own the matrix/option tuples so canonical never aliases the surface array
                ...(k.matrix
                    ? { matrix: [k.matrix[0], k.matrix[1]] as [number, number] }
                    : {}),
                ...(k.option
                    ? { option: [k.option[0], k.option[1]] as [number, number] }
                    : {}),
            })),
            ...(km.keyboard.encoders
                ? { encoders: km.keyboard.encoders.map((e) => ({ ...e })) }
                : {}),
            ...(km.keyboard.matrix
                ? { matrix: { ...km.keyboard.matrix } }
                : {}),
            ...(km.keyboard.controller
                ? { controller: cloneController(km.keyboard.controller) }
                : {}),
            ...(km.keyboard.vial ? { vial: cloneVial(km.keyboard.vial) } : {}),
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
            bindings: padBindings(l.bindings.map(normalizeAction), keyCount),
            ...(l.encoders
                ? { encoders: l.encoders.map(normalizeEncoder) }
                : {}),
            ...(l.encoderBindings
                ? {
                      encoderBindings: Object.fromEntries(
                          Object.entries(l.encoderBindings).map(([k, e]) => [
                              k,
                              normalizeEncoder(e),
                          ]),
                      ),
                  }
                : {}),
            ...(l.sliderBindings
                ? {
                      sliderBindings: Object.fromEntries(
                          Object.entries(l.sliderBindings).map(([k, s]) => [
                              k,
                              normalizeSlider(s),
                          ]),
                      ),
                  }
                : {}),
        })),
        ...(km.combos
            ? {
                  combos: km.combos.map((c) => ({
                      name: c.name,
                      keys: [...c.keys],
                      action: normalizeAction(c.action),
                      ...(c.timeoutMs !== undefined
                          ? { timeoutMs: c.timeoutMs }
                          : {}),
                      ...(c.layers ? { layers: [...c.layers] } : {}),
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
                          action: normalizeAction(tap.action),
                      })),
                      ...(t.hold ? { hold: t.hold as CanonHoldTarget } : {}),
                  })),
              }
            : {}),
        ...(km.macros
            ? {
                  macros: km.macros.map((m) => ({
                      id: m.id,
                      ...(m.description ? { description: m.description } : {}),
                      ...(m.params !== undefined ? { params: m.params } : {}),
                      steps: m.steps.map(normalizeMacroStep),
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
                          normalizeAction(mm.bindings[0]),
                          normalizeAction(mm.bindings[1]),
                      ] as [CanonAction, CanonAction],
                  })),
              }
            : {}),
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
                                holdTriggerKeyPositions: [
                                    ...h.holdTriggerKeyPositions,
                                ],
                            }
                          : {}),
                      ...(h.holdTriggerOnRelease !== undefined
                          ? { holdTriggerOnRelease: h.holdTriggerOnRelease }
                          : {}),
                      ...(h.retroTap !== undefined
                          ? { retroTap: h.retroTap }
                          : {}),
                      bindings: [h.bindings[0], h.bindings[1]] as [
                          string,
                          string,
                      ],
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
        // combos/conditional blocks above; surface keycodes → canonical.
        ...(km.keyOverrides
            ? {
                  keyOverrides: km.keyOverrides.map((ko) => ({
                      trigger: toCanonical(ko.trigger),
                      triggerMods: [...ko.triggerMods],
                      ...(ko.negativeMods?.length
                          ? { negativeMods: [...ko.negativeMods] }
                          : {}),
                      ...(ko.suppressedMods?.length
                          ? { suppressedMods: [...ko.suppressedMods] }
                          : {}),
                      ...(ko.replacement
                          ? { replacement: toCanonical(ko.replacement) }
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
                      sequence: ls.sequence.map((k) => toCanonical(k)),
                      action: normalizeAction(ls.action),
                  })),
              }
            : {}),
        // Whole-node sections carry through opaquely (no surface sugar); deep-clone
        // so canonical never aliases the surface object.
        ...(km.node ? { node: cloneJson(km.node) } : {}),
        ...(km.firmware ? { firmware: cloneJson(km.firmware) } : {}),
        ...(km.board ? { board: cloneJson(km.board) } : {}),
    }
}

/** Parse + validate + normalize JSON source into the canonical ConfigKeymap. Throws on invalid. */
export function parseKeymap(source: string): ConfigKeymap {
    return normalizeKeymap(parseSurface(source))
}
