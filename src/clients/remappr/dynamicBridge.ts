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
import type { CanonicalKeyId } from '../../catalog/types'
import type {
    CanonAction,
    CanonCombo,
    CanonMacro,
    CanonMacroStep,
    CanonTapDance,
    CanonTapDanceStep,
} from '../../config'
import type { ComboEntry, MacroAction, TapDanceEntry } from '../../types'

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

/** A macro step's keycode as the app holds it: the raw usage for a keyboard-page
 *  key (what KeycodeField and the recorder use), else the codec's packed
 *  (page<<16)|usage so a consumer key is not masked into a keyboard key.
 *  keyOfUsage reads both. 0 = not codec-encodable. */
function macroKeycodeOf(key: string): number {
    const packed = remapprCodec.encode(key)?.value ?? 0
    return packed >>> 16 === HID_PAGE_KEYBOARD ? packed & HID_USAGE_MASK : packed
}

type KeyStep = Extract<CanonMacroStep, { type: 'tap' | 'press' | 'release' }>

/** True when the app keycode can't name this step's key back (no codec entry,
 *  or it resolves to a different canonical id). */
function keyLost(s: KeyStep): boolean {
    return keyOfUsage(macroKeycodeOf(s.key)) !== s.key
}

const KEY_ACTION = { tap: 'tap', press: 'down', release: 'up' } as const
const KEY_VERB = { tap: 'Tap', press: 'Hold', release: 'Let go of' } as const
const KEY_PHRASE = { tap: 'taps', press: 'holds', release: 'lets go of' } as const

/** The locked (view-only) row for a step the editor can't change, or null. */
function lockedStep(s: CanonMacroStep): MacroAction | null {
    if (s.type === 'tap_time')
        return { kind: 'locked', label: 'Press time', value: `${s.ms} ms`, phrase: `sets the press time to ${s.ms} ms` }
    if (s.type === 'param') {
        const value = `parameter ${s.from ?? 1} to ${s.to ?? 1}`
        return { kind: 'locked', label: 'Use the key’s value', value, phrase: 'uses a value from the key it is on' }
    }
    if ((s.type === 'tap' || s.type === 'press' || s.type === 'release') && keyLost(s))
        return { kind: 'locked', label: KEY_VERB[s.type], value: s.key, phrase: `${KEY_PHRASE[s.type]} ${s.key}` }
    return null
}

// pattern-check: skip — bug fix: exhaustive macro-step mapper; pure data transform
/** A macro's canonical steps → the app's flat MacroAction buffer, one action per
 *  step. A step the editor can't change comes back as a `locked` action; such a
 *  macro is refused on save (see isRichMacro), so nothing is dropped. */
export function macroToActions(macro: CanonMacro): MacroAction[] {
    return macro.steps.map((s): MacroAction => {
        const locked = lockedStep(s)
        if (locked) return locked
        switch (s.type) {
            case 'tap':
            case 'press':
            case 'release':
                return { kind: KEY_ACTION[s.type], keycode: macroKeycodeOf(s.key) }
            case 'wait':
                return { kind: 'delay', ms: s.ms }
            case 'text':
                return { kind: 'text', text: s.text }
            case 'pause_for_release':
                return { kind: 'pause' }
            case 'call':
                return { kind: 'call', macro: s.macro }
            case 'param':
            case 'tap_time':
                throw new Error('unreachable: handled by lockedStep')
        }
    })
}

/** True when the app's macro editor can't round-trip this macro: it has a
 *  `param` or `tap_time` step, or a key the app keycode can't name back. Saving
 *  such a macro from the editor is refused, so nothing is silently dropped. */
export function isRichMacro(macro: CanonMacro): boolean {
    return macro.steps.some((s) => lockedStep(s) !== null)
}

const LOCKED_FEATURE: Record<string, string> = {
    tap_time: 'a custom press time',
    param: 'a value from the key the macro is on',
}

/** Plain-language reason a rich macro is view only, naming its locked steps
 *  ("Steps 2 and 3 use a custom press time and …"), or null when editable. */
export function macroBlockedReason(macro: CanonMacro): string | null {
    const locked = macro.steps.flatMap((s, i) => (lockedStep(s) ? [{ s, n: i + 1 }] : []))
    if (locked.length === 0) return null
    const many = locked.length > 1
    const features = [
        ...new Set(locked.map(({ s }) => LOCKED_FEATURE[s.type] ?? 'a key this editor can’t name')),
    ]
    const it = many ? 'them' : 'it'
    return (
        `${many ? 'Steps' : 'Step'} ${andList(locked.map(({ n }) => String(n)))} ` +
        `${many ? 'use' : 'uses'} ${andList(features)}. This editor can show ${it} but ` +
        `can’t change ${it} yet, so the whole macro is view only to keep ${it} safe.`
    )
}

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
    if (items.length < 2) return items.join('')
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Which macros `id` may call, and why each other one can't be: itself, a
 *  parameterized macro (it has no record of its own to run), or one that
 *  already reaches `id` through its own calls (the call would loop). Mirrors
 *  the compile's refusals. */
export function callTargets(
    macros: readonly CanonMacro[],
    id: string,
): { allowed: string[]; excluded: { macro: string; reason: string }[] } {
    const byId = new Map(macros.map((m) => [m.id, m]))
    const reaches = (from: string, seen: Set<string>): boolean => {
        if (from === id) return true
        if (seen.has(from)) return false
        seen.add(from)
        const steps = byId.get(from)?.steps ?? []
        return steps.some((s) => s.type === 'call' && reaches(s.macro, seen))
    }
    const why = (m: CanonMacro): string | null => {
        if (m.id === id) return 'is this macro.'
        if (m.params) return 'needs a value from the key it’s on.'
        if (reaches(m.id, new Set())) return 'already runs this macro, so they would run each other forever.'
        return null
    }
    const allowed: string[] = []
    const excluded: { macro: string; reason: string }[] = []
    for (const m of macros) {
        const reason = why(m)
        if (reason) excluded.push({ macro: m.id, reason })
        else allowed.push(m.id)
    }
    return { allowed, excluded }
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
 *  macroToActions). `orig` is the macro being edited: its other fields (params,
 *  description, private…) carry over, and so does each key's source spelling.
 *  Unmappable keycodes are dropped; `text` passes through for the compiler to
 *  expand. */
// pattern-check: skip — type-narrowing bug fix on an existing mapper signature
export function actionsToMacro(orig: CanonMacro, actions: MacroAction[]): CanonMacro {
    const keySrc = new Map<string, string>()
    for (const s of orig.steps) {
        if ('_keySrc' in s && s._keySrc !== undefined) keySrc.set(s.key, s._keySrc)
    }
    const steps: CanonMacroStep[] = []
    for (const a of actions) {
        switch (a.kind) {
            case 'tap':
            case 'down':
            case 'up': {
                const key = keyOfUsage(a.keycode)
                if (!key) break
                const type = a.kind === 'tap' ? 'tap' : a.kind === 'down' ? 'press' : 'release'
                const src = keySrc.get(key)
                steps.push(src === undefined ? { type, key } : { type, key, _keySrc: src })
                break
            }
            case 'delay':
                steps.push({ type: 'wait', ms: a.ms })
                break
            case 'text':
                steps.push({ type: 'text', text: a.text })
                break
            case 'pause':
                steps.push({ type: 'pause_for_release' })
                break
            case 'call':
                steps.push({ type: 'call', macro: a.macro })
                break
            case 'locked':
                // Display only: a macro with locked steps is refused before here.
                break
        }
    }
    return { ...orig, steps }
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
