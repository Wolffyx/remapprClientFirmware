// Pattern check: Strategy (Tier 1) — extended — KeychronCodec extends QmkCodec strategy; adds QK_KB_0..31 range encode/decode for wireless + OS keys; cite src/firmware/qmk/codec.ts.
import type { CanonicalKeyId } from '../../catalog/types'
import type { DecodedKeycode, EncodedKeycode } from '../../codec'
import { QmkCodec } from '../qmk/codec'

const QK_KB_BASE = 0x7e00
const QK_KB_END = 0x7e1f

// Keychron QK_KB offsets for K-series wireless build (LK_WIRELESS_ENABLE,
// no analog, no LED matrix). Mirrors src/firmware/keychron/keycodes.ts:58.
const CANONICAL_TO_OFFSET: Record<CanonicalKeyId, number> = {
    'os.mac.lopt': 0x00,
    'os.mac.ropt': 0x01,
    'os.mac.lcmd': 0x02,
    'os.mac.rcmd': 0x03,
    'os.mac.mission_control': 0x04,
    'os.mac.launchpad': 0x05,
    'os.win.task_view': 0x06,
    'os.win.file_explorer': 0x07,
    'os.mac.screenshot': 0x08,
    'os.win.cortana': 0x09,
    'os.system.lock_screen': 0x0a,
    'os.mac.siri': 0x0b,
    'wireless.profile.1': 0x0c,
    'wireless.profile.2': 0x0d,
    'wireless.profile.3': 0x0e,
    'wireless.output.2p4ghz': 0x0f,
    'wireless.battery.level': 0x10,
}

const OFFSET_TO_CANONICAL: Map<number, CanonicalKeyId> = new Map(
    Object.entries(CANONICAL_TO_OFFSET).map(([id, off]) => [off, id]),
)

export class KeychronCodec extends QmkCodec {
    override encode(id: CanonicalKeyId): EncodedKeycode | null {
        const offset = CANONICAL_TO_OFFSET[id]
        if (offset !== undefined) {
            return { value: QK_KB_BASE + offset }
        }
        return super.encode(id)
    }

    override decode(rawValue: number): DecodedKeycode | null {
        const code = rawValue & 0xffff
        if (code >= QK_KB_BASE && code <= QK_KB_END) {
            const offset = code - QK_KB_BASE
            const id = OFFSET_TO_CANONICAL.get(offset)
            if (id) return { canonicalId: id }
            return null
        }
        return super.decode(rawValue)
    }

    override supports(id: CanonicalKeyId): boolean {
        return id in CANONICAL_TO_OFFSET || super.supports(id)
    }
}

export const keychronCodec = new KeychronCodec()
