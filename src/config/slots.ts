// Pattern check: no GoF pattern (-) — rejected — pure config transforms parameterized by a two-field kind descriptor; knobs and sliders share them.
//
// Input slots: an input that is not a plain key (a knob, a slider) lives in a
// SLOT list on the keyboard (`keyboard.encoders`, `keyboard.sliders`), each
// layer's bindings for it index-aligned to that list. A slot linked to a key
// (`key` = the key's index, which has the matching `element`) sits where the
// key does; a slot without `key` has no key of its own (a device's own input,
// a decoded blob). The slot index is the index every compiler and live
// protocol uses. knobs.ts and sliders.ts build their sync on these.
import type { CanonEncoderSlot, ConfigKeyboard, ConfigKeymap } from './types'

/** Which keys own which slot list. */
export interface SlotKind {
    readonly element: 'encoder' | 'slider'
    readonly field: 'encoders' | 'sliders'
}

export interface KeptSlot {
    slot: CanonEncoderSlot
    /** Index in the old slot list, or null for a slot made for a key. */
    from: number | null
}

const slotsOf = (kb: ConfigKeyboard, kind: SlotKind) => kb[kind.field] ?? []

/** True when every key of the kind has exactly one slot that sits where it
 *  does, and no slot points at a key of another kind. */
export function slotsInSync(config: ConfigKeymap, kind: SlotKind): boolean {
    const keys = config.keyboard.keys
    const linked = new Set<number>()
    for (const s of slotsOf(config.keyboard, kind)) {
        if (s.key === undefined) continue
        const k = keys[s.key]
        if (k?.element !== kind.element || linked.has(s.key)) return false
        if (s.x !== k.x || s.y !== k.y) return false
        linked.add(s.key)
    }
    return keys.every((k, i) => k.element !== kind.element || linked.has(i))
}

/** The slots after a sync: unlinked ones kept, linked ones moved to their key
 *  (dropped when the key is gone or of another kind), one made per key left. */
export function keptSlots(config: ConfigKeymap, kind: SlotKind): KeptSlot[] {
    const keys = config.keyboard.keys
    const seen = new Set<number>()
    const kept: KeptSlot[] = []
    slotsOf(config.keyboard, kind).forEach((slot, from) => {
        if (slot.key === undefined) {
            kept.push({ slot, from })
            return
        }
        const k = keys[slot.key]
        if (k?.element !== kind.element || seen.has(slot.key)) return
        seen.add(slot.key)
        kept.push({ slot: { x: k.x, y: k.y, key: slot.key }, from })
    })
    keys.forEach((k, i) => {
        if (k.element !== kind.element || seen.has(i)) return
        kept.push({ slot: { x: k.x, y: k.y, key: i }, from: null })
    })
    return kept
}

/** The keyboard with `kept` as its slot list (none = the field left out). */
export function withSlots(
    kb: ConfigKeyboard,
    kind: SlotKind,
    kept: readonly KeptSlot[],
): ConfigKeyboard {
    const { [kind.field]: _old, ...rest } = kb
    return kept.length ? { ...rest, [kind.field]: kept.map((k) => k.slot) } : rest
}

/** `config` with the slot links following a key renumbering (`remap[old] =
 *  new`, -1 = removed), or null when no slot is linked. */
export function remapSlotLinks(
    config: ConfigKeymap,
    kind: SlotKind,
    remap: readonly number[],
): ConfigKeymap | null {
    const slots = config.keyboard[kind.field]
    if (!slots?.some((s) => s.key !== undefined)) return null
    return {
        ...config,
        keyboard: {
            ...config.keyboard,
            [kind.field]: slots.map((s) =>
                s.key === undefined ? s : { ...s, key: remap[s.key] ?? -1 },
            ),
        },
    }
}

/** The slot index of the input at key `keyIndex`, or -1. */
export function slotOfKey(
    config: ConfigKeymap,
    kind: SlotKind,
    keyIndex: number,
): number {
    return slotsOf(config.keyboard, kind).findIndex((s) => s.key === keyIndex)
}
