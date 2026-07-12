import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import {
    BehaviorType,
    BlobBuilder,
    crc32,
    MacroOp,
    NameKind,
    TableId,
    type BehaviorRecord,
} from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'

// The same locked golden bytes asserted in remappr.compile.test.ts + the
// firmware fixture tests/config_blob/src/golden_canonical.h.
// prettier-ignore
const GOLDEN = Uint8Array.from([
    0x52, 0x4d, 0x42, 0x43, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x7e, 0x00, 0x00, 0x00, 0x34, 0xc3, 0x5f, 0x45, 0x01, 0x00, 0x01, 0x00,
    0x08, 0x00, 0x00, 0x00, 0x02, 0x00, 0x03, 0x00, 0xc8, 0x00, 0x00, 0x00,
    0x04, 0x00, 0x01, 0x00, 0x52, 0x00, 0x00, 0x00, 0x05, 0x00, 0x02, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x06, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x0c, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x00,
    0x04, 0x00,
])

describe('crc32 (remappr_crc32 parity)', () => {
    it('matches the standard CRC-32 check vector', () => {
        // "123456789" → 0xCBF43926 (IEEE 802.3, poly 0xEDB88320).
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    })
})

describe('decodeRemapprBlob header validation', () => {
    it('rejects a too-short buffer as TRUNCATED', () => {
        expect(decodeRemapprBlob(new Uint8Array(10)).code).toBe(DecodeCode.TRUNCATED)
    })

    it('rejects a bad magic as MAGIC', () => {
        const bad = GOLDEN.slice()
        bad[0] = 0x00
        expect(decodeRemapprBlob(bad).code).toBe(DecodeCode.MAGIC)
    })

    it('rejects a corrupted body as CRC', () => {
        const bad = GOLDEN.slice()
        bad[bad.length - 1] ^= 0xff // flip a body byte → CRC mismatch
        expect(decodeRemapprBlob(bad).code).toBe(DecodeCode.CRC)
    })

    it('rejects min_reader_version > 1 as READER_VER', () => {
        const bad = GOLDEN.slice()
        bad[6] = 0x02 // min_reader_version u16 @6
        // CRC still covers body only, so the header tweak alone trips READER_VER
        // before the CRC check is reached.
        expect(decodeRemapprBlob(bad).code).toBe(DecodeCode.READER_VER)
    })
})

describe('decodeRemapprBlob golden cross-check', () => {
    it('decodes the golden blob to its source semantics', () => {
        const { code, config, diagnostics } = decodeRemapprBlob(GOLDEN)
        expect(code).toBe(DecodeCode.OK)
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const c = config!
        expect(c.layers).toHaveLength(2)
        expect(c.keyboard.keys).toHaveLength(3)
        // layer 0 = three bare keys; layer 1 = [transparent, key, none].
        expect(c.layers[0].bindings.map((b) => b.type)).toEqual([
            'key_press',
            'key_press',
            'key_press',
        ])
        expect(c.layers[1].bindings.map((b) => b.type)).toEqual([
            'transparent',
            'key_press',
            'none',
        ])
    })

    it('re-encodes the decoded golden back to the exact golden bytes', () => {
        const { config } = decodeRemapprBlob(GOLDEN)
        const { blob } = buildRemapprBlob(config!, { configVersion: 1 })
        expect(blob).toEqual(GOLDEN)
    })
})

// A BehaviorRecord with every field zeroed; overrides set the interesting ones.
const rec = (over: Partial<BehaviorRecord>): BehaviorRecord => ({
    type: 0,
    flavor: 0,
    flags: 0,
    subCount: 0,
    tap: 0,
    hold: 0,
    tappingTermMs: 0,
    quickTapMs: 0,
    requirePriorIdleMs: 0,
    subIndex: 0,
    ...over,
})

// Walk the table frames of a finalized blob and return one table's payload.
const tablePayload = (blob: Uint8Array, id: number): Uint8Array | null => {
    let off = 20 // BLOB_HEADER_LEN
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    while (off + 8 <= blob.length) {
        const tid = dv.getUint16(off, true)
        const len = dv.getUint32(off + 4, true)
        const start = off + 8
        if (tid === id) return blob.subarray(start, start + len)
        off = start + len
    }
    return null
}

