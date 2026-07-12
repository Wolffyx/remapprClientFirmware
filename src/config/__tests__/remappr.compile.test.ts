import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getCompiler, hasCompiler, parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr/index'
import { decodeRemapprBlob, DecodeCode } from '../compilers/remappr/decode'
import { defaultConfig } from '../../remappr/configRead'

// Read a little-endian u16 out of a blob.
const u16 = (b: Uint8Array, off: number): number => b[off] | (b[off + 1] << 8)
const u32 = (b: Uint8Array, off: number): number =>
    (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0

// Find a table payload [start, end) by id in a validated blob (header is 20B,
// each table is u16 id, u16 ver, u32 len, payload).
const findTable = (b: Uint8Array, id: number): [number, number] | null => {
    let off = 20
    while (off + 8 <= b.length) {
        const tid = u16(b, off)
        const len = u32(b, off + 4)
        const start = off + 8
        if (tid === id) return [start, start + len]
        off = start + len
    }
    return null
}

const bytesOf = (config: ReturnType<typeof parseKeymap>): Uint8Array =>
    getCompiler('remappr').compile(config).files[0].content as Uint8Array

// A tiny 2-layer × 3-position all-bare-keys fixture. Small enough to lock the
// exact bytes both here and in the firmware decoder (golden cross-check).
const TINY = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Tiny", "target": "zmk" },
    "keyboard": { "id": "tiny", "name": "Tiny",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "defaults": { "tappingTermMs": 200 },
    "layers": [
        { "name": "base", "bindings": ["A", "B", "C"] },
        { "name": "fn", "bindings": [{ "type": "transparent" }, "A", { "type": "none" }] }
    ]
}`

describe('fresh-device default config (no stored geometry)', () => {
    it('encodes num_positions from the binding count when keyboard.keys is empty', () => {
        // The live "Save on a freshly-connected keyboard" path: with no stored
        // config the editor uses defaultConfig(), which leaves keyboard.keys
        // empty but carries one transparent binding per physical position.
        // Regression for COMMIT_CONFIG → ERR_ACTIVATE (the firmware rejects a
        // LAYER table with num_positions=0 as ERR_BOUNDS in decode_keymap).
        const cfg = defaultConfig(15)
        expect(cfg.keyboard.keys).toHaveLength(0)

        const { blob, diagnostics } = buildRemapprBlob(cfg, { configVersion: 1 })
        const layer = findTable(blob, 1) // TBL_LAYER
        expect(layer).not.toBeNull()
        const [start] = layer!
        expect(u16(blob, start)).toBe(1) // num_layers
        expect(u16(blob, start + 2)).toBe(15) // num_positions — was 0 before the fix
        expect(diagnostics.some((d) => d.level === 'error')).toBe(false)

        // The firmware re-validates on commit; the app's decoder shares that
        // logic, so a clean round-trip proves the blob now activates.
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
    })
})

describe('remappr (canonical → RMBC) target', () => {
    it('is registered alongside the text targets', () => {
        expect(hasCompiler('remappr')).toBe(true)
    })

    it('emits a binary .rmbc artifact with the RMBC magic', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(TINY),
        )
        expect(files).toHaveLength(1)
        expect(files[0].filename).toBe('tiny.rmbc')
        expect(files[0].mime).toBe('application/octet-stream')
        const b = files[0].content as Uint8Array
        expect(b).toBeInstanceOf(Uint8Array)
        // header: magic "RMBC" little-endian
        expect([b[0], b[1], b[2], b[3]]).toEqual([0x52, 0x4d, 0x42, 0x43])
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
    })

    // The byte-exact wire contract. These same bytes are decoded by the
    // firmware in tests/config_blob/src/golden_canonical.h + test_golden_canonical.c.
    // If either side changes the layout, this assertion (or the firmware decode)
    // fails — the wire ABI cannot drift silently. Layout: header(20) + LAYER +
    // BEHAVIOR[KeyA,KeyB,KeyC,Trans,None] + BINDING[0,1,2,3,0,4].
    it('matches the locked golden bytes (firmware cross-check)', () => {
        const b = bytesOf(parseKeymap(TINY))
        // prettier-ignore
        const golden = Uint8Array.from([
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
        expect(b).toEqual(golden)
    })

    it('encodes the real 42-key Corne export end-to-end (all bare keys)', () => {
        const json = readFileSync(
            fileURLToPath(new URL('./corne.keymap.json', import.meta.url)),
            'utf8',
        )
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        // Every binding is a bare keyboard-page key → no gaps hit.
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        // LAYER table payload starts after the 20-byte header + 8-byte table hdr.
        expect(u16(b, 20)).toBe(1) // table id = LAYER
        expect(u16(b, 28)).toBe(1) // num_layers
        expect(u16(b, 30)).toBe(42) // num_positions == keys.length
    })
})

// A macro behavior + TBL_MACRO (§43.5). Ctrl+C = press LCTRL, tap C, release.
const MACRO = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Mac", "target": "zmk" },
    "keyboard": { "id": "mac", "name": "Mac", "keys": [{"x":0,"y":0}] },
    "layers": [{ "name": "base", "bindings": [{ "type": "macro", "ref": "cc" }] }],
    "macros": [{ "id": "cc", "params": 0, "steps": [
        { "type": "press", "key": "LCTRL" },
        { "type": "tap", "key": "C" },
        { "type": "release", "key": "LCTRL" }
    ] }]
}`

describe('remappr macros (TBL_MACRO + BH_MACRO)', () => {
    it('emits a macro table and a BH_MACRO cell referencing it', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(MACRO),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array

        // BEHAVIOR table: one 16-byte record, type = Macro(11), tap = idx 0.
        const beh = findTable(b, 4)!
        expect(u16(b, beh[0])).toBe(1) // count
        expect(b[beh[0] + 2]).toBe(11) // record.type == BehaviorType.Macro
        expect(u16(b, beh[0] + 2 + 4)).toBe(0) // record.tap == macro index 0

        // MACRO table (id 6): 1 macro, 3 steps {op,pad,u16 arg}.
        const mac = findTable(b, 6)!
        let o = mac[0]
        expect(u16(b, o)).toBe(1) // num_macros
        o += 2
        expect(u16(b, o)).toBe(3) // num_steps
        o += 2
        expect([b[o], u16(b, o + 2)]).toEqual([1, 0xe0]) // PRESS LCTRL
        expect([b[o + 4], u16(b, o + 6)]).toEqual([0, 0x06]) // TAP C
        expect([b[o + 8], u16(b, o + 10)]).toEqual([2, 0xe0]) // RELEASE LCTRL
    })

    it('expands a text macro with shift wrapping for capitals', () => {
        const HI = MACRO.replace(
            '"steps": [\n        { "type": "press", "key": "LCTRL" },\n        { "type": "tap", "key": "C" },\n        { "type": "release", "key": "LCTRL" }\n    ]',
            '"steps": [{ "type": "text", "text": "Hi" }]',
        )
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(HI),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const mac = findTable(b, 6)!
        // "H" => PRESS Shift, TAP h(0x0b), RELEASE Shift; "i" => TAP i(0x0c).
        expect(u16(b, mac[0] + 2)).toBe(4) // 4 steps total
    })
})

