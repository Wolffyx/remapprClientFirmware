// Pattern check: Builder (Tier 1) — extended — byte-exact RMBC blob assembler
// ported from the firmware repo's tools/config_compiler/src/blob.ts BlobBuilder;
// reserves a header, appends length-prefixed tables, then finalize() backpatches
// body length + CRC32. The deferred-backpatch step is the Builder's whole point.
//
// This is the *canonical-pipeline* encoder (the §44 `remappr` target). It MUST
// stay byte-for-byte in lockstep with include/remappr/config_blob.h and
// lib/config_blob/keymap_decode.c — the firmware re-validates every blob (§21),
// so a layout drift surfaces as a decode failure in the golden cross-check test.
// Little-endian throughout.

export const BLOB_MAGIC = 0x43424d52 // "RMBC"
export const BLOB_READER_VERSION = 1
export const BLOB_HEADER_LEN = 20

// enum remappr_table_id (config_blob.h).
export const TableId = {
    Layer: 1,
    Layout: 2,
    Binding: 3,
    Behavior: 4,
    Combo: 5,
    Macro: 6,
    Rgb: 7,
    Mouse: 8,
    Profile: 9,
    Alias: 10,
    Security: 11,
    Subs: 12,
} as const

// enum remappr_behavior_type (behavior_table.h).
export const BehaviorType = {
    None: 0,
    Trans: 1,
    Key: 2,
    ModTap: 3,
    LayerTap: 4,
    Momentary: 5,
    To: 6,
    StickyMod: 7,
    StickyLayer: 8,
    ModMorph: 9,
    TapDance: 10,
    Macro: 11,
    ToggleLayer: 12,
    KeyToggle: 13,
} as const

// enum remappr_macro_op (behavior_table.h §43.5).
export const MacroOp = {
    Tap: 0,
    Press: 1,
    Release: 2,
    Wait: 3,
} as const

// enum remappr_th_flavor.
export const Flavor = {
    HoldPreferred: 0,
    Balanced: 1,
    TapPreferred: 2,
    TapUnlessInterrupted: 3,
} as const

// HID modifier byte bits (REMAPPR_MOD_*).
export const MOD = {
    LEFT_CTRL: 1 << 0,
    LEFT_SHIFT: 1 << 1,
    LEFT_ALT: 1 << 2,
    LEFT_GUI: 1 << 3,
    RIGHT_CTRL: 1 << 4,
    RIGHT_SHIFT: 1 << 5,
    RIGHT_ALT: 1 << 6,
    RIGHT_GUI: 1 << 7,
} as const

/** One decoded behavior record (16 bytes on the wire). */
export interface BehaviorRecord {
    type: number
    flavor: number
    flags: number
    subCount: number
    tap: number
    hold: number
    tappingTermMs: number
    quickTapMs: number
    requirePriorIdleMs: number
    subIndex: number
}

export interface ComboRecord {
    positions: number[]
    timeoutMs: number
    layer: number // 0xFF = any
    outputIndex: number // index into the behavior table
}

// pattern-check: skip plain wire-DTO interfaces mirroring BehaviorRecord/ComboRecord
/** One macro step (4 bytes: u8 op, u8 pad, u16 arg). */
export interface MacroStep {
    op: number // MacroOp
    arg: number // HID usage (tap/press/release) or delay-ms (wait)
}

export interface MacroRecord {
    steps: MacroStep[]
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        t[n] = c >>> 0
    }
    return t
})()

/** CRC32 (IEEE, reflected, poly 0xEDB88320) — matches remappr_crc32. */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

/** Growable little-endian byte writer. */
class ByteWriter {
    private buf = new Uint8Array(256)
    len = 0

    private ensure(n: number): void {
        if (this.len + n <= this.buf.length) return
        let cap = this.buf.length
        while (cap < this.len + n) cap *= 2
        const next = new Uint8Array(cap)
        next.set(this.buf.subarray(0, this.len))
        this.buf = next
    }

    u8(v: number): void {
        this.ensure(1)
        this.buf[this.len++] = v & 0xff
    }

    u16(v: number): void {
        this.u8(v & 0xff)
        this.u8((v >>> 8) & 0xff)
    }

    u32(v: number): void {
        this.u16(v & 0xffff)
        this.u16((v >>> 16) & 0xffff)
    }

