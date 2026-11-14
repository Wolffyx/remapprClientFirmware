// Pattern check: Strategy (Tier 1) — extended — RemapprCodec is the KeycodeCodec
// strategy for the Remappr live blob, sibling of MockCodec/ZmkCodec. The blob
// stores keycodes as HID (page<<16)|usage, so encode/decode is a straight catalog
// lookup with no firmware-specific quantum range (unlike Vial's macro slots).
import { HID_USAGE_BY_CANONICAL } from '../../catalog/entries'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

/** Keyboard-page usages the firmware sends: 0x00..0xA7 (REMAPPR_KBD_USAGE_MAX)
 *  and the modifiers 0xE0..0xE7. It drops the rest, so they are not offered. */
const KBD_USAGE_MAX = 0xa7
const sendable = (page: number, usage: number): boolean =>
    page !== 7 || usage <= KBD_USAGE_MAX || (usage >= 0xe0 && usage <= 0xe7)

const BY_PACKED: Map<number, CanonicalKeyId> = new Map()
for (const [id, usage] of HID_USAGE_BY_CANONICAL.entries()) {
    BY_PACKED.set((usage.page << 16) | usage.usage, id)
}

export class RemapprCodec implements KeycodeCodec {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        return usage ? { value: (usage.page << 16) | usage.usage } : null
    }

    decode(rawValue: number): DecodedKeycode | null {
        const id = BY_PACKED.get(rawValue >>> 0)
        return id ? { canonicalId: id } : null
    }

    supports(id: CanonicalKeyId): boolean {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        return usage !== undefined && sendable(usage.page, usage.usage)
    }
}

export const remapprCodec = new RemapprCodec()
