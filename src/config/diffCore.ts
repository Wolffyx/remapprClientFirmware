// Pattern check: no GoF pattern (-) — rejected — pure value helpers (stable
// JSON, compact text, record access) and three table-driven comparers; no
// abstraction.
//
// The building blocks of diff.ts: compare two loosely typed values the same way
// whatever document they come from. A section is compared field by field
// (`diffFields`), as a list of identified items (`diffKeyed`) or as a set of
// strings (`diffSet`). Fields starting with `_` record how the user spelled
// something (`_keySrc`, `_preset`), never what it does, so they are ignored
// everywhere. Nothing here throws on a malformed value: a missing section reads
// as empty.

export type ChangeOp = 'added' | 'removed' | 'changed' | 'moved'

export interface DocumentChange {
    /** Stable group id, e.g. 'binding', 'layer', 'key' (see diff.ts). */
    area: string
    op: ChangeOp
    /** Stable machine path, e.g. 'layers.0.bindings.12'. */
    path: string
    /** Short human text naming what changed, e.g. 'Layer "Base", key 12'. */
    label: string
    /** The old value as text (absent when added). */
    before?: string
    /** The new value as text (absent when removed). */
    after?: string
}

/** Where a change sits: its group, machine path and human name. */
export interface Where {
    area: string
    path: string
    label: string
}

export type Rec = Record<string, unknown>

export const isRecord = (v: unknown): v is Rec =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

export const asRecord = (v: unknown): Rec => (isRecord(v) ? v : {})

export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A string or number as text, else `fallback`. */
export function asText(v: unknown, fallback = ''): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number') return String(v)
    return fallback
}

export const joinPath = (base: string, key: string): string =>
    base ? `${base}.${key}` : key

/** The fields that say what something does: no `_` fields, no undefined. */
export function visibleEntries(r: Rec): [string, unknown][] {
    return Object.entries(r).filter(
        ([k, v]) => !k.startsWith('_') && v !== undefined,
    )
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]): number =>
    a < b ? -1 : a > b ? 1 : 0

/** JSON with sorted keys and no `_` fields: equal meaning, equal text. */
export function stableJson(v: unknown): string {
    const json = JSON.stringify(v, (_k, x: unknown) =>
        isRecord(x) ? Object.fromEntries(visibleEntries(x).sort(byKey)) : x,
    ) as string | undefined
    return json ?? 'undefined'
}

export const sameValue = (a: unknown, b: unknown): boolean =>
    stableJson(a) === stableJson(b)

export function pick(r: Rec, fields: readonly string[]): Rec {
    return Object.fromEntries(
        visibleEntries(r).filter(([k]) => fields.includes(k)),
    )
}

export function omit(r: Rec, fields: readonly string[]): Rec {
    return Object.fromEntries(
        visibleEntries(r).filter(([k]) => !fields.includes(k)),
    )
}

/* ── text ───────────────────────────────────────────────────────────────── */

const MAX_TEXT = 240

function clip(s: string): string {
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s
}

function rawText(v: unknown): string {
    if (v === undefined || v === null) return 'none'
    if (Array.isArray(v)) return `[${v.map(rawText).join(', ')}]`
    if (isRecord(v)) return `{${rawPairs(v)}}`
    return String(v)
}

function rawPairs(r: Rec): string {
    return visibleEntries(r)
        .map(([k, x]) => `${k}: ${rawText(x)}`)
        .join(', ')
}

/** Compact one-line text of any value, e.g. `{cpi: 1600, invertY: true}`. */
export const valueText = (v: unknown): string => clip(rawText(v))

/** A record's fields as `k: v, k: v` (no braces); 'none' when it has none. */
export const pairsText = (r: Rec): string => clip(rawPairs(r) || 'none')

/** ` (k: v, …)` for the fields a text builder did not already spell out;
 *  '' when there are none. `type` is never repeated. */
export function extrasText(r: Rec, consumed: readonly string[]): string {
    const rest = omit(r, [...consumed, 'type'])
    return Object.keys(rest).length ? ` (${pairsText(rest)})` : ''
}

/* ── changes ────────────────────────────────────────────────────────────── */

function opFor(before?: string, after?: string): ChangeOp {
    if (before === undefined) return 'added'
    if (after === undefined) return 'removed'
    return 'changed'
}

/** One change; the op follows from which side is present unless given. */
export function makeChange(
    where: Where,
    before: string | undefined,
    after: string | undefined,
    op: ChangeOp = opFor(before, after),
): DocumentChange {
    return {
        area: where.area,
        op,
        path: where.path,
        label: where.label,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
    }
}

const present = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : valueText(v)

