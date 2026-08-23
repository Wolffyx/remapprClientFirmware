// Pattern check: Strategy (Tier 1) — applied — MockCodec implements KeycodeCodec for demo flow; encodes/decodes (page<<16)|usage HID format with no firmware constraints.
import { HID_USAGE_BY_CANONICAL } from '../../catalog/entries'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

const BY_PACKED: Map<number, CanonicalKeyId> = new Map()
for (const [id, usage] of HID_USAGE_BY_CANONICAL.entries()) {
    BY_PACKED.set((usage.page << 16) | usage.usage, id)
}

// Vial macro-slot range (`macro.user.0..15`). These have no HID usage, so the
// demo keymap picker — which filters by codec.supports — would otherwise hide
// them and you couldn't bind a key to a macro. Mirror VialCodec's 0x7700 base so
// the demo can bind the same slots the mock `macros` facade edits.
const QK_MACRO = 0x7700
const QK_MACRO_MAX = 0x777f
const MACRO_PREFIX = 'macro.user.'

export class MockCodec implements KeycodeCodec {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        if (id.startsWith(MACRO_PREFIX)) {
            const idx = Number(id.slice(MACRO_PREFIX.length))
            if (Number.isInteger(idx) && idx >= 0 && idx <= 0x7f) {
                return { value: QK_MACRO + idx }
            }
            return null
        }
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        if (usage) {
            return { value: (usage.page << 16) | usage.usage }
        }
        return null
    }

    decode(rawValue: number): DecodedKeycode | null {
        const code = rawValue >>> 0
        if (code >= QK_MACRO && code <= QK_MACRO_MAX) {
            return { canonicalId: `${MACRO_PREFIX}${code - QK_MACRO}` }
        }
        const id = BY_PACKED.get(code)
        return id ? { canonicalId: id } : null
    }

    supports(id: CanonicalKeyId): boolean {
        return id.startsWith(MACRO_PREFIX) || HID_USAGE_BY_CANONICAL.has(id)
    }
}

export const mockCodec = new MockCodec()
