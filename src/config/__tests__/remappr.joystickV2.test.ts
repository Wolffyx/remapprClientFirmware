// pattern-check: skip vitest cases, one group per behavior
//
// L3.19: the joystick document compiles to TBL_JOYSTICK v2 (what each input
// means) with its shaping on the AXES part in TBL_PART, placed by the device's
// own part list, and reads back from both tables.
import { describe, expect, it } from 'vitest'
import type { SensorInfo, SensorSettingInfo } from '../../devices/types'
import { buildRemapprDeviceBlob, decodeRemapprDeviceBlob, parseDeviceConfig } from '../index'
import { readBlobFrames, DecodeCode } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'
import { readSensorEntries } from '../compilers/remappr/sensor'

const setting = (name: string): SensorSettingInfo =>
    ({ name, value: 0, personality: false, perChannel: true }) as unknown as SensorSettingInfo

const AXIS_SETTINGS = [
    'axisInvert',
    'axisRadial',
    'axisCurve',
    'deadzoneInner',
    'deadzoneOuter',
].map(setting)

const part = (index: number, cls: SensorInfo['cls'], channels: number): SensorInfo => ({
    index,
    cls,
    model: cls === 'analog' ? 'AXES' : 'BUTTONS',
    channels,
    io: [],
    settings: cls === 'analog' ? AXIS_SETTINGS : [],
    procedures: [],
    metrics: [],
})

// Buttons are part 0, the stick's AXES part is part 1 with four channels.
const PARTS: SensorInfo[] = [part(0, 'buttons', 1), part(1, 'analog', 4)]

const JOY = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Bench stick' },
    personality: 'joystick',
    joystick: {
        hatWays: 4,
        axes: [
            { input: 0, out: 'x', curve: 'aggressive', inner: 8, outer: 5 },
            { input: 1, out: 'y', invert: true, inner: 8, outer: 5 },
        ],
    },
} as const

const frame = (blob: Uint8Array, id: number) => {
    const p = readBlobFrames(blob)
    return p.frames.find((f) => f.id === id)
}

describe('joystick TBL_JOYSTICK v2 + TBL_PART shaping (L3.19)', () => {
    const cfg = parseDeviceConfig(JSON.stringify(JOY))

    it('writes v2 (input + out axis only) and the shaping on the AXES part', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2, sensors: PARTS })
        const jt = frame(blob, TableId.Joystick)!
        expect(jt.version).toBe(2)
        // hat 4, 2 entries, {input 0 -> X}, {input 1 -> Y}
        expect(Array.from(blob.subarray(jt.start, jt.end))).toEqual([4, 2, 0, 0, 1, 1])
        const st = frame(blob, TableId.Sensor)!
        expect(st.version).toBe(2) // channel 1 is named
        const entries = readSensorEntries(blob, st.start, st.end)
        expect(entries).toEqual([
            { sensor: 1, id: 0x40, ch: 0, value: 0 },
            { sensor: 1, id: 0x41, ch: 0, value: 0 },
            { sensor: 1, id: 0x42, ch: 0, value: 1 },
            { sensor: 1, id: 0x43, ch: 0, value: 8 },
            { sensor: 1, id: 0x44, ch: 0, value: 5 },
            { sensor: 1, id: 0x40, ch: 1, value: 1 },
            { sensor: 1, id: 0x41, ch: 1, value: 0 },
            { sensor: 1, id: 0x42, ch: 1, value: 0 },
            { sensor: 1, id: 0x43, ch: 1, value: 8 },
            { sensor: 1, id: 0x44, ch: 1, value: 5 },
        ])
    })

    it('reads v2 + TBL_PART back to the same document, byte-identical on re-encode', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2, sensors: PARTS })
        const r = decodeRemapprDeviceBlob(blob, { sensors: PARTS })
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.joystick).toEqual(JOY.joystick)
        expect(r.sensor).toBeUndefined()
        const again = buildRemapprDeviceBlob(
            { ...cfg, joystick: r.joystick },
            { configVersion: 2, sensors: PARTS },
        )
        expect(again).toEqual(blob)
    })

    it('places inputs across several AXES parts in part order', () => {
        const parts = [part(0, 'analog', 2), part(1, 'buttons', 1), part(2, 'analog', 2)]
        const doc = { ...JOY, joystick: { axes: [{ input: 3, out: 'rz', invert: true }] } }
        const blob = buildRemapprDeviceBlob(parseDeviceConfig(JSON.stringify(doc)), {
            configVersion: 2,
            sensors: parts,
        })
        const st = frame(blob, TableId.Sensor)!
        const invert = readSensorEntries(blob, st.start, st.end)
        expect(invert).toContainEqual({ sensor: 2, id: 0x40, ch: 1, value: 1 })
        expect(decodeRemapprDeviceBlob(blob, { sensors: parts }).joystick).toEqual(
            doc.joystick,
        )
    })

    it('writes the legacy v1 table without the part list', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        expect(frame(blob, TableId.Joystick)!.version).toBe(1)
        expect(frame(blob, TableId.Sensor)).toBeUndefined()
    })

    it('leaves out a default-valued setting the AXES part does not list', () => {
        const noRadial = { ...PARTS[1], settings: AXIS_SETTINGS.filter((x) => x.name !== 'axisRadial') }
        const blob = buildRemapprDeviceBlob(cfg, {
            configVersion: 2,
            sensors: [PARTS[0], noRadial],
        })
        const st = frame(blob, TableId.Sensor)!
        const ids = readSensorEntries(blob, st.start, st.end) as { id: number }[]
        expect(ids.some((e) => e.id === 0x41)).toBe(false)
        expect(ids).toHaveLength(8)
    })

    it('falls back to v1 when an input has no AXES part, so no shaping is lost', () => {
        const doc = { ...JOY, joystick: { axes: [{ input: 5, out: 'x', inner: 10 }] } }
        const blob = buildRemapprDeviceBlob(parseDeviceConfig(JSON.stringify(doc)), {
            configVersion: 2,
            sensors: PARTS, // four channels: input 5 has no place
        })
        expect(frame(blob, TableId.Joystick)!.version).toBe(1)
        expect(frame(blob, TableId.Sensor)).toBeUndefined()
        expect(decodeRemapprDeviceBlob(blob).joystick).toEqual(doc.joystick)
    })

    it('reads a v2 table without the part list as one AXES part (input = channel)', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2, sensors: PARTS })
        expect(decodeRemapprDeviceBlob(blob).joystick).toEqual(JOY.joystick)
    })

    it('reads TBL_PART shaping over a v1 table, as the device does', () => {
        const v1 = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        expect(frame(v1, TableId.Joystick)!.version).toBe(1)
        expect(decodeRemapprDeviceBlob(v1).joystick).toEqual(JOY.joystick)
    })
})