/** Visible keys of `a` in order, then those only `b` has. */
export function unionKeys(a: Rec, b: Rec): string[] {
    const keys = visibleEntries(a).map(([k]) => k)
    for (const [k] of visibleEntries(b)) if (!keys.includes(k)) keys.push(k)
    return keys
}

/** Field-by-field changes between two records. Nested records recurse; any
 *  other value (arrays included) compares whole. */
export function diffFields(
    where: Where,
    a: unknown,
    b: unknown,
    field = '',
): DocumentChange[] {
    const ra = asRecord(a)
    const rb = asRecord(b)
    return unionKeys(ra, rb).flatMap((key) =>
        diffField(where, ra[key], rb[key], joinPath(field, key)),
    )
}

function diffField(
    where: Where,
    va: unknown,
    vb: unknown,
    field: string,
): DocumentChange[] {
    if (isRecord(va) && isRecord(vb)) return diffFields(where, va, vb, field)
    if (sameValue(va, vb)) return []
    const at: Where = {
        area: where.area,
        path: joinPath(where.path, field),
        label: `${where.label}: ${field}`,
    }
    return [makeChange(at, present(va), present(vb))]
}

/** Strings only one side holds: added or removed members of a set. */
export function diffSet(
    where: Where,
    a: unknown,
    b: unknown,
): DocumentChange[] {
    const before = asArray(a).map((x) => asText(x, valueText(x)))
    const after = asArray(b).map((x) => asText(x, valueText(x)))
    const at = (s: string): Where => ({
        ...where,
        path: joinPath(where.path, s),
    })
    return [
        ...after
            .filter((s) => !before.includes(s))
            .map((s) => makeChange(at(s), undefined, s)),
        ...before
            .filter((s) => !after.includes(s))
            .map((s) => makeChange(at(s), s, undefined)),
    ]
}

/* ── keyed lists ────────────────────────────────────────────────────────── */

/** How to compare one list of items that each have an identity. */
export interface KeyedSpec {
    area: string
    path: string
    /** The item's identity in the list: its id, name or position. */
    key: (item: Rec, index: number) => string
    label: (key: string, item: Rec) => string
    /** The item as human text; default its fields. */
    text?: (item: Rec) => string
    /** Fields whose change means the item moved rather than changed. */
    geometry?: readonly string[]
}

function keyItems(spec: KeyedSpec, list: unknown): Map<string, Rec> {
    const items = new Map<string, Rec>()
    asArray(list).forEach((x, i) => {
        const item = asRecord(x)
        const base = spec.key(item, i)
        let key = base
        for (let n = 2; items.has(key); n++) key = `${base}#${n}`
        items.set(key, item)
    })
    return items
}

const itemText = (spec: KeyedSpec, item: Rec): string =>
    (spec.text ?? pairsText)(item)

const whereOf = (spec: KeyedSpec, key: string, item: Rec): Where => ({
    area: spec.area,
    path: joinPath(spec.path, key),
    label: spec.label(key, item),
})

/** Added, removed and changed items of two lists, matched by identity:
 *  the new list's order first, then what it no longer has. */
export function diffKeyed(
    spec: KeyedSpec,
    a: unknown,
    b: unknown,
): DocumentChange[] {
    const before = keyItems(spec, a)
    const after = keyItems(spec, b)
    const kept = [...after].flatMap(([key, item]) =>
        diffItem(spec, key, before.get(key), item),
    )
    const gone = [...before]
        .filter(([key]) => !after.has(key))
        .map(([key, item]) =>
            makeChange(
                whereOf(spec, key, item),
                itemText(spec, item),
                undefined,
            ),
        )
    return [...kept, ...gone]
}

function diffItem(
    spec: KeyedSpec,
    key: string,
    old: Rec | undefined,
    item: Rec,
): DocumentChange[] {
    const where = whereOf(spec, key, item)
    if (!old) return [makeChange(where, undefined, itemText(spec, item))]
    if (sameValue(old, item)) return []
    if (!spec.geometry) {
        return [makeChange(where, itemText(spec, old), itemText(spec, item))]
    }
    return [
        ...movedChange(where, spec.geometry, old, item),
        ...restChange(where, spec, old, item),
    ]
}

function movedChange(
    where: Where,
    geometry: readonly string[],
    old: Rec,
    item: Rec,
): DocumentChange[] {
    const from = pick(old, geometry)
    const to = pick(item, geometry)
    if (sameValue(from, to)) return []
    return [makeChange(where, pairsText(from), pairsText(to), 'moved')]
}

function restChange(
    where: Where,
    spec: KeyedSpec,
    old: Rec,
    item: Rec,
): DocumentChange[] {
    const geometry = spec.geometry ?? []
    const from = omit(old, geometry)
    const to = omit(item, geometry)
    if (sameValue(from, to)) return []
    return [makeChange(where, itemText(spec, from), itemText(spec, to))]
}
