// Pattern check: Factory Method (Tier 1) — applied — builds the QMK/VIA concrete
// SideloadApi over this client's own parsers and localStorage cache, so every
// VIA-format detail (board JSON shape, `raw.menus`, the registry scan) stays
// inside the client and the app only ever sees the neutral facade.
//
// The QMK/VIA sideload source: a VIA-style keyboard definition JSON. It names
// the physical layout (which the protocol cannot report) and carries the board's
// `menus`, from which the real per-board RGB effect list is derived.
import type {
    SideloadApi,
    SideloadFormat,
    SideloadResult,
    SideloadStatus,
} from '@firmware/sideload'
import type { KeyboardService } from '@firmware/service'
import type { ParsedKeyboardDef } from '@firmware/kle/parser'
import { parseLightingMenu } from '@firmware/clients/via/lightingMenu'
import {
    cacheKey,
    loadCached,
    parseSideloadJson,
    saveCached,
} from './layoutSideload'
import { findDef, type LookupStatus } from './viaRegistry'

/** The one format this client accepts. Exported id so importFile can assert it. */
const LAYOUT_JSON: SideloadFormat = {
    id: 'via-layout-json',
    kind: 'layout',
    accept: '.json,application/json',
    label: 'Load layout JSON',
    description:
        'Import a VIA/QMK keyboard definition to set this board’s physical layout and RGB effect list.',
}

const FORMATS: readonly SideloadFormat[] = [LAYOUT_JSON]

/** Neutral result for a parsed board def. Lighting comes from the board's own
 *  `menus`, so a def with none simply yields a null catalog. */
function toResult(
    def: ParsedKeyboardDef,
    keymapChanged: boolean,
): SideloadResult {
    return {
        name: def.name,
        lightingCatalog: parseLightingMenu(def.raw.menus),
        keymapChanged,
    }
}

/** viaRegistry speaks GitHub (repo/branch); the neutral status says
 *  source/revision. Same phases, renamed fields. */
function toStatus(s: LookupStatus): SideloadStatus {
    switch (s.phase) {
        case 'listing':
            return { phase: 'listing', source: s.repo, revision: s.branch }
        case 'scanning':
            return {
                phase: 'scanning',
                source: s.repo,
                revision: s.branch,
                processed: s.processed,
                total: s.total,
            }
        case 'hit':
            return {
                phase: 'hit',
                source: s.repo,
                revision: s.branch,
                path: s.path,
                name: s.name,
            }
        default:
            return s
    }
}

export function createQmkSideload(service: KeyboardService): SideloadApi {
    const key = (): string | null => cacheKey(service.deviceInfo)

    /** Push a def onto the device and remember it for the next connect. */
    const apply = async (def: ParsedKeyboardDef): Promise<SideloadResult> => {
        if (!service.applyLayout)
            throw new Error('This device cannot accept a sideloaded layout')
        await service.applyLayout(def)
        const k = key()
        if (k) saveCached(k, def)
        return toResult(def, true)
    }

    return {
        formats: FORMATS,

        async importFile(formatId, text) {
            if (formatId !== LAYOUT_JSON.id)
                throw new Error(`Unknown sideload format: ${formatId}`)
            return apply(parseSideloadJson(text))
        },

        readCached() {
            const k = key()
            const def = k ? loadCached(k) : null
            // Cache read only — nothing was pushed to the device, so the keymap
            // is untouched.
            return def ? toResult(def, false) : null
        },

        async restoreCached() {
            const k = key()
            const def = k ? loadCached(k) : null
            if (!def) return null
            // Already cached — re-apply to the device but don't rewrite the entry.
            if (!service.applyLayout) return null
            await service.applyLayout(def)
            return toResult(def, true)
        },

        async resolveAuto(onStatus) {
            const { vid, pid, name } = service.deviceInfo
            if (vid === undefined || pid === undefined) return null
            const def = await findDef(vid, pid, name, (s) =>
                onStatus(toStatus(s)),
            )
            if (!def) return null
            onStatus({ phase: 'applying', name: def.name })
            return apply(def)
        },
    }
}
