// Pattern check: no GoF pattern (-) — rejected — unit tests for VIA framing helpers; pure assertions, no abstraction.
import { describe, expect, it } from 'vitest'

import {
    getKeycodeCmd,
    getLayerCountCmd,
    getProtocolVersionCmd,
    makeFrame,
    parseBuffer,
    parseKeycode,
    parseLayerCount,
    parseProtocolVersion,
    setBufferCmd,
    setKeycodeCmd,
    VIA_ID,
    VIA_PAYLOAD_SIZE,
} from './protocol'

describe('qmk/protocol — VIA framing', () => {
    it('makeFrame yields a fixed 32-byte payload with id at byte 0', () => {
        const f = makeFrame(0x42, [1, 2, 3])
        expect(f.length).toBe(VIA_PAYLOAD_SIZE)
        expect(f[0]).toBe(0x42)
        expect(f[1]).toBe(1)
        expect(f[2]).toBe(2)
        expect(f[3]).toBe(3)
        expect(f[4]).toBe(0)
    })

    it('protocol version round-trips', () => {
        const cmd = getProtocolVersionCmd()
        expect(cmd[0]).toBe(VIA_ID.GET_PROTOCOL_VERSION)
        const resp = makeFrame(VIA_ID.GET_PROTOCOL_VERSION, [0x00, 0x0c])
        expect(parseProtocolVersion(resp)).toBe(0x000c)
    })

    it('layer count round-trips', () => {
        const cmd = getLayerCountCmd()
        expect(cmd[0]).toBe(VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT)
        const resp = makeFrame(VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT, [4])
        expect(parseLayerCount(resp)).toBe(4)
    })

    it('get keycode encodes layer/row/col', () => {
        const cmd = getKeycodeCmd(2, 3, 4)
        expect(cmd[0]).toBe(VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE)
        expect(cmd[1]).toBe(2)
        expect(cmd[2]).toBe(3)
        expect(cmd[3]).toBe(4)
    })

    it('parse keycode reads U16BE keycode', () => {
        const resp = makeFrame(
            VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE,
            [1, 2, 3, 0x60, 0x14],
        )
        const out = parseKeycode(resp)
        expect(out.layer).toBe(1)
        expect(out.row).toBe(2)
        expect(out.col).toBe(3)
        expect(out.keycode).toBe(0x6014)
    })

    it('set keycode writes U16BE keycode at bytes 4..5', () => {
        const cmd = setKeycodeCmd(0, 1, 2, 0x7311)
        expect(cmd[0]).toBe(VIA_ID.DYNAMIC_KEYMAP_SET_KEYCODE)
        expect(cmd[1]).toBe(0)
        expect(cmd[2]).toBe(1)
        expect(cmd[3]).toBe(2)
        expect(cmd[4]).toBe(0x73)
        expect(cmd[5]).toBe(0x11)
    })

    it('buffer set/get round-trip preserves data', () => {
        const data = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
        const set = setBufferCmd(0x0100, data)
        expect(set[0]).toBe(VIA_ID.DYNAMIC_KEYMAP_SET_BUFFER)
        expect(set[1]).toBe(0x01)
        expect(set[2]).toBe(0x00)
        expect(set[3]).toBe(4)
        expect(set.slice(4, 8)).toEqual(data)

        // Simulate device echoing back via get-buffer response shape.
        const resp = makeFrame(
            VIA_ID.DYNAMIC_KEYMAP_GET_BUFFER,
            [0x01, 0x00, 4, 0xaa, 0xbb, 0xcc, 0xdd],
        )
        const parsed = parseBuffer(resp)
        expect(parsed.offset).toBe(0x0100)
        expect(parsed.size).toBe(4)
        expect(parsed.data).toEqual(data)
    })

    it('rejects oversized buffers', () => {
        const oversize = new Uint8Array(VIA_PAYLOAD_SIZE)
        expect(() => setBufferCmd(0, oversize)).toThrow()
    })

    it('rejects responses with wrong command id', () => {
        const wrong = makeFrame(0xff, [1])
        expect(() => parseProtocolVersion(wrong)).toThrow()
        expect(() => parseLayerCount(wrong)).toThrow()
    })
})
