// pattern-check: skip codec round-trip test
import { describe, expect, it } from 'vitest'

import type { MacroAction } from '@firmware/types'
import { decodeMacro, encodeMacro } from './macroCodec'

describe('VIA V2 macro codec', () => {
    it('round-trips basic actions', () => {
        const actions: MacroAction[] = [
            { kind: 'tap', keycode: 0x04 },
            { kind: 'down', keycode: 0xe1 },
            { kind: 'up', keycode: 0xe1 },
            { kind: 'delay', ms: 250 },
            { kind: 'text', text: 'hi' },
        ]
        const bytes = encodeMacro(actions)
        expect(decodeMacro(bytes)).toEqual(actions)
    })

    it('uses extended encoding for keycodes > 0xff', () => {
        const actions: MacroAction[] = [{ kind: 'tap', keycode: 0x1234 }]
        const bytes = encodeMacro(actions)
        expect(Array.from(bytes)).toEqual([0x01, 0x05, 0x34, 0x12])
        expect(decodeMacro(bytes)).toEqual(actions)
    })

    it('encodes delay little-endian', () => {
        const bytes = encodeMacro([{ kind: 'delay', ms: 0x0102 }])
        expect(Array.from(bytes)).toEqual([0x01, 0x04, 0x02, 0x01])
    })

    it('stops at 0x00 terminator on decode', () => {
        const bytes = new Uint8Array([0x41, 0x00, 0x42])
        expect(decodeMacro(bytes)).toEqual([{ kind: 'text', text: 'A' }])
    })

    it('rejects text with non-ASCII byte', () => {
        expect(() => encodeMacro([{ kind: 'text', text: 'ÿ' }])).toThrow()
    })

    it('rejects unknown opcode on decode', () => {
        expect(() => decodeMacro(new Uint8Array([0x01, 0x99, 0x00]))).toThrow()
    })
})
