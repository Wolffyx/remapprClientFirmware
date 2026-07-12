// Pattern check: no GoF pattern (-) — rejected — declarative field-descriptor
// tables plus pure diff / validation helpers for the config-blob editors; no
// polymorphism or construction to abstract.
//
// Shared metadata + pure helpers for the config-blob editors (§7.4 timing defaults,
// custom hold-tap / mod-morph def pools, conditional tri-layers). Lives in the
// firmware-client lib so every front-end — the app's device editors AND the
// builder's design-time sections — reads one source of truth, and the field tables
// sit next to the ConfigKeymap types + zod schema they mirror. UI-agnostic and
// service-agnostic: the front-ends supply their own inputs and write path.
import type {
    CanonConditionalLayer,
    CanonHoldTapDef,
    CanonModMorph,
    ConfigDefaults,
} from './types'
import { MODIFIERS, type Modifier } from './keycodes'
import type { FeatureName } from './featureWarnings'
import { LimitsFeature } from '../remappr/protocol'

/* ── timing defaults (§7.4) ──────────────────────────────────────────────── */

export type TimingFieldKey = keyof ConfigDefaults

export interface TimingFieldDef {
    key: TimingFieldKey
    label: string
    description: string
    group: string
    min: number
    max: number
    /** Firmware feature bit required to honor this field; undefined ⇒ always
     *  honored (core timing / pre-§7.4.1 debounce). */
    feature?: FeatureName
}

const GROUP_TAP = 'Tap-hold & combo'
const GROUP_DEBOUNCE = 'Debounce'
const GROUP_ENGINE = 'Engine timing (§7.4.1)'

export const TIMING_FIELDS = [
    {
        key: 'tappingTermMs',
        label: 'Tapping term',
        description: 'Hold-vs-tap decision window.',
        group: GROUP_TAP,
        min: 1,
        max: 1000,
    },
    {
        key: 'quickTapMs',
        label: 'Quick tap',
        description: 'Tap-then-hold within this window repeats the tap.',
        group: GROUP_TAP,
        min: 0,
        max: 1000,
    },
    {
        key: 'comboTimeoutMs',
        label: 'Combo timeout',
        description: 'Max time between the keys of a combo.',
        group: GROUP_TAP,
        min: 1,
        max: 1000,
    },
    {
        key: 'releaseDebounceMs',
        label: 'Release debounce',
        description: '0 keeps the firmware / devicetree value.',
        group: GROUP_DEBOUNCE,
        min: 0,
        max: 80,
    },
    {
        key: 'pressDebounceMs',
        label: 'Press debounce',
        description: '0 keeps the firmware / devicetree value.',
        group: GROUP_DEBOUNCE,
        min: 0,
        max: 80,
    },
    {
        key: 'matrixPressDebounceMs',
        label: 'Matrix press debounce',
        description: '0 keeps the firmware / devicetree value.',
        group: GROUP_DEBOUNCE,
        min: 0,
        max: 80,
    },
    {
        key: 'matrixReleaseDebounceMs',
        label: 'Matrix release debounce',
        description: '0 keeps the firmware / devicetree value.',
        group: GROUP_DEBOUNCE,
        min: 0,
        max: 80,
    },
    {
        key: 'capsWordIdleMs',
        label: 'Caps-word idle',
        description: 'Auto-exit caps-word after this idle time; 0 = never.',
        group: GROUP_ENGINE,
        min: 0,
        max: 5000,
        feature: 'capsWordIdle',
    },
    {
        key: 'stickyReleaseDefaultMs',
        label: 'Sticky release',
        description: 'Sticky-key lifetime; 0 = until the next key.',
        group: GROUP_ENGINE,
        min: 0,
        max: 5000,
        feature: 'stickyReleaseAfter',
    },
    {
        key: 'macroDefaultWaitMs',
        label: 'Macro default wait',
        description: 'Default gap between macro steps.',
        group: GROUP_ENGINE,
        min: 0,
        max: 1000,
        feature: 'macroDefaults',
    },
    {
        key: 'macroDefaultTapMs',
        label: 'Macro default tap',
        description: 'Default tap hold-time inside a macro.',
        group: GROUP_ENGINE,
        min: 0,
        max: 1000,
        feature: 'macroDefaults',
    },
    {
        key: 'matrixPollPeriodMs',
        label: 'Matrix poll period',
        description: 'Matrix scan interval; 0 keeps the devicetree value.',
        group: GROUP_ENGINE,
        min: 0,
        max: 100,
        feature: 'matrixPollPeriod',
    },
] as const satisfies readonly TimingFieldDef[]

