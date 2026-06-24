// Pattern check: Strategy (Tier 1) — extended — typed handler-dispatch table
// (mapped over CanonAction) replaces the per-binding `switch`, mirroring
// compilers/qmk.ts emitKeycode; extends the KeymapCompiler Strategy.
//
// Lowers a single CanonAction to its ZMK `&behavior …` binding token. Custom
// flavor/timing tap_holds spawn a dedicated generated hold-tap node (tracked on
// Ctx.genHoldTaps and emitted by the keymap assembler); everything else maps to a
// built-in behavior or a constant.

import type { DiagnosticBag } from '../../diagnostics'
import { resolveKeycode } from '../../keycodes'
import { ZMK_MOD, ZMK_MOD_FN, zmkKeyName } from '../../names'
import type { CanonAction, CanonKeyPress } from '../../types'
import { BL, EP, MOUSE_BTN, MOVE, RGB_UG, SCRL, sanitize } from './maps'

export type Path = (string | number)[]

export interface Ctx {
    layerIndex: Map<string, number>
    diag: DiagnosticBag
    /** Hold-tap nodes generated for tap_holds carrying custom flavor/timing,
     *  deduped by signature → id. Emitted as a behaviors block at the end. */
    genHoldTaps: Map<string, { id: string; lines: string[] }>
}

const layerIdx = (ctx: Ctx, name: string, path: Path): number => {
    const i = ctx.layerIndex.get(name)
    if (i === undefined) {
        ctx.diag.error(`unknown layer "${name}"`, path)
        return 0
    }
    return i
}

// Our `resolve` enum predates `flavor`; map it to the ZMK flavor it approximates.
const RESOLVE_TO_FLAVOR: Record<string, string> = {
    'prefer-hold': 'hold-preferred',
    'prefer-tap': 'tap-preferred',
}

// Generate (or reuse) a custom hold-tap node for a tap_hold with flavor/timing,
// returning its label. &mt is `<&kp>,<&kp>`; &lt is `<&mo>,<&kp>`.
function generateHoldTap(
    a: Extract<CanonAction, { type: 'tap_hold' }>,
    ctx: Ctx,
): string {
    const isLayer = a.hold.type === 'layer'
    const flavor =
        a.flavor ?? (a.resolve ? RESOLVE_TO_FLAVOR[a.resolve] : undefined)
    const sig = JSON.stringify([
        isLayer ? 'lt' : 'mt',
        flavor ?? '',
        a.tappingTermMs ?? '',
        a.quickTapMs ?? '',
    ])
    const hit = ctx.genHoldTaps.get(sig)
    if (hit) return hit.id
    const id = `ht_${ctx.genHoldTaps.size}`
    const lines = [
        `        ${id}: ${id} {`,
        `            compatible = "zmk,behavior-hold-tap";`,
        `            #binding-cells = <2>;`,
        `            bindings = <${isLayer ? '&mo' : '&kp'}>, <&kp>;`,
    ]
    if (flavor) lines.push(`            flavor = "${flavor}";`)
    if (a.tappingTermMs !== undefined)
        lines.push(`            tapping-term-ms = <${a.tappingTermMs}>;`)
    if (a.quickTapMs !== undefined)
        lines.push(`            quick-tap-ms = <${a.quickTapMs}>;`)
    lines.push(`        };`)
    ctx.genHoldTaps.set(sig, { id, lines })
    return id
}

// A hold-tap param is a keycode token when it resolves, else emitted raw (e.g. a
// layer index for an &mo/&lt inner binding).
function holdTapParam(token: string): string {
    const id = resolveKeycode(token)
    return id ? zmkKeyName(id) : token
}

function kp(kpAction: CanonKeyPress): string {
    let token = zmkKeyName(kpAction.key)
    // Wrap modifiers innermost-last: LC(LS(A)).
    for (const m of kpAction.mods ?? []) token = `${ZMK_MOD_FN[m]}(${token})`
    return `&kp ${token}`
}

// One emit handler per CanonAction variant; the mapped type forces every
// discriminant to be handled. Handlers receive the narrowed action.
type BindingHandlers = {
    [T in CanonAction['type']]: (
        a: Extract<CanonAction, { type: T }>,
        ctx: Ctx,
        path: Path,
    ) => string
}

// §5.2 Remappr-firmware-only behaviors have no ZMK binding; warn + &none so the
// keymap still builds. pattern-check: skip — shared fallback handler.
const remapprOnly = (a: { type: string }, ctx: Ctx, path: Path): string => {
    ctx.diag.warn(
        `"${a.type}" is a Remappr-specific behavior; no ZMK binding; emitted &none`,
        path,
    )
    return '&none'
}

