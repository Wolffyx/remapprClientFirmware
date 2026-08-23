// Pattern check: no GoF pattern (-) — rejected — vitest unit tests for VialCodec macro range round-trip; data-driven assertions.
import { describe, expect, it } from 'vitest'

import { vialCodec } from './codec'

describe('VialCodec', () => {
    it('encodes macro.user.0 to 0x7700', () => {
        expect(vialCodec.encode('macro.user.0')?.value).toBe(0x7700)
    })

    it('encodes macro.user.5 to 0x7705', () => {
        expect(vialCodec.encode('macro.user.5')?.value).toBe(0x7705)
    })

    it('decodes 0x7705 back to macro.user.5', () => {
        expect(vialCodec.decode(0x7705)?.canonicalId).toBe('macro.user.5')
    })

    it('rejects out-of-range macro indices', () => {
        expect(vialCodec.encode('macro.user.9999')).toBeNull()
    })

    it('falls through to QMK basic for HID page-7 entries', () => {
        expect(vialCodec.encode('key.keyboard_a')?.value).toBe(0x04)
    })
})
