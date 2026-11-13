// Pattern check: no GoF pattern (-) — rejected — two pure lookups over the
// generated name tables, used by each firmware's codec.
//
// A key's spellings for one firmware: the catalog aliases that firmware's
// sources define (firmware-names.ts says which sources).
import { CATALOG } from './entries'
import { QMK_NAMES, REMAPPR_NAMES, ZMK_NAMES } from './firmware-names'
import type { CanonicalKeyId } from './types'

const ALIASES = new Map(CATALOG.map((e) => [e.id, e.aliases ?? []]))

const within =
    (names: ReadonlySet<string>) =>
    (id: CanonicalKeyId): readonly string[] =>
        (ALIASES.get(id) ?? []).filter((n) => names.has(n.split(' ')[0]!))

export const zmkNames = within(ZMK_NAMES)
export const qmkNames = within(QMK_NAMES)
export const remapprNames = (id: CanonicalKeyId): readonly string[] =>
    REMAPPR_NAMES[id] ?? []
