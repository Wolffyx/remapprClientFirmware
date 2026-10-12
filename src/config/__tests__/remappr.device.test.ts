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
