// L3.7 (tables): a save of a config read off a device keeps the tables the
// config does not model, byte for byte, or refuses when it cannot.
import { describe, expect, it } from 'vitest'
import type { ConfigKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { BehaviorType, TableId } from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob, readBlobFrames } from '../compilers/remappr/decode'
import { readPartEntries } from '../compilers/remappr/sensor'
import {
    assembleBlob,
    behaviorBytes,
    blobTables,
    keymapCore,
    type RawTable,
    tableOf,
    u16,
} from './blobFixtures'

const SENSOR: RawTable = {
    id: TableId.Sensor,
    version: 1,
    payload: [...u16(1), 0, 0x21, ...u16(3), 0x10, 0x00, 0x00, 0x00],
}
const DISPLAY: RawTable = {
    id: TableId.Display,
    version: 1,
    payload: [0, 0, ...u16(0), ...u16(0), ...u16(0)],
}
const LAYOUT: RawTable = { id: TableId.Layout, version: 1, payload: [1, 2, 3, 4] }
const FUTURE: RawTable = { id: 40, version: 3, payload: [9, 8, 7] }
const PER_LAYER_RGB: RawTable = {
    id: TableId.Rgb,
    version: 1,
    // mode 1 (per-key), flags bit0 (per-layer), 1 layer, 2 positions.
    payload: [1, 1, 1, 0, ...u16(2), ...u16(0), 0xff, 0, 0, 0, 0xff, 0],
}
const SLIDER: RawTable = {
    id: TableId.Slider,
    version: 1,
    // one STEPS entry: slider 0, any layer, 10 steps, up = behavior 0, down = 1.
    payload: [...u16(1), 0, 0xff, 2, 10, 0, 0, ...u16(0), ...u16(1)],
}
const clusterSec = (key: number[]): RawTable => ({
    id: TableId.ClusterSec,
    version: 1,
    payload: key,
})

function resave(
    device: Uint8Array,
    edit: (c: ConfigKeymap) => ConfigKeymap = (c) => c,
): ReturnType<typeof buildRemapprBlob> {
    const decoded = decodeRemapprBlob(device)
    expect(decoded.code).toBe(DecodeCode.OK)
    return buildRemapprBlob(edit(decoded.config!), {
        configVersion: 2,
        carryFrom: device,
    })
}

const errors = (r: ReturnType<typeof buildRemapprBlob>): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

describe('carry unmodeled tables on re-encode (L3.7)', () => {
    it('keeps sensor, display, reserved and unknown tables byte for byte', () => {
        const device = assembleBlob([...keymapCore(), SENSOR, DISPLAY, LAYOUT, FUTURE])
        const out = resave(device)
        expect(errors(out)).toEqual([])
        for (const t of [SENSOR, DISPLAY, LAYOUT, FUTURE])
            expect(tableOf(out.blob, t.id)).toEqual(t)
        // and the result is a blob the decoder (and so the firmware) accepts
        expect(decodeRemapprBlob(out.blob).code).toBe(DecodeCode.OK)
    })

    it('keeps a per-layer RGB table instead of flattening it to layer 0', () => {
        const device = assembleBlob([...keymapCore(), PER_LAYER_RGB])
        const out = resave(device)
        expect(tableOf(out.blob, TableId.Rgb)).toEqual(PER_LAYER_RGB)
    })

    it('lets a table the compile writes from an edit win over the carried one', () => {
        const device = assembleBlob([...keymapCore(), PER_LAYER_RGB])
        const out = resave(device, (c) => ({
            ...c,
            keyboard: { ...c.keyboard, lighting: { perKey: { 0: '#00ff00' } } },
        }))
        const rgb = blobTables(out.blob).filter((t) => t.id === TableId.Rgb)
        expect(rgb).toHaveLength(1)
        expect(rgb[0].payload[1] & 1).toBe(0) // the compiled, flat table
    })

    it('keeps a cluster key that reads back intact', () => {
        const key = clusterSec(Array.from({ length: 16 }, (_, i) => i + 1))
        const out = resave(assembleBlob([...keymapCore(), key]))
        expect(errors(out)).toEqual([])
        expect(tableOf(out.blob, TableId.ClusterSec)).toEqual(key)
    })

    it('refuses to replace a redacted (zeroed) cluster key', () => {
        const out = resave(assembleBlob([...keymapCore(), clusterSec(Array(16).fill(0))]))
        expect(errors(out).join()).toMatch(/cluster key/)
        expect(tableOf(out.blob, TableId.ClusterSec)).toBeUndefined()
    })

    it('keeps slider bindings while the behavior table is unchanged', () => {
        const out = resave(assembleBlob([...keymapCore(), SLIDER]))
        expect(errors(out)).toEqual([])
        expect(tableOf(out.blob, TableId.Slider)).toEqual(SLIDER)
    })

    it('rewrites slider bindings from the config once the keymap renumbers behaviors', () => {
        // The decoder reads TBL_SLIDER into layers[].sliders (slider.ts), so a
        // recompile writes the slider table with the new behavior indices.
        const device = assembleBlob([...keymapCore(), SLIDER])
        // The two keys swapped: B is now behavior 0 and A behavior 1.
        const out = resave(device, (c) => ({
            ...c,
            layers: [
                {
                    ...c.layers[0],
                    bindings: [c.layers[0].bindings[1], c.layers[0].bindings[0]],
                },
            ],
        }))
        expect(errors(out)).toEqual([])
        const slider = tableOf(out.blob, TableId.Slider)!
        const behaviors = tableOf(out.blob, TableId.Behavior)!.payload
        const tapOf = (i: number) => behaviors[2 + i * 16 + 4]
        const up = slider.payload[8] | (slider.payload[9] << 8)
        const down = slider.payload[10] | (slider.payload[11] << 8)
        expect([tapOf(up), tapOf(down)]).toEqual([0x04, 0x05])
    })

    it('refuses a slider table it cannot read once the keymap renumbers behaviors', () => {
        // An entry kind this client does not know: the table is carried as
        // read, and its behavior indices would no longer match.
        const unknown: RawTable = {
            ...SLIDER,
            payload: [...u16(1), 0, 0xff, 9, 10, 0, 0, ...u16(0), ...u16(1)],
        }
        const device = assembleBlob([...keymapCore(), unknown])
        const out = resave(device, (c) => ({
            ...c,
            layers: [
                {
                    ...c.layers[0],
                    bindings: [c.layers[0].bindings[1], c.layers[0].bindings[0]],
                },
            ],
        }))
        expect(errors(out).join()).toMatch(/slider/)
    })

    it('carries nothing extra for a config with only modeled tables', () => {
        const device = assembleBlob(
            keymapCore([
                behaviorBytes({ type: BehaviorType.Key, tap: 0x04 }),
                behaviorBytes({ type: BehaviorType.Key, tap: 0x05 }),
            ]),
        )
        const out = resave(device)
        expect(blobTables(out.blob).map((t) => t.id)).toEqual([
            TableId.Layer,
            TableId.Behavior,
            TableId.Binding,
        ])
    })
})

