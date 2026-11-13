// Pattern check: no GoF pattern (-) — rejected — a data table of slider maps plus
// pure lookups and slot transforms on the shared slot helpers (slots.ts).
//
// What a slider can do, firmware-neutral: set a level, or send keys. A level is
// the computer's (volume, screen brightness: sent as up / down steps, the
// computer never reports it back) or the keyboard's own (backlight, RGB: always
// in step). Which firmware builds which map is each target's own business.
//
// One slider model, like knobs (knobs.ts): a slider a designer places is a KEY
// (`element: "slider"`) with a SLOT (`keyboard.sliders[i]`, `key` = that key's
// index); what it does per layer is `layers[].sliders[i]` (null = as on the
// base layer). A slot without `key` is a slider with no key of its own (a
// device's fader, a decoded blob). The slot index is the slider index every
// firmware and live protocol uses.
import {
    keptSlots,
    remapSlotLinks,
    slotOfKey,
    slotsInSync,
    withSlots,
    type SlotKind,
} from './slots'
import type {
    CanonLayer,
    CanonSliderBinding,
    ConfigKeymap,
    SliderMap,
} from './types'

export interface SliderMapInfo {
    readonly id: SliderMap
    readonly label: string
    /** `level` sets a value across the travel; `keys` sends bindings. */
    readonly kind: 'level' | 'keys'
    /** Whose value a level is: the computer's or the keyboard's own. */
    readonly owner?: 'computer' | 'keyboard'
}

export const SLIDER_MAP_INFO: readonly SliderMapInfo[] = [
    { id: 'volume', label: 'Volume', kind: 'level', owner: 'computer' },
    {
        id: 'brightness',
        label: 'Screen brightness',
        kind: 'level',
        owner: 'computer',
    },
    { id: 'backlight', label: 'Backlight', kind: 'level', owner: 'keyboard' },
    {
        id: 'rgb_brightness',
        label: 'RGB brightness',
        kind: 'level',
        owner: 'keyboard',
    },
    { id: 'rgb_hue', label: 'RGB colour', kind: 'level', owner: 'keyboard' },
    { id: 'keys', label: 'Keys you pick', kind: 'keys' },
    { id: 'mouse_wheel', label: 'Scroll', kind: 'keys' },
    { id: 'custom', label: 'Custom action', kind: 'keys' },
]

export function sliderMapInfo(id: SliderMap): SliderMapInfo {
    return SLIDER_MAP_INFO.find((m) => m.id === id) ?? SLIDER_MAP_INFO[0]!
}

const SLIDER: SlotKind = { element: 'slider', field: 'sliders' }

/** The older per-key slider bindings (`layers[].sliderBindings`), one map per
 *  layer, keyed by key index. Read once when a design loads. */
export type LegacySliderBindings = (
    Record<number, CanonSliderBinding> | undefined
)[]

/** `layer` with `sliders` (all null = the field left out). */
function withLayerSliders(
    layer: CanonLayer,
    sliders: readonly (CanonSliderBinding | null)[],
): CanonLayer {
    const { sliders: _old, ...rest } = layer
    return sliders.some((b) => b) ? { ...rest, sliders: [...sliders] } : rest
}

/** Bring the slots in line with the slider keys: one slot per slider key (made
 *  when missing, dropped when its key is gone or no longer a slider), each
 *  layer's `sliders` re-aligned to the slots. `legacy` moves older per-key
 *  bindings into the slots. */
export function syncSliders(
    config: ConfigKeymap,
    legacy?: LegacySliderBindings,
): ConfigKeymap {
    const hasLegacy = !!legacy?.some((m) => m && Object.keys(m).length)
    if (!hasLegacy && slotsInSync(config, SLIDER)) return config
    const kept = keptSlots(config, SLIDER)
    return {
        ...config,
        keyboard: withSlots(config.keyboard, SLIDER, kept),
        layers: config.layers.map((l, li) =>
            withLayerSliders(
                l,
                kept.map(({ slot, from }) => {
                    const prev = from === null ? undefined : l.sliders?.[from]
                    const moved =
                        slot.key === undefined ? undefined : legacy?.[li]?.[slot.key]
                    return prev ?? moved ?? null
                }),
            ),
        ),
    }
}

/** Follow a key renumbering (`remap[old] = new`, -1 = removed) in the slot
 *  links, then re-sync. Slots whose key was removed go with it. */
export function remapSliderKeys(
    config: ConfigKeymap,
    remap: readonly number[],
): ConfigKeymap {
    return syncSliders(remapSlotLinks(config, SLIDER, remap) ?? config)
}

/** The slot index of the slider at key `keyIndex`, or -1. */
export function sliderSlotOf(config: ConfigKeymap, keyIndex: number): number {
    return slotOfKey(config, SLIDER, keyIndex)
}

/** What slider `slot` does on layer `layerIndex` as set there (null = as on
 *  the base layer). */
export function sliderBindingAt(
    config: ConfigKeymap,
    layerIndex: number,
    slot: number,
): CanonSliderBinding | null {
    return config.layers[layerIndex]?.sliders?.[slot] ?? null
}

/** `config` with slider `slot` doing `binding` on layer `layerIndex` (null =
 *  as on the base layer). Unchanged for a slot the keyboard does not have. */
export function setSliderBinding(
    config: ConfigKeymap,
    layerIndex: number,
    slot: number,
    binding: CanonSliderBinding | null,
): ConfigKeymap {
    const count = config.keyboard.sliders?.length ?? 0
    if (slot < 0 || slot >= count || !config.layers[layerIndex]) return config
    return {
        ...config,
        layers: config.layers.map((l, li) => {
            if (li !== layerIndex) return l
            const sliders = Array.from(
                { length: count },
                (_, i) => l.sliders?.[i] ?? null,
            )
            sliders[slot] = binding
            return withLayerSliders(l, sliders)
        }),
    }
}
