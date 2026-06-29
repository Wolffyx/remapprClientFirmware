// pattern-check: skip — pure canonical→app-model mappers for the dynamic-entry
// facades (macros / tap-dance / combo), the dual of configBridge's keymap
// lower/raise. No GoF abstraction: a single concrete mapping per entry type.
//
// The app's MacroApi / DynamicEntriesApi speak the compact QMK/vial shapes
// (numeric keycode buffers, fixed 4-slot tap-dance, 4-key combos). The Remappr
// canonical model is richer (N-ary action-valued composites, nested macros), so
// these mappers are deliberately LOSSY for display: a tap-dance step or combo
// output that is not a plain key_press surfaces as keycode 0, and `isRichTapDance`
// flags an entry the 4-slot editor cannot round-trip so the UI shows it read-only
// (§24). The full definition always survives in the config (raise preserves it).
import type { CanonicalKeyId } from '../catalog/types'
import type {
    CanonAction,
    CanonCombo,
    CanonMacro,
    CanonMacroStep,
    CanonTapDance,
    CanonTapDanceStep,
} from '../config'
import type { ComboEntry, MacroAction, TapDanceEntry } from '../types'

import { remapprCodec } from './codec'

const HID_PAGE_KEYBOARD = 0x07

// pattern-check: skip — raw-HID masking fix to pure mappers, no abstraction
// The app's macro/dynamic editors speak raw HID usages (DOM_KEY_TO_HID: KeyC=6),
// matching the firmware blob's macro-step arg + tap-dance sub `tap`. The codec
// stores keycodes packed as (page<<16)|usage, so strip the page for these fields.
const HID_USAGE_MASK = 0xffff

/** Raw HID usage for a canonical key, or 0 if it isn't codec-encodable. */
function usageOfKey(key: string): number {
    return (remapprCodec.encode(key)?.value ?? 0) & HID_USAGE_MASK
}

/** Raw HID usage for a key_press action, or 0 for anything the compact app model
 *  can't name (so a richer action surfaces as an empty slot, not garbage). */
function usageOf(a: CanonAction | undefined): number {
    return a?.type === 'key_press' ? usageOfKey(a.key) : 0
}

/** A macro's canonical steps → the app's flat MacroAction buffer. */
export function macroToActions(macro: CanonMacro): MacroAction[] {
    return macro.steps.map((s): MacroAction => {
        switch (s.type) {
            case 'tap':
                return { kind: 'tap', keycode: usageOfKey(s.key) }
            case 'press':
                return { kind: 'down', keycode: usageOfKey(s.key) }
            case 'release':
                return { kind: 'up', keycode: usageOfKey(s.key) }
            case 'wait':
                return { kind: 'delay', ms: s.ms }
        }
    })
}

/** True when a tap-dance can't be faithfully shown in the app's 4-slot editor:
 *  more than two tap counts, or any tap whose action isn't a plain key_press
 *  (e.g. multitap_cx's 3rd tap = a nested macro). Such entries render read-only. */
export function isRichTapDance(td: CanonTapDance): boolean {
    if (td.hold) return true
    if (td.taps.some((t) => t.count > 2)) return true
    return td.taps.some((t) => t.action.type !== 'key_press')
}

/** Canonical tap-dance → the app's fixed 4-slot entry (lossy; see isRichTapDance).
 *  Remappr tap-dances are tap-count only, so the hold slots stay 0. */
export function tapDanceToEntry(td: CanonTapDance): TapDanceEntry {
    const at = (count: number): number =>
        usageOf(td.taps.find((t) => t.count === count)?.action)
    return {
        onTap: at(1),
        onHold: 0,
        onDoubleTap: at(2),
        onTapHold: 0,
        tappingTerm: td.tappingTermMs ?? 200,
    }
}

/** Canonical combo → the app's 4-key entry (extra positions/outputs dropped). */
export function comboToEntry(combo: CanonCombo): ComboEntry {
    const k = combo.keys
    return {
        keys: [k[0] ?? 0, k[1] ?? 0, k[2] ?? 0, k[3] ?? 0],
        output: usageOf(combo.action),
    }
}

/* ── reverse mappers (app model → canonical) for editing (§24) ──────────── */

// pattern-check: skip — raw HID usage → CanonicalKeyId, the inverse of usageOfKey
/** A raw HID usage (what the app sends) → CanonicalKeyId, or null if unknown.
 *  The codec is keyed by packed (page<<16)|usage, so pack the keyboard page. */
function keyOfUsage(usage: number): CanonicalKeyId | null {
    const packed = usage < 1 << 16 ? (HID_PAGE_KEYBOARD << 16) | usage : usage
    return remapprCodec.decode(packed)?.canonicalId ?? null
}

/** The app's MacroAction buffer → a canonical macro (the inverse of
 *  macroToActions). Unmappable keycodes are dropped; `text` passes through for
 *  the compiler to expand. */
export function actionsToMacro(
    id: string,
    params: number,
    actions: MacroAction[],
): CanonMacro {
    const steps: CanonMacroStep[] = []
    for (const a of actions) {
        switch (a.kind) {
            case 'tap':
            case 'down':
            case 'up': {
                const key = keyOfUsage(a.keycode)
                if (!key) break
                const type = a.kind === 'tap' ? 'tap' : a.kind === 'down' ? 'press' : 'release'
                steps.push({ type, key })
                break
            }
            case 'delay':
                steps.push({ type: 'wait', ms: a.ms })
                break
            case 'text':
                steps.push({ type: 'text', text: a.text })
                break
        }
    }
    return { id, params, steps }
}

/** The app's 4-slot entry → a canonical tap-dance (inverse of tapDanceToEntry,
 *  for simple non-rich entries only — see isRichTapDance). The hold slots have no
 *  Remappr equivalent and are dropped; a 0 keycode means that tap is unset. */
export function entryToTapDance(id: string, entry: TapDanceEntry): CanonTapDance {
    const taps: CanonTapDanceStep[] = []
    const push = (count: number, usage: number): void => {
        const key = keyOfUsage(usage)
        if (key) taps.push({ count, action: { type: 'key_press', key } })
    }
    push(1, entry.onTap)
    push(2, entry.onDoubleTap)
    const td: CanonTapDance = { id, taps }
    if (entry.tappingTerm) td.tappingTermMs = entry.tappingTerm
    return td
}
