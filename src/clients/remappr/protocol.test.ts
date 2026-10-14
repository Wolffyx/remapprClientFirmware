// pattern-check: skip — test wiring: byte-level fixtures for the layout-chunk
// parser; no GoF abstraction.
import { describe, expect, it } from 'vitest'

import {
    EVT_ROLE,
    HwCap,
    parseClusterDiag,
    InputClass,
    InputForm,
    InputShape,
    INPUT_NONE,
    parseInputLayoutPage,
    parseKeyLayoutChunk,
    parseRoleEvent,
    parseUchEvent,
    reportsHwCap,
} from './protocol'

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

describe('parseClusterDiag (§N4b-3)', () => {
    it('parses the local role and per-peer status', () => {
        // version | role=coord | flags | u16 term | count=2, then a
        // ready+seen follower and an unseen coordinator (term 5, hb 0x01).
        const d = new Uint8Array([
            1, 1, 0, 0, 0, 2,
            0x03, 0, 0, 0, 0,
            0x00, 1, 5, 0, 1,
        ])
        const out = parseClusterDiag(d)
        expect(out.coordinator).toBe(true)
        expect(out.localTerm).toBe(0)
        expect(out.peers).toHaveLength(2)
        expect(out.peers[0]).toMatchObject({
            coordinator: false,
            ready: true,
            seen: true,
        })
        expect(out.peers[1]).toMatchObject({
            coordinator: true,
            term: 5,
            hbFlags: 1,
            ready: false,
            seen: false,
        })
    })

    it('leaves modeADrops undefined when the reply has no §N4c tail', () => {
        // 2 peers, tail-less (§N4b-3 build / follower / mode-B): 6 + 2*5 = 16 B.
        const d = new Uint8Array([1, 0, 0, 0, 0, 2, 0x03, 0, 0, 0, 0, 0x03, 0, 0, 0, 0])
        expect(parseClusterDiag(d).modeADrops).toBeUndefined()
    })

    it('decodes the §N4c mode-A drop-counter tail when present', () => {
        // 1 peer, then the 8-byte tail {u32 no_node=7, u32 oob=0x0102} LE.
        const d = new Uint8Array([
            1, 1, 0, 0, 0, 1,
            0x03, 0, 0, 0, 0,
            7, 0, 0, 0, 0x02, 0x01, 0, 0,
        ])
        expect(parseClusterDiag(d).modeADrops).toEqual({ noNode: 7, oob: 0x0102 })
    })

    it('rejects an unknown reply version', () => {
        expect(() => parseClusterDiag(new Uint8Array([9, 0, 0, 0, 0, 0]))).toThrow(
            /version/,
        )
    })
})

describe('parseUchEvent + parseRoleEvent (§N4b-3)', () => {
    it('decodes a role-transition event frame', () => {
        // [0xE2][UCH ver2, ns COMMON, flags EVENT, rid][event_id ROLE | seq |
        // u16 len 4 | payload role=coord, flags 0, term 5].
        const frame = new Uint8Array([
            0xe2, 2, 0x00, 0x02, 0xff, 0, 0, 0, 0,
            EVT_ROLE, 0, 4, 0,
            1, 0, 5, 0,
        ])
        const evt = parseUchEvent(frame)
        expect(evt.eventId).toBe(EVT_ROLE)
        expect(evt.payload).toHaveLength(4)
        const role = parseRoleEvent(evt.payload)
        expect(role.coordinator).toBe(true)
        expect(role.term).toBe(5)
    })
})

describe('HwCap', () => {
    it('matches the firmware capability bits', () => {
        // include/remappr/capabilities.h — a wire ABI, append-only.
        expect(HwCap.FLASH_STORAGE).toBe(1 << 16)
        expect(HwCap.ANALOG_AXES).toBe(1 << 17)
        expect(HwCap.HID_GAMEPAD).toBe(1 << 24)
    })

    it('treats 0 as not reported', () => {
        expect(reportsHwCap(0, HwCap.POINTER)).toBeUndefined()
        expect(reportsHwCap(undefined, HwCap.POINTER)).toBeUndefined()
        expect(reportsHwCap(HwCap.POINTER, HwCap.POINTER)).toBe(true)
        expect(reportsHwCap(HwCap.USB, HwCap.POINTER)).toBe(false)
    })
})

describe('parseInputLayoutPage (input-layout plan §2)', () => {
    // The firmware golden (tests/input_layout lmb_wire): a mouse's left button,
    // rotated -15° about (0.75, 1.5).
    const LMB = [
        0x01, 0x0d, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x96, 0x00,
        0x2c, 0x01, 0x24, 0xfa, 0x4b, 0x00, 0x96, 0x00,
    ]
    const page = (count: number, entries: number[]) =>
        Uint8Array.from([1, InputForm.MOUSE, 4, 0, 1, 0, count, ...entries])

    it('decodes the firmware golden entry', () => {
        const p = parseInputLayoutPage(page(1, LMB))
        expect(p).toMatchObject({ version: 1, form: 3, total: 4, start: 1 })
        expect(p.entries).toEqual([
            {
                cls: InputClass.BUTTON,
                shape: InputShape.MOUSE_LEFT,
                inputId: 0x0100,
                position: 0,
                x: 0,
                y: 0,
                w: 150,
                h: 300,
                rot: -1500,
                rotx: 75,
                roty: 150,
            },
        ])
    })

    it('reads an unbound position as INPUT_NONE', () => {
        const wheel = [...LMB]
        wheel[0] = InputClass.WHEEL
        wheel[4] = 0xff
        wheel[5] = 0xff
        expect(parseInputLayoutPage(page(1, wheel)).entries[0]!.position).toBe(
            INPUT_NONE,
        )
    })

    it('rejects a page shorter than its count', () => {
        expect(() => parseInputLayoutPage(page(2, LMB))).toThrow(/truncated/)
        expect(() => parseInputLayoutPage(Uint8Array.of(1, 0, 0))).toThrow(
            /too short/,
        )
    })
})
