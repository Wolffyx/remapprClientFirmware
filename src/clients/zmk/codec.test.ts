// Pattern check: no GoF pattern (-) — rejected — vitest unit tests for ZmkCodec packed (page<<16)|usage round-trips; assertions only.
import { describe, expect, it } from 'vitest'

import { zmkCodec } from './codec'

describe('ZmkCodec', () => {
    it('encodes HID page-7 letter as packed (7<<16)|0x04', () => {
        const enc = zmkCodec.encode('key.keyboard_a')
        expect(enc?.value).toBe((7 << 16) | 0x04)
    })

    it('decodes packed (7<<16)|0x04 back to key.keyboard_a', () => {
        expect(zmkCodec.decode((7 << 16) | 0x04)?.canonicalId).toBe(
            'key.keyboard_a',
        )
    })

    it('encodes consumer page entries with page=12', () => {
        const enc = zmkCodec.encode('media.eject')
        expect(enc).not.toBeNull()
        expect(enc!.value >>> 16).toBe(12)
    })

    it('returns null for non-HID canonical ids', () => {
        expect(zmkCodec.encode('wireless.profile.1')).toBeNull()
        expect(zmkCodec.encode('rgb.toggle')).toBeNull()
        expect(zmkCodec.encode('system.bootloader')).toBeNull()
    })

    it('supports() agrees with encode()', () => {
        expect(zmkCodec.supports('key.keyboard_a')).toBe(true)
        expect(zmkCodec.supports('rgb.toggle')).toBe(false)
    })
})
