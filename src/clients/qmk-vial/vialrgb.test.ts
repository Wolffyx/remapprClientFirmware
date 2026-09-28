// Pattern check: no GoF pattern (-) — rejected — unit tests for the VialRGB facade against a byte-level vialrgb.c emulator, no abstraction.
import { describe, expect, it } from 'vitest'

import type { HidClient } from '@firmware/clients/qmk/hidClient'
import { RGB_MATRIX_EFFECTS } from '@firmware/lighting'
import { VIA_PAYLOAD_SIZE } from '@firmware/clients/qmk/protocol'

import {
    createVialRgbFacade,
    FASTSET_MAX_LEDS,
    probeVialRgb,
    VIALRGB_EFFECT_DIRECT,
    VIALRGB_EFFECT_NAMES,
} from './vialrgb'

interface Led {
    row: number
    col: number
}

interface FakeBoard {
    /** Supported VialRGB ids, excluding 0 (off), ascending. */
    supported: number[]
    maxBrightness: number
    mode: { id: number; speed: number; h: number; s: number; v: number }
    leds: Led[]
    direct: { h: number; s: number; v: number }[]
    saves: number
    sent: Uint8Array[]
}

/** Answers like vial-qmk quantum/vialrgb.c (and via.c's lighting dispatch). */
function fakeBoard(opts: Partial<FakeBoard> = {}): {
    board: FakeBoard
    client: HidClient
} {
    const leds = opts.leds ?? [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 0 },
    ]
    const board: FakeBoard = {
        supported: opts.supported ?? [1, 2, 6, 14],
        maxBrightness: opts.maxBrightness ?? 29,
        mode: opts.mode ?? { id: 14, speed: 127, h: 0, s: 255, v: 29 },
        leds,
        direct: leds.map(() => ({ h: 0, s: 0, v: 0 })),
        saves: 0,
        sent: [],
    }
    const hasDirect = (): boolean => board.supported.includes(1)
    const client = {
        async send(req: Uint8Array): Promise<Uint8Array> {
            board.sent.push(req.slice())
            const data = req.slice(0, VIA_PAYLOAD_SIZE)
            const args = data.subarray(2)
            if (data[0] === 0x08) {
                switch (data[1]) {
                    case 0x40:
                        args.set([1, 0, board.maxBrightness])
                        break
                    case 0x41: {
                        const m = board.mode
                        args.set([
                            m.id & 0xff,
                            m.id >> 8,
                            m.speed,
                            m.h,
                            m.s,
                            m.v,
                        ])
                        break
                    }
                    case 0x42: {
                        const gt = args[0] | (args[1] << 8)
                        let length = VIA_PAYLOAD_SIZE - 2
                        args.fill(0xff)
                        let off = 0
                        for (const id of board.supported) {
                            if (id > gt && length >= 2) {
                                args[off] = id & 0xff
                                args[off + 1] = id >> 8
                                off += 2
                                length -= 2
                            }
                        }
                        break
                    }
                    case 0x43:
                        if (hasDirect())
                            args.set([
                                board.leds.length & 0xff,
                                board.leds.length >> 8,
                            ])
                        break
                    case 0x44: {
                        if (!hasDirect()) break
                        // vialrgb.c: `args[0] | (args[1] >> 8)` — low byte only.
                        const led = args[0] | (args[1] >> 8)
                        if (led >= board.leds.length) break
                        const l = board.leds[led]
                        args.set([led * 10, 0, 4, l.row, l.col])
                        break
                    }
                }
            } else if (data[0] === 0x07) {
                if (data[1] === 0x41) {
                    board.mode = {
                        id: args[0] | (args[1] << 8),
                        speed: args[2],
                        h: args[3],
                        s: args[4],
                        v: Math.min(args[5], board.maxBrightness),
                    }
                } else if (data[1] === 0x42 && hasDirect()) {
                    const first = args[0] | (args[1] << 8)
                    const n = args[2]
                    for (let i = 0; i < n; i++) {
                        if (first + i >= board.leds.length) break
                        board.direct[first + i] = {
                            h: args[3 + i * 3],
                            s: args[4 + i * 3],
                            v: Math.min(args[5 + i * 3], board.maxBrightness),
                        }
                    }
                }
            } else if (data[0] === 0x09) {
                board.saves++
            }
            return data
        },
        close: async () => {},
        onClosed: () => () => {},
        subscribe: () => () => {},
    } satisfies HidClient
    return { board, client }
}

