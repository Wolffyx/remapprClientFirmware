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
    CanonAutocorrectEntry,
    CanonConditionalLayer,
    CanonHoldTapDef,
    CanonModMorph,
    ConfigClusterNode,
    ConfigDefaults,
    ConfigLinkProfile,
    ConfigNode,
} from './types'
import { MODIFIERS, type Modifier } from './keycodes'
import { DEFAULT_AUTOCORRECT_ENTRIES } from './autocorrectDictionary'
import {
    AUTOCORRECT_MAX_TYPO,
    REPL_ALPHABET as AUTOCORRECT_REPL_ALPHABET,
    TYPO_ALPHABET as AUTOCORRECT_TYPO_ALPHABET,
} from './compilers/remappr/autocorrect'
import type { FeatureName } from './featureWarnings'
import { LimitsFeature, LinkProfileKnob, type LinkLimitKnob } from '../remappr/protocol'

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

/* ── autocorrect dictionary (§5.2-E, TBL_AUTOCORRECT) ─────────────────────────
 * The dictionary editor is a plain two-column list, so all the front-end needs
 * from here is a blank row, the "load the starter list" merge, and the same
 * validation the encoder would apply — run per row, while the user is typing,
 * instead of as one throw at commit time. */

/** A blank dictionary row for the editor's "add" button. */
export function emptyAutocorrectEntry(): CanonAutocorrectEntry {
    return { typo: '', correction: '' }
}

/** `entries` with every starter pair whose typo is not already present appended.
 *  Merging rather than replacing means "load defaults" can never silently discard
 *  what the user wrote, and running it twice changes nothing. */
export function withDefaultAutocorrect(
    entries: readonly CanonAutocorrectEntry[],
): CanonAutocorrectEntry[] {
    const have = new Set(entries.map((e) => e.typo.trim().toLowerCase()))
    return [
        ...entries.map((e) => ({ ...e })),
        ...DEFAULT_AUTOCORRECT_ENTRIES.filter((d) => !have.has(d.typo)).map(
            (d) => ({ ...d }),
        ),
    ]
}

/** First problem with the dictionary, or null when every row is one the device
 *  would accept. Mirrors the encoder's rules (which throw at commit) plus the
 *  duplicate check, naming the offending row so the UI can block Save. */
