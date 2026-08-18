// Pattern check: no GoF pattern (-) — rejected — vitest unit tests asserting codec encode/decode round-trips for canonical entries; data-driven assertions.
import { describe, expect, it } from 'vitest'

import { decodeAsKeyAction } from '@firmware/qmk/actions'

import { keychronCodec } from './codec'

describe('KeychronCodec', () => {
    it('encodes wireless.profile.1 to 0x7E0C (BT_HST1)', () => {
        const enc = keychronCodec.encode('wireless.profile.1')
        expect(enc?.value).toBe(0x7e0c)
    })

    it('encodes wireless.battery.level to 0x7E10', () => {
        expect(keychronCodec.encode('wireless.battery.level')?.value).toBe(
            0x7e10,
        )
    })

    it('encodes os.mac.mission_control to 0x7E04', () => {
        expect(keychronCodec.encode('os.mac.mission_control')?.value).toBe(
            0x7e04,
        )
    })

    it('decodes 0x7E0C back to wireless.profile.1', () => {
        const dec = keychronCodec.decode(0x7e0c)
        expect(dec?.canonicalId).toBe('wireless.profile.1')
    })

    it('round-trips every Keychron canonical id', () => {
        const ids = [
            'wireless.profile.1',
            'wireless.profile.2',
            'wireless.profile.3',
            'wireless.output.2p4ghz',
            'wireless.battery.level',
            'os.mac.lopt',
            'os.mac.lcmd',
            'os.mac.mission_control',
            'os.mac.launchpad',
            'os.win.task_view',
            'os.win.cortana',
            'os.system.lock_screen',
            'os.mac.siri',
        ]
        for (const id of ids) {
            const enc = keychronCodec.encode(id)
            expect(enc, `encode failed for ${id}`).not.toBeNull()
            const dec = keychronCodec.decode(enc!.value)
            expect(dec?.canonicalId, `decode failed for ${id}`).toBe(id)
        }
    })

    it('falls through to QMK basic for HID page-7 entries', () => {
        // KEYBOARD_ENTRIES expose `key.keyboard_a` style ids derived from
        // the JSON Name. HID usage Id 4 maps to "Keyboard A".
        const enc = keychronCodec.encode('key.keyboard_a')
        expect(enc?.value).toBe(0x04)
    })

    it('returns null for unsupported canonical ids', () => {
        expect(keychronCodec.encode('wireless.nonsense.1')).toBeNull()
    })

    it('resolves a wire keycode read off the device to a canonical id', () => {
        // Regression: the QMK decoder masked 0x7E02 down to 0x02, so the
        // codec saw KC_POST_FAIL and Left Command showed as "POSTFail".
        const action = decodeAsKeyAction(0x7e02, undefined, keychronCodec)
        expect(action.canonicalId).toBe('os.mac.lcmd')
    })

    it('supports() agrees with encode() result', () => {
        expect(keychronCodec.supports('wireless.profile.1')).toBe(true)
        expect(keychronCodec.supports('wireless.nonsense.1')).toBe(false)
    })
})
