// Pattern check: no GoF pattern (-) — rejected — pure VIA framing constants and codec helpers; no abstraction warranted.
// VIA HID command framing. 32-byte fixed payload, command id in byte 0.
// Spec: https://www.caniusevia.com/docs/specification (v12).

import { ProtocolError } from '@firmware/errors'
import type { HidClient } from '@firmware/hid/rawHidClient'

export const VIA_PAYLOAD_SIZE = 32
export const VIA_USAGE_PAGE = 0xff60
export const VIA_USAGE = 0x61

export const VIA_ID = {
    GET_PROTOCOL_VERSION: 0x01,
    GET_KEYBOARD_VALUE: 0x02,
    SET_KEYBOARD_VALUE: 0x03,
    DYNAMIC_KEYMAP_GET_KEYCODE: 0x04,
    DYNAMIC_KEYMAP_SET_KEYCODE: 0x05,
    DYNAMIC_KEYMAP_RESET: 0x06,
    EEPROM_RESET: 0x0a,
    BOOTLOADER_JUMP: 0x0b,
    CUSTOM_SET_VALUE: 0x07,
    CUSTOM_GET_VALUE: 0x08,
    CUSTOM_SAVE: 0x09,
    DYNAMIC_KEYMAP_GET_LAYER_COUNT: 0x11,
    DYNAMIC_KEYMAP_GET_BUFFER: 0x12,
    DYNAMIC_KEYMAP_SET_BUFFER: 0x13,
} as const

// VIA custom-channel ids (per the public VIA protocol spec, via_channel_id).
export const VIA_CHANNEL = {
    CUSTOM: 0,
    BACKLIGHT: 1,
    RGBLIGHT: 2,
    RGB_MATRIX: 3,
    AUDIO: 4,
    LED_MATRIX: 5,
} as const

// RGB-matrix value ids (via_qmk_rgb_matrix_value). The index into the channel.
export const VIA_RGB_MATRIX_VALUE = {
    BRIGHTNESS: 0x01,
    EFFECT: 0x02,
    EFFECT_SPEED: 0x03,
    COLOR: 0x04, // 2 data bytes: hue, sat (0..255)
} as const

export const VIA_KBV = {
    UPTIME: 0x01,
    LAYOUT_OPTIONS: 0x02,
    SWITCH_MATRIX_STATE: 0x03,
    FIRMWARE_VERSION: 0x04,
    DEVICE_INDICATION: 0x05,
} as const

export function makeFrame(id: number, body: number[] = []): Uint8Array {
    if (body.length > VIA_PAYLOAD_SIZE - 1) {
        throw new ProtocolError(
            `VIA frame body too large: ${body.length} > ${VIA_PAYLOAD_SIZE - 1}`,
        )
    }
    const out = new Uint8Array(VIA_PAYLOAD_SIZE)
    out[0] = id & 0xff
    for (let i = 0; i < body.length; i++) out[i + 1] = body[i] & 0xff
    return out
}

export function readU16BE(buf: Uint8Array, off: number): number {
    return ((buf[off] << 8) | buf[off + 1]) & 0xffff
}

export function writeU16BE(buf: Uint8Array, off: number, v: number): void {
    buf[off] = (v >> 8) & 0xff
    buf[off + 1] = v & 0xff
}

function expectId(resp: Uint8Array, id: number, label: string): void {
    if (resp.length < VIA_PAYLOAD_SIZE) {
        throw new ProtocolError(
            `VIA ${label}: short response (${resp.length} bytes)`,
        )
    }
    if (resp[0] !== id) {
        throw new ProtocolError(
            `VIA ${label}: response id 0x${resp[0].toString(16)} != 0x${id.toString(16)}`,
        )
    }
}

export function getProtocolVersionCmd(): Uint8Array {
    return makeFrame(VIA_ID.GET_PROTOCOL_VERSION)
}

export function parseProtocolVersion(resp: Uint8Array): number {
    expectId(resp, VIA_ID.GET_PROTOCOL_VERSION, 'protocol-version')
    return readU16BE(resp, 1)
}

export function getFirmwareVersionCmd(): Uint8Array {
    return makeFrame(VIA_ID.GET_KEYBOARD_VALUE, [VIA_KBV.FIRMWARE_VERSION])
}

export function parseFirmwareVersion(resp: Uint8Array): number {
    expectId(resp, VIA_ID.GET_KEYBOARD_VALUE, 'firmware-version')
    if (resp[1] !== VIA_KBV.FIRMWARE_VERSION) {
        throw new ProtocolError(
            `VIA firmware-version: sub 0x${resp[1].toString(16)}`,
        )
    }
    return ((resp[2] << 24) | (resp[3] << 16) | (resp[4] << 8) | resp[5]) >>> 0
}

export function getLayerCountCmd(): Uint8Array {
    return makeFrame(VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT)
}

export function parseLayerCount(resp: Uint8Array): number {
    expectId(resp, VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT, 'layer-count')
    return resp[1] & 0xff
}

