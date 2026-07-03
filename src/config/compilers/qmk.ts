// Pattern check: Strategy (Tier 1) — extended — concrete QMK KeymapCompiler registered into the Strategy registry; Keychron reuses this emitter (it runs the VIA/QMK stack).
//
// Emits a QMK keymap.c `keymaps[][MATRIX_ROWS][MATRIX_COLS]` table directly from
// the canonical config. Combos / macros / tap-dance need extra C scaffolding
// (process_record_user, tap_dance_actions, …) which v1 does not generate — those
// emit a `warn` and a KC_NO placeholder so the table still compiles cleanly.

import type { ExportedFile } from '../../types'
import { supportsLighting, supportsOutput } from '../capabilities'
import { runCompile, registerCompiler, type KeymapCompiler } from '../compiler'
import type { DiagnosticBag } from '../diagnostics'
import { QMK_MODTAP, QMK_MOD_FN, qmkKeyName } from '../names'
import type {
    CanonAction,
    CanonKeyPress,
    ConfigKeymap,
    LightingAction,
    Target,
} from '../types'

const RGB: Partial<Record<LightingAction, string>> = {
    toggle: 'RGB_TOG',
    brightness_up: 'RGB_VAI',
    brightness_down: 'RGB_VAD',
    hue_up: 'RGB_HUI',
    hue_down: 'RGB_HUD',
    saturation_up: 'RGB_SAI',
    saturation_down: 'RGB_SAD',
    effect_next: 'RGB_MOD',
    effect_previous: 'RGB_RMOD',
    speed_up: 'RGB_SPI',
    speed_down: 'RGB_SPD',
}
const BL: Partial<Record<LightingAction, string>> = {
    toggle: 'BL_TOGG',
    on: 'BL_ON',
    off: 'BL_OFF',
    brightness_up: 'BL_UP',
    brightness_down: 'BL_DOWN',
}

// pattern-check: skip — static keycode lookup tables for the QMK compiler
const MOUSE_BTN: Record<string, string> = {
    left: 'KC_MS_BTN1',
    right: 'KC_MS_BTN2',
    middle: 'KC_MS_BTN3',
    mb4: 'KC_MS_BTN4',
    mb5: 'KC_MS_BTN5',
}
const MOVE: Record<string, string> = {
    up: 'KC_MS_UP',
    down: 'KC_MS_DOWN',
    left: 'KC_MS_LEFT',
    right: 'KC_MS_RIGHT',
}
const SCRL: Record<string, string> = {
    up: 'KC_MS_WH_UP',
    down: 'KC_MS_WH_DOWN',
    left: 'KC_MS_WH_LEFT',
    right: 'KC_MS_WH_RIGHT',
}

interface Ctx {
    target: Target
    layerIndex: Map<string, number>
    diag: DiagnosticBag
}

type Path = (string | number)[]

const layerIdx = (ctx: Ctx, name: string): number =>
    ctx.layerIndex.get(name) ?? 0

function kp(a: CanonKeyPress): string {
    let token = qmkKeyName(a.key)
    for (const m of a.mods ?? []) token = `${QMK_MOD_FN[m]}(${token})`
    return token
}

// One emit handler per CanonAction variant. The mapped type forces every
// discriminant to be handled (compile error on a new action type, the same
// safety the old `switch` gave) while keeping each variant's logic isolated;
// emitKeycode is then just a dispatch. Handlers receive the narrowed action.
// The actions QMK can render, each to its keycode token. This table *is* QMK's
// capability declaration: a discriminant present here is supported; one absent
// (a ZMK-only builtin, a Remappr-firmware-only §5.2 kind) is not, and emitKeycode
// drops it to the `fallback` KC_NO. Partial over CanonAction. Handlers receive
// the narrowed action.
type EmitHandlers = Partial<{
    [T in CanonAction['type']]: (
        a: Extract<CanonAction, { type: T }>,
        ctx: Ctx,
        path: Path,
    ) => string
}>