// Parameterized macro (§44.3 host clone-per-instance): the `param` marker makes
// the NEXT key step take the binding's argument; each distinct argument clones
// the template into its own TBL_MACRO record (the template itself emits none),
// and identical (ref, argument) bindings share one clone.
const PARAM_MACRO = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Par", "target": "zmk" },
    "keyboard": { "id": "par", "name": "Par",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        { "type": "macro", "ref": "wrap", "param": "A" },
        { "type": "macro", "ref": "wrap", "param": "B" },
        { "type": "macro", "ref": "wrap", "param": "A" }
    ] }],
    "macros": [{ "id": "wrap", "params": 1, "steps": [
        { "type": "press", "key": "LCTRL" },
        { "type": "param" },
        { "type": "tap", "key": "C" },
        { "type": "release", "key": "LCTRL" }
    ] }]
}`

describe('remappr parameterized macros (§44.3 clone-per-instance)', () => {
    it('clones the template per distinct argument and dedupes repeats', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(PARAM_MACRO),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array

        // MACRO table: exactly TWO records — wrap(A) and wrap(B); the third
        // binding reuses the wrap(A) clone and the template emits no record.
        const mac = findTable(b, 6)!
        let o = mac[0]
        expect(u16(b, o)).toBe(2) // num_macros == distinct arguments
        o += 2
        expect(u16(b, o)).toBe(3) // wrap(A): 3 steps
        o += 2
        expect([b[o], u16(b, o + 2)]).toEqual([1, 0xe0]) // PRESS LCTRL
        expect([b[o + 4], u16(b, o + 6)]).toEqual([0, 0x04]) // TAP A (the arg)
        expect([b[o + 8], u16(b, o + 10)]).toEqual([2, 0xe0]) // RELEASE LCTRL
        o += 12
        expect(u16(b, o)).toBe(3) // wrap(B): 3 steps
        o += 2
        expect([b[o + 4], u16(b, o + 6)]).toEqual([0, 0x05]) // TAP B (the arg)

        // BEHAVIOR table: two distinct BH_MACRO records (tap = 0 / 1) — the
        // duplicate wrap(A) binding deduped onto the first.
        const beh = findTable(b, 4)!
        expect(u16(b, beh[0])).toBe(2)
    })

    it('rejects binding a parameterized macro without an argument', () => {
        const bare = PARAM_MACRO.replace(
            '{ "type": "macro", "ref": "wrap", "param": "B" }',
            '{ "type": "macro", "ref": "wrap" }',
        )
        const { diagnostics } = getCompiler('remappr').compile(
            parseKeymap(bare),
        )
        expect(
            diagnostics.some(
                (d) =>
                    d.level === 'error' && /takes a parameter/.test(d.message),
            ),
        ).toBe(true)
    })
})

// Layer + toggle + sticky behaviors (§43.6). base has all four; fn has keys.
const LAYERS = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Lay", "target": "zmk" },
    "keyboard": { "id": "lay", "name": "Lay",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
    "layers": [
        { "name": "base", "bindings": [
            { "type": "layer", "mode": "toggle", "layer": "fn" },
            { "type": "layer", "mode": "momentary", "layer": "fn" },
            { "type": "key_toggle", "key": "CAPSLOCK" },
            { "type": "sticky_key", "key": "LSHIFT" }
        ] },
        { "name": "fn", "bindings": ["A", "B", "C", "D"] }
    ]
}`

