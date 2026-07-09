import { describe, it, expect } from 'vitest'
import { MOUSE_COMMANDS } from '@firmware/mouseCommands'
import { packDelta, mouseCanonToZmk, decodeMouseDelta } from './mouseZmk'

describe('packDelta', () => {
    it('packs signed 16-bit x/y into the 32-bit param', () => {
        expect(packDelta(600, 0)).toBe(0x02580000) // move right (HW-confirmed)
        expect(packDelta(0, -10)).toBe(0x0000fff6) // scroll down (HW-confirmed)
        expect(packDelta(-600, 0)).toBe(0xfda80000)
        expect(packDelta(0, 600)).toBe(0x00000258)
    })
})

describe('mouseCanonToZmk', () => {
    it('maps buttons to &mkp with the HID bitmask', () => {
        const mask = (button: 'left' | 'right' | 'middle' | 'mb4' | 'mb5') =>
            mouseCanonToZmk({ type: 'mouse_key', button })
        expect(mask('left')).toEqual({ binding: '&mkp', param: 1 })
        expect(mask('right')).toEqual({ binding: '&mkp', param: 2 })
        expect(mask('middle')).toEqual({ binding: '&mkp', param: 4 })
        expect(mask('mb4')).toEqual({ binding: '&mkp', param: 8 })
        expect(mask('mb5')).toEqual({ binding: '&mkp', param: 16 })
    })

    it('maps move / scroll to &mmv / &msc with packed deltas', () => {
        expect(mouseCanonToZmk({ type: 'mouse_move', direction: 'right' })).toEqual({
            binding: '&mmv',
            param: 0x02580000,
        })
        expect(mouseCanonToZmk({ type: 'mouse_scroll', direction: 'down' })).toEqual({
            binding: '&msc',
            param: 0x0000fff6,
        })
    })

    it('returns undefined for a non-mouse action', () => {
        expect(mouseCanonToZmk({ type: 'bootloader' })).toBeUndefined()
    })
})

describe('decodeMouseDelta', () => {
    it('round-trips every command (encode → decode)', () => {
        for (const c of MOUSE_COMMANDS) {
            const enc = mouseCanonToZmk(c.canon)
            expect(enc).toBeDefined()
            expect(decodeMouseDelta(enc!.binding, enc!.param)?.label).toBe(c.label)
        }
    })

    it('returns undefined for an unknown param or binding', () => {
        expect(decodeMouseDelta('&mmv', 0x12345678)).toBeUndefined()
        expect(decodeMouseDelta('&kp', 1)).toBeUndefined()
    })
})