/** TBL_PART entries as [part, id, ch, value]. */
const partTable = (entries: [number, number, number, number][]): RawTable => ({
    id: TableId.Sensor,
    version: 1,
    payload: [
        ...u16(entries.length),
        ...entries.flatMap(([p, id, ch, v]) => [p, id, ch, 0, v & 0xff, (v >> 8) & 0xff, 0, 0]),
    ],
})
const partsOf = (blob: Uint8Array) => {
    const t = readBlobFrames(blob).frames.filter((f) => f.id === TableId.Sensor)
    expect(t.length).toBeLessThanOrEqual(1)
    if (!t[0]) return []
    return (readPartEntries(blob, t[0].start, t[0].end) as {
        sensor: number
        id: number
        value: number
    }[]).map((e) => [e.sensor, e.id, e.value])
}

const SCAN = 0x30 // scanPeriodMs: matrix timing the keymap reads into defaults
const EAGER = 0x34 // eagerPress: a matrix part setting the keymap does not model
const BRIGHTNESS = 0x70

describe('TBL_PART on a save is kept per entry', () => {
    it('drops matrix timing the config cleared and keeps the rest', () => {
        const device = assembleBlob([...keymapCore(), partTable([[0, SCAN, 0, 5], [0, EAGER, 0, 1]])])
        const out = resave(device, (c) => {
            expect(c.defaults?.matrixPollPeriodMs).toBe(5)
            return { ...c, defaults: { ...c.defaults, matrixPollPeriodMs: undefined } }
        })
        expect(errors(out)).toEqual([])
        expect(partsOf(out.blob)).toEqual([[0, EAGER, 1]])
    })

    it("keeps the device's entries beside the ones the compile writes", () => {
        const display: RawTable = {
            id: TableId.Display,
            version: 1,
            // one page on part 3 with one rect widget
            payload: [1, 1, ...u16(0), ...u16(0), ...u16(0), 3, 0, 1, 0, 6, 0, 0, 0, 4, 4, 0, 0, ...u16(0), ...u16(0)],
        }
        const device = assembleBlob([
            ...keymapCore(),
            display,
            partTable([[3, BRIGHTNESS, 0, 100], [0, EAGER, 0, 1]]),
        ])
        const out = resave(device, (c) => {
            const d = c.node!.displays as { settings?: Record<string, unknown> }[]
            expect(d[0].settings).toEqual({ brightness: 100 })
            d[0].settings = { brightness: 50 }
            return c
        })
        expect(errors(out)).toEqual([])
        expect(partsOf(out.blob)).toEqual([[0, EAGER, 1], [3, BRIGHTNESS, 50]])
    })
})
