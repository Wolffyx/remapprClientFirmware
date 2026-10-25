// pattern-check: skip — devicetree behavior-node string emitters, no abstraction
//
// ZMK `behaviors {}` / `macros {}` node emitters: macros, tap-dances, mod-morphs,
// explicit hold-tap defs, encoder sensor-bindings, and the slider guidance block.
// Each returns devicetree lines spliced into the keymap by the assembler (index).

import type {
    CanonAction,
    CanonHoldTapDef,
    CanonMacro,
    CanonModMorph,
    CanonTapDance,
    ConfigKeymap,
} from '../../types'
import { zmkKeyName } from '../../names'
import { type Ctx, emitBinding } from './bindings'
import { modFlags, sanitize } from './maps'

export function emitMacros(macros: CanonMacro[], ctx: Ctx): string[] {
    const out: string[] = []
    out.push('    macros {')
    for (const m of macros) {
        const bindings: string[] = []
        for (const s of m.steps) {
            if (s.type === 'press')
                bindings.push(`<&macro_press &kp ${zmkKeyName(s.key)}>`)
            else if (s.type === 'release')
                bindings.push(`<&macro_release &kp ${zmkKeyName(s.key)}>`)
            else if (s.type === 'tap')
                bindings.push(`<&macro_tap &kp ${zmkKeyName(s.key)}>`)
            else if (s.type === 'wait')
                bindings.push(`<&macro_wait_time ${s.ms}>`)
            else if (s.type === 'tap_time')
                bindings.push(`<&macro_tap_time ${s.ms}>`)
            else if (s.type === 'param')
                bindings.push(
                    `<&macro_tap &macro_param_${s.from ?? 1}to${s.to ?? 1}>`,
                )
            else if (s.type === 'pause_for_release')
                bindings.push(`<&macro_pause_for_release>`)
            else
                ctx.diag.warn(
                    `macro "${m.id}" text steps are not generated for ZMK`,
                    ['macros'],
                )
        }
        // #binding-cells: explicit `params`, else inferred from param steps
        // (highest `from` used). 0 = plain, 1 = one-param, 2 = two-param.
        const inferredCells = m.steps.reduce(
            (n, s) => (s.type === 'param' ? Math.max(n, s.from ?? 1) : n),
            0,
        )
        const cells = m.params ?? inferredCells
        const suffix =
            cells === 2 ? '-two-param' : cells === 1 ? '-one-param' : ''
        // A stub (no emittable steps) gets an inert &none + a visible TODO, so
        // the node is valid devicetree instead of an empty `bindings = ;`.
        const isStub = bindings.length === 0
        out.push(`        ${sanitize(m.id)}: ${sanitize(m.id)} {`)
        out.push(`            compatible = "zmk,behavior-macro${suffix}";`)
        out.push(`            #binding-cells = <${cells}>;`)
        if (isStub) {
            out.push(
                `            /* TODO: stub — restore this macro's steps from your board source. */`,
            )
            bindings.push('<&none>')
        }
        out.push(`            bindings = ${bindings.join(', ')};`)
        out.push(`        };`)
    }
    out.push('    };')
    return out
}

