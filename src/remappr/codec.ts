// Pattern check: Strategy (Tier 1) — extended — RemapprCodec is the KeycodeCodec
// strategy for the Remappr live blob, sibling of MockCodec/ZmkCodec. The blob
// stores keycodes as HID (page<<16)|usage, so encode/decode is a straight catalog
// lookup with no firmware-specific quantum range (unlike Vial's macro slots).
import { HID_USAGE_BY_CANONICAL } from '../catalog/entries'
import type { CanonicalKeyId } from '../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../codec'

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
        return HID_USAGE_BY_CANONICAL.has(id)
    }
}

export const remapprCodec = new RemapprCodec()
