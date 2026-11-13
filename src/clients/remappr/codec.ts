// Pattern check: Strategy (Tier 1) — extended — RemapprCodec is the KeycodeCodec
// strategy for the Remappr live blob, sibling of MockCodec/ZmkCodec. The blob
// stores keycodes as HID (page<<16)|usage, so encode/decode is a straight catalog
// lookup with no firmware-specific quantum range (unlike Vial's macro slots).
import { HID_USAGE_BY_CANONICAL, HID_USAGE_DECODE } from '../../catalog/entries'
import { remapprNames } from '../../catalog/firmwareSpellings'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

export class RemapprCodec implements KeycodeCodec {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        return usage ? { value: (usage.page << 16) | usage.usage } : null
    }

    decode(rawValue: number): DecodedKeycode | null {
        // Alias-aware: a usage folded onto a primary (Keypad Enter, Play)
        // still decodes, as the ZMK codec does.
        const id = HID_USAGE_DECODE.get(rawValue >>> 0)
        return id ? { canonicalId: id } : null
    }

    supports(id: CanonicalKeyId): boolean {
        return HID_USAGE_BY_CANONICAL.has(id)
    }

    names(id: CanonicalKeyId): readonly string[] {
        return remapprNames(id)
    }
}

export const remapprCodec = new RemapprCodec()