export function autocorrectError(
    entries: readonly CanonAutocorrectEntry[],
): string | null {
    const seen = new Set<string>()

    for (let i = 0; i < entries.length; i++) {
        const row = `Entry ${i + 1}`
        const typo = entries[i].typo.trim().toLowerCase()
        const correction = entries[i].correction.trim()

        if (!typo) return `${row}: enter the misspelling to correct`
        if (!AUTOCORRECT_TYPO_ALPHABET.test(typo))
            return `${row}: a typo may only contain letters, digits, ' and -`
        if (typo.length > AUTOCORRECT_MAX_TYPO)
            return `${row}: "${typo}" is longer than the ${AUTOCORRECT_MAX_TYPO} characters the keyboard remembers`
        if (!correction) return `${row}: enter what "${typo}" should become`
        if (!AUTOCORRECT_REPL_ALPHABET.test(correction))
            return `${row}: a correction may only contain letters, digits, ' and - (no spaces)`
        if (correction.length > 255) return `${row}: correction is too long`
        if (correction.toLowerCase() === typo)
            return `${row}: "${typo}" corrects to itself`
        if (seen.has(typo)) return `${row}: "${typo}" is listed twice`
        seen.add(typo)
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

/* ── node-bus link/latency profile (§8, N6, TBL_LINK_PROFILE) ────────────────
 * Metadata + pure validation for the link-profile editor: a base profile
 * (balanced / gaming / power-save) plus per-knob overrides for the node-bus USART
 * baud, the §6 election cadence, and a power tier. The firmware owns the min/max
 * ranges (GET_LINK_LIMITS / parseLinkLimits) and re-validates at COMMIT; this
 * module mirrors that constraint table so the editor bounds each input and blocks
 * Save on an out-of-range or cross-knob-inconsistent combo — never a blind push.
 * Knob order + ids match enum remappr_link_profile_knob (LinkProfileKnob). */

/** Base-profile options (enum remappr_link_profile_id). */
export const LINK_PROFILE_OPTIONS: readonly {
    value: ConfigLinkProfile['profile']
    label: string
    help: string
}[] = [
    {
        value: 'balanced',
        label: 'Balanced',
        help: 'Today’s tuned defaults — runs on battery or wired (default).',
    },
    {
        value: 'gaming',
        label: 'Gaming',
        help: 'Fast election cadence + max baud for lowest latency. Requires wired / charging power.',
    },
    {
        value: 'powerSave',
        label: 'Power save',
        help: 'Slower cadences to save battery.',
    },
]

/** Power-tier knob values (enum remappr_power_tier), rendered as a select. */
export const POWER_TIER_OPTIONS: readonly { value: number; label: string }[] = [
    { value: 0, label: 'Any (battery or wired)' },
    { value: 1, label: 'Wired / charging only' },
]

// pattern-check: skip plain metadata table describing the link-profile knobs
/** One editable link-profile knob. `knob` is the enum remappr_link_profile_knob
 *  id (the GET_LINK_LIMITS reply order); `min`/`max` mirror the firmware
 *  constraint table (lib/config_blob/link_profile.c) as the fallback when a
 *  device predates GET_LINK_LIMITS. `enumOptions` marks a discrete knob (power
 *  tier) the editor renders as a select rather than a number input. */
export interface LinkKnobField {
    knob: number
    label: string
    help: string
    unit?: string
    min: number
    max: number
    enumOptions?: readonly { value: number; label: string }[]
}

export const LINK_KNOB_FIELDS: readonly LinkKnobField[] = [
    {
        knob: LinkProfileKnob.usartBaud,
        label: 'USART baud',
        help: 'Node-bus wire speed between coordinator and followers.',
        unit: 'baud',
        min: 115200,
        max: 2000000,
    },
    {
        knob: LinkProfileKnob.tElectMs,
        label: 'Election window',
        help: '§6 campaign window before a coordinator is chosen.',
        unit: 'ms',
        min: 20,
        max: 1000,
    },
    {
        knob: LinkProfileKnob.electHeartbeatMs,
        label: 'Heartbeat period',
        help: '§6 coordinator beacon / heartbeat period.',
        unit: 'ms',
        min: 40,
        max: 1000,
    },
    {
        knob: LinkProfileKnob.electMissLimit,
        label: 'Missed-beacon limit',
        help: 'Missed heartbeats before a follower fails over.',
        min: 1,
        max: 16,
    },
    {
        knob: LinkProfileKnob.candidacyStableMs,
        label: 'Candidacy-stable window',
        help: 'Link-stable time before a node may campaign (≥ heartbeat period).',
        unit: 'ms',
        min: 40,
        max: 5000,
    },
    {
        knob: LinkProfileKnob.demotionDelayMs,
        label: 'Demotion delay',
        help: 'Voluntary-demotion settle delay.',
        unit: 'ms',
        min: 100,
        max: 10000,
    },
    {
        knob: LinkProfileKnob.handoverMinIntervalMs,
        label: 'Handover min interval',
        help: 'Minimum spacing between handovers (≥ demotion delay).',
        unit: 'ms',
        min: 100,
        max: 20000,
    },
    {
        knob: LinkProfileKnob.powerTier,
        label: 'Power tier',
        help: 'Wired-only profiles need external / charging power (enforced at save).',
        min: 0,
        max: 1,
        enumOptions: POWER_TIER_OPTIONS,
    },
]

/** The three base profiles' effective knob values, indexed by knob id — mirrors
 *  the firmware `profiles[]` table (link_profile.c). The editor shows these as
 *  each knob's default and treats an input equal to the base as "no override". */
export const LINK_PROFILE_BASE: Record<
    ConfigLinkProfile['profile'],
    readonly number[]
> = {
    //          baud     tElect  hb  miss cand  demo  handover tier
    balanced: [1000000, 100, 100, 3, 500, 1000, 3000, 0],
    gaming: [2000000, 50, 50, 3, 300, 800, 2000, 1],
    powerSave: [1000000, 150, 250, 4, 800, 1500, 4000, 0],
}

/** A fresh link profile for an editor's default state (balanced, no overrides). */
export function emptyLinkProfile(): ConfigLinkProfile {
    return { profile: 'balanced' }
}

/** Effective value of `knob` in `lp` — its override if set, else the base
 *  profile's value (mirrors remappr_link_profile_resolve). */
export function linkKnobValue(lp: ConfigLinkProfile, knob: number): number {
    const ovr = lp.overrides?.find((o) => o.knob === knob)
    return ovr ? ovr.value : (LINK_PROFILE_BASE[lp.profile][knob] ?? 0)
}

/** The [min,max] for `knob` — the live GET_LINK_LIMITS range when present, else
 *  the static firmware constraint table (LINK_KNOB_FIELDS). */
export function linkKnobRange(
    knob: number,
    limits?: readonly LinkLimitKnob[],
): { min: number; max: number } {
    const live = limits?.find((l) => l.knob === knob)
    if (live) return { min: live.min, max: live.max }
    const f = LINK_KNOB_FIELDS.find((k) => k.knob === knob)
    return { min: f?.min ?? 0, max: f?.max ?? 0xffffffff }
}

/** Set/clear the override for `knob`: a value equal to the base profile default
 *  drops the override (keeping the blob byte-minimal + default-equivalent), any
 *  other value adds/replaces it. Returns a new profile (pure). */
export function withLinkOverride(
    lp: ConfigLinkProfile,
    knob: number,
    value: number,
): ConfigLinkProfile {
    const rest = (lp.overrides ?? []).filter((o) => o.knob !== knob)
    const base = LINK_PROFILE_BASE[lp.profile][knob] ?? 0
    const overrides =
        value === base ? rest : [...rest, { knob, value }]
    overrides.sort((a, b) => a.knob - b.knob)
    return overrides.length ? { ...lp, overrides } : { profile: lp.profile }
}

/** First problem with the link profile, or null when it would pass the firmware
 *  COMMIT validation. Mirrors remappr_link_profile_validate: every effective knob
 *  within its range (live GET_LINK_LIMITS when supplied, else the static table)
 *  plus the two cross-knob rules (candidacy ≥ heartbeat, handover ≥ demotion).
 *  Lets the editor block Save before a push the firmware would reject. */
export function linkProfileError(
    lp: ConfigLinkProfile,
    limits?: readonly LinkLimitKnob[],
): string | null {
    for (const o of lp.overrides ?? []) {
        const f = LINK_KNOB_FIELDS.find((k) => k.knob === o.knob)
        if (!f) return `unknown knob id ${o.knob}`
        if (!Number.isInteger(o.value) || o.value < 0)
            return `${f.label} must be a whole number`
    }
    for (const f of LINK_KNOB_FIELDS) {
        const v = linkKnobValue(lp, f.knob)
        const { min, max } = linkKnobRange(f.knob, limits)
        if (v < min || v > max)
            return `${f.label} must be ${min}–${max}${f.unit ? ' ' + f.unit : ''}`
    }
    // Cross-knob dependencies (§8): survive one heartbeat before campaigning, and
    // don't re-hand-over faster than a demotion settles.
    if (
        linkKnobValue(lp, LinkProfileKnob.candidacyStableMs) <
        linkKnobValue(lp, LinkProfileKnob.electHeartbeatMs)
    )
        return 'Candidacy-stable window must be ≥ the heartbeat period'
    if (
        linkKnobValue(lp, LinkProfileKnob.handoverMinIntervalMs) <
        linkKnobValue(lp, LinkProfileKnob.demotionDelayMs)
    )
        return 'Handover min interval must be ≥ the demotion delay'
    return null
}
