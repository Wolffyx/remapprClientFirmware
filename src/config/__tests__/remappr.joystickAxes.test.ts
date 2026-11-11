// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import {
    buildRemapprDeviceBlob,
    decodeRemapprDeviceBlob,
    parseDeviceConfig,
} from '../index'
import { axesLayout, AXIS_SETTING_IDS } from '../../clients/remappr/axesLayout'
import { readPartEntries } from '../compilers/remappr/sensor'
import { DecodeCode, readBlobFrames } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'
import type { ConfigDevice } from '../device'

// A joystick whose part 0 is a battery and part 1 its stick (2 channels).
const PARTS = [
    { index: 0, cls: 13, channels: 1 },
    { index: 1, cls: 4, channels: 2 },
]
const AXES = axesLayout(PARTS)!

const doc = (joystick: unknown, extra: object = {}) =>
    parseDeviceConfig(
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.device',
            meta: { name: 'Bench stick' },
            personality: 'joystick',
            joystick,
            ...extra,
        }),
    )

function frames(blob: Uint8Array) {
    const parsed = readBlobFrames(blob)
    return (id: number) => parsed.frames.find((f) => f.id === id)
}

describe('AXES layout', () => {
    it('numbers inputs across the AXES parts in part order', () => {
        const two = axesLayout([
            { index: 3, cls: 4, channels: 2 },
            { index: 1, cls: 4, channels: 4 },
            { index: 0, cls: 1, channels: 1 },
        ])!
        expect(two.count).toBe(6)
        expect(two.locate(0)).toEqual({ part: 1, ch: 0 })
        expect(two.locate(4)).toEqual({ part: 3, ch: 0 })
        expect(two.locate(6)).toBeUndefined()
        expect(two.inputOf(3, 1)).toBe(5)
        expect(two.inputOf(3, 2)).toBeUndefined()
        expect(two.inputOf(0, 0)).toBeUndefined()
    })

    it('is undefined without an AXES part', () => {
        expect(axesLayout([{ index: 0, cls: 1, channels: 1 }])).toBeUndefined()
    })
})