// Compile-time exhaustiveness: every ConfigDefaults field must appear above so a
// new schema field can never be silently un-editable. Adding a field to
// ConfigDefaults fails this line until it is listed in TIMING_FIELDS.
type CoveredKey = (typeof TIMING_FIELDS)[number]['key']
type MissingDefaultsKey = Exclude<keyof ConfigDefaults, CoveredKey>
const _allFieldsCovered: MissingDefaultsKey extends never
    ? true
    : MissingDefaultsKey = true
void _allFieldsCovered

/** Whether the connected firmware honors `field` — a field with no feature bit is
 *  always honored; otherwise the device's bitmask must advertise it. */
export function fieldSupported(
    field: TimingFieldDef,
    featureBitmask: number,
): boolean {
    if (!field.feature) return true
    return (featureBitmask & LimitsFeature[field.feature]) !== 0
}

/** The fields as contiguous `[group, fields]` sections in declared order, for a
 *  sectioned render. */
export function groupedTimingFields(): [string, TimingFieldDef[]][] {
    const out: [string, TimingFieldDef[]][] = []
    for (const f of TIMING_FIELDS) {
        const last = out[out.length - 1]
        if (last && last[0] === f.group) last[1].push(f)
        else out.push([f.group, [f]])
    }
    return out
}

/* ── hold-tap / mod-morph def pools ──────────────────────────────────────── */

export type Flavor = NonNullable<CanonHoldTapDef['flavor']>

export const FLAVOR_OPTIONS: readonly Flavor[] = [
    'balanced',
    'hold-preferred',
    'tap-preferred',
    'tap-unless-interrupted',
]

/** Editable numeric timing fields on a hold-tap def. */
export interface HoldTapNumField {
    key: 'tappingTermMs' | 'quickTapMs' | 'requirePriorIdleMs'
    label: string
    min: number
    max: number
}

export const HOLD_TAP_NUM_FIELDS: readonly HoldTapNumField[] = [
    { key: 'tappingTermMs', label: 'Tapping term', min: 1, max: 1000 },
    { key: 'quickTapMs', label: 'Quick tap', min: 0, max: 1000 },
    {
        key: 'requirePriorIdleMs',
        label: 'Require prior idle',
        min: 0,
        max: 1000,
    },
]

/** Editable boolean flags on a hold-tap def, with the firmware feature each needs
 *  (undefined ⇒ always honored). */
export interface HoldTapFlagField {
    key: 'retroTap' | 'holdTriggerOnRelease'
    label: string
    feature?: FeatureName
}

export const HOLD_TAP_FLAG_FIELDS: readonly HoldTapFlagField[] = [
    { key: 'retroTap', label: 'Retro tap' },
    {
        key: 'holdTriggerOnRelease',
        label: 'Trigger hold on release',
        feature: 'holdTriggerOnRelease',
    },
]

export const ALL_MODIFIERS: readonly Modifier[] = MODIFIERS

/** Short friendly label for a modifier, e.g. LEFT_CTRL → "LCtrl". */
export function modifierLabel(m: Modifier): string {
    const side = m.startsWith('LEFT_') ? 'L' : 'R'
    const name = m.replace(/^(LEFT|RIGHT)_/, '')
    const cap: Record<string, string> = {
        CTRL: 'Ctrl',
        SHIFT: 'Shift',
        ALT: 'Alt',
        GUI: 'Gui',
    }
    return side + (cap[name] ?? name)
}

/** Whether the connected firmware honors `feature` (undefined ⇒ always). */
export function featureSupported(
    feature: FeatureName | undefined,
    featureBitmask: number,
): boolean {
    if (!feature) return true
    return (featureBitmask & LimitsFeature[feature]) !== 0
}