// Encoders → ZMK `sensor-bindings`. A keypress/keypress pair uses the built-in
// `&inc_dec_kp`; any other behavior pair needs a generated
// `zmk,behavior-sensor-rotate` node (referenced as `&sr_<layer>_<enc>`). The
// encoder PRESS action is a normal matrix key in ZMK (not a sensor binding), so
// it cannot live here — warned once. Returns the behavior-node lines plus the
// per-layer `sensor-bindings` value to splice into each layer node.
export function emitEncoderSensors(
    config: ConfigKeymap,
    ctx: Ctx,
): { behaviorLines: string[]; byLayer: Map<number, string> } {
    const behaviorLines: string[] = []
    const byLayer = new Map<number, string>()
    let warnedPress = false

    // pattern-check: skip local cw/ccw pair → sensor token closure, no abstraction
    // A cw/ccw pair → one sensor-binding token: the built-in &inc_dec_kp for a
    // keypress/keypress pair, else a generated zmk,behavior-sensor-rotate node.
    const pairToken = (
        cw: CanonAction,
        ccw: CanonAction,
        idBase: string,
        path: (string | number)[],
    ): string => {
        if (cw.type === 'key_press' && ccw.type === 'key_press') {
            return `&inc_dec_kp ${zmkKeyName(cw.key)} ${zmkKeyName(ccw.key)}`
        }
        const id = `sr_${idBase}`
        const cwTok = emitBinding(cw, ctx, [...path, 'cw'])
        const ccwTok = emitBinding(ccw, ctx, [...path, 'ccw'])
        behaviorLines.push(
            `        ${id}: ${id} {`,
            `            compatible = "zmk,behavior-sensor-rotate";`,
            `            #sensor-binding-cells = <0>;`,
            `            bindings = <${cwTok}>, <${ccwTok}>;`,
            `        };`,
        )
        return `&${id}`
    }
    const warnPress = (path: (string | number)[]): void => {
        if (warnedPress) return
        ctx.diag.warn(
            'encoder press is a regular matrix key in ZMK, not a sensor binding; place it in the layer bindings instead',
            path,
        )
        warnedPress = true
    }

    // Slots in order = sensor order (aligned to keyboard.encoders[]). A knob
    // key's press is its own binding, so only an unlinked slot can carry one.
    config.layers.forEach((layer, li) => {
        const tokens: string[] = []
        layer.encoders?.forEach((e, ei) => {
            if (e.press) warnPress(['layers', li, 'encoders', ei, 'press'])
            tokens.push(
                pairToken(e.cw, e.ccw, `${li}_${ei}`, [
                    'layers',
                    li,
                    'encoders',
                    ei,
                ]),
            )
        })
        if (tokens.length) byLayer.set(li, tokens.join(' '))
    })

    return { behaviorLines, byLayer }
}

// Sliders → analog (ADC) input. ZMK has no first-class keymap behavior for an
// analog axis, so this emits a NOT-GENERATED guidance block (the io-channels /
// zephyr,user wiring lives in the board overlay) plus the per-layer value-map
// remappr DID capture, so the firmware author has the intent in one place.
// Returns [] when no position carries element:'slider'.
export function emitSliderInputs(config: ConfigKeymap, ctx: Ctx): string[] {
    const sliderKeys = config.keyboard.keys
        .map((k, i) => (k.element === 'slider' ? i : -1))
        .filter((i) => i >= 0)
    if (!sliderKeys.length) return []

    const mapNote: Record<string, string> = {
        volume: 'HID consumer volume (e.g. &kp C_VOL_UP/DOWN via a custom driver)',
        brightness: 'display/backlight brightness',
        mouse_wheel: 'mouse wheel (MOVE_Y / scroll report)',
        custom: 'custom behavior (see binding below)',
    }
    const out: string[] = [
        `    /* ─────────────────────────────────────────────────────────────────`,
        `     * SLIDER / ANALOG INPUT — NOT GENERATED by remappr`,
        `     * ZMK has no built-in keymap behavior for an analog axis. Add to your`,
        `     * board overlay: an &adc node, io-channels = <&adc N>, and a driver`,
        `     * (zephyr,user / custom behavior) that reads the channel and emits the`,
        `     * mapped output. remappr captured the value-map below so the intent is`,
        `     * in one place; wire the hardware side yourself.`,
        `     *`,
    ]
    sliderKeys.forEach((ki) => {
        const pin = config.keyboard.keys[ki]?.pin
        out.push(
            `     *   slider @ key ${ki}${pin ? ` (ADC pin ${pin})` : ''}:`,
        )
        config.layers.forEach((layer, li) => {
            const s = layer.sliderBindings?.[ki]
            if (!s) return
            const range =
                s.min !== undefined || s.max !== undefined
                    ? ` [${s.min ?? '…'}..${s.max ?? '…'}]`
                    : ''
            const custom =
                s.map === 'custom' && s.action
                    ? ` → ${emitBinding(s.action, ctx, ['layers', li, 'sliderBindings', ki, 'action'])}`
                    : ''
            out.push(
                `     *     ${layer.name}: ${s.map}${range} — ${mapNote[s.map]}${custom}`,
            )
        })
    })
    out.push(
        `     * ──────────────────────────────────────────────────────────────── */`,
        ``,
    )
    ctx.diag.warn(
        'sliders are analog (ADC) input — ZMK has no built-in behavior for them; a guidance block is emitted but the board-side io-channels/driver must be added by hand',
        ['keyboard', 'keys'],
    )
    return out
}

/** Config key indices as `.keymap` positions; keys outside the default layout
 *  are left out (the caller compares lengths to tell). */
export function keymapPositionList(
    keys: readonly number[],
    ctx: Ctx,
): number[] {
    const positions = ctx.positions
    if (!positions) return [...keys]
    return keys.flatMap((k) => {
        const p = positions.get(k)
        return p === undefined ? [] : [p]
    })
}

