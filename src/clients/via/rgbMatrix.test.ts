// Pattern check: no GoF pattern (-) — rejected — unit tests for VIA custom-channel framing + facade, byte-level assertions, no abstraction.
import { describe, it, expect } from 'vitest'

import type { HidClient } from '@firmware/hid/rawHidClient'
import {
    VIA_CHANNEL,
    VIA_ID,
    VIA_PAYLOAD_SIZE,
    VIA_RGB_MATRIX_VALUE,
    customGetCmd,
    customSaveCmd,
    customSetCmd,
    parseCustomGet,
} from '@firmware/clients/qmk/protocol'

import { createRgbMatrixEffectFacade } from './rgbMatrix'

function frame(bytes: number[]): Uint8Array {
    const out = new Uint8Array(VIA_PAYLOAD_SIZE)
    out.set(bytes.slice(0, VIA_PAYLOAD_SIZE))
    return out
}

describe('via/protocol — custom channel framing', () => {
    it('get/set/save place [cmd, channel, value] correctly', () => {
        const g = customGetCmd(VIA_CHANNEL.RGB_MATRIX, 0x02)
        expect([g[0], g[1], g[2]]).toEqual([VIA_ID.CUSTOM_GET_VALUE, 3, 0x02])
        const s = customSetCmd(VIA_CHANNEL.RGB_MATRIX, 0x04, [0x10, 0x20])
        expect([s[0], s[1], s[2], s[3], s[4]]).toEqual([
            VIA_ID.CUSTOM_SET_VALUE,
            3,
            0x04,
            0x10,
            0x20,
        ])
        const sv = customSaveCmd(VIA_CHANNEL.RGB_MATRIX)
        expect([sv[0], sv[1]]).toEqual([VIA_ID.CUSTOM_SAVE, 3])
    })

    it('parseCustomGet returns data after the 3-byte header', () => {
        const resp = frame([VIA_ID.CUSTOM_GET_VALUE, 3, 0x04, 0x7f, 0x80])
        const data = parseCustomGet(resp, 3, 0x04)
        expect([data[0], data[1]]).toEqual([0x7f, 0x80])
    })

    it('parseCustomGet rejects a channel/value mismatch', () => {
        const resp = frame([VIA_ID.CUSTOM_GET_VALUE, 3, 0x02])
        expect(() => parseCustomGet(resp, 3, 0x04)).toThrow()
    })
})

// Minimal HidClient over a custom `send`, with the rest stubbed out.
function makeClient(send: HidClient['send']): HidClient {
    return {
        send,
        close: () => Promise.resolve(),
        subscribe: () => () => undefined,
        onClosed: () => () => undefined,
    }
}

describe('via/rgbMatrix — effect facade', () => {
    function fakeClient(): HidClient {
        // Get echoes the requested value; set/save resolve empty.
        return makeClient(async (f: Uint8Array): Promise<Uint8Array> => {
            if (f[0] !== VIA_ID.CUSTOM_GET_VALUE) return frame([f[0]])
            const valueId = f[2]
            const data: Record<number, number[]> = {
                [VIA_RGB_MATRIX_VALUE.BRIGHTNESS]: [200],
                [VIA_RGB_MATRIX_VALUE.EFFECT]: [5],
                [VIA_RGB_MATRIX_VALUE.EFFECT_SPEED]: [128],
                [VIA_RGB_MATRIX_VALUE.COLOR]: [40, 220],
            }
            return frame([
                VIA_ID.CUSTOM_GET_VALUE,
                3,
                valueId,
                ...(data[valueId] ?? []),
            ])
        })
    }

    it('reads the active effect from channel 3', async () => {
        const fx = createRgbMatrixEffectFacade(fakeClient())
        const st = await fx.getEffect()
        expect(st.mode).toBe(5)
        expect(st.brightness).toBe(200)
        expect(st.speed).toBe(128)
        expect(st.color).toEqual({ h: 40, s: 220, v: 200 })
        expect(fx.effectCatalog.kind).toBe('rgb_matrix')
    })

    it('writes effect/brightness/speed/colour without throwing', async () => {
        const sent: number[][] = []
        const client = makeClient(
            async (f: Uint8Array): Promise<Uint8Array> => {
                sent.push([f[0], f[1], f[2]])
                return frame([f[0]])
            },
        )
        const fx = createRgbMatrixEffectFacade(client)
        await fx.setEffect({
            mode: 3,
            brightness: 100,
            speed: 50,
            color: { h: 10, s: 20, v: 100 },
        })
        // 4 sets, all on the RGB-matrix channel.
        expect(sent).toHaveLength(4)
        expect(sent.every((s) => s[0] === VIA_ID.CUSTOM_SET_VALUE)).toBe(true)
        expect(sent.every((s) => s[1] === VIA_CHANNEL.RGB_MATRIX)).toBe(true)
        await fx.saveEffect()
    })
})
