// pattern-check: skip vitest cases, one group per finding
//
// Later-audit PR 7 (compiler coverage): what the firmware honors or refuses
// that the compiler did not express or check (L3.20, L3.21, L3.23 to L3.26).
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import {
    BehaviorType,
    BLOB_HEADER_LEN,
    crc32,
    TableId,
} from '../compilers/remappr/blobWriter'
import {
    ByteReader,
    DecodeCode,
    decodeRemapprBlob,
    readBlobFrames,
    type TableFrame,
} from '../compilers/remappr/decode'
import { readPartEntries } from '../compilers/remappr/sensor'
import { capabilityWarnings, configRequiredFeatures } from '../featureWarnings'
import { LimitsFeature } from '../../clients/remappr/protocol'
import { remapprCodec } from '../../clients/remappr/codec'
import type { CanonicalKeyId } from '../../catalog/types'

const kb = (n: number, slider: number[] = []): string =>
    `"keyboard": { "id": "k", "name": "K", "keys": [${Array.from(
        { length: n },
        (_, i) => `{"x":${i},"y":0${slider.includes(i) ? ',"element":"slider"' : ''}}`,
    ).join(',')}]${
        slider.length
            ? `, "sliders": [${slider.map((k) => `{"x":${k},"y":0,"key":${k}}`).join(',')}]`
            : ''
    } }`

const keymap = (body: string, n = 2, slider: number[] = []): string => `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "T", "target": "remappr" }, ${kb(n, slider)},
    ${body}
}`

const compile = (json: string) => buildRemapprBlob(parseKeymap(json), { configVersion: 1 })
const errors = (r: ReturnType<typeof compile>) =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
const warnings = (r: ReturnType<typeof compile>) =>
    r.diagnostics.filter((d) => d.level === 'warn').map((d) => d.message)

const frame = (blob: Uint8Array, id: number): TableFrame | undefined =>
    readBlobFrames(blob).frames.find((f) => f.id === id)
const framesOf = (blob: Uint8Array, id: number): TableFrame[] =>
    readBlobFrames(blob).frames.filter((f) => f.id === id)

interface Rec {
    type: number
    tap: number
    hold: number
    term: number
    quick: number
    prior: number
}
/** BEHAVIOR table records. */
function behaviors(blob: Uint8Array): Rec[] {
    const t = frame(blob, TableId.Behavior)!
    const r = ByteReader.frame(blob, t)
    const n = r.u16()
    return Array.from({ length: n }, () => {
        const type = r.u8()
        r.u8()
        r.u8()
        r.u8()
        const tap = r.u16()
        const hold = r.u16()
        const term = r.u16()
        const quick = r.u16()
        const prior = r.u16()
        r.u16()
        return { type, tap, hold, term, quick, prior }
    })
}

const roundTrips = (json: string): void => {
    const b1 = compile(json)
    expect(errors(b1)).toEqual([])
    const decoded = decodeRemapprBlob(b1.blob)
    expect(decoded.code).toBe(DecodeCode.OK)
    const b2 = buildRemapprBlob(decoded.config!, { configVersion: 1 })
    expect(b2.blob).toEqual(b1.blob)
}

