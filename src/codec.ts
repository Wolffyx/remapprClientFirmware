// Pattern check: Strategy (Tier 1) — applied — per-firmware encode/decode codec swappable behind unified canonical catalog interface; renderer treats every adapter the same.
import type { CanonicalKeyId } from './catalog/types'

export interface EncodedKeycode {
    /** 32-bit packed value flowing through KeyAction.params[0]. */
    value: number
}

export interface DecodedKeycode {
    canonicalId: CanonicalKeyId
    /** For modifier-wrapped or layer-tap forms, decoder may return inner refs. */
    inner?: { layer?: number; mod?: number }
}

export interface KeycodeCodec {
    /** Returns null if this firmware cannot encode the canonical key. */
    encode(id: CanonicalKeyId): EncodedKeycode | null

    /** Returns null if raw value isn't a recognized canonical key. */
    decode(rawValue: number): DecodedKeycode | null

    /** Fast filter for catalog assembly. Default is to try encode and check. */
    supports(id: CanonicalKeyId): boolean

    /** This firmware's own spellings of the key (e.g. ZMK `C_VOL_UP`), shown
     *  beside it in the picker. Absent / empty = the firmware has none. */
    names?(id: CanonicalKeyId): readonly string[]
}
