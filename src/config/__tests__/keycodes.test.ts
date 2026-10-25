// pattern-check: skip — keycode name resolution assertions
import { describe, expect, it } from 'vitest'

import { friendlyName, resolveKeycode } from '../keycodes'

describe('keyboard-page volume spellings', () => {
    it('old friendly names keep their key; new saves use the new label', () => {
        expect(resolveKeycode('Volume Up')).toBe('key.keyboard_volume_up')
        expect(resolveKeycode('Mute')).toBe('key.keyboard_mute')
        expect(resolveKeycode('Kb Vol+')).toBe('key.keyboard_volume_up')
        expect(friendlyName('key.keyboard_volume_up')).toBe('Kb Vol+')
        expect(resolveKeycode('C_VOL_UP')).toBe('media.volume_increment')
    })
})
