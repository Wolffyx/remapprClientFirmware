// Pattern check: Strategy (Tier 1) — extended — a firmware-neutral KeycodeCodec beside the per-firmware ones (src/codec.ts): plain HID usages, packed (page << 16) | id.
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../codec'
import { HID_USAGE_BY_CANONICAL } from './entries'
import type { CanonicalKeyId } from './types'

const BY_PACKED = new Map<number, CanonicalKeyId>()
for (const [id, usage] of HID_USAGE_BY_CANONICAL.entries()) {
    BY_PACKED.set((usage.page << 16) | usage.usage, id)
}

/**
 * Canonical keys as plain HID usages, packed `(page << 16) | id`: the packing
 * a device action's `usage` uses, and what a keyboard without its own keycode
 * scheme (the demo, the deviceless builder) stores. Covers every key the
 * catalog has a HID usage for.
 */
export const hidUsageCodec: KeycodeCodec = {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        return usage ? { value: (usage.page << 16) | usage.usage } : null
    },
    decode(rawValue: number): DecodedKeycode | null {
        const id = BY_PACKED.get(rawValue >>> 0)
        return id ? { canonicalId: id } : null
    },
    supports(id: CanonicalKeyId): boolean {
        return HID_USAGE_BY_CANONICAL.has(id)
    },
}
