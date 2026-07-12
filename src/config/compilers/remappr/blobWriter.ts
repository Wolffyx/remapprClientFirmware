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

// enum remappr_table_id (config_blob.h). Ids 2(LAYOUT), 8(MOUSE), 9(PROFILE),
// 10(ALIAS), 11(SECURITY) are reserved — the firmware does not decode them.
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
    Conditional: 13,
    KeyOverride: 14,
    Leader: 15,
    Personality: 16,
    ActionBinding: 17,
    Poshold: 18,
    Names: 19,
} as const

/** TBL_NAMES entry kind (config_blob.h REMAPPR_NAME_KIND_*). */
export const NameKind = {
    Macro: 0,
    TapDance: 1,
    ModMorph: 2,
} as const

// enum remappr_behavior_type (behavior_table.h) — 39 types, 0..38 (dense). The
// 16-byte record layout is identical across all types; only `type` and the
// interpretation of tap/hold/term/quick/prior differ.
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
    KeyRepeat: 14,
    CapsWord: 15,
    System: 16,
    Mouse: 17,
    Output: 18,
    Lighting: 19,
    AutoShift: 20,
    Leader: 21,
    // KEY_MODS (22): modded key_press (e.g. Ctrl+C) — tap = HID usage, hold = mod
    // mask. Emits mods+usage as one chord, both retracted on release.
    KeyMods: 22,
    AltRepeat: 23,
    LayerMod: 24,
    LayerTapToggle: 25,
    LayerLock: 26,
    ToSaved: 27,
    GuiLock: 28,
    Secure: 29,
    TuneTerm: 30,
    Unicode: 31, // tap = BMP codepoint (≤ 0xFFFF)
    Autocorrect: 32, // tap = lock_action
    AutoLayer: 33,
    MacroRecord: 34, // tap = dynamic-macro slot
    MacroPlay: 35, // tap = dynamic-macro slot
    Peripheral: 36, // tap = peripheral_kind, hold = code
    Consumer: 37, // tap = Consumer-page usage (media keys); press + release edges
    SysCtrl: 38, // tap = GD System Control usage (power/sleep/wake)
    StickyKey: 39, // tap = one-shot key usage, held until the next key releases
} as const

// enum remappr_system_action (behavior_table.h) — carried in BH_SYSTEM `tap`.
export const SystemAction = {
    reset: 0,
    bootloader: 1,
    soft_off: 2,
    ext_power_toggle: 3,
    clear_storage: 4,
    debug_toggle: 5,
    nkro_toggle: 6,
    swap_keys: 7,
    // 8 = REMAPPR_SYS_UNPAIR (a P1 radio control verb, never a keymap behavior —
    // the compiler does not emit it), so the absolute ext-power codes resume at 9.
    ext_power_on: 9,
    ext_power_off: 10,
} as const

// enum remappr_mouse_op (behavior_table.h) — carried in BH_MOUSE `tap`.
export const MouseOp = {
    key: 0,
    move: 1,
    scroll: 2,
    dragscroll: 3,
} as const

// enum remappr_lock_action (behavior_table.h) — carried in `tap` for
// GUI_LOCK / SECURE / AUTOCORRECT.
export const LockAction = {
    off: 0,
    on: 1,
    toggle: 2,
} as const

// enum remappr_peripheral_kind (behavior_table.h) — carried in BH_PERIPHERAL
// `tap`; the code rides in `hold`.
export const PeripheralKind = {
    encoder: 0,
    dipswitch: 1,
    haptic: 2,
    audio: 3,
    joystick: 4,
    midi: 5,
    steno: 6,
    sequencer: 7,
    wpm: 8,
    rawhid: 9,
} as const

// enum remappr_mouse_button — carried in BH_MOUSE `hold` for MouseOp.key.
export const MouseButtonCode = {
    left: 0,
    right: 1,
    middle: 2,
    mb4: 3,
    mb5: 4,
} as const

// enum remappr_mouse_dir — carried in BH_MOUSE `hold` for move / scroll.
export const MouseDirCode = {
    up: 0,
    down: 1,
    left: 2,
    right: 3,
} as const

// enum remappr_output_action — carried in BH_OUTPUT `tap`.
export const OutputActionCode = {
    usb: 0,
    bluetooth: 1,
    toggle: 2,
    none: 3,
    bluetooth_clear: 4,
    bluetooth_next: 5,
    bluetooth_prev: 6,
    bluetooth_disconnect: 7,
} as const
export const OUTPUT_NO_PROFILE = 0xff

// enum remappr_lighting_target — carried in BH_LIGHTING `hold`.
export const LightingTargetCode = {
    underglow: 0,
    backlight: 1,
    per_key: 2,
    indicator: 3,
} as const

// enum remappr_lighting_action — carried in BH_LIGHTING `tap` (order matches
// the firmware enum and the canonical LightingAction).
export const LightingActionCode = {
    toggle: 0,
    on: 1,
    off: 2,
    brightness_up: 3,
    brightness_down: 4,
    hue_up: 5,
    hue_down: 6,
    saturation_up: 7,
    saturation_down: 8,
    effect_next: 9,
    effect_previous: 10,
    speed_up: 11,
    speed_down: 12,
    cycle: 13,
    color: 14,
    set: 15,
} as const