export function emitHoldTapDefs(defs: CanonHoldTapDef[], ctx: Ctx): string[] {
    const out: string[] = ['    behaviors {']
    defs.forEach((h, hi) => {
        const id = sanitize(h.id)
        out.push(
            `        ${id}: ${id} {`,
            `            compatible = "zmk,behavior-hold-tap";`,
            `            #binding-cells = <2>;`,
            `            bindings = <${h.bindings[0]}>, <${h.bindings[1]}>;`,
        )
        if (h.flavor) out.push(`            flavor = "${h.flavor}";`)
        if (h.tappingTermMs !== undefined)
            out.push(`            tapping-term-ms = <${h.tappingTermMs}>;`)
        if (h.quickTapMs !== undefined)
            out.push(`            quick-tap-ms = <${h.quickTapMs}>;`)
        if (h.requirePriorIdleMs !== undefined)
            out.push(
                `            require-prior-idle-ms = <${h.requirePriorIdleMs}>;`,
            )
        const wanted = h.holdTriggerKeyPositions ?? []
        const trigger = keymapPositionList(wanted, ctx)
        if (trigger.length < wanted.length) {
            ctx.diag.warn(
                `hold-tap "${h.id}": trigger keys outside the default layout were left out`,
                ['holdTaps', hi, 'holdTriggerKeyPositions'],
            )
        }
        if (trigger.length)
            out.push(
                `            hold-trigger-key-positions = <${trigger.join(' ')}>;`,
            )
        if (h.holdTriggerOnRelease)
            out.push(`            hold-trigger-on-release;`)
        if (h.retroTap) out.push(`            retro-tap;`)
        out.push(`        };`)
    })
    out.push('    };')
    return out
}

export function emitModMorphs(morphs: CanonModMorph[], ctx: Ctx): string[] {
    const out: string[] = ['    behaviors {']
    for (const mm of morphs) {
        const id = sanitize(mm.id)
        const b0 = emitBinding(mm.bindings[0], ctx, ['modMorphs', mm.id, 0])
        const b1 = emitBinding(mm.bindings[1], ctx, ['modMorphs', mm.id, 1])
        out.push(
            `        ${id}: ${id} {`,
            `            compatible = "zmk,behavior-mod-morph";`,
            `            #binding-cells = <0>;`,
            `            bindings = <${b0}>, <${b1}>;`,
            `            mods = <${modFlags(mm.mods)}>;`,
        )
        if (mm.keepMods?.length)
            out.push(`            keep-mods = <${modFlags(mm.keepMods)}>;`)
        out.push(`        };`)
    }
    out.push('    };')
    return out
}

export function emitTapDances(tds: CanonTapDance[], ctx: Ctx): string[] {
    const out: string[] = []
    out.push('    behaviors {')
    for (const td of tds) {
        if (td.hold) {
            ctx.diag.warn(
                `tap-dance "${td.id}" hold action is not representable in a ZMK tap-dance; dropped`,
                ['tapDances'],
            )
        }
        // ZMK reads tap-dance bindings POSITIONALLY (1st = 1 tap, 2nd = 2 taps,
        // …). A gap in the tap counts (e.g. [1, 3] with no 2) silently shifts the
        // higher action down a tap — the 3-tap binding would fire on 2 taps. Warn
        // when the counts aren't the contiguous 1..N ZMK assumes.
        const sortedTaps = [...td.taps].sort((a, b) => a.count - b.count)
        if (sortedTaps.some((t, i) => t.count !== i + 1)) {
            ctx.diag.warn(
                `tap-dance "${td.id}" tap counts [${sortedTaps
                    .map((t) => t.count)
                    .join(
                        ', ',
                    )}] are not contiguous from 1 — ZMK indexes bindings ` +
                    `by position, so a gap shifts the later actions to a lower tap count`,
                ['tapDances'],
            )
        }
        const bindings = sortedTaps.map(
            (t) => `<${emitBinding(t.action, ctx, ['tapDances'])}>`,
        )
        out.push(`        ${sanitize(td.id)}: ${sanitize(td.id)} {`)
        out.push(`            compatible = "zmk,behavior-tap-dance";`)
        out.push(`            #binding-cells = <0>;`)
        if (td.tappingTermMs !== undefined)
            out.push(`            tapping-term-ms = <${td.tappingTermMs}>;`)
        out.push(`            bindings = ${bindings.join(', ')};`)
        out.push(`        };`)
    }
    out.push('    };')
    return out
}
