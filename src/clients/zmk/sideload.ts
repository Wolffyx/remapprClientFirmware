// Pattern check: Factory Method (Tier 1) — extended — mirrors qmk/sideload.ts:
// builds the ZMK concrete SideloadApi so the `.keymap` devicetree parse and the
// combo→CatalogEntry shaping stay inside this client.
//
// ZMK combos live in the keymap's devicetree source, not in the runtime the
// Studio protocol exposes — a connected board can never report them. Reading the
// user's `.keymap` file is the only way to show them, so they arrive as
// display-only picker entries: informative, not assignable.
//
// NOT CURRENTLY WIRED — deliberately. ZmkKeyboardService does not declare a
// `sideload` facade, so no button renders for it (see the comment there for the
// one line that turns it on). Display-only combo tiles weren't worth the
// toolbar space yet; the implementation is kept ready rather than deleted.
import type {
    SideloadApi,
    SideloadFormat,
    SideloadResult,
} from '@firmware/sideload'
import type { CatalogEntry } from '@firmware/catalog/types'
import { parseZmkCombos, type ParsedCombo } from './parseCombos'

const COMBOS: SideloadFormat = {
    id: 'zmk-keymap-combos',
    kind: 'catalog',
    accept: '.keymap,.dtsi,.overlay',
    label: 'Load ZMK combos',
    description:
        'Import a .keymap file to list its combos in the key picker (display only — combos are compile-time).',
}

const FORMATS: readonly SideloadFormat[] = [COMBOS]

const HID_KIND: CatalogEntry['kinds'] = ['hid']

const labelFor = (combo: ParsedCombo): string => {
    const stripped = combo.name.replace(/^combo[_-]?/i, '')
    return stripped || combo.name
}

const noteFor = (combo: ParsedCombo): string => {
    const positions = combo.keyPositions.join(' + ')
    const layers = combo.layers ? ` · layers ${combo.layers.join(', ')}` : ''
    const timeout = combo.timeoutMs ? ` · ${combo.timeoutMs}ms` : ''
    return `keys ${positions} → ${combo.bindings}${layers}${timeout}`
}

const toCatalogEntry = (combo: ParsedCombo): CatalogEntry => ({
    id: `combo.sideload.${combo.name}`,
    label: labelFor(combo),
    name: combo.name,
    notes: noteFor(combo),
    kinds: HID_KIND,
    displayOnly: true,
})

export function createZmkSideload(): SideloadApi {
    return {
        formats: FORMATS,

        async importFile(formatId, text) {
            if (formatId !== COMBOS.id)
                throw new Error(`Unknown sideload format: ${formatId}`)
            const combos = parseZmkCombos(text)
            if (combos.length === 0)
                throw new Error('No combos found in that file')
            const result: SideloadResult = {
                name: `${combos.length} combo${combos.length === 1 ? '' : 's'}`,
                catalogEntries: combos.map(toCatalogEntry),
            }
            return result
        },
    }
}
