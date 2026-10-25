import { describe, expect, it } from 'vitest'
import { normalizeAction, parseKeymap } from '../normalize'
import { knobSlotOf, remapKnobKeys, syncKnobs } from '../knobs'
import type { ConfigKeymap } from '../types'

const T = { type: 'transparent' } as const
const kp = (token: string) => normalizeAction(token)

const board = (): ConfigKeymap =>
    parseKeymap(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'K', target: 'zmk' },
            keyboard: {
                id: 'k',
                name: 'K',
                keys: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0, element: 'encoder' },
                    { x: 2, y: 0 },
                    { x: 3, y: 0, element: 'encoder' },
                ],
                encoders: [{ x: 9, y: 9 }],
            },
            layers: [
                {
                    name: 'base',
                    bindings: ['A', 'B', 'C', 'D'],
                    encoders: [{ cw: 'Up', ccw: 'Down' }],
                    encoderBindings: {
                        3: { cw: 'Right', ccw: 'Left', press: 'Enter' },
                    },
                },
            ],
        }),
    )

describe('knob slots', () => {
    it('gives every knob key one linked slot after the unlinked ones', () => {
        const km = board()
        expect(km.keyboard.encoders).toEqual([
            { x: 9, y: 9 },
            { x: 1, y: 0, key: 1 },
            { x: 3, y: 0, key: 3 },
        ])
        const enc = km.layers[0].encoders!
        expect(enc[0].cw).toMatchObject(kp('Up'))
        expect(enc[1]).toEqual({ cw: T, ccw: T })
        expect(enc[2].cw).toMatchObject(kp('Right'))
        // the older press became the key's binding; a linked slot has none
        expect(km.layers[0].bindings[3]).toMatchObject(kp('Enter'))
        expect(enc[2].press).toBeUndefined()
        expect(knobSlotOf(km, 3)).toBe(2)
    })

    it('is a no-op on a synced design', () => {
        const km = board()
        expect(syncKnobs(km)).toBe(km)
    })

    it('follows a moved knob and drops the slot of a key that stops being one', () => {
        const km = board()
        const moved = syncKnobs({
            ...km,
            keyboard: {
                ...km.keyboard,
                keys: km.keyboard.keys.map((k, i) =>
                    i === 1
                        ? { ...k, x: 5, element: undefined }
                        : i === 3
                          ? { ...k, y: 2 }
                          : k,
                ),
            },
        })
        expect(moved.keyboard.encoders).toEqual([
            { x: 9, y: 9 },
            { x: 3, y: 2, key: 3 },
        ])
        expect(moved.layers[0].encoders![1].cw).toMatchObject(kp('Right'))
    })

    it('renumbers links when keys are removed, dropping a removed knob', () => {
        const km = board()
        // remove key 0 and knob key 1: key 3 → 1
        const out = remapKnobKeys(
            {
                ...km,
                keyboard: {
                    ...km.keyboard,
                    keys: [km.keyboard.keys[2]!, km.keyboard.keys[3]!],
                },
                layers: km.layers.map((l) => ({
                    ...l,
                    bindings: l.bindings.slice(2),
                })),
            },
            [-1, -1, 0, 1],
        )
        expect(out.keyboard.encoders).toEqual([
            { x: 9, y: 9 },
            { x: 3, y: 0, key: 1 },
        ])
        expect(out.layers[0].encoders).toHaveLength(2)
        expect(out.layers[0].encoders![1].cw).toMatchObject(kp('Right'))
    })
})