describe('decodeRemapprBlob TBL_NAMES (§24 real DT names)', () => {
    // macro #0 + a mod-morph over subs[0..1], named via TBL_NAMES.
    const namedBlob = (): Uint8Array =>
        new BlobBuilder()
            .layerTable(1, 2, 200, 5)
            .behaviorTable([
                rec({ type: BehaviorType.Macro, tap: 0 }),
                rec({
                    type: BehaviorType.ModMorph,
                    hold: 0x02,
                    subCount: 2,
                    subIndex: 0,
                }),
            ])
            .bindingTable([0, 1]) // layer 0: pos0 → macro, pos1 → mod-morph
            .subsTable([
                rec({ type: BehaviorType.Key, tap: 0x04 }),
                rec({ type: BehaviorType.Key, tap: 0x05 }),
            ])
            .macroTable([{ steps: [{ op: MacroOp.Tap, arg: 0x0b }] }])
            .namesTable([
                { kind: NameKind.ModMorph, ref: 0, name: 'swap_dot' },
                { kind: NameKind.Macro, ref: 0, name: 'macro_hi' },
            ])
            .finalize(1, 1, 7)

    it('applies names to macro/composite defs and their bindings', () => {
        const { code, config } = decodeRemapprBlob(namedBlob())
        expect(code).toBe(DecodeCode.OK)
        const c = config!
        expect(c.macros?.[0].id).toBe('macro_hi')
        expect(c.modMorphs?.[0].id).toBe('swap_dot')
        expect(c.layers[0].bindings[0]).toMatchObject({
            type: 'macro',
            ref: 'macro_hi',
        })
        expect(c.layers[0].bindings[1]).toMatchObject({
            type: 'mod_morph',
            ref: 'swap_dot',
        })
    })

    // Byte-level cross-lock: the TS writer must emit exactly the layout the
    // firmware keymap_encode.c asserts in tests/config_blob test_names_table.
    it('emits the firmware TBL_NAMES wire layout byte-for-byte', () => {
        const payload = tablePayload(namedBlob(), TableId.Names)!
        // prettier-ignore
        const expected = Uint8Array.from([
            0x02, 0x00,                                     // count = 2
            0x02, 0x00, 0x00, 0x00, 0x08,                   // mod-morph, ref 0, len 8
            0x73, 0x77, 0x61, 0x70, 0x5f, 0x64, 0x6f, 0x74, // "swap_dot"
            0x00, 0x00, 0x00, 0x00, 0x08,                   // macro, ref 0, len 8
            0x6d, 0x61, 0x63, 0x72, 0x6f, 0x5f, 0x68, 0x69, // "macro_hi"
        ])
        expect(payload).toEqual(expected)
    })

    it('falls back to synthetic ids when a name is absent', () => {
        const blob = new BlobBuilder()
            .layerTable(1, 1, 200, 5)
            .behaviorTable([rec({ type: BehaviorType.Macro, tap: 0 })])
            .bindingTable([0])
            .macroTable([{ steps: [{ op: MacroOp.Tap, arg: 0x0b }] }])
            .finalize(1, 1, 1)
        const { config } = decodeRemapprBlob(blob)
        expect(config!.macros?.[0].id).toBe('macro_0')
        expect(config!.layers[0].bindings[0]).toMatchObject({
            type: 'macro',
            ref: 'macro_0',
        })
    })

    it('skips a malformed names entry (overrun) and still decodes', () => {
        const blob = namedBlob()
        const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
        // Overrun the first entry's name_len (mod-morph "swap_dot"), then re-fix
        // the body CRC so the blob passes header validation and readNames runs.
        let off = 20
        while (off + 8 <= blob.length) {
            const tid = dv.getUint16(off, true)
            const len = dv.getUint32(off + 4, true)
            if (tid === TableId.Names) {
                blob[off + 8 + 6] = 0xff // entry 0 name_len → overruns the table
                break
            }
            off += 8 + len
        }
        const bodyLen = dv.getUint32(12, true)
        dv.setUint32(16, crc32(blob.subarray(20, 20 + bodyLen)), true)

        const { code, config } = decodeRemapprBlob(blob)
        expect(code).toBe(DecodeCode.OK) // keymap still forms
        // the overrun aborts the names walk → both fall back to synthetic ids
        expect(config!.modMorphs?.[0].id).toBe('mm_0')
        expect(config!.macros?.[0].id).toBe('macro_0')
    })
})

