// Pattern check: Dispatch Map (Tier 0) — applied — one text builder per action
// type that reads better spelled out; every other type reads as its name plus
// its fields, so a new action type needs no entry here.
//
// Short human text for a canonical action, for the History diff ("A" → "Ctrl+C").
// Key presses reuse the surface spelling serialize writes (`denormalizeAction`:
// friendly key names, "Ctrl+C" chords); the rest name the action and its
// fields. Personality-neutral: nothing here knows a firmware. Total: a malformed
// action still gets a text.
import {
    asArray,
    asRecord,
    asText,
    extrasText,
    isRecord,
    omit,
    type Rec,
    valueText,
    visibleEntries,
} from './diffCore'
import { friendlyName, MODIFIERS, type Modifier } from './keycodes'
import { denormalizeAction, FRIENDLY_MOD } from './serialize'
import type { CanonKeyPress } from './types'

const isModifier = (m: unknown): m is Modifier =>
    MODIFIERS.includes(m as Modifier)

/** A canonical key id as its friendly name ("key.keyboard_a" → "A"). */
export const keyName = (id: unknown): string =>
    typeof id === 'string' ? friendlyName(id) : '?'

/** "Ctrl+C", the way the surface JSON writes a key press. */
export function keyPressText(a: unknown): string {
    const r = asRecord(a)
    if (typeof r.key !== 'string') return '?'
    const kp: CanonKeyPress = {
        type: 'key_press',
        key: r.key,
        mods: asArray(r.mods).filter(isModifier),
    }
    const surface = denormalizeAction(kp)
    return typeof surface === 'string' ? surface : valueText(surface)
}

/** What a hold does: a modifier ("Ctrl") or a layer ("layer Nav"). */
export function holdText(h: unknown): string {
    const r = asRecord(h)
    if (isModifier(r.modifier)) return FRIENDLY_MOD[r.modifier]
    if (r.layer !== undefined) return `layer ${asText(r.layer, '?')}`
    return valueText(h)
}

const LAYER_MODE: Record<string, string> = {
    momentary: 'Hold layer',
    toggle: 'Toggle layer',
    to: 'To layer',
    sticky: 'Sticky layer',
}

const KEY_FIELDS = new Set(['key', 'param', 'trigger', 'replacement'])

const humanType = (type: string): string => {
    const words = type.replace(/_/g, ' ').trim()
    return words ? words[0].toUpperCase() + words.slice(1) : 'Action'
}

/** Name + string fields as words, other fields in parentheses:
 *  "Mouse key left", "Output bt sel (profile: 1)". */
function genericText(a: Rec): string {
    const fields = visibleEntries(omit(a, ['type']))
    const words = fields
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => (KEY_FIELDS.has(k) ? keyName(v) : (v as string)))
    const rest = fields.filter(([, v]) => typeof v !== 'string')
    const extras = rest.map(([k, v]) => `${k}: ${valueText(v)}`).join(', ')
    const head = [humanType(asText(a.type)), ...words].join(' ')
    return extras ? `${head} (${extras})` : head
}

function macroRefText(a: Rec): string {
    const param = a.param === undefined ? '' : ` (${keyName(a.param)})`
    return `Macro ${asText(a.ref, '?')}${param}`
}

const ACTION_TEXT: Record<string, (a: Rec) => string> = {
    key_press: keyPressText,
    tap_hold: (a) =>
        `${keyPressText(a.tap)} / hold ${holdText(a.hold)}${extrasText(a, ['tap', 'hold'])}`,
    layer: (a) =>
        `${LAYER_MODE[asText(a.mode)] ?? 'Layer'} ${asText(a.layer, '?')}`,
    sticky_key: (a) => `Sticky ${keyName(a.key)}`,
    key_toggle: (a) => `Toggle ${keyName(a.key)}`,
    transparent: () => 'Transparent',
    none: () => 'None',
    macro: macroRefText,
}

/** Short human text for a canonical action. */
export function actionText(a: unknown): string {
    if (!isRecord(a)) return valueText(a)
    const text = ACTION_TEXT[asText(a.type)]
    return text ? text(a) : genericText(a)
}

const STEP_TEXT: Record<string, (s: Rec) => string> = {
    wait: (s) => `Wait ${asText(s.ms, '?')} ms`,
    tap_time: (s) => `Tap time ${asText(s.ms, '?')} ms`,
    text: (s) => `Text "${asText(s.text)}"`,
}

/** One macro step: "Tap A", "Wait 20 ms", "Text "hi"". */
export function macroStepText(s: unknown): string {
    if (!isRecord(s)) return valueText(s)
    const text = STEP_TEXT[asText(s.type)]
    return text ? text(s) : genericText(s)
}
