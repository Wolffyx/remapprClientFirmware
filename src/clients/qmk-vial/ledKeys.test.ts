// Pattern check: no GoF pattern (-) — rejected — unit tests for the key → LEDs resolver, no abstraction.
import { describe, expect, it } from 'vitest'

import keycultSource from '@firmware/kle/fixtures/aftermarket-keycult-tkl.vial.json?raw'
import keycultLeds from '@firmware/kle/fixtures/aftermarket-keycult-tkl.vialrgb-leds.json?raw'
import { parseKeyboardDef, validateDef } from '@firmware/kle/parser'

import { keyLedsByPos, type KeyPlace, type LedInfo } from './ledKeys'

const KEYLIGHT = 0x04
const UNDERGLOW = 0x02

/** A 1u key at column `col` of row 0. */
const key = (col: number, w = 1): KeyPlace => ({
    row: 0,
    col,
    x: col * 100,
    y: 0,
    w: w * 100,
    h: 100,
})

const led = (
    n: number,
    x: number,
    pos: { row: number; col: number } | null,
    flags = KEYLIGHT,
): LedInfo => ({ led: n, x, y: 0, flags, pos })

describe('keyLedsByPos', () => {
    // Stock vial-qmk on the Aftermarket Keycult TKL (qmk_firmware#26409):
    // get_led_info reports one LED per key, so Caps Lock's second LED and
    // two of the spacebar's three come back under no key.
    it('finds every LED of the Keycult TKL, spacebar and Caps Lock included', () => {
        const def = parseKeyboardDef(validateDef(JSON.parse(keycultSource)))
        const keys = def.rowColMap.map((pos, i) => ({
            ...def.layoutKeys[i],
            ...pos,
        }))
        const rows = JSON.parse(keycultLeds) as number[][]
        const leds = rows.map(([x, y, flags, row, col], n) => ({
            led: n,
            x,
            y,
            flags,
            pos: row === 0xff ? null : { row, col },
        }))
        expect(leds.filter((l) => !l.pos).map((l) => l.led)).toEqual([
            62, 68, 88,
        ])

        const byPos = keyLedsByPos(leds, keys)

        expect(byPos.get('5,3')).toEqual([68, 88, 89]) // spacebar
        expect(byPos.get('3,0')).toEqual([62, 63]) // Caps Lock
        expect(byPos.get('5,2')).toEqual([67]) // Alt keeps its own
        expect([...byPos.values()].flat()).toHaveLength(90)
    })

    it('keeps the LEDs the firmware places', () => {
        const byPos = keyLedsByPos(
            [led(0, 0, { row: 0, col: 1 }), led(1, 10, { row: 0, col: 0 })],
            [key(0), key(1)],
        )
        expect(byPos).toEqual(
            new Map([
                ['0,1', [0]],
                ['0,0', [1]],
            ]),
        )
    })

    it('gives an unplaced key light to the key it sits on', () => {
        // LED x is the key centre / 10: 5, 20 and 35.
        const byPos = keyLedsByPos(
            [
                led(0, 5, { row: 0, col: 0 }),
                led(1, 20, { row: 0, col: 1 }),
                led(2, 35, { row: 0, col: 3 }),
                led(3, 27, null), // right half of the 2u key
            ],
            [key(0), key(1, 2), key(3)],
        )
        expect(byPos.get('0,1')).toEqual([1, 3])
    })

    it('leaves underglow and far-off LEDs under no key', () => {
        const byPos = keyLedsByPos(
            [
                led(0, 0, { row: 0, col: 0 }),
                led(1, 10, { row: 0, col: 1 }),
                led(2, 5, null, UNDERGLOW),
                led(3, 200, null), // twenty keys to the right
            ],
            [key(0), key(1)],
        )
        expect([...byPos.values()].flat().sort()).toEqual([0, 1])
    })

    it('places nothing when too few keys pin down the LED space', () => {
        const byPos = keyLedsByPos(
            [led(0, 0, { row: 0, col: 0 }), led(1, 5, null)],
            [key(0, 2)],
        )
        expect(byPos).toEqual(new Map([['0,0', [0]]]))
    })
})