describe('per-binding timings (L3.25)', () => {
    const json = keymap(
        `"layers": [
            { "name": "base", "bindings": [
                { "type": "sticky_key", "key": "LSHIFT", "releaseAfterMs": 900 },
                { "type": "sticky_key", "key": "A", "releaseAfterMs": 700 },
                { "type": "layer", "mode": "sticky", "layer": "fn", "releaseAfterMs": 1200 },
                { "type": "auto_shift", "key": "B", "mods": ["LEFT_SHIFT"], "timeoutMs": 170,
                  "quickTapMs": 110, "requirePriorIdleMs": 90 },
                { "type": "tap_toggle", "layer": "fn", "tappingTermMs": 240 }
            ] },
            { "name": "fn", "bindings": ["C", "D", "E", "F", "G"] }
        ]`,
        5,
    )

    it('writes each into the record field the engine reads', () => {
        const recs = behaviors(compile(json).blob)
        const of = (type: number) => recs.filter((x) => x.type === type)
        expect(of(BehaviorType.StickyMod)[0].term).toBe(900)
        expect(of(BehaviorType.StickyKey)[0].term).toBe(700)
        expect(of(BehaviorType.StickyLayer)[0].term).toBe(1200)
        expect(of(BehaviorType.AutoShift)[0]).toMatchObject({
            term: 170,
            quick: 110,
            prior: 90,
        })
        expect(of(BehaviorType.LayerTapToggle)[0].term).toBe(240)
    })

    it('reads them back as fields (not a _wire carry), byte-stable', () => {
        roundTrips(json)
        const decoded = decodeRemapprBlob(compile(json).blob).config!
        const b = decoded.layers[0].bindings
        expect(b[0]).toMatchObject({ type: 'sticky_key', releaseAfterMs: 900 })
        expect(b[0]._wire).toBeUndefined()
        expect(b[2]).toMatchObject({ type: 'layer', mode: 'sticky', releaseAfterMs: 1200 })
        expect(b[3]).toMatchObject({ timeoutMs: 170, quickTapMs: 110, requirePriorIdleMs: 90 })
        expect(b[4]).toMatchObject({ type: 'tap_toggle', tappingTermMs: 240 })
    })
})

describe('key-override layer mask and combo layers (L3.23)', () => {
    const layers = (n: number): string =>
        Array.from({ length: n }, (_, i) => `{ "name": "L${i}", "bindings": ["A", "B"] }`).join(',')

    it('refuses a key override on a layer past 15 instead of widening it to any layer', () => {
        const r = compile(
            keymap(`"layers": [${layers(17)}],
            "keyOverrides": [{ "trigger": "A", "triggerMods": ["LEFT_SHIFT"], "layers": ["L16"] }]`),
        )
        expect(errors(r)).toEqual([expect.stringMatching(/layer 16.*0\.\.15/)])
    })

    it('writes a combo on two layers as one record per layer and reads it back as one', () => {
        const json = keymap(`"layers": [${layers(3)}],
            "combos": [{ "name": "c", "keys": [0, 1], "action": "C", "layers": ["L0", "L2"] }]`)
        const r = compile(json)
        expect(errors(r)).toEqual([])
        const t = frame(r.blob, TableId.Combo)!
        const rd = ByteReader.frame(r.blob, t)
        expect(rd.u16()).toBe(2)
        const layerOf = () => {
            rd.u16()
            rd.u16()
            const layer = rd.u8()
            rd.u8()
            rd.u16()
            rd.u16()
            rd.u16()
            return layer
        }
        expect([layerOf(), layerOf()]).toEqual([0, 2])
        const decoded = decodeRemapprBlob(r.blob).config!
        expect(decoded.combos).toHaveLength(1)
        expect(decoded.combos![0].layers).toEqual(['Layer 0', 'Layer 2'])
        roundTrips(json)
    })

    it('refuses a combo layer that does not exist instead of compiling it as any layer', () => {
        // The schema catches this in JSON; a config built in code (the editor)
        // reaches the compiler directly.
        const cfg = parseKeymap(
            keymap(`"layers": [${layers(1)}],
            "combos": [{ "name": "c", "keys": [0, 1], "action": "C" }]`),
        )
        cfg.combos![0].layers = ['nope']
        const r = buildRemapprBlob(cfg, { configVersion: 1 })
        expect(errors(r)).toEqual(['unknown layer "nope"'])
    })
})

