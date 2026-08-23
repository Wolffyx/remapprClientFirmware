// Pattern check: Strategy (Tier 1) — applied — ZmkCodec implements KeycodeCodec for ZMK behavior bindings; HID page 7 + page 12 → ZMK key_press / consumer_press.
import { HID_USAGE_BY_CANONICAL, HID_USAGE_DECODE } from '../../catalog/entries'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

// ZMK speaks raw HID usages directly via &kp / &cp behaviors. The packed
// 32-bit value matches src/renderer/src/lib/actions/hidUsages.ts:25 today.
export class ZmkCodec implements KeycodeCodec {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        if (usage) return { value: (usage.page << 16) | usage.usage }
        return null
    }

    decode(rawValue: number): DecodedKeycode | null {
        const id = HID_USAGE_DECODE.get(rawValue >>> 0)
        return id ? { canonicalId: id } : null
    }

    supports(id: CanonicalKeyId): boolean {
        return HID_USAGE_BY_CANONICAL.has(id)
    }
}

export const zmkCodec = new ZmkCodec()
