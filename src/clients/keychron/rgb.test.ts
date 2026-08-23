// Pattern check: no GoF pattern (-) — rejected — unit tests for the Keychron RGB facade's LED-map validation over a mock HidClient, byte-level assertions, no abstraction.
import { describe, it, expect } from 'vitest'

import type { HidClient } from '@firmware/hid/rawHidClient'

import { createRgbFacade } from './rgb'
import { KEYCHRON_PAYLOAD_SIZE, RGB_SUB } from './protocol'

function frame(bytes: number[]): Uint8Array {
    const out = new Uint8Array(KEYCHRON_PAYLOAD_SIZE)
    out.set(bytes.slice(0, KEYCHRON_PAYLOAD_SIZE))
    return out
}

// Mock client: GET_LED_COUNT (0x05) → ledCount; GET_LED_IDX (0x06) → the page
// of LED indices starting at `start`. `leds` is the full key→LED map.
function clientFor(ledCount: number, leds: number[]): HidClient {
    return {
        send: (req: Uint8Array) => {
            const sub = req[1] & 0xff
            if (sub === RGB_SUB.GET_LED_COUNT) {
                return Promise.resolve(frame([0xa8, sub, ledCount]))
            }
            if (sub === RGB_SUB.GET_LED_IDX) {
                const start = req[2] & 0xff
                const count = req[3] & 0xff
                const page = leds.slice(start, start + count)
                return Promise.resolve(
                    frame([0xa8, sub, start, count, ...page]),
                )
            }
            return Promise.resolve(frame([0xa8, sub]))
        },
        close: () => Promise.resolve(),
        subscribe: () => () => undefined,
        onClosed: () => () => undefined,
    }
}

describe('keychron/rgb — getLedIndexMap', () => {
    it('returns the device map when valid (in range + unique)', async () => {
        const rgb = createRgbFacade(clientFor(10, [2, 0, 3, 1]))
        expect(await rgb.getLedIndexMap!(4)).toEqual([2, 0, 3, 1])
    })

    it('allows repeated NO_LED (0xFF) sentinels', async () => {
        const rgb = createRgbFacade(clientFor(10, [2, 0xff, 0xff, 1]))
        expect(await rgb.getLedIndexMap!(4)).toEqual([2, 0xff, 0xff, 1])
    })

    it('falls back to identity on duplicate LED indices', async () => {
        const rgb = createRgbFacade(clientFor(10, [0, 0, 1, 2]))
        expect(await rgb.getLedIndexMap!(4)).toEqual([0, 1, 2, 3])
    })

    it('falls back to identity on an out-of-range LED index', async () => {
        const rgb = createRgbFacade(clientFor(4, [9, 1, 2, 3]))
        expect(await rgb.getLedIndexMap!(4)).toEqual([0, 1, 2, 3])
    })

    it('falls back to identity when the device errors', async () => {
        const client = clientFor(10, [0, 1, 2, 3])
        client.send = () => Promise.reject(new Error('hid timeout'))
        const rgb = createRgbFacade(client)
        expect(await rgb.getLedIndexMap!(4)).toEqual([0, 1, 2, 3])
    })
})
