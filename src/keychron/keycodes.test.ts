// Pattern check: no GoF pattern (-) — rejected — unit tests over the Keychron
// keycode decode table's icon legends (issue #147); test code, no pattern.
import { describe, expect, it } from 'vitest'
import {
    decodeKeychronKeycode,
    KEYCHRON_QK_KB_BASE,
} from './keycodes'

const at = (offset: number) => decodeKeychronKeycode(KEYCHRON_QK_KB_BASE + offset)

describe('decodeKeychronKeycode — composite icon legends', () => {
    it('BT host slots → bluetooth icon + host number text part', () => {
        expect(at(0x0c)?.label.paramParts).toEqual([
            { icon: 'bluetooth', text: 'BT' },
            { text: '1' },
        ])
        expect(at(0x0e)?.label.paramParts).toEqual([
            { icon: 'bluetooth', text: 'BT' },
            { text: '3' },
        ])
    })

    it('2.4G / battery / lock / screenshot carry their icons', () => {
        expect(at(0x0f)?.label.paramParts).toEqual([
            { icon: 'wireless', text: '2.4G' },
        ])
        expect(at(0x10)?.label.paramParts).toEqual([
            { icon: 'battery', text: 'Bat' },
        ])
        expect(at(0x0a)?.label.paramParts).toEqual([
            { icon: 'lock', text: 'Lock' },
        ])
        expect(at(0x08)?.label.paramParts).toEqual([
            { icon: 'screenshot', text: 'Snip' },
        ])
    })

    it('non-icon keycodes keep their plain-text label', () => {
        const lopt = at(0x00)
        expect(lopt?.label.primary).toBe('LOpt')
        expect(lopt?.label.paramParts).toBeUndefined()
    })
})