const HANDLERS: EmitHandlers = {
    key_press: (a) => kp(a),
    tap_hold: (a, ctx) =>
        a.hold.type === 'modifier'
            ? `${QMK_MODTAP[a.hold.modifier]}(${qmkKeyName(a.tap.key)})`
            : `LT(${layerIdx(ctx, a.hold.layer)}, ${qmkKeyName(a.tap.key)})`,
    layer: (a, ctx) =>
        a.mode === 'momentary'
            ? `MO(${layerIdx(ctx, a.layer)})`
            : a.mode === 'toggle'
              ? `TG(${layerIdx(ctx, a.layer)})`
              : a.mode === 'to'
                ? `TO(${layerIdx(ctx, a.layer)})`
                : `OSL(${layerIdx(ctx, a.layer)})`,
    sticky_key: (a, ctx, path) => {
        ctx.diag.warn(
            'QMK one-shot applies to modifiers only; emitted the bare key',
            path,
        )
        return qmkKeyName(a.key)
    },
    caps_word: () => 'CW_TOGG',
    transparent: () => 'KC_TRNS',
    none: () => 'KC_NO',
    bootloader: () => 'QK_BOOT',
    reset: () => 'QK_RBT',
    output: (a, ctx, path) => {
        if (!supportsOutput(ctx.target, a.action)) {
            ctx.diag.warn(
                `output "${a.action}" has no standard ${ctx.target} keycode; emitted KC_NO`,
                path,
            )
            return 'KC_NO'
        }
        return 'KC_NO' // usb is the implicit default on QMK; no dedicated keycode
    },
    lighting: (a, ctx, path) => {
        if (!supportsLighting(ctx.target, a.target)) {
            ctx.diag.warn(
                `${a.target} lighting is unavailable on ${ctx.target}; emitted KC_NO`,
                path,
            )
            return 'KC_NO'
        }
        if (a.target === 'backlight') {
            const t = BL[a.action]
            if (!t) {
                ctx.diag.warn(
                    `backlight has no "${a.action}" action on ${ctx.target}; emitted KC_NO`,
                    path,
                )
                return 'KC_NO'
            }
            return t
        }
        const t = RGB[a.action]
        if (!t) {
            ctx.diag.warn(
                `RGB has no "${a.action}" action on ${ctx.target}; emitted RGB_TOG`,
                path,
            )
            return 'RGB_TOG'
        }
        return t
    },
    macro: (a, ctx, path) => {
        ctx.diag.warn(
            `macro "${a.ref}" requires hand-written C (process_record_user); emitted KC_NO`,
            path,
        )
        return 'KC_NO'
    },
    tap_dance: (a, ctx, path) => {
        ctx.diag.warn(
            `tap-dance "${a.ref}" requires tap_dance_actions[]; emitted KC_NO`,
            path,
        )
        return 'KC_NO'
    },
    mod_morph: (a, ctx, path) => {
        ctx.diag.warn(
            `mod-morph "${a.ref}" requires a custom QMK macro / Key Override; emitted KC_NO`,
            path,
        )
        return 'KC_NO'
    },
    hold_tap: (a, ctx, path) => {
        ctx.diag.warn(
            `custom hold-tap "${a.ref}" has no direct QMK keycode; use MT()/LT() or a tap-hold config; emitted KC_NO`,
            path,
        )
        return 'KC_NO'
    },
    key_repeat: () => 'QK_REP',
    grave_escape: () => 'QK_GESC',
    mouse_key: (a) => MOUSE_BTN[a.button],
    mouse_move: (a) => MOVE[a.direction],
    mouse_scroll: (a) => SCRL[a.direction],
    key_toggle: (a, ctx, path) => {
        ctx.diag.warn(
            'key-toggle has no standard QMK keycode; emitted the bare key',
            path,
        )
        return qmkKeyName(a.key)
    },
}

// An action QMK has no keycode for (a ZMK-only builtin, a Remappr-firmware-only
// §5.2 kind): warn + KC_NO so the table still compiles.
const fallback = (a: CanonAction, ctx: Ctx, path: Path): string => {
    ctx.diag.warn(`"${a.type}" has no QMK keycode; emitted KC_NO`, path)
    return 'KC_NO'
}

// pattern-check: skip — refactor of the existing Strategy dispatch: presence-check
// on QMK's own partial handler table, no new abstraction introduced.
function emitKeycode(a: CanonAction, ctx: Ctx, path: Path): string {
    const handler = HANDLERS[a.type] as
        | ((a: CanonAction, ctx: Ctx, path: Path) => string)
        | undefined
    return handler ? handler(a, ctx, path) : fallback(a, ctx, path)
}

// pattern-check: skip additive pure QMK encoder_map C-block emitter, no abstraction
// QMK encoder_map[][NUM_ENCODERS][2]: one ENCODER_CCW_CW(ccw, cw) per encoder per
// layer. Sources the per-key element model (encoderBindings, keyed by element:
// 'encoder' key index) first, else the slot array (encoders[]). Press is a matrix
// key in QMK, so it is not part of the map. Returns [] when there are no encoders.
function emitEncoderMap(config: ConfigKeymap, ctx: Ctx): string[] {
    const encoderKeys = config.keyboard.keys
        .map((k, i) => (k.element === 'encoder' ? i : -1))
        .filter((i) => i >= 0)
    const usePerKey = encoderKeys.length > 0
    const count = usePerKey
        ? encoderKeys.length
        : (config.keyboard.encoders?.length ?? 0)
    if (!count) return []

    const trans = 'KC_TRNS'
    const out: string[] = [
        `#ifdef ENCODER_MAP_ENABLE`,
        `const uint16_t PROGMEM encoder_map[][NUM_ENCODERS][2] = {`,
    ]
    config.layers.forEach((layer, li) => {
        const cells: string[] = []
        for (let e = 0; e < count; e++) {
            const binding = usePerKey
                ? layer.encoderBindings?.[encoderKeys[e]]
                : layer.encoders?.[e]
            const path = usePerKey
                ? ['layers', li, 'encoderBindings', encoderKeys[e]]
                : ['layers', li, 'encoders', e]
            const cw = binding
                ? emitKeycode(binding.cw, ctx, [...path, 'cw'])
                : trans
            const ccw = binding
                ? emitKeycode(binding.ccw, ctx, [...path, 'ccw'])
                : trans
            cells.push(`ENCODER_CCW_CW(${ccw}, ${cw})`)
        }
        out.push(`    [${li}] = { ${cells.join(', ')} }, // ${layer.name}`)
    })
    out.push(`};`, `#endif`, ``)
    return out
}

