// Pattern check: no GoF pattern (-) — rejected — vitest tests verifying CATALOG entries are unique by id and bucketed via groupForId helper.
import { describe, expect, it } from 'vitest'

import { keychronCodec } from '../clients/keychron/codec'
import { mockCodec } from '../clients/mock/codec'
import { qmkCodec } from '../clients/qmk/codec'
import { vialCodec } from '../clients/qmk-vial/codec'
import { zmkCodec } from '../clients/zmk/codec'
import { CATALOG, HID_USAGE_BY_CANONICAL } from './entries'
import { EXTERNAL_NAMES, EXTERNAL_NAMES_ALLOWLIST } from './external-names'
import { CATALOG_PAGES, groupForId } from './pages'

describe('canonical catalog', () => {
    it('every entry has a unique id', () => {
        const seen = new Set<string>()
        for (const entry of CATALOG) {
            expect(seen.has(entry.id), `duplicate id: ${entry.id}`).toBe(false)
            seen.add(entry.id)
        }
    })

    it('every entry maps to a known page via groupForId', () => {
        const pageIds = new Set(CATALOG_PAGES.map((p) => p.id))
        for (const entry of CATALOG) {
            const page = groupForId(entry.id)
            expect(page, `no page for ${entry.id}`).not.toBeNull()
            expect(pageIds.has(page!), `unknown page ${page}`).toBe(true)
        }
    })

    it('HID page-7 entries are reachable by canonical id', () => {
        // "Keyboard A" → 'key.keyboard_a' with HID page 7, usage 0x04.
        const u = HID_USAGE_BY_CANONICAL.get('key.keyboard_a')
        expect(u?.page).toBe(7)
        expect(u?.usage).toBe(0x04)
    })

    it('contains wireless + os-keys + macros pages', () => {
        const ids = CATALOG_PAGES.map((p) => p.id)
        expect(ids).toContain('wireless')
        expect(ids).toContain('os-keys')
        expect(ids).toContain('macros')
    })

    it('every entry is encodable by at least one codec', () => {
        const codecs = [qmkCodec, keychronCodec, vialCodec, zmkCodec, mockCodec]
        const orphans: string[] = []
        for (const entry of CATALOG) {
            if (!codecs.some((c) => c.encode(entry.id) !== null)) {
                orphans.push(entry.id)
            }
        }
        expect(
            orphans,
            `orphaned canonical ids: ${orphans.join(', ')}`,
        ).toEqual([])
    })

    // Pages whose entries should each have at least one ZMK or QMK
    // alias from external-names (or be on the explicit allowlist).
    // `media` is intentionally excluded: the page mixes the seven
    // user-visible MEDIA_TRANSPORT_ENTRIES (covered explicitly via the
    // round-trip test) with the full HID 12 consumer-page dump (most
    // of which — channel/treble/bass/sub-channel — have no ZMK or QMK
    // documented spelling). Same for `consumer` for similar reasons.
    const SPEC_MAPPED_PAGES = new Set([
        'keyboard',
        'wireless',
        'mouse',
        'lighting',
        'audio',
        'magic',
        'quantum',
        'os-keys',
    ])

    it('every spec-mapped entry has external aliases or is allowlisted', () => {
        const missing: string[] = []
        for (const page of CATALOG_PAGES) {
            if (!SPEC_MAPPED_PAGES.has(page.id)) continue
            for (const entry of page.entries) {
                if (EXTERNAL_NAMES_ALLOWLIST.has(entry.id)) continue
                const ext = EXTERNAL_NAMES[entry.id]
                if (!ext || ext.length === 0) missing.push(entry.id)
            }
        }
        expect(
            missing,
            `entries missing external names (add to EXTERNAL_NAMES or EXTERNAL_NAMES_ALLOWLIST): ${missing.join(', ')}`,
        ).toEqual([])
    })

    it('external alias names are unique across the catalog', () => {
        const seen = new Map<string, string>()
        const dups: string[] = []
        for (const [id, names] of Object.entries(EXTERNAL_NAMES)) {
            for (const n of names) {
                const prev = seen.get(n)
                if (prev && prev !== id) {
                    dups.push(`${n} → both ${prev} and ${id}`)
                } else {
                    seen.set(n, id)
                }
            }
        }
        expect(dups, `duplicate aliases: ${dups.join('; ')}`).toEqual([])
    })

    it('aliases land on the catalog entries', () => {
        const byId = new Map(CATALOG.map((e) => [e.id, e]))
        const samples: Array<[string, string[]]> = [
            ['key.keyboard_backspace', ['BSPC', 'KC_BSPC']],
            ['mod.lctrl', ['LCTRL', 'KC_LCTL']],
            ['key.keyboard_return_enter', ['RET', 'KC_ENT', 'RETURN2']],
            ['wireless.profile.1', ['BT_PRF1', 'BT_SEL 0']],
            ['wireless.bt.clear', ['BT_CLR']],
            ['wireless.bt.clear_all', ['BT_CLR_ALL']],
            ['key.keypad_equal_sign', ['KP_EQUAL_AS400']],
            ['key.keypad_clear_entry', ['CLEAR2']],
            ['key.shifted.tilde', ['TILDE', 'KC_TILD']],
            ['media.transport.play_pause', ['KC_MPLY', 'C_PP']],
            ['system.bootloader', ['QK_BOOT', '&bootloader']],
        ]
        for (const [id, names] of samples) {
            const entry = byId.get(id)
            expect(entry, `missing entry: ${id}`).toBeDefined()
            for (const n of names) {
                expect(
                    entry?.aliases ?? [],
                    `${id} should carry alias ${n}`,
                ).toContain(n)
            }
        }
    })

    it('allowlisted ids exist in the catalog', () => {
        const ids = new Set(CATALOG.map((e) => e.id))
        const orphan: string[] = []
        for (const id of EXTERNAL_NAMES_ALLOWLIST) {
            if (!ids.has(id)) orphan.push(id)
        }
        expect(
            orphan,
            `EXTERNAL_NAMES_ALLOWLIST contains ids not in CATALOG: ${orphan.join(', ')}`,
        ).toEqual([])
    })
})
