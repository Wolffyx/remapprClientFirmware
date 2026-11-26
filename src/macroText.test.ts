// pattern-check: skip — unit tests for the pure macro text helpers
import { describe, expect, it } from 'vitest'

import { describeMacro, heldAtEnd } from './macroText'
import type { MacroAction } from './types'

const NAMES: Record<number, string> = { 0xe0: 'Ctrl', 0x06: 'C', 0x80: 'Volume up' }
const name = (code: number): string => NAMES[code] ?? `key ${code}`

describe('describeMacro', () => {
    it('reads every step kind as one sentence', () => {
        const steps: MacroAction[] = [
            { kind: 'down', keycode: 0xe0 },
            { kind: 'tap', keycode: 0x06 },
            { kind: 'delay', ms: 40 },
            { kind: 'pause' },
            { kind: 'text', text: 'Best,' },
            { kind: 'call', macro: 'm_signature' },
            { kind: 'up', keycode: 0xe0 },
        ]
        expect(describeMacro(steps, name)).toBe(
            'Holds Ctrl, taps C, waits 40 ms, waits until you let go of the key, ' +
                'types “Best,”, runs m_signature, then lets go of Ctrl.',
        )
    })

    it('folds repeated taps of one key into a count', () => {
        const tap: MacroAction = { kind: 'tap', keycode: 0x80 }
        expect(describeMacro([tap, tap, tap], name)).toBe('Taps Volume up three times.')
        expect(describeMacro([tap, tap, { kind: 'tap', keycode: 0x06 }], name)).toBe(
            'Taps Volume up twice, then taps C.',
        )
    })

    it('uses the locked step’s own phrase and says when the macro is empty', () => {
        const locked: MacroAction = {
            kind: 'locked',
            label: 'Press time',
            value: '120 ms',
            phrase: 'sets the press time to 120 ms',
        }
        expect(describeMacro([locked], name)).toBe('Sets the press time to 120 ms.')
        expect(describeMacro([], name)).toBe('Does nothing yet.')
    })
})

describe('heldAtEnd', () => {
    it('is empty when every held key is let go', () => {
        expect(
            heldAtEnd([
                { kind: 'down', keycode: 0xe0 },
                { kind: 'tap', keycode: 0x06 },
                { kind: 'up', keycode: 0xe0 },
            ]),
        ).toEqual([])
    })

    it('names each key held and never let go, once, in hold order', () => {
        expect(
            heldAtEnd([
                { kind: 'down', keycode: 0x06 },
                { kind: 'down', keycode: 0xe0 },
                { kind: 'down', keycode: 0x06 },
                { kind: 'up', keycode: 0x80 },
            ]),
        ).toEqual([0x06, 0xe0])
    })

    it('ignores a Hold with no key chosen yet', () => {
        expect(heldAtEnd([{ kind: 'down', keycode: 0 }])).toEqual([])
    })

    it('does not count a let go that comes before the hold', () => {
        expect(
            heldAtEnd([
                { kind: 'up', keycode: 0xe0 },
                { kind: 'down', keycode: 0xe0 },
            ]),
        ).toEqual([0xe0])
    })
})