// pattern-check: skip additive QMK analog-slider scaffold emitter, no abstraction
// QMK analog sliders are custom C (analogReadPin in matrix_scan_user / a sensor).
// No keymap construct expresses an analog axis, so this emits a commented
// scaffold + the captured per-layer value-map as guidance. Returns [] when no
// position carries element: 'slider'.
function emitSliderStub(config: ConfigKeymap): string[] {
    const sliderKeys = config.keyboard.keys
        .map((k, i) => (k.element === 'slider' ? i : -1))
        .filter((i) => i >= 0)
    if (!sliderKeys.length) return []

    const out: string[] = [
        `/* ─── SLIDER / ANALOG INPUT — scaffold only, finish in C ───────────────`,
        ` * QMK has no keymap construct for an analog axis. Enable analog in`,
        ` * rules.mk (ANALOG_DRIVER_REQUIRED = yes) and read the pin yourself.`,
        ` * remappr captured the value-map below:`,
        ` *`,
    ]
    sliderKeys.forEach((ki) => {
        const pin = config.keyboard.keys[ki]?.pin
        out.push(` *   slider @ key ${ki}${pin ? ` (ADC pin ${pin})` : ''}:`)
        config.layers.forEach((layer) => {
            const s = layer.sliderBindings?.[ki]
            if (!s) return
            const range =
                s.min !== undefined || s.max !== undefined
                    ? ` [${s.min ?? '…'}..${s.max ?? '…'}]`
                    : ''
            out.push(` *     ${layer.name}: ${s.map}${range}`)
        })
    })
    out.push(
        ` * ─────────────────────────────────────────────────────────────────── */`,
        `// #include "analog.h"`,
        `// void matrix_scan_user(void) {`,
        `//     uint16_t v = analogReadPin(SLIDER_PIN); // map per the table above`,
        `// }`,
        ``,
    )
    return out
}

function emit(target: Target, label: string) {
    return (config: ConfigKeymap, diag: DiagnosticBag): ExportedFile[] => {
        const ctx: Ctx = {
            target,
            layerIndex: new Map(config.layers.map((l, i) => [l.name, i])),
            diag,
        }
        if (config.combos?.length)
            diag.warn(
                'combos are not yet generated for QMK; add them in rules.mk/keymap.c',
                ['combos'],
            )
        if (config.conditionalLayers?.length)
            diag.warn(
                'conditional layers are not generated for QMK; use Tri-Layer (tri_layer_*) or layer_state_set_user in keymap.c',
                ['conditionalLayers'],
            )
        const hasEncoders =
            config.layers.some((l) => l.encoders?.length) ||
            config.keyboard.keys.some((k) => k.element === 'encoder')
        if (hasEncoders)
            diag.warn(
                'encoder_map[] is generated below; enable it with ENCODER_MAP_ENABLE = yes in rules.mk (encoder press stays a normal matrix key)',
                ['layers'],
            )

        const lines: string[] = []
        lines.push(`// Generated by remappr — ${label} keymap.c`)
        lines.push(
            `// Device: ${config.keyboard.name}  ·  Layers: ${config.layers.length}`,
        )
        lines.push(``)
        lines.push(`#include QMK_KEYBOARD_H`)
        lines.push(``)
        lines.push(
            `const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {`,
        )
        config.layers.forEach((layer, li) => {
            const cells = layer.bindings.map((b, bi) =>
                emitKeycode(b, ctx, ['layers', li, 'bindings', bi]),
            )
            const wrapped: string[] = []
            for (let i = 0; i < cells.length; i += 8) {
                wrapped.push('        ' + cells.slice(i, i + 8).join(', '))
            }
            lines.push(`    [${li}] = LAYOUT( // ${layer.name}`)
            lines.push(wrapped.join(',\n'))
            lines.push(`    ),`)
        })
        lines.push(`};`)
        lines.push(``)
        lines.push(...emitEncoderMap(config, ctx))
        if (config.keyboard.keys.some((k) => k.element === 'slider')) {
            diag.warn(
                'sliders are analog input — QMK has no keymap construct for them; a C scaffold is emitted but you must finish the analog read',
                ['keyboard', 'keys'],
            )
            lines.push(...emitSliderStub(config))
        }
        return [
            {
                filename: 'keymap.c',
                mime: 'text/x-c',
                content: lines.join('\n'),
            },
        ]
    }
}

export const qmkCompiler: KeymapCompiler = {
    target: 'qmk',
    compile: (config) => runCompile(config, emit('qmk', 'QMK')),
}

export const keychronCompiler: KeymapCompiler = {
    target: 'keychron',
    compile: (config) =>
        runCompile(config, emit('keychron', 'Keychron (QMK/VIA)')),
}

registerCompiler(qmkCompiler)
registerCompiler(keychronCompiler)