// enum remappr_macro_op (behavior_table.h §43.5).
export const MacroOp = {
    Tap: 0,
    Press: 1,
    Release: 2,
    Wait: 3,
    // Pause playback until the invoking key is released (no arg); a no-op when
    // it already lifted (ZMK &macro_pause_for_release).
    PauseForRelease: 4,
} as const

// enum remappr_th_flavor.
export const Flavor = {
    HoldPreferred: 0,
    Balanced: 1,
    TapPreferred: 2,
    TapUnlessInterrupted: 3,
} as const

// remappr_behavior.flags bits (REMAPPR_BHF_*, behavior_table.h). MORPH_SUPPRESS_MODS
// is set on a MOD_MORPH record to drop the trigger mods from the report while the
// morphed sub-behavior is active (ZMK mod-morph without keep-mods).
export const BehaviorFlags = {
    RETRO_TAP: 1 << 0,
    HOLD_WHILE_UNDECIDED: 1 << 1,
    MORPH_SUPPRESS_MODS: 1 << 2,
    // MOD_MORPH: morph when ANY trigger mod is held instead of requiring all
    // of them (the QMK grave-escape shape).
    MORPH_ANY_MOD: 1 << 3,
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

// pattern-check: skip — optional annotation field on the existing wire DTO
/** One decoded behavior record (16 bytes on the wire). `posHold` is a
 *  compiler-side annotation (§28 positional hold-trigger positions) — it rides
 *  the record through de-duplication and is emitted as a TBL_POSHOLD entry,
 *  never into the 16-byte record itself. */
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
    posHold?: number[]
}

export interface ComboRecord {
    positions: number[]
    timeoutMs: number
    layer: number // 0xFF = any
    outputIndex: number // index into the behavior table
}

// pattern-check: skip plain wire-DTO interface mirroring the TBL_POSHOLD layout
/** One positional hold-trigger list (§28): only an interrupting key whose
 *  position is listed counts toward the referenced tap-hold's hold decision. */
