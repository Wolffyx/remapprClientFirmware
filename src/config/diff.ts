// Pattern check: Dispatch Map (Tier 0) — applied — one differ per document kind
// (DIFFERS), keyed by the document's `kind` like describe.ts's DESCRIBERS; an
// unknown kind falls back to a field-by-field compare.
//
// What changed between two versions of the same library document, for the
// History panel: a semantic diff (a key's binding, a layer renamed, a control
// moved), not a text one. It takes the parsed documents describeDocument takes.
// Each change carries an `area`, a stable group id, in this display order:
//
//   document · meta · layer · binding · encoder · slider · combo · macro ·
//   tapDance · modMorph · holdTap · conditionalLayer · keyOverride · leader ·
//   actionBinding · autocorrect · key · control · part · layout · shell ·
//   matrix · pins · controller · board · hardware · vial · lighting ·
//   firmware · feature · node · defaults · setting
//
// Pure, deterministic and total: malformed input reads as empty sections, and
// nothing here throws.
import {
    asRecord,
    type ChangeOp,
    diffFields,
    diffKeyed,
    type DocumentChange,
    isRecord,
    type KeyedSpec,
    asText,
    makeChange,
    omit,
    type Rec,
    sameValue,
    unionKeys,
    valueText,
    visibleEntries,
} from './diffCore'
import { diffKeymap } from './diffKeymap'

export type { ChangeOp, DocumentChange } from './diffCore'

export interface DocumentDiff {
    /** The kind of `b` (or of `a` when `b` has none). */
    kind: string | null
    sameKind: boolean
    /** Ordered by area, then document order. */
    changes: DocumentChange[]
    /** Changes per area, e.g. { binding: 3, combo: 1 }. */
    counts: Record<string, number>
    /** One line, e.g. "3 bindings · 1 combo · 2 keys moved"; "No changes". */
    summary: string
}

/* ── device layout ──────────────────────────────────────────────────────── */

const CONTROL_SPEC: KeyedSpec = {
    area: 'control',
    path: 'controls',
    key: (c, i) => asText(c.id, `#${i}`),
    label: (key, c) => `Control "${asText(c.name, key)}"`,
    geometry: ['x', 'y', 'w', 'h', 'r'],
}

const VARIANT_SPEC: KeyedSpec = {
    area: 'layout',
    path: 'layouts',
    key: (v, i) => asText(v.id, `#${i}`),
    label: (key, v) => `Layout variant "${asText(v.name, key)}"`,
}

const LAYOUT_PARTS = ['kind', 'shell', 'controls', 'layouts']

function diffDeviceLayout(a: Rec, b: Rec): DocumentChange[] {
    const meta = { area: 'meta', path: '', label: 'Layout' }
    const shell = { area: 'shell', path: 'shell', label: 'Shell' }
    return [
        ...diffFields(meta, omit(a, LAYOUT_PARTS), omit(b, LAYOUT_PARTS)),
        ...diffFields(shell, a.shell, b.shell),
        ...diffKeyed(CONTROL_SPEC, a.controls, b.controls),
        ...diffKeyed(VARIANT_SPEC, a.layouts, b.layouts),
    ]
}

/* ── device config ──────────────────────────────────────────────────────── */

/** The top-level values that are not sections (personality, schemaVersion). */
function scalars(r: Rec): Rec {
    return Object.fromEntries(
        visibleEntries(r).filter(([k, v]) => k !== 'kind' && !isRecord(v)),
    )
}

/** The settings sections either side has (dongle, mouse, radio, …). */
const sectionNames = (a: Rec, b: Rec): string[] =>
    unionKeys(a, b).filter(
        (k) => k !== 'meta' && (isRecord(a[k]) || isRecord(b[k])),
    )

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function diffDeviceConfig(a: Rec, b: Rec): DocumentChange[] {
    const meta = { area: 'meta', path: 'meta', label: 'Meta' }
    const device = { area: 'meta', path: '', label: 'Device' }
    const settings = sectionNames(a, b).flatMap((k) =>
        diffFields(
            { area: 'setting', path: k, label: capitalize(k) },
            a[k],
            b[k],
        ),
    )
    return [
        ...diffFields(meta, a.meta, b.meta),
        ...diffFields(device, scalars(a), scalars(b)),
        ...settings,
    ]
}

/* ── dispatch ───────────────────────────────────────────────────────────── */

const DIFFERS: Record<string, (a: Rec, b: Rec) => DocumentChange[]> = {
    'remappr.keymap': diffKeymap,
    'remappr.device-layout': diffDeviceLayout,
    'remappr.device': diffDeviceConfig,
}

const DOCUMENT = { area: 'document', path: '', label: 'Document' }

/** An unknown kind: field by field, or whole when either is not a record. */
function diffGeneric(a: unknown, b: unknown): DocumentChange[] {
    if (isRecord(a) && isRecord(b)) return diffFields(DOCUMENT, a, b)
    if (sameValue(a, b)) return []
    return [makeChange(DOCUMENT, valueText(a), valueText(b))]
}

