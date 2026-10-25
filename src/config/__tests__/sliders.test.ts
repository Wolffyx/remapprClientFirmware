import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../normalize'
import { serializeKeymap } from '../serialize'
import { getCompiler } from '../compiler'
import {
    lowerConfigToMock,
    raiseMockToConfig,
} from '../../clients/mock/configBridge'

const src = JSON.stringify({
    schemaVersion: 1,
    kind: 'remappr.keymap',
    meta: { name: 'S', target: 'zmk' },
    keyboard: {
        id: 's',
        name: 'S',
        keys: [
            { x: 0, y: 0 },
            {
                x: 1,
                y: 0,
                h: 3,
                element: 'slider',
                motor: {
                    follow: 'level',
                    touchStops: true,
                    pins: { in1: 'D8' },
                },
            },
        ],
    },
    layers: [
        {
            name: 'base',
            bindings: ['A', 'B'],
            sliderBindings: {
                1: {
                    map: 'keys',
                    up: 'Volume Up',
                    down: 'Volume Down',
                    steps: 16,
                },
            },
        },
        {
            name: 'fn',
            bindings: ['A', 'B'],
            sliderBindings: { 1: { map: 'backlight', min: 0, max: 100 } },
        },
    ],
})

describe('sliders', () => {
    it('round-trips keys mode, a level preset and the motor', () => {
        const km = parseKeymap(src)
        expect(km.keyboard.keys[1]!.motor?.pins?.in1).toBe('D8')
        expect(km.layers[0]!.sliderBindings?.[1]).toMatchObject({
            map: 'keys',
            steps: 16,
            up: { type: 'key_press' },
            down: { type: 'key_press' },
        })
        const again = parseKeymap(serializeKeymap(km))
        expect(again.layers).toEqual(km.layers)
        expect(again.keyboard.keys[1]!.motor).toEqual(
            km.keyboard.keys[1]!.motor,
        )
    })

    it('survives the demo runtime: lowered, edited, raised', () => {
        const km = parseKeymap(src)
        const { layers } = lowerConfigToMock(km)
        expect(layers[0]!.sliders?.[1]?.map).toBe('keys')
        expect(layers[0]!.sliders?.[1]?.up?.kind).toBeDefined()
        const edited = layers.map((l, i) => ({
            ...l,
            ...(i === 1
                ? { sliders: { 1: { map: 'volume', min: 10, max: 90 } } }
                : {}),
        }))
        const raised = raiseMockToConfig(edited, km)
        expect(raised.layers[0]!.sliderBindings?.[1]?.up).toEqual(
            km.layers[0]!.sliderBindings?.[1]?.up,
        )
        expect(raised.layers[1]!.sliderBindings?.[1]).toEqual({
            map: 'volume',
            min: 10,
            max: 90,
        })
    })

    it('lists the keys mode in the ZMK guidance block', () => {
        const dts = String(
            getCompiler('zmk')
                .compile(parseKeymap(src))
                .files.find((f) => f.filename.endsWith('.keymap'))!.content,
        )
        expect(dts).toMatch(
            /base: keys .* → up &kp \w+, down &kp \w+, 16 steps/,
        )
        expect(dts).toContain('fn: backlight [0..100]')
    })
})
