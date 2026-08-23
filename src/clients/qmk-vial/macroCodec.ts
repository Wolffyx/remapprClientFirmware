// pattern-check: skip pure binary codec for VIA macro action stream (V2)
// VIA V2 macro encoding (firmware/Vial protocol >= 11):
//   0x01 0x01 kc        : SS_TAP_CODE   (basic 8-bit keycode)
//   0x01 0x02 kc        : SS_DOWN_CODE  (basic 8-bit keycode)
//   0x01 0x03 kc        : SS_UP_CODE    (basic 8-bit keycode)
//   0x01 0x04 lo hi     : SS_DELAY_CODE (16-bit little-endian ms)
//   0x01 0x05 lo hi     : SS_QMK_PREFIX  TAP   (extended 16-bit keycode)
//   0x01 0x06 lo hi     : SS_QMK_PREFIX  DOWN  (extended 16-bit keycode)
//   0x01 0x07 lo hi     : SS_QMK_PREFIX  UP    (extended 16-bit keycode)
//   any other byte 0x20-0x7E : ASCII text run (until next 0x01 or 0x00 terminator)
// Buffer ends at 0x00 (terminator). Encoder must avoid producing 0x00 inside an action.

import { ProtocolError } from '@firmware/errors'
import type { MacroAction } from '@firmware/types'

const ACTION_PREFIX = 0x01
const SS = {
    TAP_BASIC: 0x01,
    DOWN_BASIC: 0x02,
    UP_BASIC: 0x03,
    DELAY: 0x04,
    TAP_EXT: 0x05,
    DOWN_EXT: 0x06,
    UP_EXT: 0x07,
} as const

export function decodeMacro(bytes: Uint8Array): MacroAction[] {
    const out: MacroAction[] = []
    let i = 0
    let textRun = ''
    const flushText = (): void => {
        if (textRun.length > 0) {
            out.push({ kind: 'text', text: textRun })
            textRun = ''
        }
    }
    while (i < bytes.length) {
        const b = bytes[i]
        if (b === 0x00) break
        if (b !== ACTION_PREFIX) {
            textRun += String.fromCharCode(b)
            i += 1
            continue
        }
        flushText()
        if (i + 1 >= bytes.length) {
            throw new ProtocolError(
                'Macro decode: trailing 0x01 with no opcode',
            )
        }
        const op = bytes[i + 1]
        switch (op) {
            case SS.TAP_BASIC:
                out.push({ kind: 'tap', keycode: bytes[i + 2] & 0xff })
                i += 3
                break
            case SS.DOWN_BASIC:
                out.push({ kind: 'down', keycode: bytes[i + 2] & 0xff })
                i += 3
                break
            case SS.UP_BASIC:
                out.push({ kind: 'up', keycode: bytes[i + 2] & 0xff })
                i += 3
                break
            case SS.DELAY:
                out.push({
                    kind: 'delay',
                    ms: (bytes[i + 2] | (bytes[i + 3] << 8)) & 0xffff,
                })
                i += 4
                break
            case SS.TAP_EXT:
                out.push({
                    kind: 'tap',
                    keycode: (bytes[i + 2] | (bytes[i + 3] << 8)) & 0xffff,
                })
                i += 4
                break
            case SS.DOWN_EXT:
                out.push({
                    kind: 'down',
                    keycode: (bytes[i + 2] | (bytes[i + 3] << 8)) & 0xffff,
                })
                i += 4
                break
            case SS.UP_EXT:
                out.push({
                    kind: 'up',
                    keycode: (bytes[i + 2] | (bytes[i + 3] << 8)) & 0xffff,
                })
                i += 4
                break
            default:
                throw new ProtocolError(
                    `Macro decode: unknown opcode 0x${op.toString(16)}`,
                )
        }
    }
    flushText()
    return out
}

export function encodeMacro(actions: MacroAction[]): Uint8Array {
    const parts: number[] = []
    const pushKeycode = (kc: number, basicOp: number, extOp: number): void => {
        if (kc < 0 || kc > 0xffff) {
            throw new ProtocolError(`Macro encode: keycode out of range: ${kc}`)
        }
        if (kc <= 0xff && kc !== 0x00) {
            parts.push(ACTION_PREFIX, basicOp, kc & 0xff)
        } else {
            parts.push(ACTION_PREFIX, extOp, kc & 0xff, (kc >> 8) & 0xff)
        }
    }
    for (const a of actions) {
        switch (a.kind) {
            case 'tap':
                pushKeycode(a.keycode, SS.TAP_BASIC, SS.TAP_EXT)
                break
            case 'down':
                pushKeycode(a.keycode, SS.DOWN_BASIC, SS.DOWN_EXT)
                break
            case 'up':
                pushKeycode(a.keycode, SS.UP_BASIC, SS.UP_EXT)
                break
            case 'delay':
                if (a.ms < 0 || a.ms > 0xffff) {
                    throw new ProtocolError(
                        `Macro encode: delay out of range: ${a.ms}`,
                    )
                }
                parts.push(
                    ACTION_PREFIX,
                    SS.DELAY,
                    a.ms & 0xff,
                    (a.ms >> 8) & 0xff,
                )
                break
            case 'text':
                for (let k = 0; k < a.text.length; k++) {
                    const c = a.text.charCodeAt(k)
                    if (c < 0x20 || c > 0x7e) {
                        throw new ProtocolError(
                            `Macro encode: non-ASCII char in text: 0x${c.toString(16)}`,
                        )
                    }
                    if (c === ACTION_PREFIX) {
                        throw new ProtocolError(
                            'Macro encode: text contains 0x01',
                        )
                    }
                    parts.push(c)
                }
                break
        }
    }
    return new Uint8Array(parts)
}
