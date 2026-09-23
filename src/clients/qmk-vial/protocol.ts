// Pattern check: no GoF pattern (-) — rejected — pure Vial wire-format codecs; helper functions over a 32-byte VIA frame.
// Vial = VIA superset. All Vial commands are framed as VIA cmd 0xFE + sub-command byte.
// Reference: https://get.vial.today/ + protocol/constants.py.

import { ProtocolError } from '@firmware/errors'
import {
    makeFrame,
    readU16BE,
    VIA_PAYLOAD_SIZE,
    writeU16BE,
} from '@firmware/clients/qmk/protocol'

export const VIAL_PREFIX = 0xfe

export const VIAL_CMD = {
    GET_KEYBOARD_ID: 0x00,
    GET_SIZE: 0x01,
    GET_DEFINITION: 0x02,
    GET_ENCODER: 0x03,
    SET_ENCODER: 0x04,
    GET_UNLOCK_STATUS: 0x05,
    UNLOCK_START: 0x06,
    UNLOCK_POLL: 0x07,
    LOCK: 0x08,
    QMK_SETTINGS_QUERY: 0x09,
    QMK_SETTINGS_GET: 0x0a,
    QMK_SETTINGS_SET: 0x0b,
    QMK_SETTINGS_RESET: 0x0c,
    DYNAMIC_ENTRY_OP: 0x0d,
} as const

export const DYNAMIC_OP = {
    GET_NUMBER_OF_ENTRIES: 0x00,
    TAP_DANCE_GET: 0x01,
    TAP_DANCE_SET: 0x02,
    COMBO_GET: 0x03,
    COMBO_SET: 0x04,
    KEY_OVERRIDE_GET: 0x05,
    KEY_OVERRIDE_SET: 0x06,
    ALT_REPEAT_KEY_GET: 0x07,
    ALT_REPEAT_KEY_SET: 0x08,
} as const

export const SUPPORTED_VIAL_PROTOCOLS = [0, 1, 2, 3, 4, 5, 6] as const

export const VIAL_FEATURE = {
    QMK_SETTINGS: 4,
    DYNAMIC: 4,
    EXT_MACROS: 5,
    KEY_OVERRIDE: 5,
    MATRIX_TESTER: 3,
    ADVANCED_MACROS: 2,
} as const

function readU32LE(buf: Uint8Array, off: number): number {
    return (
        (buf[off] |
            (buf[off + 1] << 8) |
            (buf[off + 2] << 16) |
            (buf[off + 3] << 24)) >>>
        0
    )
}

function writeU32LE(buf: Uint8Array, off: number, v: number): void {
    buf[off] = v & 0xff
    buf[off + 1] = (v >> 8) & 0xff
    buf[off + 2] = (v >> 16) & 0xff
    buf[off + 3] = (v >> 24) & 0xff
}

export function makeVialFrame(sub: number, body: number[] = []): Uint8Array {
    return makeFrame(VIAL_PREFIX, [sub & 0xff, ...body])
}

export function getKeyboardIdCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.GET_KEYBOARD_ID)
}

export interface KeyboardIdResponse {
    vialProtocol: number
    keyboardId: bigint
}

export function parseKeyboardId(resp: Uint8Array): KeyboardIdResponse {
    if (resp.length < 12) {
        throw new ProtocolError(
            `Vial keyboard-id: short response (${resp.length})`,
        )
    }
    const vialProtocol = readU32LE(resp, 0)
    let keyboardId = 0n
    for (let i = 0; i < 8; i++) {
        keyboardId |= BigInt(resp[4 + i]) << BigInt(i * 8)
    }
    return { vialProtocol, keyboardId }
}

export function getSizeCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.GET_SIZE)
}

export function parseSize(resp: Uint8Array): number {
    if (resp.length < 4) throw new ProtocolError('Vial size: short response')
    return readU32LE(resp, 0)
}

