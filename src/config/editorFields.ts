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
    CanonAction,
    CanonConditionalLayer,
    CanonHoldTapDef,
    CanonModMorph,
    ConfigClusterNode,
    ConfigDefaults,
    ConfigNode,
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

/** Common ZMK inner behaviors offered for a hold-tap def's two bindings (hold,
 *  tap). The field accepts any token; an editor may show a def's current value
 *  even if it is not in this list. */
export const HOLD_TAP_BEHAVIOR_TOKENS: readonly {
    value: string
    label: string
}[] = [
    { value: '&kp', label: '&kp — key press' },
    { value: '&mo', label: '&mo — momentary layer' },
    { value: '&lt', label: '&lt — layer-tap' },
    { value: '&mt', label: '&mt — mod-tap' },
    { value: '&sk', label: '&sk — sticky key' },
    { value: '&sl', label: '&sl — sticky layer' },
    { value: '&kt', label: '&kt — key toggle' },
    { value: '&trans', label: '&trans — transparent' },
    { value: '&none', label: '&none — disabled' },
]

/** A unique id `${prefix}${n}` that collides with no `existing[i].id`. */
export function nextDefId(prefix: string, existing: { id: string }[]): string {
    const taken = new Set(existing.map((e) => e.id))
    let n = existing.length + 1
    while (taken.has(`${prefix}${n}`)) n++
    return `${prefix}${n}`
}

/** A fresh hold-tap def for an editor's "add" action — a balanced mod-tap
 *  (hold + tap both `&kp`) the user then tunes; `existing` seeds a unique id. */
export function emptyHoldTap(existing: CanonHoldTapDef[]): CanonHoldTapDef {
    return {
        id: nextDefId('ht_', existing),
        flavor: 'balanced',
        tappingTermMs: 200,
        quickTapMs: 150,
        bindings: ['&kp', '&kp'],
    }
}

/** A fresh mod-morph def for an editor's "add" action — Shift morphs the key
 *  onto itself until the user repoints the second binding via the picker. */
export function emptyModMorph(existing: CanonModMorph[]): CanonModMorph {
    const key: CanonAction = { type: 'key_press', key: 'A' }
    return {
        id: nextDefId('mm_', existing),
        mods: ['LEFT_SHIFT', 'RIGHT_SHIFT'],
        bindings: [key, { ...key }],
    }
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

/* ── node-bus role + mode-A cluster (§N4b/§N4c, TBL_PERSONALITY + TBL_CLUSTER) ─
 * Metadata for the whole-node editor: the node-bus role (which node is the
 * cluster coordinator) and the mode-A forward mode + cluster address map. These
 * live on ConfigNode (role / forwardMode / cluster) and ride the config blob, so
 * — like the timing / behavior editors above — the front-end supplies the inputs
 * and the write path; this module owns the option tables + pure validation. */

/** Node-bus role options; an absent role leaves the firmware Kconfig default, so
 *  the editor offers a third "unset" choice by writing `role: undefined`. */
export const ROLE_OPTIONS: readonly {
    value: NonNullable<ConfigNode['role']>
    label: string
    help: string
}[] = [
    {
        value: 'coordinator',
        label: 'Coordinator',
        help: 'Cluster main — merges every node’s input and drives the host link.',
    },
    {
        value: 'follower',
        label: 'Follower',
        help: 'Forwards its input upstream to the coordinator; no local host.',
    },
]

/** Mode-A vs mode-B forwarding. Absent ⇒ 'resolved' (mode B), today’s default. */
export const FORWARD_MODE_OPTIONS: readonly {
    value: NonNullable<ConfigNode['forwardMode']>
    label: string
    help: string
}[] = [
    {
        value: 'resolved',
        label: 'Resolved HID (mode B)',
        help: 'The follower resolves its own keymap and forwards HID usages (default).',
    },
    {
        value: 'physical',
        label: 'Physical positions (mode A)',
        help: 'The follower forwards raw matrix positions; the coordinator resolves them against the cluster keymap. Needs a cluster map below.',
    },
]

/** Max UID length: 16 bytes = 32 hex chars (matches REMAPPR_CLUSTER_UID_MAX). */
export const CLUSTER_UID_MAX_HEX = 32
/** Absolute position space is u16, so a node’s base + rows*cols must fit it. */
export const CLUSTER_POSITION_MAX = 0xffff

/** A fresh, empty cluster-map row for an editor’s "add" action. */
export function emptyClusterNode(): ConfigClusterNode {
    return { uid: '', positionBase: 0, rows: 1, cols: 1 }
}

/** First problem with the mode-A cluster map, or null when every row is
 *  well-formed. Mirrors the firmware decode_cluster.c / remappr_cluster_resolve
 *  bounds (uid ≤16 bytes, dims fit the u16 position space) plus a duplicate-UID
 *  check — the coordinator looks a source up by UID and finds the FIRST match, so
 *  a repeated UID silently shadows a node. Lets the UI name the bad row and block
 *  Save before a push the firmware would reject. */
export function clusterError(list: readonly ConfigClusterNode[]): string | null {
    const seen = new Set<string>()

    for (let i = 0; i < list.length; i++) {
        const n = list[i]
        const row = `Node ${i + 1}`
        const uid = n.uid.toLowerCase()

        if (uid.length === 0) return `${row}: enter a hardware UID`
        if (uid.length % 2 !== 0)
            return `${row}: UID must be whole bytes (even hex length)`
        if (uid.length > CLUSTER_UID_MAX_HEX)
            return `${row}: UID is longer than ${CLUSTER_UID_MAX_HEX / 2} bytes`
        if (!/^[0-9a-f]+$/.test(uid)) return `${row}: UID must be hex`
        if (seen.has(uid)) return `${row}: duplicate UID "${n.uid}"`
        seen.add(uid)

        if (!Number.isInteger(n.rows) || n.rows < 1 || n.rows > 255)
            return `${row}: rows must be 1–255`
        if (!Number.isInteger(n.cols) || n.cols < 1 || n.cols > 255)
            return `${row}: cols must be 1–255`
        if (!Number.isInteger(n.positionBase) || n.positionBase < 0)
            return `${row}: position base must be ≥ 0`
        if (n.positionBase + n.rows * n.cols > CLUSTER_POSITION_MAX + 1)
            return `${row}: position base + rows×cols overruns the ${CLUSTER_POSITION_MAX + 1}-position space`
        for (const [key, v] of [
            ['encoder base', n.encoderBase],
            ['pointer base', n.pointerBase],
        ] as const) {
            if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > CLUSTER_POSITION_MAX))
                return `${row}: ${key} must be 0–${CLUSTER_POSITION_MAX}`
        }
    }
    return null
}
