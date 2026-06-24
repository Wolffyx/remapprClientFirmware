import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { crc32 } from '../compilers/remappr/blobWriter'
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
})
