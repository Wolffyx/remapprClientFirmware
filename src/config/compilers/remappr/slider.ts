// Pattern check: Dispatch Map (Tier 0) — applied — each SliderMap is one row (a LEVEL target or the STEPS up / down actions); encode reads it, decode reverses it.
//
// What each slider does (`layers[].sliders`, slot = slider index) <-> TBL_SLIDER
// (table 32, version 1). Byte layout mirrors firmware include/remappr/config_blob.h
// (slider part design §4b):
//
//   u16 count
//   count x {u8 slider, u8 layer (0xFF any), u8 kind (1 LEVEL, 2 STEPS),
//            u8 arg (LEVEL target / STEPS count), u8 min, u8 max,
//            u16 up_bh, u16 down_bh (STEPS behavior indices, 0xFFFF none)}
//
// The firmware knows two kinds; every map compiles to one. A level the
// keyboard owns (RGB) is LEVEL; the computer's levels, the wheel and keys are
// STEPS that fire up / down per step crossed. The base layer's entry is the
// any-layer one, so a layer that sets nothing follows the base layer.
import type { DiagnosticBag } from '../../diagnostics'
import type {
    CanonAction,
    CanonLayer,
    CanonSliderBinding,
    ConfigKeymap,
    SliderMap,
} from '../../types'
import type { SliderRecord } from './blobWriter'
import { ByteReader, type TableFrame } from './decode'

export const SLIDER_KIND = { LEVEL: 1, STEPS: 2 } as const
export const SLIDER_ANY_LAYER = 0xff
export const SLIDER_BH_NONE = 0xffff
import { SLIDER_STEPS_DEFAULT, SLIDER_STEPS_MAX } from '../../sliders'

export { SLIDER_STEPS_DEFAULT, SLIDER_STEPS_MAX }

const key = (id: string): CanonAction =>
    ({ type: 'key_press', key: id }) as CanonAction
const scroll = (direction: 'up' | 'down'): CanonAction => ({
    type: 'mouse_scroll',
    direction,
})

/** A map's wire form: a LEVEL target, or the STEPS actions (the binding's own
 *  for `keys` / `custom`). */
type Wire =
    | { kind: 'level'; target: number }
    | { kind: 'steps'; up?: CanonAction; down?: CanonAction }

const FIXED_STEPS: Partial<Record<SliderMap, { up: CanonAction; down: CanonAction }>> = {
    volume: { up: key('media.volume_increment'), down: key('media.volume_decrement') },
    brightness: {
        up: key('consumer.display_brightness_increment'),
        down: key('consumer.display_brightness_decrement'),
    },
    mouse_wheel: { up: scroll('up'), down: scroll('down') },
}

const LEVEL_TARGET: Partial<Record<SliderMap, number>> = {
    rgb_brightness: 1,
    rgb_hue: 2,
}

/** Every map the firmware can run: the LEVEL targets, the fixed STEPS maps,
 *  and the two that carry their own actions. */
export const REMAPPR_SLIDER_MAPS: readonly SliderMap[] = [
    ...(Object.keys(LEVEL_TARGET) as SliderMap[]),
    ...(Object.keys(FIXED_STEPS) as SliderMap[]),
    'keys',
    'custom',
]

/** The map's wire form, or undefined when the firmware has none (backlight). */
function wireOf(s: CanonSliderBinding): Wire | undefined {
    const target = LEVEL_TARGET[s.map]
    if (target !== undefined) return { kind: 'level', target }
    const fixed = FIXED_STEPS[s.map]
    if (fixed) return { kind: 'steps', ...fixed }
    if (s.map === 'keys') return { kind: 'steps', up: s.up, down: s.down }
    if (s.map === 'custom') return { kind: 'steps', up: s.action }
    return undefined
}

/** A percentage (0..100) on the wire's 0..255. */
const pct255 = (v: number | undefined, dflt: number): number =>
    Math.round((Math.min(100, Math.max(0, v ?? dflt)) * 255) / 100)

const from255 = (v: number): number => Math.round((v * 100) / 255)

/** The TBL_SLIDER entries for `config`. `lower` turns an action into its
 *  BEHAVIOR-table index; maps the firmware cannot run are warned and left out. */
