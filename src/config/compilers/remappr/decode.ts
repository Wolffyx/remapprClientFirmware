// Pattern check: no GoF pattern (-) — rejected — a ByteReader utility + a
// switch-based behavior-record reversal that mirrors blobWriter's ByteWriter and
// index.ts's lowerAction switch; a plain table walk, no GoF abstraction warranted.
//
// The inverse of the `remappr` compiler: RMBC blob → canonical ConfigKeymap. It
// MUST mirror firmware lib/config_blob/keymap_decode.c byte-for-byte — the same
// header validation, the same table layouts, the same 16-byte behavior records.
// `getKeymap()` reads the live config off the wire (READ_CONFIG_CHUNK) and runs
// it through here. Little-endian throughout.
//
// What the blob does NOT carry (and this decoder therefore synthesizes): layer
// names ("Layer N"), keyboard identity, and physical geometry. Real geometry is
// fetched live via GET_KEY_LAYOUT (proto-v2) and merged by the service; here the
// keyboard gets a synthetic single-row grid sized to num_positions.

import { HID_USAGE_DECODE } from '../../../catalog/entries'
import type { CanonicalKeyId } from '../../../catalog/types'
import { DiagnosticBag, type Diagnostic } from '../../diagnostics'
import { MODIFIERS, type Modifier } from '../../keycodes'
import type {
    CanonAction,
    CanonCombo,
    CanonConditionalLayer,
    CanonGeometry,
    CanonKeyPress,
    CanonLayer,
    CanonMacro,
    CanonMacroStep,
    ConfigKeymap,
    Direction,
    HoldTapFlavor,
    LightingAction,
    LightingTarget,
    MouseButton,
    OutputAction,
} from '../../types'
import {
    BehaviorType,
    BLOB_HEADER_LEN,
    BLOB_MAGIC,
    BLOB_READER_VERSION,
    crc32,
    Flavor,
    LightingActionCode,
    LightingTargetCode,
    MacroOp,
    MouseButtonCode,
    MouseDirCode,
    MouseOp,
    OUTPUT_NO_PROFILE,
    OutputActionCode,
    SystemAction,
    TableId,
    type BehaviorRecord,
} from './blobWriter'

const HID_PAGE_KEYBOARD = 7

/** Decode result codes — mirror enum remappr_config_result (config_blob.h). */
export const DecodeCode = {
    OK: 0,
    TRUNCATED: -1,
    MAGIC: -2,
    READER_VER: -3,
    CRC: -4,
    TABLE_FRAME: -5,
    MISSING: -6,
    TABLE_VER: -7,
    BOUNDS: -8,
    REFERENCE: -9,
    CAPABILITY: -10,
    BUDGET: -11,
} as const

export type DecodeCodeValue = (typeof DecodeCode)[keyof typeof DecodeCode]

const DECODE_CODE_NAME: Record<number, string> = {
    0: 'OK',
    [-1]: 'TRUNCATED',
    [-2]: 'MAGIC',
    [-3]: 'READER_VER',
    [-4]: 'CRC',
    [-5]: 'TABLE_FRAME',
    [-6]: 'MISSING',
    [-7]: 'TABLE_VER',
    [-8]: 'BOUNDS',
    [-9]: 'REFERENCE',
    [-10]: 'CAPABILITY',
    [-11]: 'BUDGET',
}

/** Human label for a decode result code, e.g. "CRC mismatch (-4)". */
export function decodeCodeLabel(code: number): string {
    return `${DECODE_CODE_NAME[code] ?? 'UNKNOWN'} (${code})`
}

export interface DecodeResult {
    code: DecodeCodeValue
    /** The decoded keymap, present iff `code === OK`. */
    config?: ConfigKeymap
    /** The blob's monotonic config_version (header offset 8), present on OK. */
    configVersion?: number
    diagnostics: readonly Diagnostic[]
}

/* ── little-endian reader ───────────────────────────────────────────────── */

