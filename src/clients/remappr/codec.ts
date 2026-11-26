// Pattern check: Strategy (Tier 1) — extended — RemapprCodec is the KeycodeCodec
// strategy for the Remappr live blob, sibling of MockCodec/ZmkCodec. The blob
// stores keycodes as HID (page<<16)|usage, so encode/decode is a straight catalog
// lookup with no firmware-specific quantum range (unlike Vial's macro slots).
import { HID_USAGE_BY_CANONICAL, HID_USAGE_DECODE } from '../../catalog/entries'
import { remapprNames } from '../../catalog/firmwareSpellings'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

/** Keyboard-page usages the firmware sends: 0x00..0xA7 (REMAPPR_KBD_USAGE_MAX)
 *  and the modifiers 0xE0..0xE7. It drops the rest, so they are not offered. */
const KBD_USAGE_MAX = 0xa7
const sendable = (page: number, usage: number): boolean =>
    page !== 7 || usage <= KBD_USAGE_MAX || (usage >= 0xe0 && usage <= 0xe7)

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
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        return usage !== undefined && sendable(usage.page, usage.usage)
    }

    names(id: CanonicalKeyId): readonly string[] {
        return remapprNames(id)
    }
}

export const remapprCodec = new RemapprCodec()