// encode → decode → re-encode must be byte-stable: it proves the decoder is a
// faithful inverse of the compiler. Any field the decoder drops or mangles
// changes the re-encoded bytes.
const roundTrips = (json: string): void => {
    const cfg = parseKeymap(json)
    const b1 = buildRemapprBlob(cfg, { configVersion: 1 })
    expect(b1.diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
    const decoded = decodeRemapprBlob(b1.blob)
    expect(decoded.code).toBe(DecodeCode.OK)
    expect(decoded.diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
    const b2 = buildRemapprBlob(decoded.config!, { configVersion: 1 })
    expect(b2.blob).toEqual(b1.blob)
}

const kb = (n: number): string =>
    `"keyboard": { "id": "k", "name": "K", "keys": [${Array.from({ length: n }, (_, i) => `{"x":${i},"y":0}`).join(',')} ] }`

describe('decodeRemapprBlob TBL_RGB (id 7 per-key colors)', () => {
    // pattern-check: skip — decode fixture, no production logic
    const rgbBlob = (mode: number, colors: number[]): Uint8Array =>
        new BlobBuilder()
            .layerTable(1, 2, 200, 5)
            .behaviorTable([rec({ type: BehaviorType.Key, tap: 0x04 })])
            .bindingTable([0, 0])
            .rgbTable({
                mode,
                perLayer: false,
                numLayers: 1,
                numPositions: 2,
                colors: Uint8Array.from(colors),
            })
            .finalize(1, 1, 1)

    it('decodes per-key colors into lighting.perKey (black/off omitted)', () => {
        // pos0 = #ff6600, pos1 = 0,0,0 (off) → dropped from the sparse map.
        const { code, config } = decodeRemapprBlob(
            rgbBlob(1, [0xff, 0x66, 0x00, 0x00, 0x00, 0x00]),
        )
        expect(code).toBe(DecodeCode.OK)
        expect(config?.keyboard.lighting?.perKey).toEqual({ 0: '#ff6600' })
    })

    it('ignores an effects-only (mode 0) table — no lighting', () => {
        const { code, config } = decodeRemapprBlob(
            rgbBlob(0, [0xff, 0x66, 0x00, 0x11, 0x22, 0x33]),
        )
        expect(code).toBe(DecodeCode.OK)
        expect(config?.keyboard.lighting).toBeUndefined()
    })
})

describe('remappr round-trip (encode → decode → re-encode is byte-stable)', () => {
    it('bare keys + transparent + none', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "T", "target": "zmk" }, ${kb(3)},
            "defaults": { "tappingTermMs": 200 },
            "layers": [
                { "name": "base", "bindings": ["A", "B", "C"] },
                { "name": "fn", "bindings": [{ "type": "transparent" }, "A", { "type": "none" }] }
            ]
        }`)
    })

    it('modded key_press (Ctrl+C → KEY_MODS)', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "M", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "key_press", "key": "C", "mods": ["LEFT_CTRL"] },
                { "type": "key_press", "key": "V", "mods": ["LEFT_CTRL", "LEFT_SHIFT"] }
            ] }]
        }`)
    })

    it('tap_hold (mod_tap + layer_tap with flavor + timings)', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "TH", "target": "zmk" }, ${kb(2)},
            "layers": [
                { "name": "base", "bindings": [
                    { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                      "hold": { "type": "modifier", "modifier": "LEFT_SHIFT" },
                      "flavor": "tap-preferred", "tappingTermMs": 180 },
                    { "type": "tap_hold", "tap": { "type": "key_press", "key": "B" },
                      "hold": { "type": "layer", "layer": "fn" }, "quickTapMs": 100 }
                ] },
                { "name": "fn", "bindings": ["X", "Y"] }
            ]
        }`)
    })

    // pattern-check: skip — round-trip test data, no production logic
    it('positional hold (§28) + requirePriorIdle + retroTap round-trip', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "PH", "target": "zmk" }, ${kb(4)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" },
                  "flavor": "balanced", "requirePriorIdleMs": 125, "retroTap": true,
                  "holdTriggerKeyPositions": [1, 2, 3] },
                "B", "C", "D"
            ] }]
        }`)
    })

    // pattern-check: skip — asserts the decoder restores the position list
    it('decodes holdTriggerKeyPositions back onto the inline tap-hold', () => {
        const cfg = parseKeymap(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "PH", "target": "zmk" }, ${kb(4)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" },
                  "holdTriggerKeyPositions": [1, 2, 3] },
                "B", "C", "D"
            ] }]
        }`)
        const { blob } = buildRemapprBlob(cfg, { configVersion: 1 })
        const { config } = decodeRemapprBlob(blob)
        const th = config!.layers[0].bindings[0]
        expect(th.type).toBe('tap_hold')
        expect(th.type === 'tap_hold' && th.holdTriggerKeyPositions).toEqual([1, 2, 3])
    })

    // pattern-check: skip — compile/round-trip assertion, no production logic
    it('emits holdTriggerOnRelease as BHF bit4 and round-trips (fw #58)', () => {
        const cfg = parseKeymap(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "HR", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" },
                  "holdTriggerOnRelease": true },
                "B"
            ] }]
        }`)
        const { blob, diagnostics } = buildRemapprBlob(cfg, { configVersion: 1 })
        // No longer dropped: the firmware honors BHF bit4 since #58.
        expect(
            diagnostics.some((d) => /hold-trigger-on-release/.test(d.message)),
        ).toBe(false)
        const { config } = decodeRemapprBlob(blob)
        const th = config!.layers[0].bindings[0]
        expect(th.type).toBe('tap_hold')
        expect(th.type === 'tap_hold' && th.holdTriggerOnRelease).toBe(true)
    })

    it('layer / sticky / key_toggle / system / mouse / output / lighting', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "All", "target": "zmk" }, ${kb(9)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "layer", "mode": "momentary", "layer": "base" },
                { "type": "sticky_key", "key": "LSHIFT" },
                { "type": "key_toggle", "key": "CAPSLOCK" },
                { "type": "reset" },
                { "type": "ext_power", "action": "toggle" },
                { "type": "mouse_move", "direction": "up" },
                { "type": "output", "action": "bluetooth", "profile": 2 },
                { "type": "lighting", "target": "underglow", "action": "color",
                  "hue": 200, "saturation": 80, "brightness": 90 },
                { "type": "lighting", "target": "backlight", "action": "set", "level": 50 }
            ] }]
        }`)
    })

    // pattern-check: skip — round-trip test data, no production logic
    it('ext_power on/off round-trips (BH_SYSTEM)', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "EP", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "ext_power", "action": "on" },
                { "type": "ext_power", "action": "off" }
            ] }]
        }`)
    })

    // pattern-check: skip — round-trip test data for the §5.2 vocabulary
    it('round-trips the §5.2 vocabulary (behavior_type 20..36)', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "V52", "target": "zmk" }, ${kb(16)},
            "layers": [
                { "name": "base", "bindings": [
                    { "type": "auto_shift", "key": "A", "mods": ["LEFT_SHIFT"] },
                    { "type": "alt_repeat" },
                    { "type": "layer_lock" },
                    { "type": "layer_mod", "layer": "fn", "mods": ["LEFT_CTRL"] },
                    { "type": "tap_toggle", "layer": "fn" },
                    { "type": "set_base_saved", "layer": "base" },
                    { "type": "auto_layer", "layer": "fn" },
                    { "type": "gui_lock", "action": "toggle" },
                    { "type": "secure", "action": "on" },
                    { "type": "autocorrect", "action": "toggle" },
                    { "type": "tune_tap_term", "ms": 200 },
                    { "type": "unicode", "codepoint": 233 },
                    { "type": "macro_record", "slot": 0 },
                    { "type": "macro_play", "slot": 1 },
                    { "type": "leader", "windowMs": 500 },
                    { "type": "peripheral", "kind": "encoder", "code": 3 }
                ] },
                { "name": "fn", "bindings": [{ "type": "transparent" }] }
            ]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.layers[0].bindings.map((b) => b.type)).toEqual([
            'auto_shift', 'alt_repeat', 'layer_lock', 'layer_mod', 'tap_toggle',
            'set_base_saved', 'auto_layer', 'gui_lock', 'secure', 'autocorrect',
            'tune_tap_term', 'unicode', 'macro_record', 'macro_play', 'leader',
            'peripheral',
        ])
    })

    it('macros, combos, and conditional layers', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "X", "target": "zmk" }, ${kb(3)},
            "layers": [
                { "name": "base", "bindings": [{ "type": "macro", "ref": "cc" }, "A", "B"] },
                { "name": "raise", "bindings": [{ "type": "transparent" }, { "type": "transparent" }, { "type": "transparent" }] },
                { "name": "lower", "bindings": [{ "type": "transparent" }, { "type": "transparent" }, { "type": "transparent" }] },
                { "name": "adjust", "bindings": [{ "type": "transparent" }, { "type": "transparent" }, { "type": "transparent" }] }
            ],
            "macros": [{ "id": "cc", "params": 0, "steps": [
                { "type": "press", "key": "LCTRL" }, { "type": "tap", "key": "C" }, { "type": "release", "key": "LCTRL" }
            ] }],
            "combos": [{ "name": "esc", "keys": [0, 1], "action": "ESCAPE", "timeoutMs": 40 }],
            "conditionalLayers": [{ "ifLayers": ["raise", "lower"], "thenLayer": "adjust" }]
        }`)
    })

    it('encoders (TBL_ENCODER) round-trip on the slot-array form', () => {
        // base binds cw/ccw/press; fn omits press (exercises the 0xFFFF unbound
        // sentinel) — both on encoder slot 0, one record per (layer, slot).
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Enc", "target": "zmk" },
            "keyboard": { "id": "k", "name": "K",
                "keys": [{"x":0,"y":0},{"x":1,"y":0}],
                "encoders": [{"x":0,"y":1}] },
            "layers": [
                { "name": "base", "bindings": ["A", "B"],
                  "encoders": [{ "cw": "C", "ccw": "D", "press": "E" }] },
                { "name": "fn",
                  "bindings": [{"type":"transparent"},{"type":"transparent"}],
                  "encoders": [{ "cw": "1", "ccw": "2" }] }
            ]
        }`)
    })

    // pattern-check: skip — composite-table (mod-morph / tap-dance) test fixtures
    it('tap_dance (SUBS table) round-trips + reconstructs the definition', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "TD", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_dance", "ref": "td_esc" }, "A"
            ] }],
            "tapDances": [{
                "id": "td_esc", "tappingTermMs": 180,
                "taps": [
                    { "count": 1, "action": "ESCAPE" },
                    { "count": 2, "action": { "type": "layer", "mode": "toggle", "layer": "base" } }
                ]
            }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        // §24: the real id round-trips via TBL_NAMES — not the synthetic td_0.
        expect(config!.layers[0].bindings[0]).toEqual({
            type: 'tap_dance',
            ref: 'td_esc',
        })
        expect(config!.tapDances).toHaveLength(1)
        const td = config!.tapDances![0]
        expect(td.id).toBe('td_esc')
        expect(td.tappingTermMs).toBe(180)
        expect(td.taps.map((t) => t.count)).toEqual([1, 2])
        expect(td.taps.map((t) => t.action.type)).toEqual(['key_press', 'layer'])
    })

    it('mod_morph (SUBS table) round-trips — suppress vs keep mods', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "MM", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "mod_morph", "ref": "mm_dot" },
                { "type": "mod_morph", "ref": "mm_keep" }
            ] }],
            "modMorphs": [
                { "id": "mm_dot", "mods": ["LEFT_SHIFT"], "bindings": ["N", "M"] },
                { "id": "mm_keep", "mods": ["LEFT_GUI"], "keepMods": ["LEFT_GUI"], "bindings": ["A", "B"] }
            ]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.modMorphs).toHaveLength(2)
        const [dot, keep] = config!.modMorphs!
        // No keep-mods authored ⇒ trigger mods suppressed (MORPH_SUPPRESS_MODS);
        // decode reports keepMods absent.
        expect(dot.mods).toEqual(['LEFT_SHIFT'])
        expect(dot.keepMods).toBeUndefined()
        expect(dot.bindings.map((b) => b.type)).toEqual(['key_press', 'key_press'])
        // keep-mods authored ⇒ flag clear ⇒ decode reports keepMods = the mods.
        expect(keep.keepMods).toEqual(['LEFT_GUI'])
    })

    it('grave_escape round-trips to the canonical token', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "GE", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base",
                "bindings": [{ "type": "grave_escape" }] }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.layers[0].bindings[0]).toEqual({ type: 'grave_escape' })
        // Recognized as the grave-escape shape — no synthetic mod_morph def.
        expect(config!.modMorphs ?? []).toHaveLength(0)
    })

    it('sticky non-mod key round-trips through BH_STICKY_KEY', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "SK", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base",
                "bindings": [{ "type": "sticky_key", "key": "A" }] }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        const a = config!.layers[0].bindings[0]
        expect(a.type).toBe('sticky_key')
        if (a.type === 'sticky_key') expect(a.key).toMatch(/keyboard_a$/)
    })

    it('mod_morph keepMods partial round-trips via the suppress mask', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "KP", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base",
                "bindings": [{ "type": "mod_morph", "ref": "mm" }] }],
            "modMorphs": [{ "id": "mm",
                "mods": ["LEFT_SHIFT", "LEFT_GUI"],
                "keepMods": ["LEFT_GUI"],
                "bindings": ["N", "M"] }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.modMorphs![0].keepMods).toEqual(['LEFT_GUI'])
    })

    it('macro pause_for_release round-trips; tap_time is stable-lossy', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "MP", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base",
                "bindings": [{ "type": "macro", "ref": "adv" }] }],
            "macros": [{ "id": "adv", "steps": [
                { "type": "press", "key": "LSHIFT" },
                { "type": "pause_for_release" },
                { "type": "release", "key": "LSHIFT" },
                { "type": "tap_time", "ms": 30 },
                { "type": "tap", "key": "A" }
            ] }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        const steps = config!.macros![0].steps.map((s) => s.type)
        // tap_time decodes as its expansion (press/wait/release) — byte-stable
        // on re-encode, canonically lossy by design.
        expect(steps).toEqual([
            'press', 'pause_for_release', 'release', 'press', 'wait', 'release',
        ])
    })

    it('a composite reused across cells dedupes to one behavior + one def', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "TDx2", "target": "zmk" }, ${kb(3)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_dance", "ref": "td" },
                { "type": "tap_dance", "ref": "td" },
                "A"
            ] }],
            "tapDances": [{ "id": "td", "taps": [
                { "count": 1, "action": "B" }, { "count": 2, "action": "C" }
            ] }]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        // Both cells decode to the same ref; exactly one reconstructed def.
        expect(config!.layers[0].bindings[0]).toEqual(config!.layers[0].bindings[1])
        expect(config!.tapDances).toHaveLength(1)
    })

    // pattern-check: skip — key-override / leader table round-trip fixtures
    it('key_override (TBL_KEY_OVERRIDE) round-trips', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "KO", "target": "zmk" }, ${kb(2)},
            "layers": [
                { "name": "base", "bindings": ["A", "B"] },
                { "name": "fn", "bindings": ["X", "Y"] }
            ],
            "keyOverrides": [
                { "trigger": "A", "triggerMods": ["LEFT_CTRL"], "replacement": "B",
                  "replacementMods": ["LEFT_SHIFT"], "suppressedMods": ["LEFT_CTRL"], "layers": ["fn"] },
                { "trigger": "C", "triggerMods": [], "negativeMods": ["LEFT_ALT"] }
            ]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.keyOverrides).toHaveLength(2)
        const [a, c] = config!.keyOverrides!
        expect(a.triggerMods).toEqual(['LEFT_CTRL'])
        expect(a.suppressedMods).toEqual(['LEFT_CTRL'])
        expect(a.replacementMods).toEqual(['LEFT_SHIFT'])
        expect(a.layers).toEqual(['Layer 1']) // fn = layer index 1 (synthetic name)
        // Empty trigger mask + no replacement decode to absent optional fields.
        expect(c.triggerMods).toEqual([])
        expect(c.negativeMods).toEqual(['LEFT_ALT'])
        expect(c.replacement).toBeUndefined()
        expect(c.layers).toBeUndefined()
    })

    it('leader sequence (TBL_LEADER) round-trips — output refs the behavior table', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "LDR", "target": "zmk" }, ${kb(2)},
            "layers": [{ "name": "base", "bindings": [{ "type": "leader", "windowMs": 400 }, "A"] }],
            "leaderSequences": [
                { "sequence": ["B", "C"], "action": "ESCAPE" },
                { "sequence": ["X"], "action": { "type": "layer", "mode": "toggle", "layer": "base" } }
            ]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        expect(config!.leaderSequences).toHaveLength(2)
        expect(config!.leaderSequences![0].sequence).toHaveLength(2)
        expect(config!.leaderSequences![0].action.type).toBe('key_press')
        expect(config!.leaderSequences![1].sequence).toHaveLength(1)
        expect(config!.leaderSequences![1].action.type).toBe('layer')
        // The per-key leader-start cell still decodes alongside the table.
        expect(config!.layers[0].bindings[0]).toEqual({
            type: 'leader',
            windowMs: 400,
        })
    })

    // pattern-check: skip — custom hold-tap lowering test fixtures
    it('hold_tap (custom) lowers to MOD_TAP / LAYER_TAP and round-trips', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "HT", "target": "zmk" }, ${kb(2)},
            "layers": [
                { "name": "base", "bindings": [
                    { "type": "hold_tap", "ref": "ht_shift", "holdParam": "LSHIFT", "tapParam": "A" },
                    { "type": "hold_tap", "ref": "ht_layer", "holdParam": "fn", "tapParam": "B" }
                ] },
                { "name": "fn", "bindings": ["X", "Y"] }
            ],
            "holdTaps": [
                { "id": "ht_shift", "flavor": "tap-preferred", "tappingTermMs": 200, "bindings": ["&kp", "&kp"] },
                { "id": "ht_layer", "bindings": ["&mo", "&kp"] }
            ]
        }`
        roundTrips(json)
        const { config } = decodeRemapprBlob(
            buildRemapprBlob(parseKeymap(json), { configVersion: 1 }).blob,
        )
        // The custom-behavior grouping isn't on the wire — both cells decode to a
        // plain tap_hold (MOD_TAP / LAYER_TAP); the holdTaps def is not recovered.
        expect(config!.holdTaps).toBeUndefined()
        const a = config!.layers[0].bindings[0]
        const b = config!.layers[0].bindings[1]
        if (a.type !== 'tap_hold' || b.type !== 'tap_hold')
            throw new Error('expected both cells to decode to tap_hold')
        expect(a.hold).toEqual({ type: 'modifier', modifier: 'LEFT_SHIFT' })
        expect(a.flavor).toBe('tap-preferred')
        expect(a.tappingTermMs).toBe(200)
        expect(b.hold).toEqual({ type: 'layer', layer: 'Layer 1' })
    })

    it('hold_tap with a non-mod / non-layer hold is a diagnosed gap', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "HTbad", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base", "bindings": [
                { "type": "hold_tap", "ref": "bad", "holdParam": "A", "tapParam": "B" }
            ] }],
            "holdTaps": [{ "id": "bad", "bindings": ["&kp", "&kp"] }]
        }`
        const { diagnostics } = buildRemapprBlob(parseKeymap(json), {
            configVersion: 1,
        })
        expect(
            diagnostics.some(
                (d) => d.level === 'error' && /not a modifier/.test(d.message),
            ),
        ).toBe(true)
    })
})

