// Pattern check: no GoF pattern (-) — rejected — JSON-to-entry data transformation; loads + normalizes static records, no abstraction.
import keyboardJson from './hid-pages/keyboard.json'
import consumerJson from './hid-pages/consumer.json'
import acJson from './hid-pages/ac.json'
import alJson from './hid-pages/al.json'
import mediaJson from './hid-pages/media.json'
import contactJson from './hid-pages/contact.json'
import systemJson from './hid-pages/system.json'
import overridesJson from './hid-pages/overrides.json'
import { CANONICAL_ALIASES, resolveAlias } from './aliases'
import { EXTERNAL_NAMES, EXTERNAL_NOTES } from './external-names'

import type { CanonicalKeyId, CatalogEntry } from './types'

interface HidLabelOverride {
    short?: string
    med?: string
    long?: string
}

const OVERRIDES = overridesJson as Record<
    string,
    Record<string, HidLabelOverride>
>

const lookupOverride = (
    page: number,
    id: number,
): HidLabelOverride | undefined => OVERRIDES[String(page)]?.[String(id)]

interface RawHidEntry {
    Id: number
    Name: string
    Label?: string
    Label2?: string
    Kinds?: string[]
    w?: number
    h?: number
    x?: number
    y?: number
}

const slugify = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')

export interface HidUsage {
    page: number
    usage: number
}

interface HidPageBuild {
    entries: CatalogEntry[]
    usages: Map<CanonicalKeyId, HidUsage>
}

const fromHidPage = (
    raw: RawHidEntry[],
    idPrefix: string,
    pageHidNumber: number,
): HidPageBuild => {
    const entries: CatalogEntry[] = []
    const usages = new Map<CanonicalKeyId, HidUsage>()
    for (const r of raw) {
        const slug = slugify(r.Name) || `id_${r.Id}`
        const id = `${idPrefix}.${slug}`
        const ov = lookupOverride(pageHidNumber, r.Id)
        entries.push({
            id,
            label: ov?.short ?? r.Label ?? r.Name,
            name: ov?.long ?? ov?.med ?? r.Name,
            description: r.Label2,
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            kinds: ['hid'],
        })
        usages.set(id, { page: pageHidNumber, usage: r.Id })
    }
    return { entries, usages }
}

const keyboardBuild = fromHidPage(keyboardJson as RawHidEntry[], 'key', 7)
const consumerBuild = fromHidPage(consumerJson as RawHidEntry[], 'consumer', 12)
const acBuild = fromHidPage(acJson as RawHidEntry[], 'ac', 12)
const alBuild = fromHidPage(alJson as RawHidEntry[], 'al', 12)
const mediaBuild = fromHidPage(mediaJson as RawHidEntry[], 'media', 12)
const contactBuild = fromHidPage(contactJson as RawHidEntry[], 'contact', 12)
// Generic Desktop System Control (HID page 1): power / sleep / wake. The firmware
// emits these through its system-control HID interface as BH_SYS_CTRL (§44.4), so
// — exactly like Consumer — the behavior type, not a page tag in the record,
// disambiguates the page on the wire.
const systemBuild = fromHidPage(systemJson as RawHidEntry[], 'sys_ctrl', 1)

export {
    AUDIO_ENTRIES,
    BACKLIGHT_ENTRIES,
    COMBOS_ENTRIES,
    JOYSTICK_ENTRIES,
    MACROS_ENTRIES,
    MAGIC_ENTRIES,
    MEDIA_TRANSPORT_ENTRIES,
    MIDI_ENTRIES,
    MISC_ENTRIES,
    MOD_ENTRIES,
    MOUSE_ENTRIES,
    OS_KEYS_ENTRIES,
    PROGRAMMABLE_ENTRIES,
    QUANTUM_ENTRIES,
    RGB_ENTRIES,
    SHIFTED_ENTRIES,
    WIRELESS_ENTRIES,
} from './static-entries'
import { STATIC_ENTRIES } from './static-entries'

// Treat single-non-alphanumeric or unicode-symbol labels (←, ↵, ⇪, ✶, ⌫…)
// as icon labels. Used to prefer the icon-friendly variant when merging
// duplicate canonical entries.
const isIconLabel = (s: string | undefined): boolean => {
    if (!s) return false
    if (s.length === 1 && !/[a-zA-Z0-9]/.test(s)) return true
    return s.length <= 3 && /[←-⇿⌀-⏿✀-➿]/.test(s)
}

// Pick the better label between primary and merged-secondary entries.
// Icon-first: any icon variant wins over text variant.
const selectMergedLabel = (
    primary: CatalogEntry,
    secondary: CatalogEntry,
): string => {
    const primIcon = isIconLabel(primary.label)
    const secIcon = isIconLabel(secondary.label)
    if (secIcon && !primIcon) return secondary.label
    return primary.label
}

// Copy positioning from secondary onto primary when primary lacks layout
// metadata. HID Keypad/duplicate variants sometimes carry x/y/w/h that
// the primary lost (e.g. mod.lctrl static entry has no position; HID
// LeftControl 7/224 has x=0/y=550).
const mergePositioning = (
    primary: CatalogEntry,
    secondary: CatalogEntry,
): void => {
    if (primary.x === undefined && secondary.x !== undefined)
        primary.x = secondary.x
    if (primary.y === undefined && secondary.y !== undefined)
        primary.y = secondary.y
    if (primary.w === undefined && secondary.w !== undefined)
        primary.w = secondary.w
    if (primary.h === undefined && secondary.h !== undefined)
        primary.h = secondary.h
}