class ByteReader {
    pos = 0
    constructor(private readonly b: Uint8Array) {}
    get length(): number {
        return this.b.length
    }
    remaining(): number {
        return this.b.length - this.pos
    }
    u8(): number {
        return this.b[this.pos++]
    }
    u16(): number {
        const v = this.b[this.pos] | (this.b[this.pos + 1] << 8)
        this.pos += 2
        return v
    }
    u32(): number {
        const v =
            (this.b[this.pos] |
                (this.b[this.pos + 1] << 8) |
                (this.b[this.pos + 2] << 16) |
                (this.b[this.pos + 3] << 24)) >>>
            0
        this.pos += 4
        return v
    }
    seek(p: number): void {
        this.pos = p
    }
}

/* ── reverse enum lookups ───────────────────────────────────────────────── */

// pattern-check: skip pure {name:number}→Map<number,name> inversion helper
function invert<T extends Record<string, number>>(o: T): Map<number, keyof T> {
    const m = new Map<number, keyof T>()
    for (const k in o) m.set(o[k], k)
    return m
}

const SYSTEM_BY_CODE = invert(SystemAction)
const MOUSE_BTN_BY_CODE = invert(MouseButtonCode)
const MOUSE_DIR_BY_CODE = invert(MouseDirCode)
const OUTPUT_BY_CODE = invert(OutputActionCode)
const LIGHT_ACTION_BY_CODE = invert(LightingActionCode)

// remappr_th_flavor → ZMK flavor string (the canonical model's vocabulary).
const FLAVOR_BY_CODE: Record<number, HoldTapFlavor> = {
    [Flavor.HoldPreferred]: 'hold-preferred',
    [Flavor.Balanced]: 'balanced',
    [Flavor.TapPreferred]: 'tap-preferred',
    [Flavor.TapUnlessInterrupted]: 'tap-unless-interrupted',
}

/** Keyboard-page HID usage → canonical key id, or null if not in the catalog. */
function usageToKey(usage: number): CanonicalKeyId | null {
    return HID_USAGE_DECODE.get((HID_PAGE_KEYBOARD << 16) | usage) ?? null
}

/** Single modifier-mask bit → Modifier (lowest set bit wins). */
function maskToMod(mask: number): Modifier | null {
    for (let i = 0; i < 8; i++) if (mask & (1 << i)) return MODIFIERS[i]
    return null
}

/** Modifier mask → Modifier[] (for KEY_MODS hold). */
function maskToMods(mask: number): Modifier[] {
    const out: Modifier[] = []
    for (let i = 0; i < 8; i++) if (mask & (1 << i)) out.push(MODIFIERS[i])
    return out
}

/* ── behavior record → CanonAction ──────────────────────────────────────── */

interface DecodeCtx {
    layerName: (i: number) => string
    macroRef: (i: number) => string
    diag: DiagnosticBag
    path: (string | number)[]
}

// Build a key_press, threading the original mods through (KEY_MODS).
function keyPress(usage: number, mods: Modifier[]): CanonKeyPress {
    const key = usageToKey(usage)
    const kp: CanonKeyPress = { type: 'key_press', key: key ?? '' }
    if (mods.length) kp.mods = mods
    return kp
}

