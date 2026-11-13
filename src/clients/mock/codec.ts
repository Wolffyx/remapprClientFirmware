// Pattern check: Strategy (Tier 1) — applied — MockCodec implements KeycodeCodec for demo flow: the neutral HID-usage codec plus the demo's macro slots.
import { hidUsageCodec } from '../../catalog/hidUsageCodec'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'

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
        return hidUsageCodec.encode(id)
    }

    decode(rawValue: number): DecodedKeycode | null {
        const code = rawValue >>> 0
        if (code >= QK_MACRO && code <= QK_MACRO_MAX) {
            return { canonicalId: `${MACRO_PREFIX}${code - QK_MACRO}` }
        }
        return hidUsageCodec.decode(code)
    }

    supports(id: CanonicalKeyId): boolean {
        return id.startsWith(MACRO_PREFIX) || hidUsageCodec.supports(id)
    }
}

export const mockCodec = new MockCodec()