describe('remappr layer / toggle / sticky behaviors', () => {
    it('lowers each to its behavior record', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(LAYERS),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)
        const holdOf = (i: number) => u16(b, recAt(i) + 6)

        // base cells dedup to behaviors 0..3 in binding order.
        expect(typeOf(0)).toBe(12) // ToggleLayer
        expect(holdOf(0)).toBe(1) // -> fn (layer index 1)
        expect(typeOf(1)).toBe(5) // Momentary
        expect(holdOf(1)).toBe(1)
        expect(typeOf(2)).toBe(13) // KeyToggle
        expect(tapOf(2)).toBe(0x39) // Caps Lock usage
        expect(typeOf(3)).toBe(7) // StickyMod
        expect(holdOf(3)).toBe(0x02) // LSHIFT bit (1 << 1)
    })
})

// key_repeat (§44.3): zero-field BH_KEY_REPEAT (type 14). Firmware replays the
// last emitted key+mods at runtime, so the wire record carries no payload.
const REPEAT = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Rep", "target": "zmk" },
    "keyboard": { "id": "rep", "name": "Rep", "keys": [{"x":0,"y":0}] },
    "layers": [{ "name": "base", "bindings": [{ "type": "key_repeat" }] }]
}`

describe('remappr key_repeat (BH_KEY_REPEAT)', () => {
    it('lowers to a zero-field type-14 record', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(REPEAT),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(u16(b, beh[0])).toBe(1) // one behavior record
        const rec = beh[0] + 2
        expect(b[rec]).toBe(14) // BehaviorType.KeyRepeat
        // every remaining field is zero (flavor..subIndex).
        for (let i = 1; i < 16; i++) expect(b[rec + i]).toBe(0)
    })
})

// caps_word (§44.3): zero-field BH_CAPS_WORD (type 15). Firmware toggles a modal
// auto-shift; the wire record carries no payload.
const CAPS = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Caps", "target": "zmk" },
    "keyboard": { "id": "caps", "name": "Caps", "keys": [{"x":0,"y":0}] },
    "layers": [{ "name": "base", "bindings": [{ "type": "caps_word" }] }]
}`

describe('remappr caps_word (BH_CAPS_WORD)', () => {
    it('lowers to a zero-field type-15 record', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(CAPS),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(u16(b, beh[0])).toBe(1) // one behavior record
        const rec = beh[0] + 2
        expect(b[rec]).toBe(15) // BehaviorType.CapsWord
        for (let i = 1; i < 16; i++) expect(b[rec + i]).toBe(0)
    })
})

// Conditional layers (§44.3 tri-layer): TBL_CONDITIONAL (id 13). Wire per
// conditional: u8 num_if, u8 then_layer, num_if x u8 if_layer. Layer names
// resolve to indices (base=0, raise=1, lower=2, adjust=3).
const TRILAYER = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Tri", "target": "zmk" },
    "keyboard": { "id": "tri", "name": "Tri", "keys": [{"x":0,"y":0}] },
    "layers": [
        { "name": "base", "bindings": ["A"] },
        { "name": "raise", "bindings": [{ "type": "transparent" }] },
        { "name": "lower", "bindings": [{ "type": "transparent" }] },
        { "name": "adjust", "bindings": [{ "type": "transparent" }] }
    ],
    "conditionalLayers": [
        { "ifLayers": ["raise", "lower"], "thenLayer": "adjust" }
    ]
}`

// System behaviors (§44.3): reset / bootloader / soft_off lower to BH_SYSTEM
// (type 16) with the action code in `tap` (0/1/2).
const SYSTEM = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Sys", "target": "zmk" },
    "keyboard": { "id": "sys", "name": "Sys",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        { "type": "reset" }, { "type": "bootloader" }, { "type": "soft_off" }
    ] }]
}`

describe('remappr system behaviors (BH_SYSTEM)', () => {
    it('lowers reset/bootloader/soft_off to type-16 records with action codes', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(SYSTEM),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)

        expect(u16(b, beh[0])).toBe(3) // three distinct records
        expect(typeOf(0)).toBe(16) // System
        expect(tapOf(0)).toBe(0) // reset
        expect(typeOf(1)).toBe(16)
        expect(tapOf(1)).toBe(1) // bootloader
        expect(typeOf(2)).toBe(16)
        expect(tapOf(2)).toBe(2) // soft_off
    })

    it('lowers ext_power toggle/on/off to BH_SYSTEM action codes', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(`{
                "schemaVersion": 1, "kind": "remappr.keymap",
                "meta": { "name": "EP", "target": "zmk" },
                "keyboard": { "id": "ep", "name": "EP",
                    "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
                "layers": [{ "name": "base", "bindings": [
                    { "type": "ext_power", "action": "toggle" },
                    { "type": "ext_power", "action": "on" },
                    { "type": "ext_power", "action": "off" }
                ] }]
            }`),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)
        // toggle = 3 (existing), on = 9, off = 10 (8 is the unpair control verb).
        expect([typeOf(0), typeOf(1), typeOf(2)]).toEqual([16, 16, 16])
        expect(tapOf(0)).toBe(3)
        expect(tapOf(1)).toBe(9)
        expect(tapOf(2)).toBe(10)
    })
})