// The inverse of lowerAction: one 16-byte behavior record → a CanonAction. Types
// the canonical model can't yet express (composites, the 23..36 vocabulary,
// extended system/mouse/lighting sub-codes) decode to `none` + a diagnostic.
function behaviorToAction(rec: BehaviorRecord, ctx: DecodeCtx): CanonAction {
    const { diag, path } = ctx
    const unmodeled = (what: string): CanonAction => {
        diag.warn(`behavior ${what} has no canonical form yet — decoded as none`, path)
        return { type: 'none' }
    }
    const keyOf = (usage: number): CanonicalKeyId | null => {
        const k = usageToKey(usage)
        if (k === null)
            diag.warn(`unknown keyboard usage 0x${usage.toString(16)}`, path)
        return k
    }

    switch (rec.type) {
        case BehaviorType.None:
            return { type: 'none' }
        case BehaviorType.Trans:
            return { type: 'transparent' }
        case BehaviorType.Key: {
            const k = keyOf(rec.tap)
            return k ? { type: 'key_press', key: k } : { type: 'none' }
        }
        case BehaviorType.KeyMods: {
            const k = keyOf(rec.tap)
            return k ? keyPress(rec.tap, maskToMods(rec.hold)) : { type: 'none' }
        }
        case BehaviorType.ModTap: {
            const k = keyOf(rec.tap)
            const mod = maskToMod(rec.hold)
            if (!k || !mod) return unmodeled('mod_tap')
            return tapHold(k, { type: 'modifier', modifier: mod }, rec)
        }
        case BehaviorType.LayerTap: {
            const k = keyOf(rec.tap)
            if (!k) return { type: 'none' }
            return tapHold(
                k,
                { type: 'layer', layer: ctx.layerName(rec.hold) },
                rec,
            )
        }
        case BehaviorType.Momentary:
            return { type: 'layer', mode: 'momentary', layer: ctx.layerName(rec.hold) }
        case BehaviorType.To:
            return { type: 'layer', mode: 'to', layer: ctx.layerName(rec.hold) }
        case BehaviorType.ToggleLayer:
            return { type: 'layer', mode: 'toggle', layer: ctx.layerName(rec.hold) }
        case BehaviorType.StickyLayer:
            return { type: 'layer', mode: 'sticky', layer: ctx.layerName(rec.hold) }
        case BehaviorType.StickyMod: {
            const mod = maskToMod(rec.hold)
            if (!mod) return unmodeled('sticky_mod')
            // The sticky_key canonical form names the modifier *key* (e.g.
            // key.keyboard_left_shift), whose usage is 0xE0 + bit index.
            const usage = 0xe0 + MODIFIERS.indexOf(mod)
            const k = usageToKey(usage)
            return k ? { type: 'sticky_key', key: k } : unmodeled('sticky_mod')
        }
        case BehaviorType.KeyToggle: {
            const k = keyOf(rec.tap)
            return k ? { type: 'key_toggle', key: k } : { type: 'none' }
        }
        case BehaviorType.KeyRepeat:
            return { type: 'key_repeat' }
        case BehaviorType.CapsWord:
            return { type: 'caps_word' }
        case BehaviorType.Macro:
            return { type: 'macro', ref: ctx.macroRef(rec.tap) }
        case BehaviorType.System: {
            const name = SYSTEM_BY_CODE.get(rec.tap)
            if (name === 'reset') return { type: 'reset' }
            if (name === 'bootloader') return { type: 'bootloader' }
            if (name === 'soft_off') return { type: 'soft_off' }
            if (name === 'ext_power_toggle')
                return { type: 'ext_power', action: 'toggle' }
            return unmodeled(`system(${name ?? rec.tap})`)
        }
        case BehaviorType.Mouse: {
            if (rec.tap === MouseOp.key) {
                const btn = MOUSE_BTN_BY_CODE.get(rec.hold)
                return btn
                    ? { type: 'mouse_key', button: btn as MouseButton }
                    : unmodeled('mouse_key')
            }
            if (rec.tap === MouseOp.move) {
                const dir = MOUSE_DIR_BY_CODE.get(rec.hold)
                return dir
                    ? { type: 'mouse_move', direction: dir as Direction }
                    : unmodeled('mouse_move')
            }
            if (rec.tap === MouseOp.scroll) {
                const dir = MOUSE_DIR_BY_CODE.get(rec.hold)
                return dir
                    ? { type: 'mouse_scroll', direction: dir as Direction }
                    : unmodeled('mouse_scroll')
            }
            return unmodeled('mouse_dragscroll')
        }
        case BehaviorType.Output: {
            const action = OUTPUT_BY_CODE.get(rec.tap)
            if (!action) return unmodeled('output')
            const out: CanonAction = {
                type: 'output',
                action: action as OutputAction,
            }
            if (rec.hold !== OUTPUT_NO_PROFILE) out.profile = rec.hold
            return out
        }
        case BehaviorType.Lighting: {
            const action = LIGHT_ACTION_BY_CODE.get(rec.tap) as
                | LightingAction
                | undefined
            const target = LIGHTING_TARGET_BY_CODE.get(rec.hold) as
                | LightingTarget
                | undefined
            if (!action || !target) return unmodeled('lighting')
            const lit: Extract<CanonAction, { type: 'lighting' }> = {
                type: 'lighting',
                target,
                action,
            }
            if (rec.tap === LightingActionCode.color) {
                lit.hue = rec.tappingTermMs
                lit.saturation = rec.quickTapMs
                lit.brightness = rec.requirePriorIdleMs
            } else if (rec.tap === LightingActionCode.set) {
                lit.level = rec.requirePriorIdleMs
            }
            return lit
        }
        default:
            // AUTO_SHIFT(20), LEADER(21), and the 23..36 vocabulary have no
            // canonical authoring form yet (firmware engine-complete; app model
            // pending). Decode as none so the keymap still forms.
            return unmodeled(`type ${rec.type}`)
    }
}

