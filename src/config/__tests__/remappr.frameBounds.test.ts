// L3.27: the decode readers stay inside their own table frame, and the frame
// walk refuses a remainder too short for a table header, as the firmware does.
import { describe, expect, it } from 'vitest'
import { MacroOp, TableId } from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'
import { assembleBlob, keymapCore, u16 } from './blobFixtures'

// A macro table that says one macro of 2 steps but carries only 1 step (4 B).
const shortMacro = {
    id: TableId.Macro,
    version: 1,
    payload: [...u16(1), ...u16(2), MacroOp.Tap, 0, ...u16(0x04)],
}

describe('decode frame bounds (L3.27)', () => {
    it('decodes the well-formed core', () => {
        expect(decodeRemapprBlob(assembleBlob(keymapCore())).code).toBe(DecodeCode.OK)
    })

    it('refuses a 1..7-byte remainder after the last table', () => {
        const blob = assembleBlob(keymapCore(), { tail: [0, 0, 0] })
        expect(decodeRemapprBlob(blob).code).toBe(DecodeCode.TABLE_FRAME)
    })

    it('refuses a short table instead of reading into the next one', () => {
        const next = { id: TableId.Names, version: 1, payload: [...u16(0)] }
        const blob = assembleBlob([...keymapCore(), shortMacro, next])
        expect(decodeRemapprBlob(blob).code).toBe(DecodeCode.TABLE_FRAME)
    })

    it('refuses a short last table instead of reading past the body as 0', () => {
        const blob = assembleBlob([...keymapCore(), shortMacro])
        expect(decodeRemapprBlob(blob).code).toBe(DecodeCode.TABLE_FRAME)
    })
})