// Consumer-page media keys round-trip through BH_CONSUMER (§44.4).
// pattern-check: skip — round-trip test data, no production logic
describe('remappr consumer round-trip (BH_CONSUMER)', () => {
    it('encode → decode → re-encode is byte-stable for media keys', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Media", "target": "zmk" }, ${kb(4)},
            "layers": [{ "name": "base", "bindings": [
                "media.volume_increment", "media.volume_decrement",
                "media.mute", "media.transport.play_pause"
            ] }]
        }`)
    })

    it('decodes BH_CONSUMER back to its consumer key_press', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "M", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base", "bindings": ["media.mute"] }]
        }`
        const { blob } = buildRemapprBlob(parseKeymap(json), { configVersion: 1 })
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.layers[0].bindings[0]).toMatchObject({
            type: 'key_press',
            key: 'media.mute',
        })
    })
})

// GD system-control keys round-trip through BH_SYS_CTRL (§44.4).
// pattern-check: skip — round-trip test data, no production logic
describe('remappr system-control round-trip (BH_SYS_CTRL)', () => {
    it('encode → decode → re-encode is byte-stable for GD usages', () => {
        roundTrips(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Sys", "target": "zmk" }, ${kb(3)},
            "layers": [{ "name": "base", "bindings": [
                "sys_ctrl.system_power_down", "sys_ctrl.system_sleep",
                "sys_ctrl.system_wake_up"
            ] }]
        }`)
    })

    it('decodes BH_SYS_CTRL back to its system-control key_press', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "S", "target": "zmk" }, ${kb(1)},
            "layers": [{ "name": "base",
                "bindings": ["sys_ctrl.system_power_down"] }]
        }`
        const { blob } = buildRemapprBlob(parseKeymap(json), { configVersion: 1 })
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.layers[0].bindings[0]).toMatchObject({
            type: 'key_press',
            key: 'sys_ctrl.system_power_down',
        })
    })
})