// LIGHTING target inversion can't use the shared `invert` helper directly
// because the canonical union only models underglow/backlight/per_key (no
// INDICATOR). Drop indicator here so a stray one decodes to `unmodeled`.
const LIGHTING_TARGET_BY_CODE = new Map<number, string>([
    [LightingTargetCode.underglow, 'underglow'],
    [LightingTargetCode.backlight, 'backlight'],
    [LightingTargetCode.per_key, 'per_key'],
])

function tapHold(
    tapKey: CanonicalKeyId,
    hold: Extract<CanonAction, { type: 'tap_hold' }>['hold'],
    rec: BehaviorRecord,
): CanonAction {
    const th: Extract<CanonAction, { type: 'tap_hold' }> = {
        type: 'tap_hold',
        tap: { type: 'key_press', key: tapKey },
        hold,
        flavor: FLAVOR_BY_CODE[rec.flavor] ?? 'balanced',
    }
    if (rec.tappingTermMs) th.tappingTermMs = rec.tappingTermMs
    if (rec.quickTapMs) th.quickTapMs = rec.quickTapMs
    return th
}

/* ── table walk ─────────────────────────────────────────────────────────── */

interface TableFrame {
    id: number
    version: number
    start: number // payload start
    end: number // payload end (exclusive)
}

function parseBehaviorRecord(r: ByteReader): BehaviorRecord {
    const type = r.u8()
    const flavor = r.u8()
    const flags = r.u8()
    const subCount = r.u8()
    const tap = r.u16()
    const hold = r.u16()
    const tappingTermMs = r.u16()
    const quickTapMs = r.u16()
    const requirePriorIdleMs = r.u16()
    const subIndex = r.u16()
    return {
        type,
        flavor,
        flags,
        subCount,
        tap,
        hold,
        tappingTermMs,
        quickTapMs,
        requirePriorIdleMs,
        subIndex,
    }
}

/**
 * Decode an RMBC blob into a canonical ConfigKeymap. Validates the 20-byte
 * header (magic / min_reader / CRC32-over-body) exactly like the firmware, then
 * walks the table frames. Header-level failures return a `code` and no config;
 * intra-table reference issues surface as diagnostics with a best-effort config.
 */
