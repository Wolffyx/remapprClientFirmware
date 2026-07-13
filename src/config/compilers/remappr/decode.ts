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
    CanonActionBinding,
    CanonSemanticAction,
    CanonCombo,
    CanonConditionalLayer,
    CanonEncoderBinding,
    CanonGeometry,
    CanonKeyPress,
    CanonKeyOverride,
    CanonLayer,
    CanonLeaderSequence,
    CanonMacro,
    CanonMacroStep,
    CanonModMorph,
    CanonTapDance,
    CanonTapDanceStep,
    ConfigKeymap,
    ConfigMouse,
    ConfigNode,
    Direction,
    HoldTapFlavor,
    LightingAction,
    LightingTarget,
    LockAction as CanonLockAction,
    MouseButton,
    OutputAction,
    PeripheralKind as CanonPeripheralKind,
} from '../../types'
import {
    BehaviorType,
    BehaviorFlags,
    BLOB_HEADER_LEN,
    BLOB_MAGIC,
    BLOB_READER_VERSION,
    crc32,
    Flavor,
    LightingActionCode,
    LightingTargetCode,
    LockAction,
    MacroOp,
    MouseButtonCode,
    MouseDirCode,
    MouseOp,
    NameKind,
    OUTPUT_NO_PROFILE,
    OutputActionCode,
    PeripheralKind,
    SystemAction,
    TableId,
    type BehaviorRecord,
} from './blobWriter'

const HID_PAGE_KEYBOARD = 7
const HID_PAGE_CONSUMER = 12
const HID_PAGE_SYSTEM = 1

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

/** Consumer-page HID usage → canonical key id, or null if not in the catalog. */
function consumerUsageToKey(usage: number): CanonicalKeyId | null {
    return HID_USAGE_DECODE.get((HID_PAGE_CONSUMER << 16) | usage) ?? null
}

