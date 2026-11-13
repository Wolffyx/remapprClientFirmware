// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import { normalizeAction, parseKeymap } from '../normalize'
import { serializeKeymap } from '../serialize'
import { buildRemapprBlob } from '../compilers/remappr/index'
import { decodeRemapprBlob, DecodeCode, readBlobFrames } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'
import {
    remapSliderKeys,
    setSliderBinding,
    sliderSlotOf,
    syncSliders,
} from '../sliders'
import type { ConfigKeymap } from '../types'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const keyOf = (token: string): string =>
    (normalizeAction(token) as { key: string }).key

/** Keys 1 and 3 are sliders (slots 0, 1); `slots` false = an older design
 *  that has the keys but no slot list yet. */
const board = (layers: unknown[], slots = true): ConfigKeymap =>
    parseKeymap(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'S', target: 'remappr' },
            keyboard: {
                id: 's',
                name: 'S',
                keys: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0, element: 'slider' },
                    { x: 2, y: 0 },
                    { x: 3, y: 0, element: 'slider' },
                ],
                ...(slots
                    ? {
                          sliders: [
                              { x: 1, y: 0, key: 1 },
                              { x: 3, y: 0, key: 3 },
                          ],
                      }
                    : {}),
            },
            layers,
        }),
    )

const TWO_LAYERS = [
    {
        name: 'base',
        bindings: ['A', 'B', 'C', 'D'],
        sliders: [
            { map: 'volume', steps: 10 },
            { map: 'rgb_brightness', min: 20, max: 100 },
        ],
    },
    {
        name: 'fn',
        bindings: ['A', 'B', 'C', 'D'],
        sliders: [{ map: 'keys', steps: 5, up: 'Up', down: 'Down' }, null],
    },
]

function sliderTable(blob: Uint8Array): Uint8Array {
    const t = readBlobFrames(blob).frames.find((f) => f.id === TableId.Slider)!
    return blob.subarray(t.start, t.end)
}

describe('slider slots', () => {
    it('gives every slider key a linked slot, moving older per-key bindings in', () => {
        const km = board([
            {
                name: 'base',
                bindings: ['A', 'B', 'C', 'D'],
                sliderBindings: { 3: { map: 'rgb_hue' } },
            },
        ], false)
        expect(km.keyboard.sliders).toEqual([
            { x: 1, y: 0, key: 1 },
            { x: 3, y: 0, key: 3 },
        ])
        expect(km.layers[0]!.sliders).toEqual([null, { map: 'rgb_hue' }])
        expect(sliderSlotOf(km, 3)).toBe(1)
        expect(sliderSlotOf(km, 0)).toBe(-1)
    })

    it('follows a key renumbering and drops a removed slider', () => {
        const km = board(TWO_LAYERS)
        // key 1 removed, key 3 -> 2
        const next = remapSliderKeys(
            {
                ...km,
                keyboard: {
                    ...km.keyboard,
                    keys: [km.keyboard.keys[0]!, km.keyboard.keys[2]!, km.keyboard.keys[3]!],
                },
                layers: km.layers.map((l) => ({
                    ...l,
                    bindings: [l.bindings[0]!, l.bindings[2]!, l.bindings[3]!],
                })),
            },
            [0, -1, 1, 2],
        )
        expect(next.keyboard.sliders).toEqual([{ x: 3, y: 0, key: 2 }])
        expect(next.layers[0]!.sliders).toEqual([
            { map: 'rgb_brightness', min: 20, max: 100 },
        ])
        expect(next.layers[1]!.sliders).toBeUndefined()
    })

    it('sets and clears one layer slot', () => {
        const km = board(TWO_LAYERS)
        const set = setSliderBinding(km, 1, 1, { map: 'rgb_hue' })
        expect(set.layers[1]!.sliders).toEqual([
            km.layers[1]!.sliders![0],
            { map: 'rgb_hue' },
        ])
        const cleared = setSliderBinding(setSliderBinding(set, 1, 0, null), 1, 1, null)
        expect(cleared.layers[1]!.sliders).toBeUndefined()
        expect(setSliderBinding(km, 0, 5, null)).toBe(km)
    })

    it('is in sync already: unchanged', () => {
        const km = board(TWO_LAYERS)
        expect(syncSliders(km)).toBe(km)
    })

    it('serializes the slots and reads them back', () => {
        const km = board(TWO_LAYERS)
        const again = parseKeymap(serializeKeymap(km))
        expect(again.keyboard.sliders).toEqual(km.keyboard.sliders)
        expect(again.layers).toEqual(km.layers)
    })
})

describe('TBL_SLIDER', () => {
    it('writes the bytes the firmware decodes (base layer = any layer)', () => {
        const { blob, diagnostics } = buildRemapprBlob(board(TWO_LAYERS), { configVersion: 1 })
        expect(diagnostics.filter((d) => d.level === 'error')).toEqual([])
        const t = sliderTable(blob)
        expect(t[0] | (t[1] << 8)).toBe(3)
        const e = (i: number) => hex(t.subarray(2 + i * 10, 12 + i * 10))
        // slider 0, any layer, STEPS, 10 steps, up / down = vol up / down
        expect(e(0).slice(0, 12)).toBe('00ff020a0000')
        // slider 1, any layer, LEVEL rgb_brightness, 20 %..100 % = 51..255
        expect(e(1)).toBe('01ff010133ffffffffff')
        // slider 0, layer 1, STEPS, 5 steps
        expect(e(2).slice(0, 12)).toBe('000102050000')
        expect(e(2).slice(12)).not.toContain('ffff')
    })

    it('reads back what it writes', () => {
        const km = board(TWO_LAYERS)
        const { blob } = buildRemapprBlob(km, { configVersion: 1 })
        const res = decodeRemapprBlob(blob)
        expect(res.code).toBe(DecodeCode.OK)
        const layers = res.config!.layers
        expect(layers[0]!.sliders).toEqual([
            { map: 'volume', steps: 10 },
            { map: 'rgb_brightness', min: 20, max: 100 },
        ])
        expect(layers[1]!.sliders![0]).toMatchObject({
            map: 'keys',
            steps: 5,
            up: { type: 'key_press', key: keyOf('Up') },
            down: { type: 'key_press', key: keyOf('Down') },
        })
        expect(layers[1]!.sliders![1]).toBeNull()
    })

    it('warns about and leaves out a map the firmware has no form for', () => {
        const { blob, diagnostics } = buildRemapprBlob(
            board([
                {
                    name: 'base',
                    bindings: ['A', 'B', 'C', 'D'],
                    sliders: [{ map: 'backlight' }, { map: 'mouse_wheel', steps: 500 }],
                },
            ]),
            { configVersion: 1 },
        )
        expect(diagnostics.map((d) => d.message).join('\n')).toMatch(/backlight/)
        expect(diagnostics.map((d) => d.message).join('\n')).toMatch(/steps 500 set to 100/)
        const t = sliderTable(blob)
        expect(t[0]).toBe(1)
        expect(hex(t.subarray(2, 8))).toBe('01ff02640000')
    })
})