function compare(
    kind: string | null,
    a: unknown,
    b: unknown,
): DocumentChange[] {
    const differ = kind === null ? undefined : DIFFERS[kind]
    return differ ? differ(asRecord(a), asRecord(b)) : diffGeneric(a, b)
}

/** The last guard: a value even JSON cannot read (a cycle, a BigInt). */
function compareSafely(
    kind: string | null,
    a: unknown,
    b: unknown,
): DocumentChange[] {
    try {
        return compare(kind, a, b)
    } catch {
        const where = { ...DOCUMENT, label: 'Document (could not be compared)' }
        return [makeChange(where, 'unreadable', 'unreadable')]
    }
}

function kindOf(doc: unknown): string | null {
    const kind = isRecord(doc) ? doc.kind : undefined
    return typeof kind === 'string' ? kind : null
}

/* ── ordering and summary ───────────────────────────────────────────────── */

/** Every area in display order, with its noun (singular, plural). */
const AREAS: readonly [string, string, string][] = [
    ['document', 'document change', 'document changes'],
    ['meta', 'detail', 'details'],
    ['layer', 'layer', 'layers'],
    ['binding', 'binding', 'bindings'],
    ['encoder', 'encoder', 'encoders'],
    ['slider', 'slider', 'sliders'],
    ['combo', 'combo', 'combos'],
    ['macro', 'macro', 'macros'],
    ['tapDance', 'tap dance', 'tap dances'],
    ['modMorph', 'mod-morph', 'mod-morphs'],
    ['holdTap', 'hold-tap', 'hold-taps'],
    ['conditionalLayer', 'conditional layer', 'conditional layers'],
    ['keyOverride', 'key override', 'key overrides'],
    ['leader', 'leader sequence', 'leader sequences'],
    ['actionBinding', 'action binding', 'action bindings'],
    ['autocorrect', 'autocorrect entry', 'autocorrect entries'],
    ['key', 'key', 'keys'],
    ['control', 'control', 'controls'],
    ['part', 'part', 'parts'],
    ['layout', 'layout', 'layouts'],
    ['shell', 'shell setting', 'shell settings'],
    ['matrix', 'matrix setting', 'matrix settings'],
    ['pins', 'pin setting', 'pin settings'],
    ['controller', 'controller setting', 'controller settings'],
    ['board', 'board setting', 'board settings'],
    ['hardware', 'hardware setting', 'hardware settings'],
    ['vial', 'Vial setting', 'Vial settings'],
    ['lighting', 'lighting setting', 'lighting settings'],
    ['firmware', 'firmware setting', 'firmware settings'],
    ['feature', 'feature', 'features'],
    ['node', 'node setting', 'node settings'],
    ['defaults', 'default', 'defaults'],
    ['setting', 'setting', 'settings'],
]

const AREA_RANK = new Map(AREAS.map(([area], rank) => [area, rank]))
const AREA_NOUN = new Map(AREAS.map(([area, one, many]) => [area, [one, many]]))

const rankOf = (area: string): number => AREA_RANK.get(area) ?? AREAS.length

/** Stable: within an area, document order is kept. */
const byArea = (changes: DocumentChange[]): DocumentChange[] =>
    [...changes].sort((x, y) => rankOf(x.area) - rankOf(y.area))

function countByArea(changes: DocumentChange[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const c of changes) counts[c.area] = (counts[c.area] ?? 0) + 1
    return counts
}

/** "2 keys moved", "1 layer added", "3 bindings" (mixed or changed: no op). */
function areaSummary(area: string, changes: DocumentChange[]): string {
    const own = changes.filter((c) => c.area === area)
    const [one, many] = AREA_NOUN.get(area) ?? [area, `${area}s`]
    const ops = new Set<ChangeOp>(own.map((c) => c.op))
    const [op] = ops
    const suffix = ops.size === 1 && op !== 'changed' ? ` ${op}` : ''
    return `${own.length} ${own.length === 1 ? one : many}${suffix}`
}

function summarize(changes: DocumentChange[]): string {
    const areas = [...new Set(changes.map((c) => c.area))]
    if (!areas.length) return 'No changes'
    return areas.map((area) => areaSummary(area, changes)).join(' · ')
}

function finish(
    kind: string | null,
    sameKind: boolean,
    changes: DocumentChange[],
): DocumentDiff {
    const ordered = byArea(changes)
    return {
        kind,
        sameKind,
        changes: ordered,
        counts: countByArea(ordered),
        summary: summarize(ordered),
    }
}

/** What changed from `a` to `b`, two parsed versions of one library document
 *  (a keymap, a device layout or a device config). Different kinds give one
 *  'document' change and `sameKind: false`. */
export function diffDocuments(a: unknown, b: unknown): DocumentDiff {
    const before = kindOf(a)
    const after = kindOf(b)
    const kind = after ?? before
    if (before === after) return finish(kind, true, compareSafely(kind, a, b))
    const where = { area: 'document', path: 'kind', label: 'Document type' }
    const change = makeChange(where, before ?? 'none', after ?? 'none')
    return finish(kind, false, [change])
}
