// Pattern check: no GoF pattern (-) — rejected — pure config transforms (sync + remap) over plain data, on the shared slot helpers (slots.ts).
//
// One knob model. A knob a designer places is a KEY (`element: "encoder"`): its
// press is that key's binding. Its turns live in an encoder SLOT
// (`keyboard.encoders[i]`, `key` = that key's index) with the per-layer turn
// bindings in `layers[].encoders[i]`. A slot without `key` is a knob that has no
// keymap position of its own (an imported VIA definition, a decoded blob). The
// slot index is the encoder index every compiler and live protocol uses.
import {
    keptSlots,
    remapSlotLinks,
    slotOfKey,
    slotsInSync,
    withSlots,
    type SlotKind,
} from './slots'
import type { CanonAction, CanonEncoderBinding, ConfigKeymap } from './types'

const TRANS: CanonAction = { type: 'transparent' }

/** The older per-key turn bindings (`layers[].encoderBindings`), one map per
 *  layer, keyed by key index. Read once when a design loads. */
export type LegacyKnobBindings = (
    Record<number, CanonEncoderBinding> | undefined
)[]

const KNOB: SlotKind = { element: 'encoder', field: 'encoders' }

/** A linked knob's press is its key's binding, so its slot carries none. */
const turnsOnly = (b: CanonEncoderBinding): CanonEncoderBinding => ({
    cw: b.cw,
    ccw: b.ccw,
})

/** Bring the slots in line with the knob keys: one slot per knob key (made
 *  when missing, dropped when its key is gone or no longer a knob), each
 *  layer's `encoders` re-aligned to the slots. `legacy` moves older per-key
 *  turn bindings into the slots, and a legacy press into the key's binding. */
export function syncKnobs(
    config: ConfigKeymap,
    legacy?: LegacyKnobBindings,
): ConfigKeymap {
    const hasLegacy = !!legacy?.some((m) => m && Object.keys(m).length)
    if (!hasLegacy && slotsInSync(config, KNOB)) return config
    const kept = keptSlots(config, KNOB)
    const made = kept.some((k) => k.from === null)
    return {
        ...config,
        keyboard: withSlots(config.keyboard, KNOB, kept),
        layers: config.layers.map((l, li) => {
            const { encoders: prevEnc, ...rest } = l
            const old = legacy?.[li]
            const bindings = [...l.bindings]
            const encoders = kept.map(({ slot, from }) => {
                const prev = from === null ? undefined : prevEnc?.[from]
                const moved =
                    slot.key === undefined ? undefined : old?.[slot.key]
                if (slot.key !== undefined && moved?.press)
                    bindings[slot.key] = moved.press
                const b = prev ?? moved ?? { cw: TRANS, ccw: TRANS }
                return slot.key === undefined ? b : turnsOnly(b)
            })
            const keep = kept.length && (prevEnc || old || made)
            return keep
                ? { ...rest, bindings, encoders }
                : { ...rest, bindings }
        }),
    }
}

/** Follow a key renumbering (`remap[old] = new`, -1 = removed) in the slot
 *  links, then re-sync. Slots whose key was removed go with it. */
export function remapKnobKeys(
    config: ConfigKeymap,
    remap: readonly number[],
): ConfigKeymap {
    return syncKnobs(remapSlotLinks(config, KNOB, remap) ?? config)
}

/** The slot index of the knob at key `keyIndex`, or -1. */
export function knobSlotOf(config: ConfigKeymap, keyIndex: number): number {
    return slotOfKey(config, KNOB, keyIndex)
}
