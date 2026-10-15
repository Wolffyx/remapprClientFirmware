// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import {
    buildDeviceJsonSchema,
    buildRemapprDeviceBlob,
    decodeRemapprDeviceBlob,
    isDeviceConfig,
    parseDeviceConfig,
} from '../index'
import { BlobBuilder, Personality } from '../compilers/remappr/blobWriter'
import { DecodeCode } from '../compilers/remappr/decode'

const DOC = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Desk dongle' },
    personality: 'dongle',
    dongle: { nkro: true, pairWindowMs: 60000, failsafeMs: 150, rosterLiveMs: 2500 },
}

// Body bytes the firmware's TBL_PERSONALITY + TBL_DONGLE layout gives for DOC
// (include/remappr/config_blob.h): personality 4, then set = NKRO|PAIR_WINDOW|
// FAILSAFE|ROSTER_LIVE = 0x1b, flags NKRO, hid 0, pair window 60000, replay 0,
// failsafe 150, roster 2500, reserved 0.
// prettier-ignore
const BODY = [
    0x10, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, // TBL_PERSONALITY v1, 4 B
    0x04, 0x00, 0x00, 0x00,
    0x19, 0x00, 0x01, 0x00, 0x10, 0x00, 0x00, 0x00, // TBL_DONGLE v1, 16 B
    0x1b, 0x00, 0x01, 0x00, 0x60, 0xea, 0x00, 0x00,
    0x00, 0x00, 0x96, 0x00, 0xc4, 0x09, 0x00, 0x00,
]

describe('device config document', () => {
    it('parses a dongle config and recognizes the kind', () => {
        const cfg = parseDeviceConfig(JSON.stringify(DOC))
        expect(cfg.dongle?.failsafeMs).toBe(150)
        expect(isDeviceConfig(DOC)).toBe(true)
        expect(isDeviceConfig({ kind: 'remappr.keymap' })).toBe(false)
    })

    it('refuses values the dongle would refuse', () => {
        const bad = (dongle: object) =>
            JSON.stringify({ ...DOC, dongle: { ...dongle } })
        expect(() => parseDeviceConfig(bad({ failsafeMs: 49 }))).toThrow()
        expect(() => parseDeviceConfig(bad({ pairWindowMs: 4999 }))).toThrow()
        expect(() => parseDeviceConfig(bad({ hidSubmitTimeoutMs: 51 }))).toThrow()
        expect(() =>
            parseDeviceConfig(bad({ failsafeMs: 500, rosterLiveMs: 400 })),
        ).toThrow(/must not be below the failsafe/)
        // roster below the 100 ms default failsafe, failsafe unset
        expect(() => parseDeviceConfig(bad({ rosterLiveMs: 100 }))).not.toThrow()
    })

    it('has a JSON Schema for the editor', () => {
        const schema = buildDeviceJsonSchema() as { properties?: object }
        expect(Object.keys(schema.properties ?? {})).toContain('dongle')
    })
})

describe('device blob', () => {
    const cfg = parseDeviceConfig(JSON.stringify(DOC))

    it('encodes TBL_PERSONALITY + TBL_DONGLE byte-for-byte', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 7 })
        expect(Array.from(blob.subarray(20))).toEqual(BODY)
        // header: magic, schema 1, min reader 1, config_version 7, body length
        expect(Array.from(blob.subarray(0, 16))).toEqual([
            0x52, 0x4d, 0x42, 0x43, 0x01, 0x00, 0x01, 0x00, 0x07, 0x00, 0x00,
            0x00, BODY.length, 0x00, 0x00, 0x00,
        ])
    })

    it('round-trips through the decoder', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 3 })
        const r = decodeRemapprDeviceBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.configVersion).toBe(3)
        expect(r.dongle).toEqual(DOC.dongle)
        const again = buildRemapprDeviceBlob(
            { ...cfg, dongle: r.dongle },
            { configVersion: 3 },
        )
        expect(again).toEqual(blob)
    })

    it('writes only the personality when no settings are given', () => {
        const blob = buildRemapprDeviceBlob(
            { ...cfg, dongle: undefined },
            { configVersion: 1 },
        )
        expect(Array.from(blob.subarray(20))).toEqual(BODY.slice(0, 12))
        expect(decodeRemapprDeviceBlob(blob).dongle).toEqual({})
    })

    it('refuses a blob for another device, or for none', () => {
        const kbd = new BlobBuilder()
            .personalityTable(Personality.keyboard)
            .finalize(1, 1, 1)
        expect(decodeRemapprDeviceBlob(kbd).code).toBe(DecodeCode.DEVICE)
        const none = new BlobBuilder().finalize(1, 1, 1)
        expect(decodeRemapprDeviceBlob(none).code).toBe(DecodeCode.MISSING)
    })

    it('rejects a damaged blob', () => {
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 1 })
        blob[blob.length - 1] ^= 0xff
        expect(decodeRemapprDeviceBlob(blob).code).toBe(DecodeCode.CRC)
    })
})

