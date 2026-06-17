import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getCompiler, hasCompiler, parseKeymap } from '../index'

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