export function sliderRecords(
    config: ConfigKeymap,
    lower: (a: CanonAction, path: (string | number)[]) => number,
    diag: DiagnosticBag,
    target: string,
): SliderRecord[] {
    const out: SliderRecord[] = []
    config.layers.forEach((layer, li) => {
        layer.sliders?.forEach((s, si) => {
            if (!s) return
            const path = ['layers', li, 'sliders', si]
            const wire = wireOf(s)
            if (!wire) {
                diag.warn(`${target} can't use a slider for "${s.map}", so it was left out.`, path)
                return
            }
            const base = { slider: si, layer: li === 0 ? SLIDER_ANY_LAYER : li }
            if (wire.kind === 'level') {
                out.push({
                    ...base,
                    kind: SLIDER_KIND.LEVEL,
                    arg: wire.target,
                    min: pct255(s.min, 0),
                    max: pct255(s.max, 100),
                    upIndex: SLIDER_BH_NONE,
                    downIndex: SLIDER_BH_NONE,
                })
                return
            }
            const steps = s.steps ?? SLIDER_STEPS_DEFAULT
            const arg = Math.min(SLIDER_STEPS_MAX, Math.max(1, Math.round(steps)))
            if (arg !== steps)
                diag.warn(`slider steps ${steps} set to ${arg} (1..${SLIDER_STEPS_MAX}).`, [...path, 'steps'])
            out.push({
                ...base,
                kind: SLIDER_KIND.STEPS,
                arg,
                min: 0,
                max: 0,
                upIndex: wire.up ? lower(wire.up, [...path, 'up']) : SLIDER_BH_NONE,
                downIndex: wire.down ? lower(wire.down, [...path, 'down']) : SLIDER_BH_NONE,
            })
        })
    })
    return out
}

/* ── decode ─────────────────────────────────────────────────────────────── */

/** Same step action, by what it sends. */
function sameStep(a: CanonAction | undefined, b: CanonAction): boolean {
    if (!a || a.type !== b.type) return false
    if (a.type === 'key_press' && b.type === 'key_press')
        return a.key === b.key && !a.mods?.length
    if (a.type === 'mouse_scroll' && b.type === 'mouse_scroll')
        return a.direction === b.direction
    return false
}

/** The map a STEPS entry came from: a fixed map whose actions it fires, else
 *  `keys` with its own. */
function stepsBinding(
    steps: number,
    up: CanonAction | undefined,
    down: CanonAction | undefined,
): CanonSliderBinding {
    const fixed = (Object.keys(FIXED_STEPS) as SliderMap[]).find((m) => {
        const f = FIXED_STEPS[m]!
        return sameStep(up, f.up) && sameStep(down, f.down)
    })
    if (fixed) return { map: fixed, steps }
    return {
        map: 'keys',
        steps,
        ...(up ? { up } : {}),
        ...(down ? { down } : {}),
    }
}

function levelBinding(target: number, min: number, max: number): CanonSliderBinding | undefined {
    const map = (Object.keys(LEVEL_TARGET) as SliderMap[]).find(
        (m) => LEVEL_TARGET[m] === target,
    )
    return map ? { map, min: from255(min), max: from255(max) } : undefined
}

/** TBL_SLIDER read back into `layers[].sliders` (slot = slider index; the
 *  any-layer entry is the base layer's). */
export function readSliders(
    bytes: Uint8Array,
    t: TableFrame,
    decoded: readonly CanonAction[],
    layers: CanonLayer[],
    diag: DiagnosticBag,
): void {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const action = (idx: number): CanonAction | undefined => {
        if (idx === SLIDER_BH_NONE) return undefined
        if (idx < decoded.length) return decoded[idx]
        diag.error(`slider references behavior ${idx}`)
        return undefined
    }
    for (let i = 0; i < count; i++) {
        const [slider, layer, kind, arg, min, max] = [r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8()]
        const up = action(r.u16())
        const down = action(r.u16())
        const li = layer === SLIDER_ANY_LAYER ? 0 : layer
        const binding =
            kind === SLIDER_KIND.LEVEL
                ? levelBinding(arg, min, max)
                : kind === SLIDER_KIND.STEPS
                  ? stepsBinding(arg, up, down)
                  : undefined
        if (!binding || li >= layers.length) {
            diag.error(`slider entry ${i} (kind ${kind}, layer ${layer}) is not readable`)
            continue
        }
        const lay = layers[li]!
        const sliders = lay.sliders ?? []
        while (sliders.length <= slider) sliders.push(null)
        sliders[slider] = binding
        lay.sliders = sliders
    }
    // Every layer the same length, so the slots line up.
    const n = Math.max(0, ...layers.map((l) => l.sliders?.length ?? 0))
    for (const l of layers) {
        if (!l.sliders) continue
        while (l.sliders.length < n) l.sliders.push(null)
    }
}
