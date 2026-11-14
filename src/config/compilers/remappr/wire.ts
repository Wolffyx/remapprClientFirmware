// Pattern check: no GoF pattern (-) — rejected — a hex codec and one merge rule
// for the `_wire` carry, shared by the decoder and the compiler; plain functions.
//
// The `_wire` carry (CanonWireCarry in config/types.ts). The decoder marks an
// action whose behavior record the canonical form cannot hold in full with the
// record itself; the compiler writes that record back, so a save keeps what a
// binding the user did not touch really does.

import { BehaviorFlags, type BehaviorRecord, BehaviorType } from './blobWriter'

const RECORD_LEN = 16

/** A behavior record as 32 hex chars, in wire order. */
export function recordToWire(r: BehaviorRecord): string {
    const b = new Uint8Array(RECORD_LEN)
    const dv = new DataView(b.buffer)
    b[0] = r.type
    b[1] = r.flavor
    b[2] = r.flags
    b[3] = r.subCount
    dv.setUint16(4, r.tap, true)
    dv.setUint16(6, r.hold, true)
    dv.setUint16(8, r.tappingTermMs, true)
    dv.setUint16(10, r.quickTapMs, true)
    dv.setUint16(12, r.requirePriorIdleMs, true)
    dv.setUint16(14, r.subIndex, true)
    return Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('')
}

/** The record a `_wire` string holds, or null when it is not one. */
export function wireToRecord(hex: string): BehaviorRecord | null {
    if (!/^[0-9a-f]{32}$/i.test(hex)) return null
    const b = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))
    const dv = new DataView(b.buffer)
    return {
        type: b[0],
        flavor: b[1],
        flags: b[2],
        subCount: b[3],
        tap: dv.getUint16(4, true),
        hold: dv.getUint16(6, true),
        tappingTermMs: dv.getUint16(8, true),
        quickTapMs: dv.getUint16(10, true),
        requirePriorIdleMs: dv.getUint16(12, true),
        subIndex: dv.getUint16(14, true),
    }
}

const TAP_HOLD_FLAGS = BehaviorFlags.RETRO_TAP | BehaviorFlags.HOLD_TRIGGER_ON_RELEASE
const MORPH_FLAGS = BehaviorFlags.MORPH_SUPPRESS_MODS | BehaviorFlags.MORPH_ANY_MOD

/** The flag bits each type's canonical form holds; every other bit is lost in
 *  decode (HOLD_WHILE_UNDECIDED above all). */
const MODELED_FLAGS: Readonly<Record<number, number>> = {
    [BehaviorType.ModTap]: TAP_HOLD_FLAGS,
    [BehaviorType.LayerTap]: TAP_HOLD_FLAGS,
    [BehaviorType.ModMorph]: MORPH_FLAGS,
}

const unmodeledFlags = (type: number, flags: number): number =>
    flags & ~(MODELED_FLAGS[type] ?? 0)

/** Sticky cells reuse tapping_term_ms as the one-shot release-after timeout,
 *  which `sticky_key` has no field for. */
const STICKY_TYPES: ReadonlySet<number> = new Set([
    BehaviorType.StickyMod,
    BehaviorType.StickyLayer,
    BehaviorType.StickyKey,
])

/** Types whose record names a layer, macro or sub-behavior by index. Written
 *  back verbatim, the index could point elsewhere once the config changes, so
 *  such a record is only carried when the canonical form kept its type. */
const INDEXED_TYPES: ReadonlySet<number> = new Set([
    BehaviorType.LayerTap,
    BehaviorType.Momentary,
    BehaviorType.To,
    BehaviorType.StickyLayer,
    BehaviorType.ModMorph,
    BehaviorType.TapDance,
    BehaviorType.Macro,
    BehaviorType.ToggleLayer,
    BehaviorType.LayerMod,
    BehaviorType.LayerTapToggle,
    BehaviorType.ToSaved,
    BehaviorType.AutoLayer,
])

/** Whether decoding `rec` to an action of type `decodedType` lost something a
 *  save would drop, and the record can be carried safely. */
export function needsWire(rec: BehaviorRecord, decodedType: string): boolean {
    if (decodedType === 'none') {
        return rec.type !== BehaviorType.None && !INDEXED_TYPES.has(rec.type)
    }
    if (unmodeledFlags(rec.type, rec.flags) !== 0) return true
    return STICKY_TYPES.has(rec.type) && rec.tappingTermMs !== 0
}

/**
 * The record to write for an action carrying `_wire`. When the canonical form
 * lost the type (it decoded as `none`), the carried record as is. Otherwise the
 * freshly lowered record, so every field the form holds (layer indices
 * included) is current, plus what the form has no slot for: the unmodeled flag
 * bits and a sticky cell's release-after.
 */
export function mergeWire(lowered: BehaviorRecord, wire: string): BehaviorRecord {
    const raw = wireToRecord(wire)
    if (!raw) return lowered
    if (lowered.type !== raw.type) return raw
    return {
        ...lowered,
        flags: lowered.flags | unmodeledFlags(raw.type, raw.flags),
        ...(STICKY_TYPES.has(raw.type) ? { tappingTermMs: raw.tappingTermMs } : {}),
    }
}
