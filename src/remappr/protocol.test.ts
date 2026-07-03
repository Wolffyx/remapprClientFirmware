// pattern-check: skip — test wiring: byte-level fixtures for the layout-chunk
// parser; no GoF abstraction.
import { describe, expect, it } from 'vitest'

import { parseKeyLayoutChunk } from './protocol'

/** Build a GET_KEY_LAYOUT chunk: [total u16][start u16][count u8][entries×16].
 *  `bodyEntries` is how many 16-byte entries are actually present, which may be
 *  fewer than the declared `count` to model a lost middle fragment. */
function chunk(total: number, start: number, count: number, bodyEntries = count) {
    const d = new Uint8Array(5 + bodyEntries * 16)
    d[0] = total & 0xff
    d[1] = (total >> 8) & 0xff
    d[2] = start & 0xff
    d[3] = (start >> 8) & 0xff
    d[4] = count
    // a recognisable keycode per entry so a well-formed parse is verifiable
    for (let i = 0; i < bodyEntries; i++) d[5 + i * 16] = 0x04 + i
    return d
}

describe('parseKeyLayoutChunk', () => {
    it('parses a complete chunk', () => {
        const out = parseKeyLayoutChunk(chunk(15, 0, 2))
        expect(out.total).toBe(15)
        expect(out.start).toBe(0)
        expect(out.count).toBe(2)
        expect(out.positions).toHaveLength(2)
        expect(out.positions[0].keycode).toBe(0x04)
        expect(out.positions[1].keycode).toBe(0x05)
    })

    it('accepts an empty (count 0) chunk', () => {
        const out = parseKeyLayoutChunk(chunk(0, 0, 0))
        expect(out.count).toBe(0)
        expect(out.positions).toHaveLength(0)
    })

    it('rejects a truncated chunk (a lost middle FRAG fragment) instead of reading past the buffer', () => {
        // header declares 15 entries but the reassembled body carries only 13 —
        // exactly the "209 B for 15 entries" split-tier relay truncation.
        expect(() => parseKeyLayoutChunk(chunk(15, 0, 15, 13))).toThrow(/truncated/)
    })
})
