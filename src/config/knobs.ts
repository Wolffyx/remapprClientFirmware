// Pattern check: no GoF pattern (-) — rejected — pure config transforms (sync + remap) over plain data; no polymorphism.
//
// One knob model. A knob a designer places is a KEY (`element: "encoder"`): its
// press is that key's binding. Its turns live in an encoder SLOT
// (`keyboard.encoders[i]`, `key` = that key's index) with the per-layer turn
// bindings in `layers[].encoders[i]`. A slot without `key` is a knob that has no
// keymap position of its own (an imported VIA definition, a decoded blob). The
// slot index is the encoder index every compiler and live protocol uses.
import type {
    CanonAction,
    CanonEncoderBinding,
    CanonEncoderSlot,
    ConfigKeymap,
} from './types'

const TRANS: CanonAction = { type: 'transparent' }

/** The older per-key turn bindings (`layers[].encoderBindings`), one map per
 *  layer, keyed by key index. Read once when a design loads. */
export type LegacyKnobBindings = (
    Record<number, CanonEncoderBinding> | undefined
)[]

interface KeptSlot {
    slot: CanonEncoderSlot
    /** Index in the old slot list, or null for a slot made for a knob key. */
    from: number | null
}

/** True when every knob key has exactly one slot that sits where it does,
 *  and no slot points at a key that is not a knob. */
function inSync(config: ConfigKeymap): boolean {
    const keys = config.keyboard.keys
    const linked = new Set<number>()
    for (const s of config.keyboard.encoders ?? []) {
        if (s.key === undefined) continue
        const k = keys[s.key]
        if (k?.element !== 'encoder' || linked.has(s.key)) return false
        if (s.x !== k.x || s.y !== k.y) return false
        linked.add(s.key)
    }
    return keys.every((k, i) => k.element !== 'encoder' || linked.has(i))
}

function keptSlots(config: ConfigKeymap): KeptSlot[] {
    const keys = config.keyboard.keys
    const seen = new Set<number>()
    const kept: KeptSlot[] = []
    ;(config.keyboard.encoders ?? []).forEach((slot, from) => {
        if (slot.key === undefined) {
            kept.push({ slot, from })
            return
        }
        const k = keys[slot.key]
        if (k?.element !== 'encoder' || seen.has(slot.key)) return
        seen.add(slot.key)
        kept.push({ slot: { x: k.x, y: k.y, key: slot.key }, from })
    })
    keys.forEach((k, i) => {
        if (k.element !== 'encoder' || seen.has(i)) return
        kept.push({ slot: { x: k.x, y: k.y, key: i }, from: null })
    })
    return kept
}

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
    if (!hasLegacy && inSync(config)) return config
    const kept = keptSlots(config)
    const made = kept.some((k) => k.from === null)
    const { encoders: _old, ...keyboard } = config.keyboard
    return {
        ...config,
        keyboard: kept.length
            ? { ...keyboard, encoders: kept.map((k) => k.slot) }
            : keyboard,
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
    const encoders = config.keyboard.encoders
    if (!encoders?.some((s) => s.key !== undefined)) return syncKnobs(config)
    return syncKnobs({
        ...config,
        keyboard: {
            ...config.keyboard,
            encoders: encoders.map((s) =>
                s.key === undefined ? s : { ...s, key: remap[s.key] ?? -1 },
            ),
        },
    })
}

/** The slot index of the knob at key `keyIndex`, or -1. */
export function knobSlotOf(config: ConfigKeymap, keyIndex: number): number {
    return (config.keyboard.encoders ?? []).findIndex((s) => s.key === keyIndex)
}
