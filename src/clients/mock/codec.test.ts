// Pattern check: no GoF pattern (-) — rejected — vitest unit tests for MockCodec HID-only encode/decode; assertions only.
import { describe, expect, it } from 'vitest'

import { mockCodec } from './codec'

describe('MockCodec', () => {
    it('encodes HID letter as packed (7<<16)|0x04', () => {
        expect(mockCodec.encode('key.keyboard_a')?.value).toBe((7 << 16) | 0x04)
    })

    it('round-trips key.keyboard_a', () => {
        const enc = mockCodec.encode('key.keyboard_a')
        expect(mockCodec.decode(enc!.value)?.canonicalId).toBe('key.keyboard_a')
    })

    it('returns null for firmware-only canonical ids', () => {
        expect(mockCodec.encode('wireless.profile.1')).toBeNull()
        expect(mockCodec.encode('rgb.toggle')).toBeNull()
        expect(mockCodec.encode('mouse.cursor.up')).toBeNull()
    })

    it('round-trips macro slots over the 0x7700 range so the demo can bind them', () => {
        expect(mockCodec.encode('macro.user.0')?.value).toBe(0x7700)
        expect(mockCodec.encode('macro.user.15')?.value).toBe(0x770f)
        expect(mockCodec.decode(0x770f)?.canonicalId).toBe('macro.user.15')
        expect(mockCodec.supports('macro.user.3')).toBe(true)
    })
})