const HANDLERS: BindingHandlers = {
    key_press: (a) => kp(a),
    tap_hold: (a, ctx, path) => {
        const holdTok =
            a.hold.type === 'modifier'
                ? ZMK_MOD[a.hold.modifier]
                : String(layerIdx(ctx, a.hold.layer, path))
        const tapTok = zmkKeyName(a.tap.key)
        // Custom flavor/timing → a dedicated generated hold-tap node;
        // otherwise the global &mt / &lt.
        const hasCustom =
            a.flavor !== undefined ||
            a.tappingTermMs !== undefined ||
            a.quickTapMs !== undefined ||
            a.resolve !== undefined
        if (hasCustom) return `&${generateHoldTap(a, ctx)} ${holdTok} ${tapTok}`
        return a.hold.type === 'modifier'
            ? `&mt ${holdTok} ${tapTok}`
            : `&lt ${holdTok} ${tapTok}`
    },
    layer: (a, ctx, path) =>
        a.mode === 'momentary'
            ? `&mo ${layerIdx(ctx, a.layer, path)}`
            : a.mode === 'toggle'
              ? `&tog ${layerIdx(ctx, a.layer, path)}`
              : a.mode === 'to'
                ? `&to ${layerIdx(ctx, a.layer, path)}`
                : `&sl ${layerIdx(ctx, a.layer, path)}`,
    sticky_key: (a) => `&sk ${zmkKeyName(a.key)}`,
    caps_word: () => '&caps_word',
    transparent: () => '&trans',
    none: () => '&none',
    bootloader: () => '&bootloader',
    reset: () => '&sys_reset',
    output: (a) => {
        if (a.action === 'usb') return '&out OUT_USB'
        if (a.action === 'toggle') return '&out OUT_TOG'
        if (a.action === 'none') return '&out OUT_NONE'
        if (a.action === 'bluetooth_clear') return '&bt BT_CLR'
        if (a.action === 'bluetooth_next') return '&bt BT_NXT'
        if (a.action === 'bluetooth_prev') return '&bt BT_PRV'
        if (a.action === 'bluetooth_disconnect')
            return `&bt BT_DISC ${a.profile ?? 0}`
        return a.profile !== undefined
            ? `&bt BT_SEL ${a.profile}`
            : '&out OUT_BLE'
    },
    lighting: (a, ctx, path) => {
        if (a.target === 'per_key') {
            ctx.diag.warn(
                'per_key lighting is not available on ZMK; emitted &none',
                path,
            )
            return '&none'
        }
        if (a.target === 'backlight') {
            // BL_SET carries an absolute level; the rest are in the BL map.
            if (a.action === 'set') return `&bl BL_SET ${a.level ?? 0}`
            const t = BL[a.action]
            if (!t) {
                ctx.diag.warn(
                    `backlight has no "${a.action}" action on ZMK; emitted &none`,
                    path,
                )
                return '&none'
            }
            return `&bl ${t}`
        }
        // underglow: RGB_COLOR_HSB carries an absolute hue/sat/brightness.
        if (a.action === 'color') {
            return `&rgb_ug RGB_COLOR_HSB(${a.hue ?? 0},${a.saturation ?? 0},${a.brightness ?? 0})`
        }
        if (a.action === 'set') {
            ctx.diag.warn(
                'underglow has no absolute "set" on ZMK (BL_SET is backlight-only); emitted RGB_TOG',
                path,
            )
            return '&rgb_ug RGB_TOG'
        }
        return `&rgb_ug ${RGB_UG[a.action] ?? 'RGB_TOG'}`
    },
    macro: (a) =>
        a.param !== undefined
            ? `&${sanitize(a.ref)} ${zmkKeyName(a.param)}`
            : `&${sanitize(a.ref)}`,
    tap_dance: (a) => `&${sanitize(a.ref)}`,
    mod_morph: (a) => `&${sanitize(a.ref)}`,
    hold_tap: (a) =>
        `&${sanitize(a.ref)} ${holdTapParam(a.holdParam)} ${holdTapParam(a.tapParam)}`,
    soft_off: () => '&soft_off',
    studio_unlock: () => '&studio_unlock',
    grave_escape: () => '&gresc',
    key_repeat: () => '&key_repeat',
    key_toggle: (a) => `&kt ${zmkKeyName(a.key)}`,
    ext_power: (a) => `&ext_power ${EP[a.action]}`,
    mouse_key: (a) => `&mkp ${MOUSE_BTN[a.button]}`,
    mouse_move: (a) => `&mmv ${MOVE[a.direction]}`,
    mouse_scroll: (a) => `&msc ${SCRL[a.direction]}`,
    // pattern-check: skip — §5.2 Remappr-only kinds → &none fallback
    auto_shift: remapprOnly,
    alt_repeat: remapprOnly,
    layer_lock: remapprOnly,
    layer_mod: remapprOnly,
    tap_toggle: remapprOnly,
    set_base_saved: remapprOnly,
    auto_layer: remapprOnly,
    gui_lock: remapprOnly,
    secure: remapprOnly,
    autocorrect: remapprOnly,
    tune_tap_term: remapprOnly,
    unicode: remapprOnly,
    macro_record: remapprOnly,
    macro_play: remapprOnly,
    leader: remapprOnly,
    peripheral: remapprOnly,
}

export function emitBinding(a: CanonAction, ctx: Ctx, path: Path): string {
    const handler = HANDLERS[a.type] as (
        a: CanonAction,
        ctx: Ctx,
        path: Path,
    ) => string
    return handler(a, ctx, path)
}