// Build a flat working set of all entries (HID + static), then resolve
// aliases. Mutate primary entries' label/aliases in place — same object
// references are exported through *_ENTRIES, so callers see merged data.
const KEYBOARD_RAW = keyboardBuild.entries
const CONSUMER_RAW = consumerBuild.entries
const AC_RAW = acBuild.entries
const AL_RAW = alBuild.entries
const MEDIA_RAW = mediaBuild.entries
const CONTACT_RAW = contactBuild.entries
const SYSTEM_RAW = systemBuild.entries

const ENTRY_BY_ID = new Map<CanonicalKeyId, CatalogEntry>()
const indexEntries = (es: CatalogEntry[]): void => {
    for (const e of es) ENTRY_BY_ID.set(e.id, e)
}
indexEntries(KEYBOARD_RAW)
indexEntries(CONSUMER_RAW)
indexEntries(AC_RAW)
indexEntries(AL_RAW)
indexEntries(MEDIA_RAW)
indexEntries(CONTACT_RAW)
indexEntries(SYSTEM_RAW)
indexEntries(STATIC_ENTRIES)

// Merge each present secondary into its primary; record alias name for search.
for (const [secId, primId] of Object.entries(CANONICAL_ALIASES)) {
    const sec = ENTRY_BY_ID.get(secId)
    const prim = ENTRY_BY_ID.get(primId)
    if (!sec || !prim) continue
    prim.label = selectMergedLabel(prim, sec)
    mergePositioning(prim, sec)
    const aliasNames = prim.aliases ?? []
    if (!aliasNames.includes(sec.name)) aliasNames.push(sec.name)
    prim.aliases = aliasNames
}

// Append spec-name aliases (ZMK + QMK + KC_*/QK_*) and copy platform
// notes from external-names onto each entry. Runs after the HID-merge
// pass so secondary entries are already collapsed onto their primary.
for (const e of ENTRY_BY_ID.values()) {
    if (e.id in CANONICAL_ALIASES) continue
    const ext = EXTERNAL_NAMES[e.id]
    if (ext?.length) {
        const merged = e.aliases ? [...e.aliases] : []
        for (const a of ext) if (!merged.includes(a)) merged.push(a)
        e.aliases = merged
    }
    const note = EXTERNAL_NOTES[e.id]
    if (note) e.notes = note
}

// Drop secondary entries from each exported array.
const dropAliased = (es: CatalogEntry[]): CatalogEntry[] =>
    es.filter((e) => !(e.id in CANONICAL_ALIASES))

export const KEYBOARD_ENTRIES = dropAliased(KEYBOARD_RAW)
export const CONSUMER_ENTRIES = dropAliased(CONSUMER_RAW)
export const AC_ENTRIES = dropAliased(AC_RAW)
export const AL_ENTRIES = dropAliased(AL_RAW)
export const MEDIA_ENTRIES = dropAliased(MEDIA_RAW)
export const CONTACT_ENTRIES = dropAliased(CONTACT_RAW)
export const SYSTEM_ENTRIES = dropAliased(SYSTEM_RAW)

export const CATALOG: CatalogEntry[] = [
    ...KEYBOARD_ENTRIES,
    ...CONSUMER_ENTRIES,
    ...AC_ENTRIES,
    ...AL_ENTRIES,
    ...MEDIA_ENTRIES,
    ...CONTACT_ENTRIES,
    ...SYSTEM_ENTRIES,
    ...dropAliased(STATIC_ENTRIES),
]

// Encoder side: primary canonical id → HID usage. Walks aliases so an
// aliased secondary's usage is promoted to its primary when the primary
// has no native HID usage (e.g. mod.lctrl ← HID 7/224, media.transport.play_pause ← HID 12/205).
export const HID_USAGE_BY_CANONICAL: Map<CanonicalKeyId, HidUsage> = new Map()
const allUsageBuilds = [
    keyboardBuild,
    consumerBuild,
    acBuild,
    alBuild,
    mediaBuild,
    contactBuild,
    systemBuild,
]
for (const b of allUsageBuilds) {
    for (const [id, u] of b.usages) {
        const primary = resolveAlias(id)
        if (!HID_USAGE_BY_CANONICAL.has(primary)) {
            HID_USAGE_BY_CANONICAL.set(primary, u)
        }
    }
}

// Decoder side: every original (page, usage) → primary canonical id.
// Lets ZMK decode incoming HID 7/187 (Keypad Backspace) as primary
// key.keyboard_backspace, even though that secondary id no longer exists.
const packUsage = (page: number, usage: number): number => (page << 16) | usage
export const HID_USAGE_DECODE: Map<number, CanonicalKeyId> = new Map()
for (const b of allUsageBuilds) {
    for (const [id, u] of b.usages) {
        HID_USAGE_DECODE.set(packUsage(u.page, u.usage), resolveAlias(id))
    }
}
