// Pattern check: no GoF pattern (-) — rejected — vitest tests verifying CATALOG entries are unique by id and bucketed via groupForId helper.
import { describe, expect, it } from 'vitest'

import { keychronCodec } from '../clients/keychron/codec'
import { mockCodec } from '../clients/mock/codec'
import { qmkCodec } from '../clients/qmk/codec'
import { vialCodec } from '../clients/qmk-vial/codec'
import { remapprCodec } from '../clients/remappr/codec'
import { zmkCodec } from '../clients/zmk/codec'
import type { KeycodeCodec } from '../codec'
import { CANONICAL_ALIASES } from './aliases'
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

describe('keyboard-page vs media volume keys', () => {
    const byId = (id: string) => CATALOG.find((e) => e.id === id)!

    it('names the keyboard-page keys as such and points to Media', () => {
        expect(byId('key.keyboard_volume_up')).toMatchObject({
            label: 'Kb Vol+',
            name: 'Volume Up (keyboard page)',
        })
        expect(byId('key.keyboard_volume_down').label).toBe('Kb Vol−')
        expect(byId('key.keyboard_mute').label).toBe('Kb Mute')
        expect(byId('key.keyboard_volume_up').notes).toMatch(/Media → Volume Increment/)
    })

    it('gives the media keys their spec names (ZMK C_VOL_UP lands on Media)', () => {
        expect(byId('media.volume_increment').aliases).toContain('C_VOL_UP')
        expect(byId('media.volume_decrement').aliases).toContain('C_VOL_DN')
        expect(byId('media.mute').aliases).toContain('C_MUTE')
    })

    it('every EXTERNAL_NAMES key is a catalog id (no name filed on a missing key)', () => {
        const ids = new Set(CATALOG.map((e) => e.id))
        const missing = Object.keys(EXTERNAL_NAMES).filter(
            (k) => !ids.has(k) && !(k in CANONICAL_ALIASES),
        )
        expect(missing).toEqual([])
    })

    it('brightness, input-assist and voice names land on their HID keys', () => {
        const id = (n: string) => CATALOG.find((e) => e.aliases?.includes(n))?.id
        expect(id('C_BRI_UP')).toBe('consumer.display_brightness_increment')
        expect(id('KC_BRIU')).toBe('consumer.display_brightness_increment')
        expect(id('C_KBIA_NEXT')).toBe('consumer.keyboard_input_assist_next')
        expect(id('C_VOICE_COMMAND')).toBe('media.voice_command')
        expect(id('KC_ASSISTANT')).toBe('al.al_context_aware_desktop_assistant')
    })

    it('every EXTERNAL_NAMES key the media page defines uses its media id', () => {
        const ids = new Set(CATALOG.map((e) => e.id))
        const misfiled = Object.keys(EXTERNAL_NAMES).filter(
            (k) => k.startsWith('consumer.') && ids.has(k.replace(/^consumer\./, 'media.')),
        )
        expect(misfiled).toEqual([])
    })
})

describe('each firmware shows its own key names', () => {
    it('ZMK, QMK and Remappr name the same keys their own way', () => {
        expect(zmkCodec.names('media.volume_increment')).toEqual(['C_VOLUME_UP', 'C_VOL_UP'])
        expect(qmkCodec.names('media.volume_increment')).toEqual(['KC_AUDIO_VOL_UP', 'KC_VOLU'])
        expect(remapprCodec.names('media.volume_increment')).toEqual(['RC_VOL_UP'])
        expect(remapprCodec.names('key.keyboard_a')).toEqual(['RK_A'])
        expect(vialCodec.names('key.keyboard_volume_up')).toEqual(['KC_KB_VOLUME_UP'])
        expect((mockCodec as KeycodeCodec).names).toBeUndefined()
    })

    it('Android keyboard-page codes are no alias of the HID keys', () => {
        const all = new Set(CATALOG.flatMap((e) => e.aliases ?? []))
        for (const n of ['K_VOLUME_UP2', 'K_VOL_DN2', 'K_MUTE2', 'K_PLAY_PAUSE', 'K_PP', 'K_NEXT', 'K_PREV'])
            expect(all.has(n), n).toBe(false)
    })

    it('Play, Pause and Play/Pause are three keys (HID 0xB0, 0xB1, 0xCD)', () => {
        expect(HID_USAGE_BY_CANONICAL.get('media.play')).toEqual({ page: 12, usage: 0xb0 })
        expect(HID_USAGE_BY_CANONICAL.get('media.pause')).toEqual({ page: 12, usage: 0xb1 })
        expect(HID_USAGE_BY_CANONICAL.get('media.transport.play_pause')).toEqual({ page: 12, usage: 0xcd })
        expect(remapprCodec.decode((12 << 16) | 0xcd)?.canonicalId).toBe('media.transport.play_pause')
    })

    it('the 4 HID Usage Tables 1.7 consumer usages are in the catalog', () => {
        for (const u of [0x07, 0x515, 0x516, 0x517])
            expect(zmkCodec.decode((12 << 16) | u), u.toString(16)).not.toBeNull()
    })
})