    patch32(off: number, v: number): void {
        this.buf[off] = v & 0xff
        this.buf[off + 1] = (v >>> 8) & 0xff
        this.buf[off + 2] = (v >>> 16) & 0xff
        this.buf[off + 3] = (v >>> 24) & 0xff
    }

    bytes(): Uint8Array {
        return this.buf.subarray(0, this.len)
    }
}

/**
 * Assembles a config blob: reserve the header, append tables, then finalize()
 * backpatches body length and the body CRC32. Mirrors the C test encoder
 * (tests/config_blob/src/blob_builder.h) and the M3 tools/config_compiler.
 */
export class BlobBuilder {
    private w = new ByteWriter()
    private tableLenOff = 0

    constructor() {
        for (let i = 0; i < BLOB_HEADER_LEN; i++) this.w.u8(0) // header placeholder
    }

    private tableBegin(id: number, version: number): void {
        this.w.u16(id)
        this.w.u16(version)
        this.tableLenOff = this.w.len
        this.w.u32(0)
    }

    private tableEnd(): void {
        const payloadLen = this.w.len - (this.tableLenOff + 4)
        this.w.patch32(this.tableLenOff, payloadLen)
    }

    layerTable(
        numLayers: number,
        numPositions: number,
        defaultTermMs: number,
        releaseDebounceMs: number,
    ): this {
        this.tableBegin(TableId.Layer, 1)
        this.w.u16(numLayers)
        this.w.u16(numPositions)
        this.w.u16(defaultTermMs)
        this.w.u16(releaseDebounceMs)
        this.tableEnd()
        return this
    }

    behaviorTable(records: BehaviorRecord[]): this {
        return this.recordTable(TableId.Behavior, records)
    }

    /** SUBS table — identical 16-byte record framing to BEHAVIOR (§43.3). */
    subsTable(records: BehaviorRecord[]): this {
        return this.recordTable(TableId.Subs, records)
    }

    private recordTable(id: number, records: BehaviorRecord[]): this {
        this.tableBegin(id, 1)
        this.w.u16(records.length)
        for (const r of records) {
            this.w.u8(r.type)
            this.w.u8(r.flavor)
            this.w.u8(r.flags)
            this.w.u8(r.subCount)
            this.w.u16(r.tap)
            this.w.u16(r.hold)
            this.w.u16(r.tappingTermMs)
            this.w.u16(r.quickTapMs)
            this.w.u16(r.requirePriorIdleMs)
            this.w.u16(r.subIndex)
        }
        this.tableEnd()
        return this
    }

    bindingTable(behaviorIndices: number[]): this {
        this.tableBegin(TableId.Binding, 1)
        for (const idx of behaviorIndices) this.w.u16(idx)
        this.tableEnd()
        return this
    }

    comboTable(combos: ComboRecord[]): this {
        this.tableBegin(TableId.Combo, 1)
        this.w.u16(combos.length)
        for (const c of combos) {
            this.w.u16(c.positions.length)
            this.w.u16(c.timeoutMs)
            this.w.u8(c.layer)
            this.w.u8(0) // pad
            this.w.u16(c.outputIndex)
            for (const p of c.positions) this.w.u16(p)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    macroTable(macros: MacroRecord[]): this {
        this.tableBegin(TableId.Macro, 1)
        this.w.u16(macros.length)
        for (const m of macros) {
            this.w.u16(m.steps.length)
            for (const s of m.steps) {
                this.w.u8(s.op)
                this.w.u8(0) // pad
                this.w.u16(s.arg)
            }
        }
        this.tableEnd()
        return this
    }

    finalize(
        schemaVersion: number,
        minReader: number,
        configVersion: number,
    ): Uint8Array {
        const bodyLen = this.w.len - BLOB_HEADER_LEN
        this.w.patch32(0, BLOB_MAGIC)
        // schema_version (u16) + min_reader_version (u16) packed into one u32 slot
        this.w.patch32(4, (schemaVersion & 0xffff) | ((minReader & 0xffff) << 16))
        this.w.patch32(8, configVersion >>> 0)
        this.w.patch32(12, bodyLen >>> 0)
        const body = this.w
            .bytes()
            .subarray(BLOB_HEADER_LEN, BLOB_HEADER_LEN + bodyLen)
        this.w.patch32(16, crc32(body))
        return Uint8Array.from(this.w.bytes())
    }
}