describe('firmware limits (L3.24)', () => {
    it('refuses more layers than the u8 layer count holds', () => {
        const many = Array.from({ length: 256 }, (_, i) => `{ "name": "L${i}", "bindings": ["A"] }`)
        const r = compile(keymap(`"layers": [${many.join(',')}]`, 1))
        expect(errors(r)).toContainEqual(expect.stringMatching(/256 layers.*255/))
    })

    it('refuses more than 8 link-profile overrides', () => {
        const ovr = Array.from({ length: 9 }, (_, i) => `{ "knob": ${i % 8}, "value": ${i} }`)
        const r = compile(
            keymap(`"layers": [{ "name": "b", "bindings": ["A", "B"] }],
            "node": { "linkProfile": { "profile": "gaming", "overrides": [${ovr.join(',')}] } }`),
        )
        expect(errors(r)).toContainEqual(expect.stringMatching(/9 overrides.*8/))
    })

    it('takes the leader cap from the target build', () => {
        const json = keymap(`"layers": [{ "name": "b", "bindings": ["A", "B"] }],
            "leaderSequences": [{ "sequence": ["A", "B", "C", "D", "E", "F"], "action": "G" }]`)
        expect(errors(compile(json))).toContainEqual(expect.stringMatching(/6 keys \(max 5\)/))
        const wide = buildRemapprBlob(parseKeymap(json), {
            configVersion: 1,
            limits: { leaderMaxKeys: 8 },
        })
        expect(errors(wide)).toEqual([])
    })

    it('takes the autocorrect typo cap from the target build', () => {
        const json = keymap(`"layers": [{ "name": "b", "bindings": ["A", "B"] }],
            "autocorrect": { "entries": [{ "typo": "abcdefghij", "correction": "x" }] }`)
        expect(errors(compile(json))).toEqual([])
        const narrow = buildRemapprBlob(parseKeymap(json), {
            configVersion: 1,
            limits: { autocorrectMaxTypo: 8 },
        })
        expect(errors(narrow)).toContainEqual(expect.stringMatching(/8-character history/))
    })

    it('refuses more keys than the engine tracks', () => {
        const r = buildRemapprBlob(
            parseKeymap(keymap(`"layers": [{ "name": "b", "bindings": ["A", "B", "C"] }]`, 3)),
            { configVersion: 1, limits: { maxPositions: 2 } },
        )
        expect(errors(r)).toContainEqual(expect.stringMatching(/3 keys.*tracks 2/))
    })

    it('refuses a custom hold-tap whose hold is &to or &tog instead of making it momentary', () => {
        const json = (hold: string) =>
            keymap(`"layers": [
                { "name": "b", "bindings": [
                    { "type": "hold_tap", "ref": "ht", "holdParam": "fn", "tapParam": "A" }, "B"] },
                { "name": "fn", "bindings": ["C", "D"] }],
            "holdTaps": [{ "id": "ht", "bindings": ["${hold}", "&kp"] }]`)
        expect(errors(compile(json('&tog')))).toEqual([expect.stringMatching(/&tog.*momentary/)])
        expect(errors(compile(json('&to')))).toEqual([expect.stringMatching(/&to.*momentary/)])
        expect(errors(compile(json('&mo')))).toEqual([])
    })
})

describe('keyboard usage range (L3.21)', () => {
    const bind = (key: string) =>
        keymap(`"layers": [{ "name": "b", "bindings": ["${key}", "B"] }]`)

    it('warns about a key past 0xA7, which no firmware sends', () => {
        const r = compile(bind('key.keypad_double_0'))
        expect(warnings(r)).toEqual([expect.stringMatching(/usage 0xb0.*0xa7.*does nothing/)])
    })

    it('does not warn about a KBD_EXT key or a modifier', () => {
        expect(warnings(compile(bind('key.keyboard_international1')))).toEqual([])
        expect(warnings(compile(bind('LSHIFT')))).toEqual([])
    })

    it('warns in macros, key overrides and leader sequences too', () => {
        const r = compile(
            keymap(`"layers": [{ "name": "b", "bindings": [{ "type": "macro", "ref": "m" }, "B"] }],
            "macros": [{ "id": "m", "steps": [{ "type": "tap", "key": "key.keypad_double_0" }] }],
            "keyOverrides": [{ "trigger": "key.keypad_double_0", "triggerMods": ["LEFT_SHIFT"] }],
            "leaderSequences": [{ "sequence": ["key.keypad_double_0"], "action": "A" }]`),
        )
        expect(warnings(r)).toHaveLength(3)
    })

    it('asks for the device KBD_EXT bit when a key 0x78..0xA7 is bound', () => {
        const cfg = parseKeymap(bind('key.keyboard_international1'))
        expect(configRequiredFeatures(cfg) & LimitsFeature.kbdExt).toBe(LimitsFeature.kbdExt)
        expect(capabilityWarnings(cfg, 0).map((w) => w.feature)).toEqual(['kbdExt'])
        expect(capabilityWarnings(cfg, LimitsFeature.kbdExt)).toEqual([])
        const plain = parseKeymap(bind('A'))
        expect(configRequiredFeatures(plain) & LimitsFeature.kbdExt).toBe(0)
    })

    it('does not offer a key the firmware drops', () => {
        expect(remapprCodec.supports('key.keypad_double_0' as CanonicalKeyId)).toBe(false)
        expect(remapprCodec.supports('key.keyboard_international1' as CanonicalKeyId)).toBe(true)
        expect(remapprCodec.supports('mod.lshift' as CanonicalKeyId)).toBe(true)
    })
})