// Mouse behaviors (§44.3): mouse_key/move/scroll lower to BH_MOUSE (type 17)
// with the op in `tap` (key=0, move=1, scroll=2) and the button/direction code
// in `hold`.
const MOUSE = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Mou", "target": "zmk" },
    "keyboard": { "id": "mou", "name": "Mou",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        { "type": "mouse_key", "button": "right" },
        { "type": "mouse_move", "direction": "up" },
        { "type": "mouse_scroll", "direction": "down" }
    ] }]
}`

describe('remappr mouse behaviors (BH_MOUSE)', () => {
    it('lowers key/move/scroll to type-17 records with op + code', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(MOUSE),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)
        const holdOf = (i: number) => u16(b, recAt(i) + 6)

        expect(u16(b, beh[0])).toBe(3)
        expect(typeOf(0)).toBe(17) // Mouse
        expect(tapOf(0)).toBe(0) // op=key
        expect(holdOf(0)).toBe(1) // right button
        expect(typeOf(1)).toBe(17)
        expect(tapOf(1)).toBe(1) // op=move
        expect(holdOf(1)).toBe(0) // up
        expect(typeOf(2)).toBe(17)
        expect(tapOf(2)).toBe(2) // op=scroll
        expect(holdOf(2)).toBe(1) // down
    })
})

// Output behaviors (§44.3): output lowers to BH_OUTPUT (type 18), action in
// `tap`, BLE profile in `hold` (0xFF when unspecified).
const OUTPUT = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Out", "target": "zmk" },
    "keyboard": { "id": "out", "name": "Out",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        { "type": "output", "action": "bluetooth", "profile": 1 },
        { "type": "output", "action": "usb" }
    ] }]
}`

describe('remappr output behaviors (BH_OUTPUT)', () => {
    it('lowers action + profile to type-18 records', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(OUTPUT),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        expect(b[recAt(0)]).toBe(18) // Output
        expect(u16(b, recAt(0) + 4)).toBe(1) // action = bluetooth
        expect(u16(b, recAt(0) + 6)).toBe(1) // profile 1
        expect(b[recAt(1)]).toBe(18)
        expect(u16(b, recAt(1) + 4)).toBe(0) // action = usb
        expect(u16(b, recAt(1) + 6)).toBe(0xff) // no profile
    })
})

// Lighting behaviors (§44.3): lighting lowers to BH_LIGHTING (type 19), action
// in `tap`, target in `hold`; COLOR packs hue/sat/val into term/quick/prior.
const LIGHTING = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Lit", "target": "zmk" },
    "keyboard": { "id": "lit", "name": "Lit",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        { "type": "lighting", "target": "underglow", "action": "color",
          "hue": 200, "saturation": 80, "brightness": 90 },
        { "type": "lighting", "target": "backlight", "action": "toggle" }
    ] }]
}`

describe('remappr lighting behaviors (BH_LIGHTING)', () => {
    it('lowers action/target + packs HSV for color', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(LIGHTING),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        // color underglow: type 19, tap=14 (color), hold=0 (underglow),
        // term=hue(200), quick=sat(80), prior=val(90).
        expect(b[recAt(0)]).toBe(19)
        expect(u16(b, recAt(0) + 4)).toBe(14) // color
        expect(u16(b, recAt(0) + 6)).toBe(0) // underglow
        expect(u16(b, recAt(0) + 8)).toBe(200) // hue
        expect(u16(b, recAt(0) + 10)).toBe(80) // saturation
        expect(u16(b, recAt(0) + 12)).toBe(90) // brightness
        // backlight toggle: tap=0 (toggle), hold=1 (backlight), no params.
        expect(b[recAt(1)]).toBe(19)
        expect(u16(b, recAt(1) + 4)).toBe(0) // toggle
        expect(u16(b, recAt(1) + 6)).toBe(1) // backlight
        expect(u16(b, recAt(1) + 8)).toBe(0) // no hue
    })
})

describe('remappr conditional layers (TBL_CONDITIONAL)', () => {
    it('emits a conditional table with resolved layer indices', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(TRILAYER),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const cond = findTable(b, 13)! // TableId.Conditional
        let o = cond[0]
        expect(u16(b, o)).toBe(1) // one conditional
        o += 2
        expect(b[o]).toBe(2) // num_if
        expect(b[o + 1]).toBe(3) // then_layer = adjust (index 3)
        expect(b[o + 2]).toBe(1) // if[0] = raise (index 1)
        expect(b[o + 3]).toBe(2) // if[1] = lower (index 2)
    })
})

// Consumer-page media keys (§44.4): canonical ids on HID page 12 lower to
// BH_CONSUMER (37) carrying the bare Consumer usage, not BH_KEY. The firmware
// already routes these through its dedicated consumer HID interface.
// pattern-check: skip — test fixtures + assertions, no production logic
const CONSUMER = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Media", "target": "zmk" },
    "keyboard": { "id": "m", "name": "M",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        "media.volume_increment", "media.volume_decrement",
        "media.mute", "media.transport.play_pause"
    ] }]
}`

