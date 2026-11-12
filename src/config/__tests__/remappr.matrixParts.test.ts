// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr/index'
import { DecodeCode, decodeRemapprBlob, readBlobFrames } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'
import { readPartEntries } from '../compilers/remappr/sensor'
import type { SensorInfo, SensorSettingInfo } from '../../devices/types'

const TINY = (defaults: Record<string, number>) =>
    parseKeymap(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'Tiny', target: 'remappr' },
            keyboard: {
                id: 'tiny',
                name: 'Tiny',
                keys: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                ],
            },
            defaults: { tappingTermMs: 200, ...defaults },
            layers: [{ name: 'base', bindings: ['A', 'B'] }],
        }),
    )

const setting = (
    name: string,
    extra: Partial<SensorSettingInfo> = {},
): SensorSettingInfo => ({
    name,
    label: name,
    type: 'int',
    unit: 'ms',
    min: 1,
    max: 65535,
    step: 1,
    advanced: true,
    default: 5,
    value: 5,
    personality: false,
    ...extra,
})

const part = (
    index: number,
    cls: SensorInfo['cls'],
    settings: SensorSettingInfo[],
): SensorInfo => ({
    index,
    cls,
    model: cls,
    channels: 1,
    io: [],
    settings,
    procedures: [],
    metrics: [],
})

const MATRIX_SETTINGS = () => [
    setting('scanPeriodMs'),
    setting('debouncePressMs'),
    setting('debounceReleaseMs'),
]

// A keyboard whose part 0 is a battery and parts 1 and 2 its two matrices.
const PARTS: SensorInfo[] = [
    part(0, 'battery', []),
    part(1, 'matrix', MATRIX_SETTINGS()),
    part(2, 'matrix', MATRIX_SETTINGS()),
]

const TIMING = {
    matrixPollPeriodMs: 2,
    matrixPressDebounceMs: 3,
    matrixReleaseDebounceMs: 7,
}

function tables(blob: Uint8Array) {
    const parsed = readBlobFrames(blob)
    const t = (id: number) => parsed.frames.find((f) => f.id === id)
    const layer = t(TableId.Layer)!
    const u16 = (off: number) =>
        blob[layer.start + off] | (blob[layer.start + off + 1] << 8)
    const pt = t(TableId.Sensor)
    const parts = pt ? readPartEntries(blob, pt.start, pt.end) : undefined
    return { layerLen: layer.end - layer.start, u16, parts }
}

describe('matrix timing in the MATRIX parts (TBL_PART)', () => {
    it('writes each field for every matrix part and 0 in the tail', () => {
        const { blob, diagnostics } = buildRemapprBlob(TINY(TIMING), {
            configVersion: 1,
            parts: PARTS,
        })
        expect(diagnostics).toEqual([])
        const t = tables(blob)
        // Every matrix field folded and nothing else set: the 8-byte layout.
        expect(t.layerLen).toBe(8)
        expect(t.parts).toEqual([
            { sensor: 1, id: 0x30, ch: 0, value: 2 },
            { sensor: 1, id: 0x31, ch: 0, value: 3 },
            { sensor: 1, id: 0x32, ch: 0, value: 7 },
            { sensor: 2, id: 0x30, ch: 0, value: 2 },
            { sensor: 2, id: 0x31, ch: 0, value: 3 },
            { sensor: 2, id: 0x32, ch: 0, value: 7 },
        ])
        // TBL_PART v1: every channel is 0.
        const pt = readBlobFrames(blob).frames.find((f) => f.id === TableId.Sensor)!
        expect(pt.version).toBe(1)
    })

    it('keeps the other tail fields at their offsets', () => {
        const { blob } = buildRemapprBlob(
            TINY({ ...TIMING, pressDebounceMs: 4, capsWordIdleMs: 900 }),
            { configVersion: 1, parts: PARTS },
        )
        const t = tables(blob)
        expect(t.layerLen).toBe(24)
        expect(t.u16(8)).toBe(4) // press_debounce_ms
        expect(t.u16(10)).toBe(0) // matrix_press_debounce_ms
        expect(t.u16(12)).toBe(0) // matrix_release_debounce_ms
        expect(t.u16(14)).toBe(900) // caps_word_idle_ms
        expect(t.u16(22)).toBe(0) // matrix_poll_period_ms
    })

    it('keeps the tail without the part list', () => {
        const { blob } = buildRemapprBlob(TINY(TIMING), { configVersion: 1 })
        const t = tables(blob)
        expect(t.layerLen).toBe(24)
        expect(t.u16(10)).toBe(3)
        expect(t.u16(12)).toBe(7)
        expect(t.u16(22)).toBe(2)
        expect(t.parts).toBeUndefined()
    })

    it('keeps a field in the tail where no matrix part takes it', () => {
        const parts = [
            part(0, 'matrix', [
                setting('debouncePressMs'),
                // Firmware before the fold: the personality drives it.
                setting('debounceReleaseMs', { personality: true }),
            ]),
        ]
        const { blob } = buildRemapprBlob(TINY(TIMING), {
            configVersion: 1,
            parts,
        })
        const t = tables(blob)
        expect(t.u16(10)).toBe(0)
        expect(t.u16(12)).toBe(7)
        expect(t.u16(22)).toBe(2)
        expect(t.parts).toEqual([{ sensor: 0, id: 0x31, ch: 0, value: 3 }])
    })

    it('leaves out a value a part would refuse, with a warning', () => {
        const parts = [
            part(0, 'matrix', [setting('scanPeriodMs', { max: 1 })]),
        ]
        const { blob, diagnostics } = buildRemapprBlob(
            TINY({ matrixPollPeriodMs: 2 }),
            { configVersion: 1, parts },
        )
        expect(tables(blob).parts).toBeUndefined()
        expect(tables(blob).layerLen).toBe(8)
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0].path).toEqual(['defaults', 'matrixPollPeriodMs'])
    })

    it('writes nothing for a field at 0 (the board value)', () => {
        const { blob } = buildRemapprBlob(TINY({ matrixPressDebounceMs: 3 }), {
            configVersion: 1,
            parts: [PARTS[1]],
        })
        expect(tables(blob).parts).toEqual([
            { sensor: 1, id: 0x31, ch: 0, value: 3 },
        ])
    })

    it('reads the timing back from TBL_PART', () => {
        const { blob } = buildRemapprBlob(TINY(TIMING), {
            configVersion: 1,
            parts: PARTS,
        })
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.defaults).toMatchObject(TIMING)
    })

    it('reads a TBL_PART value over the tail', () => {
        const parts = [
            part(0, 'matrix', [
                setting('debouncePressMs'),
                setting('debounceReleaseMs', { personality: true }),
            ]),
        ]
        const { blob } = buildRemapprBlob(TINY(TIMING), {
            configVersion: 1,
            parts,
        })
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.config!.defaults).toMatchObject(TIMING)
    })
})