describe('sensor defaults on the part JSON names (L3.26)', () => {
    it('writes node.sensor.defaults for node.sensor.part, not part 0', () => {
        const r = compile(
            keymap(`"layers": [{ "name": "b", "bindings": ["A", "B"] }],
            "node": { "sensor": { "part": 2, "defaults": { "axisInvert": true } } }`),
        )
        const t = frame(r.blob, TableId.Sensor)
        expect(t).toBeDefined()
        const entries = readPartEntries(r.blob, t!.start, t!.end)
        expect(entries).not.toHaveLength(0)
        expect((entries as { sensor: number }[]).every((e) => e.sensor === 2)).toBe(true)
    })
})

// TBL_SLIDER and TBL_DISPLAY are written and read by compilers/remappr/slider.ts
// and display.ts (remappr.slider / remappr.display tests). These cases are the
// carry rules of a keymap save around them (later-audit L3.7, L3.20).
describe('TBL_SLIDER on a save (L3.20)', () => {
    // keys 1 and 3 are sliders: slots 0 and 1
    const json = (sliders: string) =>
        keymap(
            `"layers": [{ "name": "b", "bindings": ["A", "B", "C", "D"],
                "sliders": ${sliders} }]`,
            4,
            [1, 3],
        )
    const sliderFrames = (blob: Uint8Array) => framesOf(blob, TableId.Slider)

    it('a written slider table replaces the device one instead of being refused', () => {
        const device = compile(json(`[{ "map": "volume" }, null]`)).blob
        const edited = buildRemapprBlob(
            parseKeymap(json(`[{ "map": "rgb_hue" }, null]`)),
            { configVersion: 2, carryFrom: device },
        )
        expect(errors(edited)).toEqual([])
        expect(sliderFrames(edited.blob)).toHaveLength(1)
        const t = sliderFrames(edited.blob)[0]
        expect(edited.blob[t.start + 2 + 2]).toBe(1) // LEVEL
    })

    it('sliders deleted from a read config stay deleted (not carried)', () => {
        const device = compile(json(`[{ "map": "volume" }, null]`)).blob
        const edited = parseKeymap(json(`[null, null]`))
        const r = buildRemapprBlob(edited, { configVersion: 2, carryFrom: device })
        expect(errors(r)).toEqual([])
        expect(sliderFrames(r.blob)).toHaveLength(0)
    })

    it('a slider table this client cannot read is carried while the keymap is unchanged', () => {
        const device = compile(json(`[{ "map": "rgb_hue" }, null]`)).blob
        const t = sliderFrames(device)[0]
        const unknown = device.slice()
        unknown[t.start + 2 + 2] = 0x7f // entry 0: a kind this client does not know
        new DataView(unknown.buffer).setUint32(16, crc32(unknown.subarray(BLOB_HEADER_LEN)), true)
        const edited = parseKeymap(json(`[null, null]`))
        const r = buildRemapprBlob(edited, { configVersion: 2, carryFrom: unknown })
        expect(errors(r)).toEqual([])
        const out = sliderFrames(r.blob)
        expect(out).toHaveLength(1)
        expect(Array.from(r.blob.subarray(out[0].start, out[0].end))).toEqual(
            Array.from(unknown.subarray(t.start, t.end)),
        )
    })
})