export function decodeRemapprBlob(bytes: Uint8Array): DecodeResult {
    const diag = new DiagnosticBag()
    const fail = (code: DecodeCodeValue): DecodeResult => ({
        code,
        diagnostics: diag.all,
    })

    // ── header ──
    if (bytes.length < BLOB_HEADER_LEN) return fail(DecodeCode.TRUNCATED)
    const h = new ByteReader(bytes)
    const magic = h.u32()
    if (magic !== BLOB_MAGIC) return fail(DecodeCode.MAGIC)
    const schemaVersion = h.u16()
    const minReader = h.u16()
    if (minReader > BLOB_READER_VERSION) return fail(DecodeCode.READER_VER)
    const configVersion = h.u32()
    const bodyLen = h.u32()
    const crcStored = h.u32()
    if (bodyLen > bytes.length - BLOB_HEADER_LEN) return fail(DecodeCode.TRUNCATED)
    const body = bytes.subarray(BLOB_HEADER_LEN, BLOB_HEADER_LEN + bodyLen)
    if (crc32(body) !== crcStored) return fail(DecodeCode.CRC)

    // ── table frames ──
    const frames: TableFrame[] = []
    let off = BLOB_HEADER_LEN
    const bodyEnd = BLOB_HEADER_LEN + bodyLen
    while (off + 8 <= bodyEnd) {
        const fr = new ByteReader(bytes)
        fr.seek(off)
        const id = fr.u16()
        const version = fr.u16()
        const len = fr.u32()
        const start = off + 8
        if (start + len > bodyEnd) return fail(DecodeCode.TABLE_FRAME)
        frames.push({ id, version, start, end: start + len })
        off = start + len
    }
    const table = (id: number): TableFrame | undefined =>
        frames.find((f) => f.id === id)

    // ── LAYER (required) ──
    const layerT = table(TableId.Layer)
    if (!layerT) return fail(DecodeCode.MISSING)
    if (layerT.version !== 1) return fail(DecodeCode.TABLE_VER)
    if (layerT.end - layerT.start < 8) return fail(DecodeCode.TABLE_FRAME)
    const lr = new ByteReader(bytes)
    lr.seek(layerT.start)
    const numLayers = lr.u16()
    const numPositions = lr.u16()
    const defaultTermMs = lr.u16()
    lr.u16() // release_debounce_ms — not modeled in ConfigDefaults
    if (numLayers === 0 || numPositions === 0) return fail(DecodeCode.BOUNDS)

    // ── BEHAVIOR (required) ──
    const behT = table(TableId.Behavior)
    if (!behT) return fail(DecodeCode.MISSING)
    if (behT.version !== 1) return fail(DecodeCode.TABLE_VER)
    const behaviors = readRecordTable(bytes, behT)
    if (behaviors === null) return fail(DecodeCode.TABLE_FRAME)

    // ── BINDING (required, exact length, layer-major) ──
    const bindT = table(TableId.Binding)
    if (!bindT) return fail(DecodeCode.MISSING)
    if (bindT.version !== 1) return fail(DecodeCode.TABLE_VER)
    const numCells = numLayers * numPositions
    if (bindT.end - bindT.start !== numCells * 2) return fail(DecodeCode.TABLE_FRAME)
    const cells: number[] = []
    const br = new ByteReader(bytes)
    br.seek(bindT.start)
    for (let i = 0; i < numCells; i++) {
        const idx = br.u16()
        if (idx >= behaviors.length) {
            diag.error(`binding cell ${i} references behavior ${idx} (only ${behaviors.length})`)
            cells.push(0)
        } else {
            cells.push(idx)
        }
    }

    // ── MACRO (optional) → synthetic CanonMacro[] ──
    const macroT = table(TableId.Macro)
    const macros = macroT ? readMacros(bytes, macroT, diag) : []

    const layerName = (i: number): string =>
        i >= 0 && i < numLayers ? `Layer ${i}` : `Layer ${i}`
    const macroRef = (i: number): string =>
        i >= 0 && i < macros.length ? macros[i].id : `macro_${i}`

    // ── behaviors → CanonAction per cell, sliced into layers ──
    const ctx: DecodeCtx = { layerName, macroRef, diag, path: [] }
    const decoded = behaviors.map((rec, i) =>
        behaviorToAction(rec, { ...ctx, path: ['behaviors', i] }),
    )
    const layers: CanonLayer[] = []
    for (let li = 0; li < numLayers; li++) {
        const bindings: CanonAction[] = []
        for (let pos = 0; pos < numPositions; pos++) {
            bindings.push(decoded[cells[li * numPositions + pos]])
        }
        layers.push({ name: `Layer ${li}`, bindings })
    }

    // ── COMBO (optional) ──
    const comboT = table(TableId.Combo)
    const combos = comboT
        ? readCombos(bytes, comboT, decoded, layerName, diag)
        : []

    // ── CONDITIONAL (optional) ──
    const condT = table(TableId.Conditional)
    const conditionalLayers = condT ? readConditionals(bytes, condT, layerName) : []

    // ── synthesize keyboard geometry (real layout comes from GET_KEY_LAYOUT) ──
    const keys: CanonGeometry[] = Array.from({ length: numPositions }, (_, i) => ({
        x: i,
        y: 0,
        w: 1,
        h: 1,
        r: 0,
    }))

    const config: ConfigKeymap = {
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Decoded keymap', target: 'remappr', version: String(configVersion) },
        defaults: { tappingTermMs: defaultTermMs },
        keyboard: { id: 'decoded', name: 'Decoded', keys },
        layers,
        ...(combos.length ? { combos } : {}),
        ...(macros.length ? { macros } : {}),
        ...(conditionalLayers.length ? { conditionalLayers } : {}),
    }

    return { code: DecodeCode.OK, config, configVersion, diagnostics: diag.all }
}