export function getKeycodeCmd(
    layer: number,
    row: number,
    col: number,
): Uint8Array {
    return makeFrame(VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE, [
        layer & 0xff,
        row & 0xff,
        col & 0xff,
    ])
}

export interface KeycodeResponse {
    layer: number
    row: number
    col: number
    keycode: number
}

export function parseKeycode(resp: Uint8Array): KeycodeResponse {
    expectId(resp, VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE, 'get-keycode')
    return {
        layer: resp[1] & 0xff,
        row: resp[2] & 0xff,
        col: resp[3] & 0xff,
        keycode: readU16BE(resp, 4),
    }
}

export function setKeycodeCmd(
    layer: number,
    row: number,
    col: number,
    keycode: number,
): Uint8Array {
    const out = makeFrame(VIA_ID.DYNAMIC_KEYMAP_SET_KEYCODE, [
        layer & 0xff,
        row & 0xff,
        col & 0xff,
    ])
    writeU16BE(out, 4, keycode & 0xffff)
    return out
}

export function parseSetKeycodeEcho(resp: Uint8Array): KeycodeResponse {
    expectId(resp, VIA_ID.DYNAMIC_KEYMAP_SET_KEYCODE, 'set-keycode')
    return {
        layer: resp[1] & 0xff,
        row: resp[2] & 0xff,
        col: resp[3] & 0xff,
        keycode: readU16BE(resp, 4),
    }
}

export function resetKeymapCmd(): Uint8Array {
    return makeFrame(VIA_ID.DYNAMIC_KEYMAP_RESET)
}

export function getBufferCmd(offset: number, size: number): Uint8Array {
    if (size <= 0 || size > VIA_PAYLOAD_SIZE - 4) {
        throw new ProtocolError(`VIA get-buffer size out of range: ${size}`)
    }
    const out = makeFrame(VIA_ID.DYNAMIC_KEYMAP_GET_BUFFER)
    writeU16BE(out, 1, offset & 0xffff)
    out[3] = size & 0xff
    return out
}

export interface BufferResponse {
    offset: number
    size: number
    data: Uint8Array
}

export function parseBuffer(resp: Uint8Array): BufferResponse {
    expectId(resp, VIA_ID.DYNAMIC_KEYMAP_GET_BUFFER, 'get-buffer')
    const offset = readU16BE(resp, 1)
    const size = resp[3] & 0xff
    return { offset, size, data: resp.slice(4, 4 + size) }
}

// pattern-check: skip mechanical dedupe of identical fetch loop from qmk + qmk-vial services
/** Max payload bytes per get-buffer round trip (4-byte VIA frame header). */
export const BUFFER_FETCH_CHUNK = VIA_PAYLOAD_SIZE - 4

/** Bulk-read the whole dynamic keymap as one byte stream (rows*cols*2 per layer). */
export async function fetchKeymapBuffer(
    client: HidClient,
    layerCount: number,
    rows: number,
    cols: number,
): Promise<Uint8Array> {
    const total = layerCount * rows * cols * 2
    const out = new Uint8Array(total)
    let offset = 0
    while (offset < total) {
        const size = Math.min(total - offset, BUFFER_FETCH_CHUNK)
        const resp = await client.send(getBufferCmd(offset, size))
        const { data } = parseBuffer(resp)
        out.set(data.subarray(0, size), offset)
        offset += size
    }
    return out
}

// ---------- VIA custom-channel (lighting etc.) ----------
// Frame: [cmd, channel, value_id, ...data]. Get echoes the same header + data.

export function customGetCmd(
    channel: number,
    valueId: number,
    extra: number[] = [],
): Uint8Array {
    return makeFrame(VIA_ID.CUSTOM_GET_VALUE, [channel, valueId, ...extra])
}

/** Returns the data bytes after the [cmd, channel, value_id] header. */
export function parseCustomGet(
    resp: Uint8Array,
    channel: number,
    valueId: number,
): Uint8Array {
    expectId(resp, VIA_ID.CUSTOM_GET_VALUE, 'custom-get')
    if (resp[1] !== channel || resp[2] !== valueId) {
        throw new ProtocolError(
            `VIA custom-get: channel/value mismatch (got ${resp[1]}/${resp[2]}, want ${channel}/${valueId})`,
        )
    }
    return resp.slice(3)
}

export function customSetCmd(
    channel: number,
    valueId: number,
    data: number[] = [],
): Uint8Array {
    return makeFrame(VIA_ID.CUSTOM_SET_VALUE, [channel, valueId, ...data])
}

export function customSaveCmd(channel: number): Uint8Array {
    return makeFrame(VIA_ID.CUSTOM_SAVE, [channel])
}

export function setBufferCmd(offset: number, data: Uint8Array): Uint8Array {
    if (data.length === 0 || data.length > VIA_PAYLOAD_SIZE - 4) {
        throw new ProtocolError(
            `VIA set-buffer size out of range: ${data.length}`,
        )
    }
    const out = makeFrame(VIA_ID.DYNAMIC_KEYMAP_SET_BUFFER)
    writeU16BE(out, 1, offset & 0xffff)
    out[3] = data.length & 0xff
    out.set(data, 4)
    return out
}