/** GD System-Control HID usage → canonical key id, or null if not in catalog. */
function systemUsageToKey(usage: number): CanonicalKeyId | null {
    return HID_USAGE_DECODE.get((HID_PAGE_SYSTEM << 16) | usage) ?? null
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
    /** The decoded SUBS pool a composite record's sub_index/sub_count slices. */
    subs: BehaviorRecord[]
    /** Composite definitions reconstructed while walking the BEHAVIOR table; a
     *  TAP_DANCE / MOD_MORPH cell decodes to a `ref` into these and pushes the
     *  reconstructed def here (keyed unique by sub_index). */
    tapDances: CanonTapDance[]
    modMorphs: CanonModMorph[]
    /** Real DT names from TBL_NAMES, keyed by sub_index (§24). Return the name
     *  when present so the def id (and every binding ref) is the real label
     *  instead of the synthetic td_N / mm_N. */
    tdName: (subIndex: number) => string | undefined
    mmName: (subIndex: number) => string | undefined
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
        case BehaviorType.Consumer: {
            const k = consumerUsageToKey(rec.tap)
            if (k === null) {
                diag.warn(`unknown consumer usage 0x${rec.tap.toString(16)}`, path)
                return { type: 'none' }
            }
            return { type: 'key_press', key: k }
        }
        case BehaviorType.SysCtrl: {
            const k = systemUsageToKey(rec.tap)
            if (k === null) {
                diag.warn(
                    `unknown system-control usage 0x${rec.tap.toString(16)}`,
                    path,
                )
                return { type: 'none' }
            }
            return { type: 'key_press', key: k }
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
        case BehaviorType.StickyKey: {
            // One-shot non-mod key (BH_STICKY_KEY); the modifier form decodes
            // from StickyMod above — both round-trip to canonical sticky_key.
            const k = keyOf(rec.tap)
            return k ? { type: 'sticky_key', key: k } : unmodeled('sticky_key')
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
            if (name === 'ext_power_on')
                return { type: 'ext_power', action: 'on' }
            if (name === 'ext_power_off')
                return { type: 'ext_power', action: 'off' }
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
        // pattern-check: skip — §5.2 behavior_type 20..36 → CanonAction reversal
        case BehaviorType.AutoShift: {
            const k = keyOf(rec.tap)
            return k
                ? { type: 'auto_shift', key: k, mods: maskToMods(rec.hold) }
                : { type: 'none' }
        }
        case BehaviorType.AltRepeat:
            return { type: 'alt_repeat' }
        case BehaviorType.LayerLock:
            return { type: 'layer_lock' }
        case BehaviorType.LayerMod:
            return {
                type: 'layer_mod',
                layer: ctx.layerName(rec.hold),
                mods: maskToMods(rec.tap),
            }
        case BehaviorType.LayerTapToggle:
            return { type: 'tap_toggle', layer: ctx.layerName(rec.hold) }
        case BehaviorType.ToSaved:
            return { type: 'set_base_saved', layer: ctx.layerName(rec.hold) }
        case BehaviorType.AutoLayer:
            return { type: 'auto_layer', layer: ctx.layerName(rec.hold) }
        case BehaviorType.GuiLock: {
            const a = LOCK_BY_CODE.get(rec.tap)
            return a ? { type: 'gui_lock', action: a } : unmodeled('gui_lock')
        }
        case BehaviorType.Secure: {
            const a = LOCK_BY_CODE.get(rec.tap)
            return a ? { type: 'secure', action: a } : unmodeled('secure')
        }
        case BehaviorType.Autocorrect: {
            const a = LOCK_BY_CODE.get(rec.tap)
            return a
                ? { type: 'autocorrect', action: a }
                : unmodeled('autocorrect')
        }
        case BehaviorType.TuneTerm:
            return { type: 'tune_tap_term', ms: rec.tap }
        case BehaviorType.Unicode:
            return { type: 'unicode', codepoint: rec.tap }
        case BehaviorType.MacroRecord:
            return { type: 'macro_record', slot: rec.tap }
        case BehaviorType.MacroPlay:
            return { type: 'macro_play', slot: rec.tap }
        case BehaviorType.Leader:
            return rec.tap
                ? { type: 'leader', windowMs: rec.tap }
                : { type: 'leader' }
        case BehaviorType.Peripheral: {
            const kind = PERIPHERAL_BY_CODE.get(rec.tap)
            return kind
                ? { type: 'peripheral', kind, code: rec.hold }
                : unmodeled('peripheral')
        }
        case BehaviorType.TapDance:
            return decodeTapDance(rec, ctx)
        case BehaviorType.ModMorph:
            return decodeModMorph(rec, ctx)
        default:
            // Any extended sub-code with no standalone canonical form decodes to
            // none so the keymap still forms.
            return unmodeled(`type ${rec.type}`)
    }
}

// MOD_MORPH (9) / TAP_DANCE (10) → a `ref` into a reconstructed definition. The
// firmware carries no name, so the ref is synthesized from the sub_index (unique
// per composite — distinct composites own distinct, non-overlapping sub slices).
function decodeTapDance(rec: BehaviorRecord, ctx: DecodeCtx): CanonAction {
    const ref = ctx.tdName(rec.subIndex) ?? `td_${rec.subIndex}`
    const taps: CanonTapDanceStep[] = []
    for (let i = 0; i < rec.subCount; i++) {
        const sub = ctx.subs[rec.subIndex + i]
        if (!sub) {
            ctx.diag.error(
                `tap_dance sub ${rec.subIndex + i} out of range`,
                ctx.path,
            )
            break
        }
        taps.push({
            count: i + 1,
            action: behaviorToAction(sub, {
                ...ctx,
                path: [...ctx.path, 'taps', i + 1],
            }),
        })
    }
    const def: CanonTapDance = { id: ref, taps }
    if (rec.tappingTermMs) def.tappingTermMs = rec.tappingTermMs
    ctx.tapDances.push(def)
    return { type: 'tap_dance', ref }
}

// pattern-check: skip — decoder branch mirroring the encoder's morph shapes
function decodeModMorph(rec: BehaviorRecord, ctx: DecodeCtx): CanonAction {
    const ref = ctx.mmName(rec.subIndex) ?? `mm_${rec.subIndex}`
    const sub0 = ctx.subs[rec.subIndex]
    const sub1 = ctx.subs[rec.subIndex + 1]
    if (rec.subCount < 2 || !sub0 || !sub1) {
        ctx.diag.error(`mod_morph "${ref}" needs two sub-behaviors`, ctx.path)
        return { type: 'none' }
    }
    // The exact shape the encoder emits for grave_escape (ANY-mod morph over
    // Shift|GUI, Esc → grave, no suppression) round-trips to the canonical
    // grave_escape token instead of a synthetic mod_morph def.
    if (
        (rec.flags & BehaviorFlags.MORPH_ANY_MOD) !== 0 &&
        rec.hold === 0xaa &&
        !(rec.flags & BehaviorFlags.MORPH_SUPPRESS_MODS) &&
        sub0.type === BehaviorType.Key &&
        sub0.tap === 0x29 &&
        sub1.type === BehaviorType.Key &&
        sub1.tap === 0x35
    )
        return { type: 'grave_escape' }
    if (rec.flags & BehaviorFlags.MORPH_ANY_MOD)
        ctx.diag.warn(
            `mod_morph "${ref}" uses ANY-mod matching — the canonical schema ` +
                `models only ALL-mod morphs; decoding as ALL`,
            ctx.path,
        )
    const mods = maskToMods(rec.hold)
    const def: CanonModMorph = {
        id: ref,
        mods,
        bindings: [
            behaviorToAction(sub0, { ...ctx, path: [...ctx.path, 'bindings', 0] }),
            behaviorToAction(sub1, { ...ctx, path: [...ctx.path, 'bindings', 1] }),
        ],
    }
    // No SUPPRESS flag ⇒ the trigger mods passed through (ZMK keep-mods = all).
    // An explicit suppress mask in `tap` keeps the mods OUTSIDE that mask.
    if (!(rec.flags & BehaviorFlags.MORPH_SUPPRESS_MODS)) def.keepMods = mods
    else if (rec.tap !== 0 && (rec.hold & ~rec.tap) !== 0)
        def.keepMods = maskToMods(rec.hold & ~rec.tap)
    ctx.modMorphs.push(def)
    return { type: 'mod_morph', ref }
}

// LIGHTING target inversion can't use the shared `invert` helper directly
// because the canonical union only models underglow/backlight/per_key (no
// INDICATOR). Drop indicator here so a stray one decodes to `unmodeled`.
const LIGHTING_TARGET_BY_CODE = new Map<number, string>([
    [LightingTargetCode.underglow, 'underglow'],
    [LightingTargetCode.backlight, 'backlight'],
    [LightingTargetCode.per_key, 'per_key'],
])

// pattern-check: skip — inverse code→name maps mirroring the encoder enums
const LOCK_BY_CODE = new Map<number, CanonLockAction>(
    (Object.entries(LockAction) as [CanonLockAction, number][]).map(
        ([name, code]) => [code, name],
    ),
)
const PERIPHERAL_BY_CODE = new Map<number, CanonPeripheralKind>(
    (Object.entries(PeripheralKind) as [CanonPeripheralKind, number][]).map(
        ([name, code]) => [code, name],
    ),
)

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
    if (rec.requirePriorIdleMs) th.requirePriorIdleMs = rec.requirePriorIdleMs
    if (rec.flags & BehaviorFlags.RETRO_TAP) th.retroTap = true
    if (rec.flags & BehaviorFlags.HOLD_TRIGGER_ON_RELEASE)
        th.holdTriggerOnRelease = true
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
    h.u16() // schema version — consumed to advance the reader; not otherwise used
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
    const releaseDebounceMs = lr.u16()
    // Optional §20 timing tail (dlen >= 14): engine eager-press debounce + the
    // matrix-scan debounce pair. 0 = keep the devicetree value.
    let pressDebounceMs = 0
    let matrixPressDebounceMs = 0
    let matrixReleaseDebounceMs = 0
    if (layerT.end - layerT.start >= 14) {
        pressDebounceMs = lr.u16()
        matrixPressDebounceMs = lr.u16()
        matrixReleaseDebounceMs = lr.u16()
    }
    // v3 engine timing tail (dlen >= 24): caps-word idle, sticky release-after
    // default, macro default wait/tap, matrix poll period. Read sequentially
    // after the v2 tail (cursor sits at byte 14). 0 = firmware default.
    let capsWordIdleMs = 0
    let stickyReleaseDefaultMs = 0
    let macroDefaultWaitMs = 0
    let macroDefaultTapMs = 0
    let matrixPollPeriodMs = 0
    if (layerT.end - layerT.start >= 24) {
        capsWordIdleMs = lr.u16()
        stickyReleaseDefaultMs = lr.u16()
        macroDefaultWaitMs = lr.u16()
        macroDefaultTapMs = lr.u16()
        matrixPollPeriodMs = lr.u16()
    }
    if (numLayers === 0 || numPositions === 0) return fail(DecodeCode.BOUNDS)

    // ── BEHAVIOR (required) ──
    const behT = table(TableId.Behavior)
    if (!behT) return fail(DecodeCode.MISSING)
    if (behT.version !== 1) return fail(DecodeCode.TABLE_VER)
    const behaviors = readRecordTable(bytes, behT)
    if (behaviors === null) return fail(DecodeCode.TABLE_FRAME)

    // ── SUBS (optional) — composite sub-behaviors (mod-morph / tap-dance) ──
    let subs: BehaviorRecord[] = []
    const subsT = table(TableId.Subs)
    if (subsT) {
        if (subsT.version !== 1) return fail(DecodeCode.TABLE_VER)
        const s = readRecordTable(bytes, subsT)
        if (s === null) return fail(DecodeCode.TABLE_FRAME)
        subs = s
    }

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

    // ── NAMES (optional, §24) → real DT labels for macros + composites ──
    const namesT = table(TableId.Names)
    const names = namesT
        ? readNames(bytes, namesT, diag)
        : {
              macros: new Map<number, string>(),
              tapDances: new Map<number, string>(),
              modMorphs: new Map<number, string>(),
          }
    // Rename macros in place so macroRef (and every macro binding) carries the
    // real name; tap-dance / mod-morph names resolve per-cell via ctx below.
    macros.forEach((m, i) => {
        const nm = names.macros.get(i)
        if (nm) m.id = nm
    })

    const layerName = (i: number): string =>
        i >= 0 && i < numLayers ? `Layer ${i}` : `Layer ${i}`
    const macroRef = (i: number): string =>
        i >= 0 && i < macros.length ? macros[i].id : `macro_${i}`

    // ── behaviors → CanonAction per cell, sliced into layers ──
    // Composite cells (mod-morph / tap-dance) reconstruct their definitions into
    // these accumulators as a side effect of decoding each behavior record.
    const tapDances: CanonTapDance[] = []
    const modMorphs: CanonModMorph[] = []
    const ctx: DecodeCtx = {
        layerName,
        macroRef,
        diag,
        path: [],
        subs,
        tapDances,
        modMorphs,
        tdName: (sub) => names.tapDances.get(sub),
        mmName: (sub) => names.modMorphs.get(sub),
    }
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

    // ── KEY_OVERRIDE (optional) ──
    const koT = table(TableId.KeyOverride)
    const keyOverrides = koT ? readKeyOverrides(bytes, koT, layerName, diag) : []

    // ── LEADER (optional) — output references the BEHAVIOR table (like combos) ──
    const leaderT = table(TableId.Leader)
    const leaderSequences = leaderT
        ? readLeaders(bytes, leaderT, decoded, diag)
        : []

    // ── POSHOLD (optional, §28) → restore holdTriggerKeyPositions on tap-holds ──
    const posholdT = table(TableId.Poshold)
    if (posholdT) readPosholds(bytes, posholdT, decoded, diag)

    // ── ENCODER (optional, §4a) → slot-array layer.encoders[] in place ──
    const encoderT = table(TableId.Encoder)
    if (encoderT) readEncoders(bytes, encoderT, decoded, layers, diag)

    // ── RGB (optional, id 7) → per-key colors (decode-only; preps Phase 4c emit) ──
    const rgbT = table(TableId.Rgb)
    const perKey = rgbT
        ? readRgb(bytes, rgbT, numLayers, numPositions, diag)
        : undefined

    // ── MOUSE (optional, id 8, §4b) → v2 node.mouse pointer settings ──
    const mouseT = table(TableId.Mouse)
    const mouse = mouseT ? readMouse(bytes, mouseT, diag) : undefined

    // ── PERSONALITY (optional, id 16, §4c) → v2 node.personality identity ──
    const personalityT = table(TableId.Personality)
    const personality = personalityT
        ? readPersonality(bytes, personalityT)
        : undefined

    // ── ACTION_BINDING (optional, id 17, §F) → top-level actionBindings[] ──
    const actionT = table(TableId.ActionBinding)
    const actionBindings = actionT ? readActionBindings(bytes, actionT) : []

    // Reassemble the v2 node section from its decoded parts (§4b mouse, §4c
    // personality). Only keyboard/mouse personalities have a firmware identity,
    // so an unknown code leaves personality undefined.
    const node: ConfigNode | undefined =
        mouse || personality
            ? {
                  ...(personality ? { personality } : {}),
                  ...(mouse ? { mouse } : {}),
              }
            : undefined

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
        defaults: {
            tappingTermMs: defaultTermMs,
            ...(releaseDebounceMs ? { releaseDebounceMs } : {}),
            ...(pressDebounceMs ? { pressDebounceMs } : {}),
            ...(matrixPressDebounceMs ? { matrixPressDebounceMs } : {}),
            ...(matrixReleaseDebounceMs ? { matrixReleaseDebounceMs } : {}),
            ...(capsWordIdleMs ? { capsWordIdleMs } : {}),
            ...(stickyReleaseDefaultMs ? { stickyReleaseDefaultMs } : {}),
            ...(macroDefaultWaitMs ? { macroDefaultWaitMs } : {}),
            ...(macroDefaultTapMs ? { macroDefaultTapMs } : {}),
            ...(matrixPollPeriodMs ? { matrixPollPeriodMs } : {}),
        },
        keyboard: {
            id: 'decoded',
            name: 'Decoded',
            keys,
            ...(perKey ? { lighting: { perKey } } : {}),
        },
        layers,
        ...(combos.length ? { combos } : {}),
        ...(tapDances.length ? { tapDances } : {}),
        ...(macros.length ? { macros } : {}),
        ...(modMorphs.length ? { modMorphs } : {}),
        ...(conditionalLayers.length ? { conditionalLayers } : {}),
        ...(keyOverrides.length ? { keyOverrides } : {}),
        ...(leaderSequences.length ? { leaderSequences } : {}),
        ...(actionBindings.length ? { actionBindings } : {}),
        ...(node ? { node } : {}),
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

// TBL_POSHOLD (§28): u16 count + per entry { u16 behavior_index, u8 num_positions,
// u8 pad, num_positions × u16 position }. Restores the position list onto the
// referenced decoded tap-hold (the inverse of blobWriter.posholdTable). Bounds-
// checked so a malformed/foreign blob can't throw: an overrun stops with a
// diagnostic; a dangling or non-tap-hold reference is reported and skipped.
function readPosholds(
    bytes: Uint8Array,
    t: TableFrame,
    decoded: CanonAction[],
    diag: DiagnosticBag,
): void {
    if (t.end - t.start < 2) return
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    for (let i = 0; i < count; i++) {
        if (r.pos + 4 > t.end) {
            diag.error('poshold table truncated')
            return
        }
        const behaviorIndex = r.u16()
        const num = r.u8()
        r.u8() // reserved
        if (r.pos + num * 2 > t.end) {
            diag.error(`poshold entry ${i} positions truncated`)
            return
        }
        const positions: number[] = []
        for (let p = 0; p < num; p++) positions.push(r.u16())
        const act = decoded[behaviorIndex]
        if (!act) {
            diag.error(
                `poshold entry references behavior ${behaviorIndex} ` +
                    `(only ${decoded.length})`,
            )
        } else if (act.type === 'tap_hold' && positions.length) {
            act.holdTriggerKeyPositions = positions
        }
    }
}

// pattern-check: skip — pure byte-triple → "#rrggbb" formatter
const rgbHex = (r: number, g: number, b: number): string =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

// TBL_RGB (id 7): 8-byte header { u8 mode, u8 flags(bit0=perLayer), u8 num_layers,
// u8 pad, u16 num_positions, u16 pad } + RGB888 colors row-major [layer][pos].
// Returns a sparse position→"#rrggbb" map from layer 0 (black/off omitted), or
// undefined for an effects-only (mode 0) / empty / truncated table. A per-layer
// table is collapsed to layer 0 with a diagnostic (per-layer authoring is Phase 4c).
function readRgb(
    bytes: Uint8Array,
    t: TableFrame,
    numLayers: number,
    numPositions: number,
    diag: DiagnosticBag,
): Record<number, string> | undefined {
    if (t.end - t.start < 8) {
        diag.error('rgb table header truncated')
        return undefined
    }
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const mode = r.u8()
    const perLayer = (r.u8() & 1) !== 0
    const hdrLayers = r.u8()
    r.u8() // pad
    const hdrPositions = r.u16()
    r.u16() // pad
    if (mode === 0) return undefined // effects-only: no per-key colors
    const layers = hdrLayers || numLayers
    const positions = hdrPositions || numPositions
    if (t.start + 8 + layers * positions * 3 > t.end) {
        diag.error('rgb color data truncated')
        return undefined
    }
    if (perLayer && layers > 1)
        diag.warn(
            'per-layer RGB decoded as layer 0 only (per-layer authoring is Phase 4c)',
        )
    const out: Record<number, string> = {}
    for (let pos = 0; pos < positions; pos++) {
        const rr = r.u8()
        const gg = r.u8()
        const bb = r.u8()
        if (rr || gg || bb) out[pos] = rgbHex(rr, gg, bb)
    }
    return Object.keys(out).length ? out : undefined
}

// TBL_MOUSE (id 8, §4b): u16 cpi, u16 auto_layer_timeout_ms, u8 accel_point_count,
// u8 flags, then N × { u16 speed_in, u16 mult_x100 }. Bounds-checked so a foreign
// or truncated blob can't throw; returns undefined when the table carries no
// pointer settings. The inverse of blobWriter.mouseTable / index.ts node.mouse.
function readMouse(
    bytes: Uint8Array,
    t: TableFrame,
    diag: DiagnosticBag,
): ConfigMouse | undefined {
    if (t.end - t.start < 6) {
        diag.error('mouse table header truncated')
        return undefined
    }
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const cpi = r.u16()
    const autoLayerTimeoutMs = r.u16()
    const count = r.u8()
    r.u8() // flags (reserved)
    if (t.start + 6 + count * 4 > t.end) {
        diag.error('mouse accel curve truncated')
        return undefined
    }
    const accel: Array<[number, number]> = []
    for (let i = 0; i < count; i++) {
        const speedIn = r.u16()
        const multX100 = r.u16()
        accel.push([speedIn, multX100])
    }
    const out: ConfigMouse = {}
    if (cpi) out.cpi = cpi
    if (autoLayerTimeoutMs) out.autoLayerTimeoutMs = autoLayerTimeoutMs
    if (accel.length) out.accel = accel
    return Object.keys(out).length ? out : undefined
}

// TBL_PERSONALITY (id 16, §4c): u8 personality + 3 reserved bytes. Only the
// keyboard/mouse identities have a firmware personality; any other code (unknown
// / recovery / reserved) decodes to undefined so it isn't reconstructed.
function readPersonality(
    bytes: Uint8Array,
    t: TableFrame,
): ConfigNode['personality'] | undefined {
    if (t.end - t.start < 1) return undefined
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const code = r.u8()
    return ({ 1: 'keyboard', 2: 'mouse' } as Record<
        number,
        ConfigNode['personality']
    >)[code]
}

interface DecodedNames {
    macros: Map<number, string>
    tapDances: Map<number, string>
    modMorphs: Map<number, string>
}

// TBL_NAMES (§24): u16 count + per entry { u8 kind, u8 reserved, u16 ref,
// u8 name_len, name_len × u8 UTF-8 }. Advisory display labels — bounds-checked
// so a malformed or foreign blob can't throw; unknown kinds + overruns skip.
function readNames(
    bytes: Uint8Array,
    t: TableFrame,
    diag: DiagnosticBag,
): DecodedNames {
    const out: DecodedNames = {
        macros: new Map(),
        tapDances: new Map(),
        modMorphs: new Map(),
    }
    if (t.end - t.start < 2) return out
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const dec = new TextDecoder()
    for (let i = 0; i < count; i++) {
        if (r.pos + 5 > t.end) {
            diag.warn('names table truncated')
            break
        }
        const kind = r.u8()
        r.u8() // reserved
        const ref = r.u16()
        const len = r.u8()
        if (r.pos + len > t.end) {
            diag.warn('name string overruns table')
            break
        }
        const name = dec.decode(bytes.subarray(r.pos, r.pos + len))
        r.seek(r.pos + len)
        if (!name) continue
        if (kind === NameKind.Macro) out.macros.set(ref, name)
        else if (kind === NameKind.TapDance) out.tapDances.set(ref, name)
        else if (kind === NameKind.ModMorph) out.modMorphs.set(ref, name)
        else diag.warn(`unknown name kind ${kind}`)
    }
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
    if (op === MacroOp.PauseForRelease) return { type: 'pause_for_release' }
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

// TBL_ENCODER (§4a): u16 count + per { u8 encoder_index, u8 layer, u16 cw, u16
// ccw, u16 press } — behavior indices into the decoded table, 0xFFFF = unbound.
// Reattaches to the slot-array layer.encoders[] form in place (mirrors how the
// lowering reads it), so the round-trip is byte-stable.
function readEncoders(
    bytes: Uint8Array,
    t: TableFrame,
    decoded: CanonAction[],
    layers: CanonLayer[],
    diag: DiagnosticBag,
): void {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const resolve = (
        idx: number,
        layer: number,
        dir: string,
    ): CanonAction | undefined => {
        if (idx === 0xffff) return undefined
        if (idx >= decoded.length) {
            diag.error(`encoder layer ${layer} ${dir} references behavior ${idx}`)
            return { type: 'none' } as CanonAction
        }
        return decoded[idx]
    }
    for (let i = 0; i < count; i++) {
        const encoderIndex = r.u8()
        const layer = r.u8()
        const cwIdx = r.u16()
        const ccwIdx = r.u16()
        const pressIdx = r.u16()
        const cw =
            resolve(cwIdx, layer, 'cw') ?? ({ type: 'none' } as CanonAction)
        const ccw =
            resolve(ccwIdx, layer, 'ccw') ?? ({ type: 'none' } as CanonAction)
        const press = resolve(pressIdx, layer, 'press')
        const binding: CanonEncoderBinding = press
            ? { cw, ccw, press }
            : { cw, ccw }
        if (layer >= layers.length) {
            diag.error(`encoder references layer ${layer} out of range`)
            continue
        }
        const lay = layers[layer]
        if (!lay.encoders) lay.encoders = []
        lay.encoders[encoderIndex] = binding
    }
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

// TBL_ACTION_BINDING (id 17, §F): u16 count + u16 num_positions, then count ×
// 10-byte records { u16 position, u8 kind, u8 reserved, u16 code, u16 arg0,
// u16 arg1 }. num_positions is implied by the keymap and not surfaced.
// pattern-check: skip pure per-record blob reader mirroring readConditionals, no abstraction
function readActionBindings(
    bytes: Uint8Array,
    t: TableFrame,
): CanonActionBinding[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    r.u16() // num_positions — implied by the keymap geometry
    const out: CanonActionBinding[] = []
    for (let i = 0; i < count; i++) {
        const position = r.u16()
        const kind = r.u8()
        r.u8() // reserved
        const code = r.u16()
        const arg0 = r.u16()
        const arg1 = r.u16()
        out.push({
            position,
            action: raiseSemanticAction(kind, code, arg0, arg1),
        })
    }
    return out
}

// Inverse of lowerSemanticAction (index.ts): the {kind, code, arg0, arg1} wire
// record → the discriminated CanonSemanticAction. Optional fields decode only
// when non-zero so a re-encode (which emits 0 for an absent field) stays
// byte-stable; an unknown kind decodes to `none` (an old reader skips a future
// kind rather than corrupting).
// pattern-check: skip pure wire-record→semantic-action unpacker, mirrors action.h
function raiseSemanticAction(
    kind: number,
    code: number,
    arg0: number,
    arg1: number,
): CanonSemanticAction {
    switch (kind) {
        case 1:
            return arg0 !== 0
                ? { kind: 'keyboard', usage: code, mods: arg0 }
                : { kind: 'keyboard', usage: code }
        case 2:
            return { kind: 'consumer', usage: code }
        case 3: {
            const a: Extract<CanonSemanticAction, { kind: 'pointer' }> = {
                kind: 'pointer',
                op: code,
            }
            if (arg0 !== 0) a.code = arg0
            if (arg1 !== 0) a.magnitude = arg1
            return a
        }
        case 4:
            return { kind: 'system', action: code }
        case 5:
            return arg0 !== 0xff /* REMAPPR_OUTPUT_NO_PROFILE */
                ? { kind: 'output', action: code, profile: arg0 }
                : { kind: 'output', action: code }
        case 6: {
            const a: Extract<CanonSemanticAction, { kind: 'lighting' }> = {
                kind: 'lighting',
                action: code & 0xff,
                target: (code >> 8) & 0xff,
            }
            const sat = arg1 & 0xff
            const val = (arg1 >> 8) & 0xff
            if (arg0 !== 0) a.hue = arg0
            if (sat !== 0) a.sat = sat
            if (val !== 0) a.val = val
            return a
        }
        default:
            return { kind: 'none' }
    }
}

// TBL_KEY_OVERRIDE: u16 count + count × 8-byte { u8 trigger, u8 trigger_mods,
// u8 negative_mods, u8 suppressed_mods, u8 replacement, u8 replacement_mods,
// u16 layers }. Optional masks/keys decode only when non-zero so re-encode (which
// emits 0 for an absent field) stays byte-stable.
function readKeyOverrides(
    bytes: Uint8Array,
    t: TableFrame,
    layerName: (i: number) => string,
    diag: DiagnosticBag,
): CanonKeyOverride[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const out: CanonKeyOverride[] = []
    for (let i = 0; i < count; i++) {
        const trigger = r.u8()
        const triggerMods = r.u8()
        const negativeMods = r.u8()
        const suppressedMods = r.u8()
        const replacement = r.u8()
        const replacementMods = r.u8()
        const layersMask = r.u16()
        const triggerKey = usageToKey(trigger)
        if (triggerKey === null) {
            diag.warn(
                `key override ${i} trigger usage 0x${trigger.toString(16)} not in catalog`,
            )
            continue
        }
        const ko: CanonKeyOverride = {
            trigger: triggerKey,
            triggerMods: maskToMods(triggerMods),
        }
        if (negativeMods) ko.negativeMods = maskToMods(negativeMods)
        if (suppressedMods) ko.suppressedMods = maskToMods(suppressedMods)
        if (replacement) {
            const rk = usageToKey(replacement)
            if (rk) ko.replacement = rk
            else
                diag.warn(
                    `key override ${i} replacement usage 0x${replacement.toString(16)} not in catalog`,
                )
        }
        if (replacementMods) ko.replacementMods = maskToMods(replacementMods)
        if (layersMask) {
            const names: string[] = []
            for (let b = 0; b < 16; b++)
                if (layersMask & (1 << b)) names.push(layerName(b))
            ko.layers = names
        }
        out.push(ko)
    }
    return out
}

// TBL_LEADER: u16 count + per sequence { u8 num_usages, u8 pad, u16 output_idx,
// num_usages × u8 usage }. output_idx references the BEHAVIOR table (like combos).
function readLeaders(
    bytes: Uint8Array,
    t: TableFrame,
    decoded: CanonAction[],
    diag: DiagnosticBag,
): CanonLeaderSequence[] {
    const r = new ByteReader(bytes)
    r.seek(t.start)
    const count = r.u16()
    const out: CanonLeaderSequence[] = []
    for (let i = 0; i < count; i++) {
        const numUsages = r.u8()
        r.u8() // pad
        const outIdx = r.u16()
        const sequence: CanonicalKeyId[] = []
        for (let k = 0; k < numUsages; k++) {
            const key = usageToKey(r.u8())
            if (key) sequence.push(key)
            else diag.warn(`leader sequence ${i} usage not in catalog`)
        }
        const action =
            outIdx < decoded.length
                ? decoded[outIdx]
                : ({ type: 'none' } as CanonAction)
        if (outIdx >= decoded.length)
            diag.error(
                `leader sequence ${i} output references behavior ${outIdx}`,
            )
        out.push({ sequence, action })
    }
    return out
}
