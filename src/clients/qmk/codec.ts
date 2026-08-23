// Pattern check: Strategy (Tier 1) — applied — concrete QmkCodec implementing KeycodeCodec interface; encode/decode for QMK basic 16-bit keycodes (HID page 7 + quantum extras).
import { HID_USAGE_BY_CANONICAL } from '../../catalog/entries'
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode, KeycodeCodec } from '../../codec'
import { QMK_CANONICAL_BY_HEX, QMK_HEX_BY_CANONICAL } from './keycodes-hex'

const QK_BASIC_MAX = 0x00ff

const PAGE7_BY_USAGE: Map<number, CanonicalKeyId> = new Map()
for (const [id, usage] of HID_USAGE_BY_CANONICAL.entries()) {
    if (usage.page === 7 && usage.usage <= QK_BASIC_MAX) {
        PAGE7_BY_USAGE.set(usage.usage, id)
    }
}

export class QmkCodec implements KeycodeCodec {
    encode(id: CanonicalKeyId): EncodedKeycode | null {
        const usage = HID_USAGE_BY_CANONICAL.get(id)
        if (usage && usage.page === 7 && usage.usage <= QK_BASIC_MAX) {
            return { value: usage.usage }
        }
        const hex = QMK_HEX_BY_CANONICAL[id]
        if (hex !== undefined) {
            return { value: hex }
        }
        return null
    }

    decode(rawValue: number): DecodedKeycode | null {
        const code = rawValue & 0xffff
        // QMK_HEX_BY_CANONICAL wins (mouse.cursor.up at 0xCD beats the
        // HID page-7 "Keypad Space" alias). HID page-7 fallback covers
        // ordinary letter/number/modifier keys whose ids are auto-derived.
        const hexId = QMK_CANONICAL_BY_HEX.get(code)
        if (hexId) return { canonicalId: hexId }
        if (code <= QK_BASIC_MAX) {
            const id = PAGE7_BY_USAGE.get(code)
            if (id) return { canonicalId: id }
        }
        return null
    }

    supports(id: CanonicalKeyId): boolean {
        return this.encode(id) !== null
    }
}

export const qmkCodec = new QmkCodec()
