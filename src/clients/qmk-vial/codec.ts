// Pattern check: Strategy (Tier 1) — extended — VialCodec extends QmkCodec strategy; adds Vial macro range encode/decode; cite src/firmware/qmk/codec.ts.
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode } from '../../codec'
import { QmkCodec } from '../qmk/codec'

const QK_MACRO = 0x7700
const QK_MACRO_MAX = 0x777f
const MACRO_PREFIX = 'macro.user.'

export class VialCodec extends QmkCodec {
    override encode(id: CanonicalKeyId): EncodedKeycode | null {
        if (id.startsWith(MACRO_PREFIX)) {
            const idx = Number(id.slice(MACRO_PREFIX.length))
            if (Number.isFinite(idx) && idx >= 0 && idx <= 0x7f) {
                return { value: QK_MACRO + idx }
            }
            return null
        }
        return super.encode(id)
    }

    override decode(rawValue: number): DecodedKeycode | null {
        const code = rawValue & 0xffff
        if (code >= QK_MACRO && code <= QK_MACRO_MAX) {
            return { canonicalId: `${MACRO_PREFIX}${code - QK_MACRO}` }
        }
        return super.decode(rawValue)
    }

    override supports(id: CanonicalKeyId): boolean {
        if (id.startsWith(MACRO_PREFIX)) {
            const idx = Number(id.slice(MACRO_PREFIX.length))
            return Number.isFinite(idx) && idx >= 0 && idx <= 0x7f
        }
        return super.supports(id)
    }
}

export const vialCodec = new VialCodec()