/* ── per-table readers ──────────────────────────────────────────────────── */

// u16 count + count × 16-byte records (BEHAVIOR / SUBS framing). null on overrun.
function readRecordTable(bytes: Uint8Array, t: TableFrame): BehaviorRecord[] | null {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    if (t.start + 2 + count * 16 > t.end) return null
    const out: BehaviorRecord[] = []
    for (let i = 0; i < count; i++) out.push(parseBehaviorRecord(r))
    return out
}

// TBL_MACRO: u16 count + per macro { u16 num_steps, [v2: u8 flags, u8 pad],
// num_steps × {u8 op, u8 pad, u16 arg} }.
function readMacros(
    bytes: Uint8Array,
    t: TableFrame,
    diag: DiagnosticBag,
): CanonMacro[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const v2 = t.version >= 2
    const out: CanonMacro[] = []
    for (let mi = 0; mi < count; mi++) {
        const numSteps = r.u16()
        if (v2) {
            r.u8() // flags
            r.u8() // reserved
        }
        const steps: CanonMacroStep[] = []
        for (let si = 0; si < numSteps; si++) {
            const op = r.u8()
            r.u8() // pad
            const arg = r.u16()
            const step = macroStep(op, arg, diag)
            if (step) steps.push(step)
        }
        out.push({ id: `macro_${mi}`, params: 0, steps })
    }
    return out
}

function macroStep(
    op: number,
    arg: number,
    diag: DiagnosticBag,
): CanonMacroStep | null {
    if (op === MacroOp.Wait) return { type: 'wait', ms: arg }
    const key = usageToKey(arg)
    if (key === null) {
        diag.warn(`macro step usage 0x${arg.toString(16)} not in catalog`)
        return null
    }
    if (op === MacroOp.Tap) return { type: 'tap', key }
    if (op === MacroOp.Press) return { type: 'press', key }
    if (op === MacroOp.Release) return { type: 'release', key }
    return null
}

// TBL_COMBO: u16 count + per combo { u16 num_positions, u16 timeout, u8 layer,
// u8 pad, u16 output_index, num_positions × u16 position }.
function readCombos(
    bytes: Uint8Array,
    t: TableFrame,
    decoded: CanonAction[],
    layerName: (i: number) => string,
    diag: DiagnosticBag,
): CanonCombo[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const out: CanonCombo[] = []
    for (let ci = 0; ci < count; ci++) {
        const np = r.u16()
        const timeoutMs = r.u16()
        const layer = r.u8()
        r.u8() // pad
        const outIdx = r.u16()
        const keys: number[] = []
        for (let i = 0; i < np; i++) keys.push(r.u16())
        const action =
            outIdx < decoded.length ? decoded[outIdx] : ({ type: 'none' } as CanonAction)
        if (outIdx >= decoded.length)
            diag.error(`combo ${ci} output references behavior ${outIdx}`)
        const combo: CanonCombo = { name: `combo_${ci}`, keys, action, timeoutMs }
        if (layer !== 0xff) combo.layers = [layerName(layer)]
        out.push(combo)
    }
    return out
}

// TBL_CONDITIONAL: u16 count + per { u8 num_if, u8 then_layer, num_if × u8 }.
function readConditionals(
    bytes: Uint8Array,
    t: TableFrame,
    layerName: (i: number) => string,
): CanonConditionalLayer[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const out: CanonConditionalLayer[] = []
    for (let i = 0; i < count; i++) {
        const numIf = r.u8()
        const thenLayer = r.u8()
        const ifLayers: string[] = []
        for (let j = 0; j < numIf; j++) ifLayers.push(layerName(r.u8()))
        out.push({ ifLayers, thenLayer: layerName(thenLayer) })
    }
    return out
}
