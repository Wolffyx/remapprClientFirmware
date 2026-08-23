// Pattern check: Facade (Tier 1) — extended — same optional-facade idiom as
// EncoderApi / MacroApi / RgbApi / KeyTestApi in service.ts: one cohesive
// surface an adapter may or may not implement, read once by the app.
//
// Sideloading = teaching a connected device (or the editor's catalog) about
// something the firmware itself cannot report: a VIA/QMK board definition that
// names the physical layout and its RGB effect menus, a ZMK `.keymap` file whose
// combos never appear over the wire, and so on.
//
// The PARSERS for those sources are irreducibly firmware-specific, so they stay
// inside the client that owns them. What crosses into the app is only this
// neutral facade: the adapter declares which formats it accepts, ingests the
// bytes itself, and hands back a firmware-agnostic SideloadResult. The app
// renders a button per declared format and never learns that VIA JSON or ZMK
// keymaps exist.
import type { CatalogEntry } from './catalog/types'
import type { LightingCatalog } from './lighting'

/** What ingesting a source contributes — the app's cue for which affordance to
 *  render and what to do with the result.
 *  - `'layout'`: changes the device's physical layout / keymap.
 *  - `'catalog'`: adds display-only entries to the key picker. */
export type SideloadKind = 'layout' | 'catalog'

/** One source the adapter can ingest. `id` is passed back to `importFile` so an
 *  adapter accepting several formats can tell them apart. */
export interface SideloadFormat {
    readonly id: string
    readonly kind: SideloadKind
    /** `<input accept>` token(s) for the file picker, e.g. `'.json'`. */
    readonly accept: string
    /** Button label, e.g. `'Load layout JSON'`. */
    readonly label: string
    /** Tooltip / longer explanation. */
    readonly description?: string
}

/** Firmware-agnostic outcome of one ingest. Every field is optional except the
 *  name so a source that only contributes one thing stays cheap to implement. */
export interface SideloadResult {
    /** Human name of what was loaded — board name, macro set, file name. */
    readonly name: string
    /** Per-board RGB effect catalog, when the source carried one. */
    readonly lightingCatalog?: LightingCatalog | null
    /** Display-only picker entries contributed by the source. */
    readonly catalogEntries?: readonly CatalogEntry[]
    /** True when the device's keymap changed and the app must re-read it. */
    readonly keymapChanged?: boolean
}

/** Progress for a long-running `resolveAuto` lookup. Deliberately says
 *  `source`/`revision` rather than repo/branch — the app only renders it. */
export type SideloadStatus =
    | { phase: 'cache-hit' }
    | { phase: 'listing'; source: string; revision: string }
    | {
          phase: 'scanning'
          source: string
          revision: string
          processed: number
          total: number
      }
    | {
          phase: 'hit'
          source: string
          revision: string
          path: string
          name: string
      }
    /** A match was found and is now being pushed to the device — the slow part
     *  the app wants to name separately from the search. */
    | { phase: 'applying'; name: string }
    | { phase: 'miss' }
    | { phase: 'error'; message: string }

export interface SideloadApi {
    /** Sources this adapter accepts. Empty is legal (nothing renders). */
    readonly formats: readonly SideloadFormat[]

    /** Ingest one user-picked file. The adapter owns parse, validation, applying
     *  to the device and caching; it throws on a bad file. `formatId` is the
     *  {@link SideloadFormat.id} the user picked. */
    importFile(formatId: string, text: string): Promise<SideloadResult>

    /** Cheap, synchronous read of whatever was cached for this device — NO
     *  device I/O and no side effects. Lets the app seed derived state (the RGB
     *  effect list) and skip an online lookup when a cached def already exists.
     *  Adapters with no cache omit it. */
    readCached?(): SideloadResult | null

    /** Re-apply the cached source to the device on connect. Resolves null when
     *  nothing is cached. Adapters with no cache omit it. */
    restoreCached?(): Promise<SideloadResult | null>

    /** Look the device up in an online registry and apply the match. Resolves
     *  null on a miss. Adapters with no registry omit it. */
    resolveAuto?(
        onStatus: (status: SideloadStatus) => void,
    ): Promise<SideloadResult | null>
}