describe('mouse device document (device-config plan, step 3)', () => {
    const MOUSE_DOC = {
        schemaVersion: 1,
        kind: 'remappr.device',
        meta: { name: 'Travel mouse' },
        personality: 'mouse',
        mouse: { cpi: 1600, invertY: true, scrollDivisor: 2, buttonMap: [1, 0, 2, 3, 4, 5, 6, null] },
        radio: { keepaliveMs: 60 },
    }
    // Body bytes of MOUSE_DOC. The TBL_MOUSE v2 payload is the one pinned by the
    // firmware test tests/config_blob/src/test_mouse_decode.c test_v2_golden.
    // prettier-ignore
    const MOUSE_BODY = [
        0x10, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, // TBL_PERSONALITY v1
        0x02, 0x00, 0x00, 0x00,                         // mouse
        0x08, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x00, // TBL_MOUSE v2, 16 B
        0x40, 0x06, 0x00, 0x00, 0x00, 0x02,             // cpi 1600, 0 pts, INVERT_Y
        0x02, 0x00, 0x01, 0x00, 0x02, 0x03, 0x04, 0x05, 0x06, 0xff, // div 2, map
        0x1a, 0x00, 0x01, 0x00, 0x08, 0x00, 0x00, 0x00, // TBL_RADIO v1, 8 B
        0x02, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x00, 0x00, // keepalive 60
    ]

    it('encodes TBL_PERSONALITY + TBL_MOUSE v2 + TBL_RADIO byte-for-byte', () => {
        const blob = buildRemapprDeviceBlob(parseDeviceConfig(JSON.stringify(MOUSE_DOC)), {
            configVersion: 2,
        })
        expect(Array.from(blob.subarray(20))).toEqual(MOUSE_BODY)
    })

    it('round-trips through the decoder', () => {
        const cfg = parseDeviceConfig(JSON.stringify(MOUSE_DOC))
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        const r = decodeRemapprDeviceBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.personality).toBe('mouse')
        expect(r.mouse).toEqual(MOUSE_DOC.mouse)
        expect(r.radio).toEqual(MOUSE_DOC.radio)
        const again = buildRemapprDeviceBlob(
            { ...cfg, mouse: r.mouse, radio: r.radio },
            { configVersion: 2 },
        )
        expect(again).toEqual(blob)
    })

    it('writes TBL_MOUSE version 1 when no version-2 field is used', () => {
        const blob = buildRemapprDeviceBlob(
            parseDeviceConfig(
                JSON.stringify({ ...MOUSE_DOC, mouse: { cpi: 800 }, radio: undefined }),
            ),
            { configVersion: 1 },
        )
        // id 8, version 1, 6 bytes: cpi 800, timeout 0, 0 points, flags 0
        expect(Array.from(blob.subarray(32))).toEqual([
            0x08, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00,
            0x20, 0x03, 0x00, 0x00, 0x00, 0x00,
        ])
    })

    it('refuses a section another device reads, and bad values', () => {
        expect(() =>
            parseDeviceConfig(JSON.stringify({ ...MOUSE_DOC, dongle: { nkro: true } })),
        ).toThrow()
        expect(() =>
            parseDeviceConfig(JSON.stringify({ ...DOC, radio: { keepaliveMs: 60 } })),
        ).toThrow()
        expect(() =>
            parseDeviceConfig(
                JSON.stringify({ ...MOUSE_DOC, mouse: { buttonMap: [0, 1, 2] } }),
            ),
        ).toThrow()
        expect(() =>
            parseDeviceConfig(JSON.stringify({ ...MOUSE_DOC, mouse: { scrollDivisor: 17 } })),
        ).toThrow()
    })

    describe('DPI stages and button actions (input-layout plan §3)', () => {
        const STAGED = {
            ...MOUSE_DOC,
            mouse: {
                dpiStages: [400, 800, 1600],
                dpiStage: 1,
                buttonActions: [
                    null,
                    null,
                    null,
                    { action: 'dpiCycle' },
                    { action: 'sniper', dpi: 400 },
                    null,
                    null,
                    null,
                ],
            },
            radio: undefined,
        }
        // TBL_MOUSE v3 is the firmware golden (test_mouse_decode.c
        // test_v3_golden); TBL_ACTION_BINDING matches make_mouse_blob.py
        // --button-action 3:cycle --button-action 4:sniper=400.
        // prettier-ignore
        const STAGED_BODY = [
            0x10, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
            0x08, 0x00, 0x03, 0x00, 0x1c, 0x00, 0x00, 0x00, // TBL_MOUSE v3, 28 B
            0x20, 0x03, 0x00, 0x00, 0x00, 0x00,             // cpi 800 = stage 1
            0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x03, 0x01, 0x90, 0x01, 0x20, 0x03, 0x40, 0x06, 0x00, 0x00, 0x00, 0x00,
            0x11, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00, // TBL_ACTION_BINDING
            0x02, 0x00, 0x08, 0x00,                         // 2 records, 8 buttons
            0x03, 0x00, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 3: cycle
            0x04, 0x00, 0x07, 0x00, 0x05, 0x00, 0x90, 0x01, 0x00, 0x00, // 4: sniper 400
        ]

        it('encodes TBL_MOUSE v3 and the actions byte-for-byte', () => {
            const blob = buildRemapprDeviceBlob(
                parseDeviceConfig(JSON.stringify(STAGED)),
                { configVersion: 6 },
            )
            expect(Array.from(blob.subarray(20))).toEqual(STAGED_BODY)
        })

        it('round-trips through the decoder', () => {
            const cfg = parseDeviceConfig(JSON.stringify(STAGED))
            const blob = buildRemapprDeviceBlob(cfg, { configVersion: 6 })
            const r = decodeRemapprDeviceBlob(blob)
            expect(r.code).toBe(DecodeCode.OK)
            expect(r.mouse).toEqual(STAGED.mouse)
            expect(
                buildRemapprDeviceBlob({ ...cfg, mouse: r.mouse }, { configVersion: 6 }),
            ).toEqual(blob)
        })

        it('writes no action table without actions, and v2 without stages', () => {
            const blob = buildRemapprDeviceBlob(
                parseDeviceConfig(
                    JSON.stringify({ ...STAGED, mouse: { buttonMap: [1, 0, 2, 3, 4, 5, 6, 7] } }),
                ),
                { configVersion: 1 },
            )
            const r = decodeRemapprDeviceBlob(blob)
            expect(r.mouse).toEqual({ buttonMap: [1, 0, 2, 3, 4, 5, 6, 7] })
            expect(blob[34]).toBe(2) // TBL_MOUSE version
            expect(blob.length).toBe(20 + 12 + 8 + 16)
        })

        it('refuses a stage past the list and a sniper without its DPI', () => {
            const bad = (mouse: unknown) => () =>
                parseDeviceConfig(JSON.stringify({ ...STAGED, mouse }))
            expect(bad({ dpiStages: [400, 800], dpiStage: 2 })).toThrow()
            expect(bad({ dpiStage: 1 })).toThrow()
            expect(bad({ dpiStages: [400, 800, 1600, 3200, 6400, 12800] })).toThrow()
            expect(bad({ dpiStages: [0] })).toThrow()
            expect(
                bad({ buttonActions: [{ action: 'sniper' }, null, null, null, null, null, null, null] }),
            ).toThrow()
        })
    })

    it('tells a dongle blob from a mouse blob', () => {
        const dongle = buildRemapprDeviceBlob(parseDeviceConfig(JSON.stringify(DOC)), {
            configVersion: 1,
        })
        expect(decodeRemapprDeviceBlob(dongle).personality).toBe('dongle')
        expect(decodeRemapprDeviceBlob(dongle).mouse).toBeUndefined()
    })
})