describe('joystick shaping in the AXES part (TBL_JOYSTICK v2 + TBL_PART)', () => {
    const JOYSTICK = {
        hatWays: 8,
        axes: [
            { input: 0, out: 'x', curve: 'aggressive', inner: 8, outer: 5 },
            { input: 1, out: null, invert: true, radial: true },
        ],
    }

    it('writes the report axes as the firmware golden v2 table', () => {
        const blob = buildRemapprDeviceBlob(doc(JOYSTICK), {
            configVersion: 2,
            axes: AXES,
        })
        const jt = frames(blob)(TableId.Joystick)!
        expect(jt.version).toBe(2)
        // test_joystick_decode.c test_v2_meaning_only
        expect(Array.from(blob.subarray(jt.start, jt.end))).toEqual([
            0x08, 0x02, 0x00, 0x00, 0x01, 0xff,
        ])
    })

    it("writes each named input's whole shaping to its channel", () => {
        const blob = buildRemapprDeviceBlob(doc(JOYSTICK), {
            configVersion: 2,
            axes: AXES,
        })
        const pt = frames(blob)(TableId.Sensor)!
        expect(pt.version).toBe(2) // channel 1 is named
        const entries = readPartEntries(blob, pt.start, pt.end)
        const id = AXIS_SETTING_IDS
        expect(entries).toEqual([
            { sensor: 1, ch: 0, id: id.invert, value: 0 },
            { sensor: 1, ch: 0, id: id.radial, value: 0 },
            { sensor: 1, ch: 0, id: id.curve, value: 1 },
            { sensor: 1, ch: 0, id: id.inner, value: 8 },
            { sensor: 1, ch: 0, id: id.outer, value: 5 },
            { sensor: 1, ch: 1, id: id.invert, value: 1 },
            { sensor: 1, ch: 1, id: id.radial, value: 1 },
            { sensor: 1, ch: 1, id: id.curve, value: 0 },
            { sensor: 1, ch: 1, id: id.inner, value: 0 },
            { sensor: 1, ch: 1, id: id.outer, value: 0 },
        ])
    })

    it('round-trips, with the device layout and without it', () => {
        const cfg = doc(JOYSTICK)
        const blob = buildRemapprDeviceBlob(cfg, {
            configVersion: 2,
            axes: AXES,
        })
        for (const opts of [{ axes: AXES }, {}]) {
            const r = decodeRemapprDeviceBlob(blob, opts)
            expect(r.code).toBe(DecodeCode.OK)
            expect(r.joystick).toEqual(JOYSTICK)
            expect(
                buildRemapprDeviceBlob(
                    { ...cfg, joystick: r.joystick },
                    { configVersion: 2, axes: AXES },
                ),
            ).toEqual(blob)
        }
    })

    it('keeps the v1 table without the device layout', () => {
        const cfg = doc(JOYSTICK)
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        expect(frames(blob)(TableId.Joystick)!.version).toBe(1)
        expect(frames(blob)(TableId.Sensor)).toBeUndefined()
        expect(decodeRemapprDeviceBlob(blob, { axes: AXES }).joystick).toEqual(
            JOYSTICK,
        )
    })

    it('keeps the v1 table when an input is not among the AXES parts', () => {
        const joystick = { axes: [{ input: 2, out: 'z', inner: 4 }] }
        const blob = buildRemapprDeviceBlob(doc(joystick), {
            configVersion: 2,
            axes: AXES,
        })
        expect(frames(blob)(TableId.Joystick)!.version).toBe(1)
        expect(decodeRemapprDeviceBlob(blob).joystick).toEqual(joystick)
    })

    it('writes one entry where the sensor section names the same setting', () => {
        // The schema keeps a sensor section off a joystick; the compiler still
        // must not write a (part, setting, channel) twice.
        const cfg = {
            ...doc({ axes: [{ input: 0, out: 'x', inner: 8 }] }),
            sensor: { index: 1, settings: { deadzoneInner: 20 } },
        } as ConfigDevice
        const blob = buildRemapprDeviceBlob(cfg, {
            configVersion: 2,
            axes: AXES,
        })
        const pt = frames(blob)(TableId.Sensor)!
        expect(pt.version).toBe(1) // channel 0 only
        const inner = (
            readPartEntries(blob, pt.start, pt.end) as {
                id: number
                value: number
            }[]
        ).filter((e) => e.id === AXIS_SETTING_IDS.inner)
        expect(inner).toEqual([
            { sensor: 1, id: AXIS_SETTING_IDS.inner, ch: 0, value: 8 },
        ])
    })
})

describe("unpair on a button (SYSTEM verb 8)", () => {
  it("round-trips on a joystick and a mouse", () => {
    const joy = doc({ buttonActions: [null, { action: "unpair" }] });
    const jb = buildRemapprDeviceBlob(joy, { configVersion: 2 });
    // the last record: position 1, kind SYSTEM (4), code 8
    expect(Array.from(jb.subarray(jb.length - 10, jb.length - 4))).toEqual([
      0x01, 0x00, 0x04, 0x00, 0x08, 0x00,
    ]);
    expect(decodeRemapprDeviceBlob(jb).joystick).toEqual(joy.joystick);

    const mouse = parseDeviceConfig(
      JSON.stringify({
        schemaVersion: 1,
        kind: "remappr.device",
        meta: { name: "Bench mouse" },
        personality: "mouse",
        mouse: {
          buttonActions: [null, null, { action: "unpair" }, null, null, null, null, null],
        },
      }),
    );
    const mb = buildRemapprDeviceBlob(mouse, { configVersion: 2 });
    expect(decodeRemapprDeviceBlob(mb).mouse).toEqual(mouse.mouse);
  });
});