describe('TBL_DISPLAY on a save (L3.20)', () => {
    const displays = [
        {
            part: 3,
            pages: [
                {
                    default: true,
                    widgets: [
                        { kind: 'text', text: 'Layer', x: 0, y: 0, w: 30, h: 8 },
                        { kind: 'value', source: 'activeLayer', x: 32, y: 0, w: 12, h: 8 },
                    ],
                },
            ],
        },
    ]
    const json = (d?: unknown) =>
        keymap(`"layers": [{ "name": "b", "bindings": ["A", "B"] }]${
            d ? `, "node": { "displays": ${JSON.stringify(d)} }` : ''
        }`)
    const deviceBlob = () => {
        const r = compile(json(displays))
        expect(errors(r)).toEqual([])
        return r.blob
    }

    it('a display section deleted from a read config stays deleted (not carried)', () => {
        const r = buildRemapprBlob(parseKeymap(json()), {
            configVersion: 2,
            carryFrom: deviceBlob(),
        })
        expect(errors(r)).toEqual([])
        expect(frame(r.blob, TableId.Display)).toBeUndefined()
    })

    const corrupt = (at: number, value: number) => {
        const device = deviceBlob()
        const t = frame(device, TableId.Display)!
        const out = device.slice()
        out[t.start + at] = value
        new DataView(out.buffer).setUint32(16, crc32(out.subarray(BLOB_HEADER_LEN)), true)
        return { blob: out, t }
    }
    // 8-byte header, one 4-byte page, then 12-byte widgets.
    const W0 = 8 + 4

    it.each([
        ['a widget kind this client does not know', W0, 0x7f],
        ['a widget flag this client does not know', W0 + 1, 0x80],
        ['a font this client does not know', W0 + 6, 7],
        ['text past the string pool', W0 + 10, 0xff],
    ])('a display table with %s is carried as read', (_what, at, value) => {
        const { blob, t } = corrupt(at, value)
        expect(decodeRemapprBlob(blob).config?.node?.displays).toBeUndefined()
        const r = buildRemapprBlob(parseKeymap(json()), { configVersion: 2, carryFrom: blob })
        const out = frame(r.blob, TableId.Display)!
        expect(Array.from(r.blob.subarray(out.start, out.end))).toEqual(
            Array.from(blob.subarray(t.start, t.end)),
        )
    })
})

describe("the device's config pools (combos, combo keys, sliders)", () => {
    const layers = (n: number, extra = '') =>
        Array.from(
            { length: n },
            (_, i) => `{ "name": "L${i}", "bindings": ["A","B","C","D","E","F","G","H","I","J"]${extra} }`,
        ).join(',')
    const combos = (n: number, keys: number, on: string[]) =>
        Array.from({ length: n }, (_, i) =>
            JSON.stringify({
                name: `c${i}`,
                keys: Array.from({ length: keys }, (_, k) => k),
                action: 'Z',
                layers: on,
            }),
        ).join(',')
    const withCombos = (n: number, keys: number, on: string[]) =>
        keymap(`"layers": [${layers(2)}], "combos": [${combos(n, keys, on)}]`, 10)

    it('fits 32 combo records and 128 combo keys', () => {
        expect(errors(compile(withCombos(16, 4, ['L0', 'L1'])))).toEqual([])
    })

    it('counts a combo once per layer against the record pool', () => {
        expect(errors(compile(withCombos(17, 2, ['L0', 'L1'])))).toEqual([
            'the config takes 34 combo records (one per layer); a device holds 32',
        ])
    })

    it('counts every record key against the combo key pool', () => {
        expect(errors(compile(withCombos(13, 5, ['L0', 'L1'])))).toEqual([
            'the config takes 130 combo key slots; a device holds 128',
        ])
    })

    it('refuses a combo wider than the engine captures', () => {
        expect(errors(compile(withCombos(1, 9, ['L0'])))).toEqual([
            'a combo takes at most 8 keys',
        ])
    })

    it('refuses more slider bindings than the device holds, and follows the build limits', () => {
        const json = keymap(
            `"layers": [${layers(9, ', "sliders": [{ "map": "rgb_hue" }]')}]`,
            10,
            [1],
        )
        expect(errors(compile(json))).toEqual([
            'the config takes 9 slider bindings; a device holds 8',
        ])
        const r = buildRemapprBlob(parseKeymap(json), {
            configVersion: 1,
            limits: { slidersMax: 16 },
        })
        expect(errors(r)).toEqual([])
    })
})
