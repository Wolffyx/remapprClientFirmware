// L3.7 (tables): a save of a config read off a device keeps the tables the
// config does not model, byte for byte, or refuses when it cannot.
import { describe, expect, it } from 'vitest'
import type { ConfigKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { BehaviorType, TableId } from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'
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

    it('refuses slider bindings once the keymap renumbers behaviors', () => {
        const device = assembleBlob([...keymapCore(), SLIDER])
        const out = resave(device, (c) => ({
            ...c,
            layers: [
                {
                    ...c.layers[0],
                    bindings: [{ type: 'key_press', key: 'C' }, ...c.layers[0].bindings],
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