describe('qmk-vial — VialRGB (#191)', () => {
    it('names every effect the way the RGB-matrix catalog spells it', () => {
        expect(VIALRGB_EFFECT_NAMES).toHaveLength(45)
        expect(VIALRGB_EFFECT_NAMES[VIALRGB_EFFECT_DIRECT]).toBe('Direct')
        const known = new Set<string>(RGB_MATRIX_EFFECTS)
        for (const name of VIALRGB_EFFECT_NAMES) {
            if (name !== 'Direct') expect(known).toContain(name)
        }
    })

    it('probes info, all supported effects across pages, and the LED count', async () => {
        const supported = Array.from({ length: 44 }, (_, i) => i + 1)
        const { client } = fakeBoard({ supported })
        const info = await probeVialRgb(client)
        expect(info).toEqual({
            maxBrightness: 29,
            effectIds: [0, ...supported],
            ledCount: 3,
        })
    })

    it('is not VialRGB when the board does not answer the info query', async () => {
        const client = {
            send: async (req: Uint8Array) => {
                const r = new Uint8Array(VIA_PAYLOAD_SIZE)
                r[0] = 0xff // id_unhandled
                r[1] = req[1]
                return r
            },
            close: async () => {},
            onClosed: () => () => {},
            subscribe: () => () => {},
        } satisfies HidClient
        expect(await probeVialRgb(client)).toBeNull()
    })

    it('reads the effect as a catalog index, with brightness on the full 0–255 scale', async () => {
        const { client } = fakeBoard()
        const rgb = createVialRgbFacade(
            client,
            (await probeVialRgb(client))!,
            () => [],
        )
        expect(rgb.effectCatalog?.effects).toEqual([
            'None',
            'Direct',
            'Solid Color',
            'Breathing',
            'Cycle Left Right',
        ])
        expect(await rgb.getEffect!()).toEqual({
            mode: 4,
            speed: 127,
            brightness: 255,
            color: { h: 0, s: 255, v: 255 },
        })
    })

    it('writes the effect by VialRGB id, scaling brightness to the board cap', async () => {
        const { board, client } = fakeBoard()
        const rgb = createVialRgbFacade(
            client,
            (await probeVialRgb(client))!,
            () => [],
        )
        await rgb.setEffect!({
            mode: 3, // Breathing
            speed: 10,
            brightness: 128,
            color: { h: 85, s: 200, v: 128 },
        })
        expect(board.mode).toEqual({ id: 6, speed: 10, h: 85, s: 200, v: 15 })
        await rgb.save()
        expect(board.saves).toBe(1)
    })

    it('offers write-only, volatile per-key colours through the Direct effect', async () => {
        const leds = Array.from({ length: 20 }, (_, i) => ({ row: 0, col: i }))
        const { board, client } = fakeBoard({ leds })
        const rgb = createVialRgbFacade(
            client,
            (await probeVialRgb(client))!,
            () => [],
        )
        expect(rgb.perKeyVolatile).toBe(true)
        expect(rgb.getPerKeyColors).toBeUndefined()
        expect(await rgb.getPerKeyEffectMode!()).toBe(1)
        expect(await rgb.getLedCount()).toBe(20)

        board.sent = []
        const red = { h: 0, s: 255, v: 255 }
        await rgb.setPerKeyColors!(
            5,
            Array.from({ length: 12 }, () => red),
        )
        // 12 LEDs → one full packet of 9, then 3.
        expect(board.sent.map((f) => [f[2], f[4]])).toEqual([
            [5, FASTSET_MAX_LEDS],
            [14, 3],
        ])
        expect(board.direct[5]).toEqual({ h: 0, s: 255, v: 29 })
        expect(board.direct[16]).toEqual({ h: 0, s: 255, v: 29 })
        expect(board.direct[17]).toEqual({ h: 0, s: 0, v: 0 })

        // Past the end or unmapped: nothing is sent.
        board.sent = []
        await rgb.setPerKeyColors!(-1, [red])
        await rgb.setPerKeyColors!(20, [red])
        expect(board.sent).toHaveLength(0)
    })

    it('maps layout keys to LEDs through their matrix positions', async () => {
        const { client } = fakeBoard({
            leds: [
                { row: 1, col: 0 },
                { row: 0, col: 0 },
                { row: 2, col: 3 }, // spacebar: two LEDs, first wins
                { row: 2, col: 3 },
                { row: 0xff, col: 0xff }, // underglow, not under a key
            ],
        })
        const keys = [
            { row: 0, col: 0 },
            { row: 1, col: 0 },
            { row: 2, col: 3 },
            { row: 3, col: 3 }, // no LED
        ]
        const rgb = createVialRgbFacade(
            client,
            (await probeVialRgb(client))!,
            () => keys,
        )
        expect(await rgb.getLedIndexMap!(4)).toEqual([1, 0, 2, -1])
    })

    it('has no per-key surface when the build lacks the Direct effect', async () => {
        const { client } = fakeBoard({ supported: [2, 6] })
        const info = (await probeVialRgb(client))!
        expect(info.ledCount).toBe(0)
        const rgb = createVialRgbFacade(client, info, () => [])
        expect(rgb.setPerKeyColors).toBeUndefined()
        expect(rgb.perKeyVolatile).toBeUndefined()
        expect(rgb.effectCatalog?.effects).toEqual([
            'None',
            'Solid Color',
            'Breathing',
        ])
    })
})