describe('joystick device config', () => {
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
            buttonActions: [
                null,
                { action: 'axis', axis: 'z', value: 32767 },
                null,
                null,
                { action: 'button', button: 10 },
            ],
        },
    }
    // TBL_JOYSTICK is the firmware golden (test_joystick_decode.c test_golden);
    // both tables match make_joystick_blob.py --hat-ways 4
    // --axis 0:x:aggressive:8:5 --axis 1:y:linear:8:5:invert
    // --button-action 1:axis=z@32767 --button-action 4:button=10.
    // prettier-ignore
    const TABLES = [
        0x1c, 0x00, 0x01, 0x00, 0x12, 0x00, 0x00, 0x00, // TBL_JOYSTICK v1, 18 B
        0x04, 0x02,
        0x00, 0x00, 0x00, 0x01, 0x08, 0x05, 0x00, 0x00,
        0x01, 0x01, 0x01, 0x00, 0x08, 0x05, 0x00, 0x00,
        0x11, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00, // TBL_ACTION_BINDING
        0x02, 0x00, 0x28, 0x00,                         // 2 records, 40 positions
        0x01, 0x00, 0x12, 0x00, 0x02, 0x00, 0xff, 0x7f, 0x00, 0x00, // 1: Z +
        0x04, 0x00, 0x10, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, // 4: button 10
    ]

    it('encodes TBL_PERSONALITY 5, TBL_JOYSTICK and the actions', () => {
        const blob = buildRemapprDeviceBlob(parseDeviceConfig(JSON.stringify(JOY)), {
            configVersion: 2,
        })
        expect(blob[28]).toBe(Personality.joystick)
        expect(Array.from(blob.subarray(32))).toEqual(TABLES)
    })

    it('round-trips through the decoder', () => {
        const cfg = parseDeviceConfig(JSON.stringify(JOY))
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        const r = decodeRemapprDeviceBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.personality).toBe('joystick')
        expect(r.joystick).toEqual(JOY.joystick)
        expect(
            buildRemapprDeviceBlob({ ...cfg, joystick: r.joystick }, { configVersion: 2 }),
        ).toEqual(blob)
    })

    it('carries a radial stick in the axis flags (bit1)', () => {
        const joystick = {
            axes: [
                { input: 0, out: 'x', radial: true },
                { input: 1, out: 'y', invert: true, radial: true },
            ],
        }
        const cfg = parseDeviceConfig(JSON.stringify({ ...JOY, joystick }))
        const blob = buildRemapprDeviceBlob(cfg, { configVersion: 2 })
        // flags of each 8-B entry (input, out, flags, ...) after the 2-B header.
        expect([blob[32 + 8 + 2 + 2], blob[32 + 8 + 2 + 8 + 2]]).toEqual([0x02, 0x03])
        expect(decodeRemapprDeviceBlob(blob).joystick).toEqual(joystick)
    })

    it('writes no joystick tables for an empty section', () => {
        const blob = buildRemapprDeviceBlob(
            parseDeviceConfig(JSON.stringify({ ...JOY, joystick: {} })),
            { configVersion: 1 },
        )
        expect(blob.length).toBe(20 + 12)
        expect(decodeRemapprDeviceBlob(blob).joystick).toBeUndefined()
    })

    it('refuses what the firmware would refuse', () => {
        const bad = (joystick: unknown) => () =>
            parseDeviceConfig(JSON.stringify({ ...JOY, joystick }))
        expect(bad({ hatWays: 6 })).toThrow()
        expect(bad({ axes: [{ input: 6, out: 'x' }] })).toThrow()
        expect(bad({ axes: [{ input: 0, out: 'x' }, { input: 0, out: 'y' }] })).toThrow()
        expect(bad({ axes: [{ input: 0, out: 'x', inner: 60, outer: 40 }] })).toThrow()
        expect(bad({ buttonActions: [{ action: 'button', button: 33 }] })).toThrow()
        expect(bad({ buttonActions: [{ action: 'hat', dir: 8 }] })).toThrow()
        expect(bad({ buttonActions: Array(41).fill(null) })).toThrow()
        expect(() =>
            parseDeviceConfig(JSON.stringify({ ...JOY, mouse: { cpi: 800 } })),
        ).toThrow()
    })
})