describe('remappr consumer-page (media) keys', () => {
    it('lowers page-12 usages to BH_CONSUMER (37)', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(CONSUMER),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)
        // Four distinct consumer usages → behaviors 0..3 in binding order.
        expect([typeOf(0), typeOf(1), typeOf(2), typeOf(3)]).toEqual([
            37, 37, 37, 37,
        ])
        expect(tapOf(0)).toBe(0xe9) // Volume Increment
        expect(tapOf(1)).toBe(0xea) // Volume Decrement
        expect(tapOf(2)).toBe(0xe2) // Mute
        expect(tapOf(3)).toBe(0xb0) // Play/Pause
    })

    it('keeps a keyboard-page volume usage on BH_KEY (page 7)', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(`{
                "schemaVersion": 1, "kind": "remappr.keymap",
                "meta": { "name": "K", "target": "zmk" },
                "keyboard": { "id": "k", "name": "K", "keys": [{"x":0,"y":0}] },
                "layers": [{ "name": "base", "bindings": ["Volume Up"] }]
            }`),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(b[beh[0] + 2]).toBe(2) // BH_KEY — keyboard-page volume usage
    })

    // Byte-exact lock for the firmware cross-check: a tiny 2-key consumer
    // fixture whose identical bytes are embedded + decoded firmware-side in
    // tests/config_blob/golden_canonical.h. The BH_CONSUMER wire ABI cannot
    // drift silently — change either side and one of the two tests fails.
    // pattern-check: skip — locked golden bytes, no production logic
    it('matches the locked consumer golden bytes (firmware cross-check)', () => {
        const TINY_CONSUMER = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Media", "target": "zmk" },
            "keyboard": { "id": "m", "name": "M",
                "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
            "layers": [{ "name": "base",
                "bindings": ["media.mute", "media.volume_increment"] }]
        }`
        // prettier-ignore
        const golden = Uint8Array.from([
            0x52, 0x4d, 0x42, 0x43, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x46, 0x00, 0x00, 0x00, 0x85, 0x46, 0x33, 0x15, 0x01, 0x00, 0x01, 0x00,
            0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0xc8, 0x00, 0x00, 0x00,
            0x04, 0x00, 0x01, 0x00, 0x22, 0x00, 0x00, 0x00, 0x02, 0x00, 0x25, 0x00,
            0x00, 0x00, 0xe2, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x25, 0x00, 0x00, 0x00, 0xe9, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
        ])
        expect(bytesOf(parseKeymap(TINY_CONSUMER))).toEqual(golden)
    })
})

// GD System Control (§44.4): canonical ids on HID page 1 lower to BH_SYS_CTRL
// (38) carrying the bare GD usage, not BH_KEY. The firmware routes these through
// its dedicated system-control HID interface (power / sleep / wake).
// pattern-check: skip — test fixtures + assertions, no production logic
const SYS_CTRL = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Sys", "target": "zmk" },
    "keyboard": { "id": "s", "name": "S",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [{ "name": "base", "bindings": [
        "sys_ctrl.system_power_down", "sys_ctrl.system_sleep",
        "sys_ctrl.system_wake_up"
    ] }]
}`

describe('remappr GD system-control keys', () => {
    it('lowers page-1 usages to BH_SYS_CTRL (38)', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(SYS_CTRL),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        const recAt = (i: number) => beh[0] + 2 + i * 16
        const typeOf = (i: number) => b[recAt(i)]
        const tapOf = (i: number) => u16(b, recAt(i) + 4)
        // Three distinct GD usages → behaviors 0..2 in binding order.
        expect([typeOf(0), typeOf(1), typeOf(2)]).toEqual([38, 38, 38])
        expect(tapOf(0)).toBe(0x81) // System Power Down
        expect(tapOf(1)).toBe(0x82) // System Sleep
        expect(tapOf(2)).toBe(0x83) // System Wake Up
    })

    it('drops modifiers on a system-control binding (warns, no error)', () => {
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(`{
                "schemaVersion": 1, "kind": "remappr.keymap",
                "meta": { "name": "S", "target": "zmk" },
                "keyboard": { "id": "s", "name": "S", "keys": [{"x":0,"y":0}] },
                "layers": [{ "name": "base", "bindings": [
                    { "type": "key_press", "key": "sys_ctrl.system_sleep",
                      "mods": ["LEFT_CTRL"] }
                ] }]
            }`),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        expect(
            diagnostics.some((d) => /system-control key/.test(d.message)),
        ).toBe(true)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(b[beh[0] + 2]).toBe(38) // still BH_SYS_CTRL, mods dropped
    })

    // Byte-exact lock for the firmware cross-check (mirrors the consumer golden):
    // a tiny 2-key fixture whose identical bytes are embedded + decoded firmware-
    // side in tests/config_blob/golden_canonical.h. The BH_SYS_CTRL wire ABI
    // cannot drift silently — change either side and one of the two tests fails.
    // pattern-check: skip — locked golden bytes, no production logic
    it('matches the locked system-control golden bytes (firmware cross-check)', () => {
        const TINY_SYS = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Sys", "target": "zmk" },
            "keyboard": { "id": "s", "name": "S",
                "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
            "layers": [{ "name": "base",
                "bindings": ["sys_ctrl.system_power_down", "sys_ctrl.system_sleep"] }]
        }`
        // prettier-ignore
        const golden = Uint8Array.from([
            0x52, 0x4d, 0x42, 0x43, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x46, 0x00, 0x00, 0x00, 0x12, 0x2a, 0xf1, 0x46, 0x01, 0x00, 0x01, 0x00,
            0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0xc8, 0x00, 0x00, 0x00,
            0x04, 0x00, 0x01, 0x00, 0x22, 0x00, 0x00, 0x00, 0x02, 0x00, 0x26, 0x00,
            0x00, 0x00, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x26, 0x00, 0x00, 0x00, 0x82, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
        ])
        expect(bytesOf(parseKeymap(TINY_SYS))).toEqual(golden)
    })
})

// §44.3 advanced-gap closures: sticky non-mod key (BH_STICKY_KEY 39),
// grave_escape (ANY-mod MOD_MORPH), keepMods partial (explicit suppress mask in
// `tap`), advanced macro steps (pause_for_release + tap_time lowering) and
// positional hold-trigger (TBL_POSHOLD).
describe('remappr §44.3 advanced gaps', () => {
    it('sticky_key with a non-mod key lowers to BH_STICKY_KEY', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Sk", "target": "zmk" },
            "keyboard": { "id": "sk", "name": "Sk", "keys": [{"x":0,"y":0}] },
            "layers": [{ "name": "base",
                "bindings": [{ "type": "sticky_key", "key": "A" }] }]
        }`
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(b[beh[0] + 2]).toBe(39) // BehaviorType.StickyKey
        expect(u16(b, beh[0] + 2 + 4)).toBe(0x04) // tap = usage A
    })

    it('grave_escape lowers to an ANY-mod MOD_MORPH over Esc/grave', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Ge", "target": "zmk" },
            "keyboard": { "id": "ge", "name": "Ge", "keys": [{"x":0,"y":0}] },
            "layers": [{ "name": "base",
                "bindings": [{ "type": "grave_escape" }] }]
        }`
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(b[beh[0] + 2]).toBe(9) // ModMorph
        expect(b[beh[0] + 2 + 2] & 0x08).toBe(0x08) // MORPH_ANY_MOD
        expect(b[beh[0] + 2 + 2] & 0x04).toBe(0) // no suppression: Shift+` = ~
        expect(u16(b, beh[0] + 2 + 6)).toBe(0xaa) // Shift|GUI trigger mask
        const subs = findTable(b, 12)!
        expect(u16(b, subs[0])).toBe(2)
        expect(u16(b, subs[0] + 2 + 4)).toBe(0x29) // sub0 = Escape
        expect(u16(b, subs[0] + 2 + 16 + 4)).toBe(0x35) // sub1 = grave
    })

    it('mod_morph keepMods partial emits the explicit suppress mask', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Km", "target": "zmk" },
            "keyboard": { "id": "km", "name": "Km", "keys": [{"x":0,"y":0}] },
            "layers": [{ "name": "base",
                "bindings": [{ "type": "mod_morph", "ref": "mm" }] }],
            "modMorphs": [{ "id": "mm",
                "mods": ["LEFT_SHIFT", "LEFT_GUI"],
                "keepMods": ["LEFT_GUI"],
                "bindings": ["N", "M"] }]
        }`
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const beh = findTable(b, 4)!
        expect(b[beh[0] + 2 + 2] & 0x04).toBe(0x04) // MORPH_SUPPRESS_MODS
        expect(u16(b, beh[0] + 2 + 6)).toBe(0x0a) // trigger LSHIFT|LGUI
        expect(u16(b, beh[0] + 2 + 4)).toBe(0x02) // suppress ONLY LSHIFT (kept GUI)
    })

    it('macro pause_for_release and tap_time lower to wire steps', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Ma", "target": "zmk" },
            "keyboard": { "id": "ma", "name": "Ma", "keys": [{"x":0,"y":0}] },
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
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const mac = findTable(b, 6)!
        let o = mac[0]
        expect(u16(b, o)).toBe(1)
        o += 2
        // tap_time is a setting, not a step; the timed tap expands to 3 steps.
        expect(u16(b, o)).toBe(6)
        o += 2
        expect([b[o], u16(b, o + 2)]).toEqual([1, 0xe1]) // PRESS LSHIFT
        expect([b[o + 4], u16(b, o + 6)]).toEqual([4, 0]) // PAUSE_FOR_RELEASE
        expect([b[o + 8], u16(b, o + 10)]).toEqual([2, 0xe1]) // RELEASE LSHIFT
        expect([b[o + 12], u16(b, o + 14)]).toEqual([1, 0x04]) // PRESS A
        expect([b[o + 16], u16(b, o + 18)]).toEqual([3, 30]) // WAIT tap_time
        expect([b[o + 20], u16(b, o + 22)]).toEqual([2, 0x04]) // RELEASE A
    })

    it('hold_tap positional trigger emits TBL_POSHOLD', () => {
        const json = `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Ph", "target": "zmk" },
            "keyboard": { "id": "ph", "name": "Ph",
                "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
            "layers": [{ "name": "base", "bindings": [
                { "type": "hold_tap", "ref": "hrm", "holdParam": "LSHIFT", "tapParam": "A" },
                "B", "C"
            ] }],
            "holdTaps": [{ "id": "hrm", "bindings": ["&kp", "&kp"],
                "holdTriggerKeyPositions": [1, 2] }]
        }`
        const { files, diagnostics } = getCompiler('remappr').compile(
            parseKeymap(json),
        )
        expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
        const b = files[0].content as Uint8Array
        const ph = findTable(b, 18)!
        let o = ph[0]
        expect(u16(b, o)).toBe(1) // one poshold entry
        o += 2
        expect(u16(b, o)).toBe(0) // behavior index 0 (the MOD_TAP record)
        expect(b[o + 2]).toBe(2) // two positions
        expect(u16(b, o + 4)).toBe(1)
        expect(u16(b, o + 6)).toBe(2)
    })
})

describe('LAYER §20 timing tail (runtime debounce)', () => {
    const withDefaults = (defaults: Record<string, number>): string =>
        TINY.replace(
            '"defaults": { "tappingTermMs": 200 }',
            `"defaults": ${JSON.stringify({ tappingTermMs: 200, ...defaults })}`,
        )

    it('stays at the 8-byte LAYER layout when no timing is set (goldens)', () => {
        const b = bytesOf(parseKeymap(TINY))
        const [start, end] = findTable(b, 1)!
        expect(end - start).toBe(8)
        expect(u16(b, start + 6)).toBe(0) // release_debounce_ms default
    })

    it('emits the 6-byte tail when any debounce default is set', () => {
        const b = bytesOf(
            parseKeymap(
                withDefaults({
                    releaseDebounceMs: 4,
                    pressDebounceMs: 2,
                    matrixPressDebounceMs: 3,
                    matrixReleaseDebounceMs: 7,
                }),
            ),
        )
        const [start, end] = findTable(b, 1)!
        expect(end - start).toBe(14)
        expect(u16(b, start + 6)).toBe(4) // release_debounce_ms
        expect(u16(b, start + 8)).toBe(2) // press_debounce_ms
        expect(u16(b, start + 10)).toBe(3) // matrix_press_debounce_ms
        expect(u16(b, start + 12)).toBe(7) // matrix_release_debounce_ms
    })

    it('emits the tail for a single matrix value (0 = keep devicetree)', () => {
        const b = bytesOf(parseKeymap(withDefaults({ matrixReleaseDebounceMs: 9 })))
        const [start, end] = findTable(b, 1)!
        expect(end - start).toBe(14)
        expect(u16(b, start + 8)).toBe(0)
        expect(u16(b, start + 10)).toBe(0)
        expect(u16(b, start + 12)).toBe(9)
    })

    it('round-trips the timing defaults through the decoder', () => {
        const b = bytesOf(
            parseKeymap(
                withDefaults({
                    releaseDebounceMs: 4,
                    pressDebounceMs: 2,
                    matrixPressDebounceMs: 3,
                    matrixReleaseDebounceMs: 7,
                }),
            ),
        )
        const decoded = decodeRemapprBlob(b)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.defaults).toMatchObject({
            releaseDebounceMs: 4,
            pressDebounceMs: 2,
            matrixPressDebounceMs: 3,
            matrixReleaseDebounceMs: 7,
        })
        // And an untailed blob decodes with none of them set.
        const plain = decodeRemapprBlob(bytesOf(parseKeymap(TINY)))
        expect(plain.code).toBe(DecodeCode.OK)
        expect(plain.config!.defaults?.pressDebounceMs).toBeUndefined()
    })

    // pattern-check: skip — compile/round-trip test assertions, no production logic
    it('emits the 24-byte v3 tail when a v3 timing default is set', () => {
        const b = bytesOf(
            parseKeymap(
                withDefaults({
                    capsWordIdleMs: 1500,
                    stickyReleaseDefaultMs: 800,
                    macroDefaultWaitMs: 12,
                    macroDefaultTapMs: 6,
                    matrixPollPeriodMs: 2,
                }),
            ),
        )
        const [start, end] = findTable(b, 1)!
        expect(end - start).toBe(24)
        // v2 slot is zero-filled (none set) but present so the v3 offsets align.
        expect(u16(b, start + 8)).toBe(0)
        expect(u16(b, start + 10)).toBe(0)
        expect(u16(b, start + 12)).toBe(0)
        expect(u16(b, start + 14)).toBe(1500) // caps_word_idle_ms
        expect(u16(b, start + 16)).toBe(800) // sticky_release_default_ms
        expect(u16(b, start + 18)).toBe(12) // macro_default_wait_ms
        expect(u16(b, start + 20)).toBe(6) // macro_default_tap_ms
        expect(u16(b, start + 22)).toBe(2) // matrix_poll_period_ms
    })

    it('forces the v2 slot present when only a v3 value is set', () => {
        const b = bytesOf(parseKeymap(withDefaults({ matrixPollPeriodMs: 5 })))
        const [start, end] = findTable(b, 1)!
        expect(end - start).toBe(24)
        expect(u16(b, start + 22)).toBe(5) // matrix_poll_period_ms at [22]
    })

    it('round-trips the v3 timing defaults through the decoder', () => {
        const b = bytesOf(
            parseKeymap(
                withDefaults({
                    capsWordIdleMs: 1500,
                    stickyReleaseDefaultMs: 800,
                    macroDefaultWaitMs: 12,
                    macroDefaultTapMs: 6,
                    matrixPollPeriodMs: 2,
                }),
            ),
        )
        const decoded = decodeRemapprBlob(b)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.defaults).toMatchObject({
            capsWordIdleMs: 1500,
            stickyReleaseDefaultMs: 800,
            macroDefaultWaitMs: 12,
            macroDefaultTapMs: 6,
            matrixPollPeriodMs: 2,
        })
    })
})

// pattern-check: skip — compile fixtures + assertions, no production logic
describe('defaults lowering (quickTapMs / comboTimeoutMs → records)', () => {
    const twoKeys = `"keyboard": { "id": "k", "name": "K", "keys": [{"x":0,"y":0},{"x":1,"y":0}] }`

    const decodedBindings = (json: string): any[] => {
        const decoded = decodeRemapprBlob(bytesOf(parseKeymap(json)))
        expect(decoded.code).toBe(DecodeCode.OK)
        return decoded.config!.layers[0].bindings
    }

    it('lowers defaults.quickTapMs into an inline tap-hold; explicit value wins', () => {
        const [th0, th1] = decodedBindings(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "QT", "target": "zmk" }, ${twoKeys},
            "defaults": { "tappingTermMs": 200, "quickTapMs": 120 },
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" } },
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "B" },
                  "hold": { "type": "modifier", "modifier": "LEFT_CTRL" }, "quickTapMs": 40 }
            ] }]
        }`)
        expect(th0.quickTapMs).toBe(120) // no explicit → config default
        expect(th1.quickTapMs).toBe(40) // explicit per-action wins
    })

    it('honors an explicit quickTapMs:0 over the default (no quick tap)', () => {
        const [th] = decodedBindings(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "QT0", "target": "zmk" }, ${twoKeys},
            "defaults": { "tappingTermMs": 200, "quickTapMs": 120 },
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" }, "quickTapMs": 0 },
                "B"
            ] }]
        }`)
        // record quickTap 0 = firmware default → decoder leaves the field unset.
        expect(th.quickTapMs).toBeUndefined()
    })

    it('lowers defaults.quickTapMs into a hold-tap definition (ht ref)', () => {
        const [th] = decodedBindings(`{
            "version": 2, "kind": "remappr.keymap", "meta": { "name": "HT" }, ${twoKeys},
            "defaults": { "tappingTermMs": 200, "quickTapMs": 150 },
            "holdTaps": { "hr": { "flavor": "balanced" } },
            "layers": [{ "name": "base", "keys": [ "ht:hr(LGui,A)", "B" ] }]
        }`)
        expect(th.quickTapMs).toBe(150)
    })

    it('leaves records at the firmware default when no quickTapMs default is set', () => {
        const [th] = decodedBindings(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "QN", "target": "zmk" }, ${twoKeys},
            "defaults": { "tappingTermMs": 200 },
            "layers": [{ "name": "base", "bindings": [
                { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" } },
                "B"
            ] }]
        }`)
        expect(th.quickTapMs).toBeUndefined()
    })

    const decodedCombo = (json: string): any => {
        const decoded = decodeRemapprBlob(bytesOf(parseKeymap(json)))
        expect(decoded.code).toBe(DecodeCode.OK)
        return decoded.config!.combos![0]
    }

    it('lowers defaults.comboTimeoutMs into a combo; per-combo value wins', () => {
        const base = (combo: string, def: string): string => `{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "CT", "target": "zmk" }, ${twoKeys},
            "defaults": { "tappingTermMs": 200${def} },
            "layers": [{ "name": "base", "bindings": ["A", "B"] }],
            "combos": [${combo}]
        }`
        expect(
            decodedCombo(base(`{ "name": "e", "keys": [0, 1], "action": "ESCAPE" }`, ', "comboTimeoutMs": 30')).timeoutMs,
        ).toBe(30) // no per-combo timeout → config default
        expect(
            decodedCombo(base(`{ "name": "e", "keys": [0, 1], "action": "ESCAPE", "timeoutMs": 25 }`, ', "comboTimeoutMs": 30')).timeoutMs,
        ).toBe(25) // per-combo timeout wins
        expect(
            decodedCombo(base(`{ "name": "e", "keys": [0, 1], "action": "ESCAPE" }`, '')).timeoutMs,
        ).toBe(40) // no default → 40 ms fallback
    })
})