/** Add/remove `m` from a modifier list (immutable). */
export function toggleModifier(list: Modifier[], m: Modifier): Modifier[] {
    return list.includes(m) ? list.filter((x) => x !== m) : [...list, m]
}

/** Order-independent set equality for a flat list. */
const sameSet = <T>(a: T[], b: T[]): boolean =>
    a.length === b.length && a.every((x) => b.includes(x))

/** The changed editable fields of a hold-tap def as a patch, or null if nothing
 *  changed. `edited` carries the full editable surface (flavor + nums + flags). */
export function holdTapPatch(
    orig: CanonHoldTapDef,
    edited: CanonHoldTapDef,
): Partial<CanonHoldTapDef> | null {
    const patch: Partial<CanonHoldTapDef> = {}
    if (edited.flavor !== orig.flavor) patch.flavor = edited.flavor
    for (const f of HOLD_TAP_NUM_FIELDS)
        if (edited[f.key] !== orig[f.key]) patch[f.key] = edited[f.key]
    for (const f of HOLD_TAP_FLAG_FIELDS)
        if (!!edited[f.key] !== !!orig[f.key]) patch[f.key] = !!edited[f.key]
    return Object.keys(patch).length ? patch : null
}

/** The changed mods / keepMods of a mod-morph as a patch, or null if unchanged. */
export function modMorphPatch(
    orig: CanonModMorph,
    mods: Modifier[],
    keepMods: Modifier[],
): Partial<CanonModMorph> | null {
    const patch: Partial<CanonModMorph> = {}
    if (!sameSet(mods, orig.mods)) patch.mods = mods
    if (!sameSet(keepMods, orig.keepMods ?? [])) patch.keepMods = keepMods
    return Object.keys(patch).length ? patch : null
}

/* ── conditional (tri-)layers (§44.3) ────────────────────────────────────── */

/** A fresh, empty tri-layer row for an editor's "add" action. */
export function emptyConditional(): CanonConditionalLayer {
    return { ifLayers: [], thenLayer: '' }
}

/** Add/remove `name` from an if-layer list (immutable). */
export function toggleIfLayer(ifLayers: string[], name: string): string[] {
    return ifLayers.includes(name)
        ? ifLayers.filter((n) => n !== name)
        : [...ifLayers, name]
}

/** Two tri-layers equal when their if-set matches (order-independent) and their
 *  then-layer is identical. */
export function sameConditional(
    a: CanonConditionalLayer,
    b: CanonConditionalLayer,
): boolean {
    return a.thenLayer === b.thenLayer && sameSet(a.ifLayers, b.ifLayers)
}

/** Two tri-layer lists equal when same length and pairwise equal in order. */
export function sameConditionalList(
    a: CanonConditionalLayer[],
    b: CanonConditionalLayer[],
): boolean {
    return a.length === b.length && a.every((c, i) => sameConditional(c, b[i]))
}

/** The edited list as the whole-list patch a setter takes, or null if it matches
 *  the committed list (nothing to push). */
export function conditionalLayersPatch(
    orig: CanonConditionalLayer[],
    edited: CanonConditionalLayer[],
): CanonConditionalLayer[] | null {
    return sameConditionalList(orig, edited)
        ? null
        : edited.map((c) => ({
              ifLayers: [...c.ifLayers],
              thenLayer: c.thenLayer,
          }))
}

/** First problem with the tri-layer set, or null when every row is well-formed and
 *  references only current layers. Bad refs throw on compile anyway, but catching
 *  them here lets the UI name the offending row and block Save. */
export function conditionalError(
    list: CanonConditionalLayer[],
    layerNames: readonly string[],
): string | null {
    for (let i = 0; i < list.length; i++) {
        const c = list[i]
        const row = `Tri-layer ${i + 1}`
        if (c.ifLayers.length === 0) return `${row}: pick at least one "if" layer`
        if (!c.thenLayer) return `${row}: pick a "then" layer`
        const unknownIf = c.ifLayers.find((n) => !layerNames.includes(n))
        if (unknownIf) return `${row}: unknown layer "${unknownIf}"`
        if (!layerNames.includes(c.thenLayer))
            return `${row}: unknown layer "${c.thenLayer}"`
    }
    return null
}