export interface PosholdRecord {
    behaviorIndex: number // index into the (deduped) BEHAVIOR table
    positions: number[] // physical key positions, each < num_positions
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

// pattern-check: skip plain wire-DTO interface mirroring the TBL_CONDITIONAL layout
/** One conditional (tri-)layer: while every ifLayer is active, thenLayer is on. */
export interface ConditionalRecord {
    ifLayers: number[]
    thenLayer: number
}

// pattern-check: skip plain wire-DTO interfaces mirroring the firmware table layouts
/** One key-override (8 bytes): replace trigger+mods with replacement+mods while
 *  enabled. `layers` is a 16-bit enabled-layer bitmask (0 = any layer). */
export interface KeyOverrideRecord {
    trigger: number // HID usage
    triggerMods: number // mods that must all be held
    negativeMods: number // mods none of which may be held
    suppressedMods: number // mods masked from the report while on
    replacement: number // HID usage (0 = emit nothing)
    replacementMods: number
    layers: number // u16 bitmask, 0 = any
}

/** One leader sequence: `usages` (1..5 HID usages) fire `outputIndex` (a behavior
 *  table index). */
export interface LeaderRecord {
    usages: number[]
    outputIndex: number
}

/** The RGB table: a per-key color map. `mode` 0 = effects-only (no colors),
 *  1 = per-key. `colors` is RGB888 row-major [layer][position], length
 *  `numLayers * numPositions * 3`. */
export interface RgbTable {
    mode: number
    perLayer: boolean
    numLayers: number
    numPositions: number
    colors: Uint8Array
}

/** One action-binding record (10 bytes): an additive per-position action that
 *  sits alongside the keymap binding. `kind`/`code`/`arg0`/`arg1` are passed
 *  through verbatim (the firmware resolver interprets them). */
export interface ActionBindingRecord {
    position: number
    kind: number
    code: number
    arg0: number
    arg1: number
}

// pattern-check: skip plain data record mirroring the other *Record interfaces
/** One TBL_NAMES entry: a display label for a macro/composite (§24). `kind` is
 *  a NameKind value; `ref` is the macro index or composite sub_index. */
export interface NameRecord {
    kind: number
    ref: number
    name: string
}

const NAME_ENCODER = new TextEncoder()

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
        timing?: {
            pressDebounceMs?: number
            matrixPressDebounceMs?: number
            matrixReleaseDebounceMs?: number
        },
    ): this {
        this.tableBegin(TableId.Layer, 1)
        this.w.u16(numLayers)
        this.w.u16(numPositions)
        this.w.u16(defaultTermMs)
        this.w.u16(releaseDebounceMs)
        // Optional §20 timing tail (firmware dlen >= 14): engine eager-press
        // debounce + the matrix-scan debounce pair. 0 = keep the devicetree
        // value, so the tail is emitted only when some field is set — an
        // all-default config keeps the 8-byte layout (goldens unchanged).
        const press = timing?.pressDebounceMs ?? 0
        const mPress = timing?.matrixPressDebounceMs ?? 0
        const mRelease = timing?.matrixReleaseDebounceMs ?? 0
        if (press || mPress || mRelease) {
            this.w.u16(press)
            this.w.u16(mPress)
            this.w.u16(mRelease)
        }
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

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_NAMES (id 19): u16 count + per entry { u8 kind, u8 reserved, u16 ref,
     *  u8 name_len, name_len × u8 UTF-8 }. Advisory display labels (§24); mirrors
     *  keymap_encode.c. Entries with an empty name are dropped (firmware does the
     *  same), so an all-empty list still emits a 0-count table — callers that want
     *  no table at all should skip calling this. */
    namesTable(records: NameRecord[]): this {
        const named = records.filter((r) => r.name.length > 0)
        this.tableBegin(TableId.Names, 1)
        this.w.u16(named.length)
        for (const r of named) {
            const bytes = NAME_ENCODER.encode(r.name).subarray(0, 255)
            this.w.u8(r.kind)
            this.w.u8(0) // reserved
            this.w.u16(r.ref)
            this.w.u8(bytes.length)
            for (const b of bytes) this.w.u8(b)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_POSHOLD (§28): u16 count, then per entry u16 behavior_index,
     *  u8 num_positions, u8 pad, num_positions × u16 position — matching
     *  firmware decode_poshold.c. */
    posholdTable(entries: PosholdRecord[]): this {
        this.tableBegin(TableId.Poshold, 1)
        this.w.u16(entries.length)
        for (const e of entries) {
            this.w.u16(e.behaviorIndex)
            this.w.u8(e.positions.length)
            this.w.u8(0) // reserved
            for (const p of e.positions) this.w.u16(p)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    conditionalTable(conditionals: ConditionalRecord[]): this {
        this.tableBegin(TableId.Conditional, 1)
        this.w.u16(conditionals.length)
        for (const c of conditionals) {
            this.w.u8(c.ifLayers.length)
            this.w.u8(c.thenLayer)
            for (const l of c.ifLayers) this.w.u8(l)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_KEY_OVERRIDE (id 14): u16 count + count × 8-byte fixed records. */
    keyOverrideTable(records: KeyOverrideRecord[]): this {
        this.tableBegin(TableId.KeyOverride, 1)
        this.w.u16(records.length)
        for (const r of records) {
            this.w.u8(r.trigger)
            this.w.u8(r.triggerMods)
            this.w.u8(r.negativeMods)
            this.w.u8(r.suppressedMods)
            this.w.u8(r.replacement)
            this.w.u8(r.replacementMods)
            this.w.u16(r.layers)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_LEADER (id 15): u16 count + per record { u8 num_usages, u8 pad,
     *  u16 output_behavior_index, num_usages × u8 usage }. Max 5 usages. */
    leaderTable(records: LeaderRecord[]): this {
        this.tableBegin(TableId.Leader, 1)
        this.w.u16(records.length)
        for (const r of records) {
            this.w.u8(r.usages.length)
            this.w.u8(0) // pad
            this.w.u16(r.outputIndex)
            for (const u of r.usages) this.w.u8(u)
        }
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_RGB (id 7): 8-byte header { u8 mode, u8 flags, u8 num_layers, u8 pad,
     *  u16 num_positions, u16 pad } + RGB888 colors row-major [layer][pos]. */
    rgbTable(rgb: RgbTable): this {
        this.tableBegin(TableId.Rgb, 1)
        this.w.u8(rgb.mode)
        this.w.u8(rgb.perLayer ? 1 : 0)
        this.w.u8(rgb.numLayers)
        this.w.u8(0) // pad
        this.w.u16(rgb.numPositions)
        this.w.u16(0) // pad
        for (const byte of rgb.colors) this.w.u8(byte)
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_PERSONALITY (id 16): u8 personality + 3 reserved bytes (only byte 0
     *  is read by the decoder). */
    personalityTable(personality: number): this {
        this.tableBegin(TableId.Personality, 1)
        this.w.u8(personality)
        this.w.u8(0)
        this.w.u16(0)
        this.tableEnd()
        return this
    }

    // pattern-check: skip one more table-emit method on the existing Builder
    /** TBL_ACTION_BINDING (id 17): header { u16 count, u16 num_positions } +
     *  count × 10-byte records { u16 position, u8 kind, u8 reserved, u16 code,
     *  u16 arg0, u16 arg1 }. */
    actionBindingTable(
        numPositions: number,
        records: ActionBindingRecord[],
    ): this {
        this.tableBegin(TableId.ActionBinding, 1)
        this.w.u16(records.length)
        this.w.u16(numPositions)
        for (const r of records) {
            this.w.u16(r.position)
            this.w.u8(r.kind)
            this.w.u8(0) // reserved
            this.w.u16(r.code)
            this.w.u16(r.arg0)
            this.w.u16(r.arg1)
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