export function getDefinitionCmd(block: number): Uint8Array {
    const out = makeVialFrame(VIAL_CMD.GET_DEFINITION)
    writeU32LE(out, 2, block >>> 0)
    return out
}

export function getEncoderCmd(layer: number, idx: number): Uint8Array {
    return makeVialFrame(VIAL_CMD.GET_ENCODER, [layer & 0xff, idx & 0xff])
}

export interface EncoderPair {
    cw: number
    ccw: number
}

// vial_get_encoder answers dynamic_keymap_get_encoder(layer, idx, clockwise)
// for clockwise = 0 then 1: counter-clockwise comes FIRST on the wire.
export function parseEncoder(resp: Uint8Array): EncoderPair {
    if (resp.length < 4) throw new ProtocolError('Vial encoder: short response')
    return { ccw: readU16BE(resp, 0), cw: readU16BE(resp, 2) }
}

/** `clockwise` is the firmware's own flag (dynamic_keymap_set_encoder). */
export function setEncoderCmd(
    layer: number,
    idx: number,
    clockwise: boolean,
    keycode: number,
): Uint8Array {
    const out = makeVialFrame(VIAL_CMD.SET_ENCODER, [
        layer & 0xff,
        idx & 0xff,
        clockwise ? 1 : 0,
    ])
    writeU16BE(out, 5, keycode & 0xffff)
    return out
}

export function getUnlockStatusCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.GET_UNLOCK_STATUS)
}

export interface UnlockStatusResponse {
    locked: boolean
    inProgress: boolean
    unlockKeys: { row: number; col: number }[]
}

export function parseUnlockStatus(resp: Uint8Array): UnlockStatusResponse {
    if (resp.length < 32) {
        throw new ProtocolError(
            `Vial unlock-status: short response (${resp.length})`,
        )
    }
    const status = resp[0] & 0xff
    const inProgress = (resp[1] & 0xff) !== 0
    const keys: { row: number; col: number }[] = []
    for (let i = 0; i < 15; i++) {
        const row = resp[2 + i * 2]
        const col = resp[3 + i * 2]
        if (row !== 0xff && col !== 0xff) keys.push({ row, col })
    }
    return { locked: status !== 1, inProgress, unlockKeys: keys }
}

export function unlockStartCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.UNLOCK_START)
}

export function unlockPollCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.UNLOCK_POLL)
}

export function lockCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.LOCK)
}

export function dynamicGetEntryCountCmd(): Uint8Array {
    return makeVialFrame(VIAL_CMD.DYNAMIC_ENTRY_OP, [
        DYNAMIC_OP.GET_NUMBER_OF_ENTRIES,
    ])
}

export interface DynamicEntryCount {
    tapDance: number
    combo: number
    keyOverride: number
}

export function parseDynamicEntryCount(resp: Uint8Array): DynamicEntryCount {
    if (resp.length < 4) {
        throw new ProtocolError('Vial dynamic count: short response')
    }
    return {
        tapDance: resp[0] & 0xff,
        combo: resp[1] & 0xff,
        keyOverride: resp[2] & 0xff,
    }
}

export function dynamicGetCmd(op: number, idx: number): Uint8Array {
    return makeVialFrame(VIAL_CMD.DYNAMIC_ENTRY_OP, [op & 0xff, idx & 0xff])
}

export function dynamicSetCmd(
    op: number,
    idx: number,
    payload: Uint8Array,
): Uint8Array {
    if (payload.length > VIA_PAYLOAD_SIZE - 4) {
        throw new ProtocolError(
            `Vial dynamic-set: payload too large (${payload.length})`,
        )
    }
    const out = makeVialFrame(VIAL_CMD.DYNAMIC_ENTRY_OP, [
        op & 0xff,
        idx & 0xff,
    ])
    out.set(payload, 4)
    return out
}

export { readU16BE, writeU16BE, readU32LE, writeU32LE }
