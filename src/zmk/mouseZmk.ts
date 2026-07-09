// Pattern check: no GoF pattern (-) — rejected — ZMK-specific numeric encode /
// decode (button masks + packed signed deltas) over the shared MOUSE_COMMANDS
// table; pure data + functions, no abstraction.
//
// The ZMK half of the unified Mouse command set. mouseCommands.ts holds the neutral
// list (labels / icons / CanonAction); this maps each command's CanonAction to the
// ZMK Studio-protocol binding param — a button bitmask for &mkp, a packed signed
// delta for &mmv / &msc — and back (decode) for cap legends. Encode and decode share
// one table so they can never drift.
//
// Move / scroll param = ((x & 0xffff) << 16) | (y & 0xffff), signed 16-bit each.
// Sign quirk: cursor move up = −Y (screen coords) but scroll up = +Y (wheel), so the
// vertical signs differ between move and scroll — hence explicit per-direction
// tables, not one shared formula.
//
// All 8 encodings match ZMK's canonical MOVE_* / SCRL_* defines (mouse.h) and were
// read back verbatim from the device's synthesized Mouse type (PM Test ZMK). NOTE:
// ZMK Studio cannot actually *set* &mmv / &msc — they expose no param metadata, so
// the protocol rejects the write — hence the editor omits move/scroll on such
// firmware (see synthesizeMouseActionType). These encodings still drive the
// builder / export path and keycap decoding, ready for firmware that exposes them.

import type { CanonAction } from '@firmware/config'
import { MOUSE_COMMANDS, type MouseCommand } from '@firmware/mouseCommands'

export type MouseBinding = '&mkp' | '&mmv' | '&msc'

type MouseButton = Extract<CanonAction, { type: 'mouse_key' }>['button']
type Direction = Extract<CanonAction, { type: 'mouse_move' }>['direction']

/** &mkp button bitmask (HID standard). */
const BUTTON_MASK: Record<MouseButton, number> = {
    left: 1,
    right: 2,
    middle: 4,
    mb4: 8,
    mb5: 16,
}

const MOVE_MAG = 600
const SCROLL_MAG = 10

/** Pack a signed (x, y) 16-bit delta into ZMK's 32-bit move / scroll param. */
export function packDelta(x: number, y: number): number {
    return (((x & 0xffff) << 16) | (y & 0xffff)) >>> 0
}

// Per-direction (x, y). Explicit because move and scroll disagree on vertical sign.
// All rows HW-confirmed against the device's synthesized params (ZMK mouse.h).
const MOVE_XY: Record<Direction, [number, number]> = {
    right: [MOVE_MAG, 0], // 0x02580000
    left: [-MOVE_MAG, 0], // 0xFDA80000
    up: [0, -MOVE_MAG], // 0x0000FDA8
    down: [0, MOVE_MAG], // 0x00000258
}
const SCROLL_XY: Record<Direction, [number, number]> = {
    up: [0, SCROLL_MAG], // 0x0000000A
    down: [0, -SCROLL_MAG], // 0x0000FFF6
    left: [-SCROLL_MAG, 0], // 0xFFF60000
    right: [SCROLL_MAG, 0], // 0x000A0000
}

/** ZMK binding + param for a neutral mouse CanonAction, or undefined for a
 *  non-mouse action. */
export function mouseCanonToZmk(
    a: CanonAction,
): { binding: MouseBinding; param: number } | undefined {
    switch (a.type) {
        case 'mouse_key':
            return { binding: '&mkp', param: BUTTON_MASK[a.button] }
        case 'mouse_move': {
            const [x, y] = MOVE_XY[a.direction]
            return { binding: '&mmv', param: packDelta(x, y) }
        }
        case 'mouse_scroll': {
            const [x, y] = SCROLL_XY[a.direction]
            return { binding: '&msc', param: packDelta(x, y) }
        }
        default:
            return undefined
    }
}

// Reverse index (binding:param → command), built from the same MOUSE_COMMANDS +
// mouseCanonToZmk so decode never drifts from encode.
const DECODE: Map<string, MouseCommand> = (() => {
    const m = new Map<string, MouseCommand>()
    for (const c of MOUSE_COMMANDS) {
        const enc = mouseCanonToZmk(c.canon)
        if (enc) m.set(`${enc.binding}:${enc.param}`, c)
    }
    return m
})()

/** The MouseCommand a &mkp / &mmv / &msc binding param encodes, for cap legends.
 *  Undefined when the param isn't a known command (e.g. a custom-magnitude delta). */
export function decodeMouseDelta(
    binding: string,
    param: number,
): MouseCommand | undefined {
    return DECODE.get(`${binding}:${param >>> 0}`)
}
