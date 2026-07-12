// Pattern check: Adapter (Tier 1) — extended — RemapprKeyboardService backs the
// KeyboardService facade like MockKeyboardService / QmkKeyboardService, wrapping
// the live sealed control RPC + the decoded config (source of truth) as the
// editor's keyboard model. Config-as-source-of-truth: device read → decode →
// lower to a neutral editing buffer; edits mutate the buffer; commit raises →
// compiles → seals the blob back.
import { filterCatalogByCodec } from '../catalog/filter'
import type { KeyCatalog } from '../catalog/types'
import type {
    Capabilities,
    DynamicEntriesApi,
    KeyboardService,
    KeyTestApi,
    MacroApi,
    NodesApi,
} from '../service'
import type {
    ActionType,
    AdapterNotification,
    DeviceInfo,
    ExportedFile,
    KeyAction,
    Keymap,
    KeyUpdate,
    Layer,
    LockState,
    PhysicalLayout,
} from '../types'
import { ProtocolError } from '../errors'
import {
    type CanonConditionalLayer,
    type CanonHoldTapDef,
    type CanonMacro,
    type CanonModMorph,
    type CanonTapDance,
    type ConfigDefaults,
    type ConfigKeymap,
    serializeKeymap,
} from '../config'
import { buildRemapprBlob } from '../config/compilers/remappr'

import {
    buildRemapprActionTypes,
    buildRemapprKeyAction,
    relabelLayer,
    REMAPPR_KIND_MACRO,
    REMAPPR_KIND_MOD_MORPH,
    REMAPPR_KIND_TAP_DANCE,
    REMAPPR_KIND_TRANSPARENT,
} from './actions'
import { remapprCodec } from './codec'
import { lowerConfigToNeutral, raiseNeutralToConfig } from './configBridge'
import {
    actionsToMacro,
    comboToEntry,
    entryToTapDance,
    isRichTapDance,
    macroToActions,
    tapDanceToEntry,
} from './dynamicBridge'
import type { RemapprRpc } from './rpc'
import type { RemapprSession } from './auth'
import {
    BLOB_ALIGN,
    Cmd,
    LEGACY_SEALED_CHUNK,
    type Limits,
    Status,
    statusName,
} from './protocol'

type NotificationHandler = (notification: AdapterNotification) => void
type PendingChangesHandler = (pending: boolean) => void
type ClosedHandler = (reason?: unknown) => void

export interface RemapprServiceDeps {
    rpc: RemapprRpc
    /** Control-auth session for sealed writes. Omitted for read-only node views,
     *  which never seal. */
    session?: RemapprSession
    deviceInfo: DeviceInfo
    /** Decoded active config (source of truth); the editing buffer lowers from it. */
    config: ConfigKeymap
    /** Active blob config_version; the next commit pushes version+1. */
    configVersion: number
    layouts: PhysicalLayout[]
    activeLayoutId: number
    /** Max layer slots the blob reader accepts (from GET_KEYMAP_BOUNDS / default). */
    maxLayers: number
    limits?: Limits
    /** Whole-device read-only (behind-dongle node view + the dongle itself): every
     *  edit throws and there is no keyTest. Does NOT decide transport ownership —
     *  see `sharesTransport`. */
    readOnly?: boolean
    /** True when this service borrows another service's transport (a behind-dongle
     *  node view rides the dongle's RPC), so disconnect() must NOT tear it down.
     *  False/omitted for a service that owns its transport (a direct keyboard or
     *  the dongle itself), which closes it on disconnect. */
    sharesTransport?: boolean
    /** Device class surfaced to the renderer (`'dongle'` lands on the roster). */
    kind?: 'keyboard' | 'dongle'
    /** Behind-dongle roster facade — set on the dongle's own service, omitted on a
     *  node view (no nesting). */
    nodes?: NodesApi
}

/** Round `b` up to a multiple of `align` with zero padding (flash alignment). */
function padTo(b: Uint8Array, align: number): Uint8Array {
    const n = Math.ceil(b.length / align) * align
    if (n === b.length) return b
    const out = new Uint8Array(n)
    out.set(b)
    return out
}

export class RemapprKeyboardService implements KeyboardService {
    public readonly deviceInfo: DeviceInfo
    public readonly capabilities: Capabilities
    /** `'dongle'` for the dongle's own service; `'keyboard'` (default) otherwise. */
    public readonly kind: 'keyboard' | 'dongle'
    public readonly codec = remapprCodec
    /** Live matrix readout — direct devices only; a node's relayed input plane is
     *  unsupported, so read-only views omit it. */
    public readonly keyTest?: KeyTestApi
    /** Behind-dongle roster — present on the dongle's own service, omitted on a
     *  node view (a node has no nodes of its own). */
    public readonly nodes?: NodesApi
    /** Read-only macro list (§24): the active config's macros surfaced to the
     *  Macros tab by their real DT names. Editing (setMacro) lands with the
     *  round-trip; for now `readonly: true`. */
    public readonly macros?: MacroApi
    /** Read-only dynamic entries (§24): tap-dance + combo surfaced to their tabs.
     *  Mod-morph has no tab (it shows on the bound key); set* reject for now. */
    public readonly dynamic?: DynamicEntriesApi

    private readonly rpc: RemapprRpc
    private readonly session?: RemapprSession
    private readonly readOnly: boolean
    /** Borrowed transport (node view) — disconnect() must not close it. */
    private readonly sharesTransport: boolean
    /** Decoded config = source of truth; updated only on a successful commit. */
    private config: ConfigKeymap
    private configVersion: number
    private readonly sealedChunk: number

    private layers: Layer[] = []
    private layouts: PhysicalLayout[]
    private activeLayoutId: number
    private readonly keyCount: number
    private readonly maxLayers: number
    private nextLayerId = 0
    private pendingChanges = false
    private closed = false
    // Pending macro / tap-dance edits (§24), overlaid on `config` at commit so the
    // committed config stays the source of truth and discard reverts cleanly —
    // same contract as the neutral `layers` buffer. Keyed by pool index.
    private readonly editedMacros = new Map<number, CanonMacro>()
    private readonly editedTapDances = new Map<number, CanonTapDance>()
    // Pending config-blob defaults patch (§7.4.1 timing tail), overlaid on
    // `config.defaults` at commit — same discard/commit contract as the macro /
    // tap-dance edit maps. Config-blob backed → staged via the concrete-service
    // setConfigDefaults(), never the generic KeyboardService interface.
    private editedDefaults: Partial<ConfigDefaults> = {}
    // Pending custom hold-tap / mod-morph def edits, overlaid on their pool at
    // commit — same per-index contract as editedMacros. Config-blob backed →
    // staged via concrete-service setHoldTap/setModMorph, not the interface.
    private readonly editedHoldTaps = new Map<number, CanonHoldTapDef>()
    private readonly editedModMorphs = new Map<number, CanonModMorph>()
    // Pending conditional-(tri-)layer list edit, overlaid on
    // `config.conditionalLayers` at commit. Unlike the per-index def pools above,
    // tri-layers are a variable-length, name-referenced list the user authors from
    // scratch (add / remove / edit), so the overlay is a whole-list replacement
    // (null = no edit) — closer to editedDefaults than the per-index maps. Staged
    // via concrete-service setConditionalLayers(), not the generic interface.
    private editedConditionalLayers: CanonConditionalLayer[] | null = null

    private readonly notificationListeners = new Set<NotificationHandler>()
    private readonly pendingChangesListeners = new Set<PendingChangesHandler>()
    private readonly closedListeners = new Set<ClosedHandler>()

    constructor(deps: RemapprServiceDeps) {
        this.rpc = deps.rpc
        this.session = deps.session
        this.readOnly = deps.readOnly ?? false
        this.sharesTransport = deps.sharesTransport ?? false
        this.kind = deps.kind ?? 'keyboard'
        this.nodes = deps.nodes
        this.deviceInfo = deps.deviceInfo
        this.config = deps.config
        this.configVersion = deps.configVersion
        this.layouts = deps.layouts
        this.activeLayoutId = deps.activeLayoutId
        this.maxLayers = Math.max(deps.maxLayers, deps.config.layers.length || 1)
        this.keyCount = deps.config.layers[0]?.bindings.length ?? 0
        // Legacy sealed (0xE1) data plane is 32 blob-bytes/chunk; the universal
        // path's smaller max_sealed_chunk (16) does not apply to direct writes.
        this.sealedChunk = LEGACY_SEALED_CHUNK

        this.capabilities = {
            lock: false,
            rename: !this.readOnly,
            notifications: false,
            reorderLayers: !this.readOnly,
            variableLayerCount: !this.readOnly,
            exportFormats: ['remappr.keymap.json'],
            // Edits raise into a config blob that `commit()` writes + validates on
            // the device; the write can fail, so it's a manual Save (unless the
            // node is read-only, where the UI hides editing via `readOnly`).
            saveMode: 'manual',
            // Remappr firmware owns its persistence: the committed config blob is
            // written durably to device storage as a first-class feature.
            persistence: true,
            maxLayers: this.maxLayers,
            readOnly: this.readOnly,
        }

        this.seedLayersFromConfig()

        // Key-Test: legacy 0xE0 INPUT events → the set of pressed positions. Direct
        // devices only — the rpc here is the shared dongle channel, so a relayed
        // node view omits keyTest (a node's input events don't ride it).
        if (!this.readOnly) {
            this.keyTest = {
                onMatrixState: (cb) => {
                    const pressed = new Set<number>()
                    return this.rpc.subscribeInput((ie) => {
                        if (ie.pressed) pressed.add(ie.inputId)
                        else pressed.delete(ie.inputId)
                        cb(new Set(pressed))
                    })
                },
            }
        }

        // pattern-check: skip — facade object literals mirroring keyTest/nodes;
        // the class is already the Adapter/Facade declared in the file header.
        // Dynamic entries (§24): surface the decoded macros + composites read-only
        // so the Macros / Tap-Dance / Combo tabs render real names. Editing lands
        // with the round-trip; until then every set* rejects.
        // pattern-check: skip — facade method bodies delegating to dynamicBridge
        this.macros = {
            getCount: () => this.config.macros?.length ?? 0,
            readonly: this.readOnly,
            // §24 named macros surfaced as key-assignable tiles: the picker
            // lists these by their real DT names in the Macros tab.
            listNames: () => (this.config.macros ?? []).map((m) => m.id),
            getMacro: async (idx) => {
                const m = this.macroAt(idx)
                if (!m) throw new ProtocolError(`No macro at index ${idx}`)
                return macroToActions(m)
            },
            setMacro: async (idx, actions) => {
                this.assertWritable()
                const m = this.config.macros?.[idx]
                if (!m) throw new ProtocolError(`No macro at index ${idx}`)
                this.editedMacros.set(idx, actionsToMacro(m.id, m.params, actions))
                this.markPending(true)
            },
        }
        this.dynamic = {
            getCounts: () => ({
                tapDance: this.config.tapDances?.length ?? 0,
                combo: this.config.combos?.length ?? 0,
                keyOverride: 0, // out of §24 scope; not surfaced as a tab yet
            }),
            getTapDance: async (idx) => {
                const td = this.tapDanceAt(idx)
                if (!td) throw new ProtocolError(`No tap-dance at index ${idx}`)
                return tapDanceToEntry(td)
            },
            setTapDance: async (idx, entry) => {
                this.assertWritable()
                const td = this.config.tapDances?.[idx]
                if (!td) throw new ProtocolError(`No tap-dance at index ${idx}`)
                // Rich composites (nested / >2 taps) can't round-trip the 4-slot
                // editor — refuse rather than silently drop the extra steps (§24).
                if (isRichTapDance(td)) {
                    throw new ProtocolError(
                        `Tap-dance "${td.id}" is too complex to edit here ` +
                            '(nested or multi-tap); edit it as JSON instead.',
                    )
                }
                this.editedTapDances.set(idx, entryToTapDance(td.id, entry))
                this.markPending(true)
            },
            getCombo: async (idx) => {
                const c = this.config.combos?.[idx]
                if (!c) throw new ProtocolError(`No combo at index ${idx}`)
                return comboToEntry(c)
            },
            setCombo: async () => {
                throw new ProtocolError('Editing combos is not yet supported')
            },
            getKeyOverride: async () => {
                throw new ProtocolError('Key overrides are not surfaced yet')
            },
            setKeyOverride: async () => {
                throw new ProtocolError('Editing key overrides is not yet supported')
            },
        }

        this.rpc.onClosed((reason) => this.fireClosed(reason))
    }

    /** Reject every edit on a read-only (behind-dongle node) view. */
    private assertWritable(): void {
        if (this.readOnly) {
            throw new ProtocolError(
                'Read-only node view: editing a behind-dongle node is not yet ' +
                    'supported (relayed-write is HW-proof-pending).',
            )
        }
    }

    /* ── editing buffer ─────────────────────────────────────────────────── */

    /** The macro at `idx` with any pending edit applied (read path). */
    private macroAt(idx: number): CanonMacro | undefined {
        return this.editedMacros.get(idx) ?? this.config.macros?.[idx]
    }

    private tapDanceAt(idx: number): CanonTapDance | undefined {
        return this.editedTapDances.get(idx) ?? this.config.tapDances?.[idx]
    }

    /** Resolve a composite binding's display name from its pool (§24) so a
     *  freshly bound macro / tap-dance / mod-morph shows its real name on the
     *  keycap, not "#<index>". Non-composite kinds (and out-of-range indices)
     *  return undefined; labelFor then ignores the field. */
    private compositeName(kind: string, params: number[]): string | undefined {
        const idx = params[0] ?? 0
        if (kind === REMAPPR_KIND_MACRO) return this.macroAt(idx)?.id
        if (kind === REMAPPR_KIND_TAP_DANCE) return this.tapDanceAt(idx)?.id
        if (kind === REMAPPR_KIND_MOD_MORPH) {
            return this.config.modMorphs?.[idx]?.id
        }
        return undefined
    }

    /** `base` with pending macro / tap-dance / defaults / hold-tap / mod-morph
     *  edits overlaid (for commit/export). */
    private withEdits(base: ConfigKeymap): ConfigKeymap {
        const hasDefaultEdits = Object.keys(this.editedDefaults).length > 0
        if (
            this.editedMacros.size === 0 &&
            this.editedTapDances.size === 0 &&
            this.editedHoldTaps.size === 0 &&
            this.editedModMorphs.size === 0 &&
            this.editedConditionalLayers === null &&
            !hasDefaultEdits
        ) {
            return base
        }
        return {
            ...base,
            ...(base.macros
                ? { macros: base.macros.map((m, i) => this.editedMacros.get(i) ?? m) }
                : {}),
            ...(base.tapDances
                ? {
                      tapDances: base.tapDances.map(
                          (t, i) => this.editedTapDances.get(i) ?? t,
                      ),
                  }
                : {}),
            ...(base.holdTaps
                ? {
                      holdTaps: base.holdTaps.map(
                          (h, i) => this.editedHoldTaps.get(i) ?? h,
                      ),
                  }
                : {}),
            ...(base.modMorphs
                ? {
                      modMorphs: base.modMorphs.map(
                          (m, i) => this.editedModMorphs.get(i) ?? m,
                      ),
                  }
                : {}),
            ...(this.editedConditionalLayers
                ? { conditionalLayers: this.editedConditionalLayers }
                : {}),
            ...(hasDefaultEdits
                ? { defaults: { ...base.defaults, ...this.editedDefaults } }
                : {}),
        }
    }

    private clearEdits(): void {
        this.editedMacros.clear()
        this.editedTapDances.clear()
        this.editedDefaults = {}
        this.editedHoldTaps.clear()
        this.editedModMorphs.clear()
        this.editedConditionalLayers = null
    }

    private seedLayersFromConfig(): void {
        const { layers } = lowerConfigToNeutral(this.config)
        this.nextLayerId = 0
        this.layers = layers.map((l) => ({
            id: this.nextLayerId++,
            name: l.name,
            keys: l.keys,
        }))
    }

    private layerNames(): string[] {
        return this.layers.map((l) => l.name)
    }

    private layerIndexById(layerId: number): number {
        return this.layers.findIndex((l) => l.id === layerId)
    }

    private makeFiller(): KeyAction[] {
        return Array.from({ length: this.keyCount }, () =>
            buildRemapprKeyAction(REMAPPR_KIND_TRANSPARENT, [], this.layerNames()),
        )
    }

    private markPending(pending: boolean): void {
        if (this.pendingChanges === pending) return
        this.pendingChanges = pending
        for (const cb of this.pendingChangesListeners) cb(pending)
    }

    /* ── lock (auth happens at connect → always unlocked) ───────────────── */

    async getLockState(): Promise<LockState> {
        return 'not-applicable'
    }

    async unlock(): Promise<void> {
        /* the control-auth handshake already ran during connect() */
    }

    onLockStateChanged(): () => void {
        return () => undefined
    }

    /* ── action catalog ─────────────────────────────────────────────────── */

    async listActionTypes(): Promise<ActionType[]> {
        return buildRemapprActionTypes(this.maxLayers)
    }

    buildKeyAction(kind: string, params: number[]): KeyAction {
        return buildRemapprKeyAction(
            kind,
            params,
            this.layerNames(),
            undefined,
            this.compositeName(kind, params),
        )
    }

    async listKeyCatalog(): Promise<KeyCatalog> {
        return filterCatalogByCodec(this.codec)
    }

    /* ── keymap read ────────────────────────────────────────────────────── */

    async getKeymap(): Promise<Keymap> {
        const names = this.layerNames()
        return {
            layers: this.layers.map((l) => ({
                id: l.id,
                name: l.name,
                keys: relabelLayer(l.keys, names),
            })),
            availableLayers: Math.max(0, this.maxLayers - this.layers.length),
            activeLayoutId: this.activeLayoutId,
            layouts: this.layouts.map((l) => ({ ...l })),
        }
    }

    async getPhysicalLayouts(): Promise<{
        layouts: PhysicalLayout[]
        activeLayoutId: number
    }> {
        return {
            layouts: this.layouts.map((l) => ({ ...l })),
            activeLayoutId: this.activeLayoutId,
        }
    }

    /* ── keymap edits (in-memory; pushed on commit) ─────────────────────── */

    async setKey(
        layerId: number,
        position: number,
        action: KeyAction,
    ): Promise<void> {
        this.assertWritable()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        if (position < 0 || position >= this.keyCount) {
            throw new ProtocolError(`Position out of range: ${position}`)
        }
        const layer = this.layers[idx]
        const next = layer.keys.slice()
        next[position] = buildRemapprKeyAction(
            action.kind,
            action.params,
            this.layerNames(),
            action.label?.modifiers,
            // Persist the composite's real name in the buffer so relabelLayer
            // (getKeymap / layer ops) keeps it across a re-render (§24).
            this.compositeName(action.kind, action.params),
        )
        this.layers[idx] = { ...layer, keys: next }
        this.markPending(true)
    }

    async setKeys(updates: KeyUpdate[]): Promise<void> {
        for (const u of updates) await this.setKey(u.layerId, u.position, u.action)
    }

    async addLayer(): Promise<Layer> {
        this.assertWritable()
        if (this.layers.length >= this.maxLayers) {
            throw new ProtocolError('Max layers reached')
        }
        const layer: Layer = {
            id: this.nextLayerId++,
            name: `Layer ${this.layers.length}`,
            keys: this.makeFiller(),
        }
        this.layers.push(layer)
        this.markPending(true)
        return { ...layer, keys: relabelLayer(layer.keys, this.layerNames()) }
    }

    async removeLayer(layerId: number): Promise<void> {
        this.assertWritable()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        if (this.layers.length <= 1) {
            throw new ProtocolError('Cannot remove the only layer')
        }
        this.layers.splice(idx, 1)
        this.markPending(true)
    }

    async renameLayer(layerId: number, name: string): Promise<void> {
        this.assertWritable()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        this.layers[idx] = { ...this.layers[idx], name }
        this.markPending(true)
    }

    async moveLayer(startIndex: number, destIndex: number): Promise<void> {
        this.assertWritable()
        if (
            startIndex < 0 ||
            startIndex >= this.layers.length ||
            destIndex < 0 ||
            destIndex >= this.layers.length
        ) {
            throw new ProtocolError(
                `moveLayer indices out of range: ${startIndex} -> ${destIndex}`,
            )
        }
        const [moved] = this.layers.splice(startIndex, 1)
        this.layers.splice(destIndex, 0, moved)
        this.markPending(true)
    }

    async restoreLayer(layerId: number, atIndex: number): Promise<Layer> {
        this.assertWritable()
        const layer: Layer = {
            id: layerId,
            name: `Restored ${layerId}`,
            keys: this.makeFiller(),
        }
        const clamped = Math.max(0, Math.min(atIndex, this.layers.length))
        this.layers.splice(clamped, 0, layer)
        this.nextLayerId = Math.max(this.nextLayerId, layerId + 1)
        this.markPending(true)
        return { ...layer, keys: relabelLayer(layer.keys, this.layerNames()) }
    }

    async setActivePhysicalLayout(layoutId: number): Promise<Keymap> {
        if (!this.layouts.some((l) => l.id === layoutId)) {
            throw new ProtocolError(`Unknown layout id: ${layoutId}`)
        }
        this.activeLayoutId = layoutId
        return this.getKeymap()
    }

    /* ── commit / discard (sealed config push) ──────────────────────────── */

    /* ── config-blob defaults (§7.4.1 timing tail) ──────────────────────────
     * Remappr-specific: these settings live in the config blob, so the API is on
     * the concrete service, NOT the generic KeyboardService interface (ZMK / QMK
     * / Keychron have no config-blob defaults to leak onto). Edits stage into
     * `editedDefaults` and land on the next commit(), same as macro edits. */

    /** The active defaults with any pending edit applied — read path for a UI
     *  editor (device-truth defaults merged with unsaved staged changes). */
    getConfigDefaults(): ConfigDefaults {
        return { ...this.config.defaults, ...this.editedDefaults }
    }

    /** Stage a defaults patch, overlaid on the committed defaults at the next
     *  commit(). A key set to `undefined` drops its pending edit (reverts to the
     *  committed value); set 0 to force the firmware default. Marks pending so
     *  Save lights up; discard/reset clear it like any other edit. */
    setConfigDefaults(patch: Partial<ConfigDefaults>): void {
        this.assertWritable()
        for (const key of Object.keys(patch) as (keyof ConfigDefaults)[]) {
            const value = patch[key]
            if (value === undefined) delete this.editedDefaults[key]
            else this.editedDefaults[key] = value
        }
        this.markPending(true)
    }

    /* ── custom hold-tap / mod-morph defs (config-blob pools) ────────────────
     * Same concrete-only rationale as config defaults: these behavior-definition
     * pools live in the blob, so the setters are on RemapprKeyboardService, not
     * the generic KeyboardService interface. A patch merges onto the def at `idx`
     * and lands on the next commit(). */

    /** The custom hold-tap defs, device-truth merged with any staged edit. */
    getHoldTaps(): CanonHoldTapDef[] {
        return (this.config.holdTaps ?? []).map(
            (h, i) => this.editedHoldTaps.get(i) ?? h,
        )
    }

    /** Stage a patch onto the hold-tap def at `idx` (flavor / timing / flags),
     *  applied at the next commit(). Throws if `idx` is out of range. */
    setHoldTap(idx: number, patch: Partial<CanonHoldTapDef>): void {
        this.assertWritable()
        const cur = this.editedHoldTaps.get(idx) ?? this.config.holdTaps?.[idx]
        if (!cur) throw new ProtocolError(`no hold-tap definition at index ${idx}`)
        this.editedHoldTaps.set(idx, { ...cur, ...patch })
        this.markPending(true)
    }

    /** The mod-morph defs, device-truth merged with any staged edit. */
    getModMorphs(): CanonModMorph[] {
        return (this.config.modMorphs ?? []).map(
            (m, i) => this.editedModMorphs.get(i) ?? m,
        )
    }

    /** Stage a patch onto the mod-morph def at `idx` (mods / keepMods), applied
     *  at the next commit(). Throws if `idx` is out of range. */
    setModMorph(idx: number, patch: Partial<CanonModMorph>): void {
        this.assertWritable()
        const cur = this.editedModMorphs.get(idx) ?? this.config.modMorphs?.[idx]
        if (!cur)
            throw new ProtocolError(`no mod-morph definition at index ${idx}`)
        this.editedModMorphs.set(idx, { ...cur, ...patch })
        this.markPending(true)
    }

    /* ── conditional (tri-)layers (§44.3) ───────────────────────────────────
     * Same concrete-only rationale as the def pools, but a tri-layer set is a
     * variable-length, name-referenced list the user authors from scratch, so the
     * overlay is a whole-list replacement (add / remove / edit all route through
     * one setter) rather than a per-index patch. Lands on the next commit(). */

    /** The conditional (tri-)layers — device truth, or the staged list once edited.
     *  Returns a deep copy so a UI editor can mutate its working array freely. */
    getConditionalLayers(): CanonConditionalLayer[] {
        const src =
            this.editedConditionalLayers ?? this.config.conditionalLayers ?? []
        return src.map((c) => ({
            ifLayers: [...c.ifLayers],
            thenLayer: c.thenLayer,
        }))
    }

    /** Stage the full conditional-layer list, overlaid on the committed list at the
     *  next commit(). Pass the complete desired set — the editor owns add / remove /
     *  reorder; an empty list clears every tri-layer. Layer names resolve to indices
     *  at compile time, so an unknown ifLayers / thenLayer name throws on commit(),
     *  not here. Marks pending; discard reverts to device truth. */
    setConditionalLayers(list: CanonConditionalLayer[]): void {
        this.assertWritable()
        this.editedConditionalLayers = list.map((c) => ({
            ifLayers: [...c.ifLayers],
            thenLayer: c.thenLayer,
        }))
        this.markPending(true)
    }

    async commit(): Promise<void> {
        this.assertWritable()
        // Fold pending macro / tap-dance / defaults edits into the config the
        // layers raise onto, so a committed blob carries them (and their names).
        const next = raiseNeutralToConfig(this.layers, this.withEdits(this.config))
        const version = this.configVersion + 1
        const { blob } = buildRemapprBlob(next, { configVersion: version })
        const padded = padTo(blob, BLOB_ALIGN)

        await this.writeOk(Cmd.WRITE_CONFIG_BEGIN, undefined, 'WRITE_CONFIG_BEGIN')
        for (let off = 0; off < padded.length; off += this.sealedChunk) {
            const slice = padded.subarray(
                off,
                Math.min(off + this.sealedChunk, padded.length),
            )
            await this.writeOk(Cmd.WRITE_CONFIG_CHUNK, slice, 'WRITE_CONFIG_CHUNK')
        }
        const validate = await this.writeCall(Cmd.VALIDATE_CONFIG)
        if (validate.status !== Status.OK) {
            await this.writeCall(Cmd.ROLLBACK_CONFIG).catch(() => undefined)
            throw new ProtocolError(
                `VALIDATE_CONFIG failed: ${statusName(validate.status)}`,
            )
        }
        await this.writeOk(Cmd.COMMIT_CONFIG, undefined, 'COMMIT_CONFIG')

        this.config = next
        this.configVersion = version
        this.clearEdits()
        this.markPending(false)
    }

    // pattern-check: skip — sealed-vs-plain fallback inside two existing private
    // helpers of this service; conditional dispatch, no GoF abstraction.
    /** A mutating verb: sealed through the §19 session when the device has one,
     *  plaintext when the firmware advertises no auth (dev/no-auth build — the
     *  device accepts mutating verbs in the clear there). */
    private writeCall(cmd: number, arg?: Uint8Array) {
        return this.session
            ? this.rpc.callSealed(this.session, cmd, arg)
            : this.rpc.callPlain(cmd, arg)
    }

    private async writeOk(
        cmd: number,
        arg: Uint8Array | undefined,
        label: string,
    ): Promise<void> {
        const r = await this.writeCall(cmd, arg)
        if (r.status !== Status.OK) {
            throw new ProtocolError(`${label} failed: ${statusName(r.status)}`)
        }
    }

    async discardChanges(): Promise<void> {
        // Abort any staging the device started, then drop the in-memory edits by
        // re-lowering from the last-known config (source of truth). A read-only
        // view never staged anything — just re-seed.
        if (!this.readOnly) {
            await this.writeCall(Cmd.ROLLBACK_CONFIG).catch(() => undefined)
        }
        this.clearEdits()
        this.seedLayersFromConfig()
        this.markPending(false)
    }

    async resetSettings(): Promise<void> {
        this.clearEdits()
        this.seedLayersFromConfig()
        this.activeLayoutId = this.layouts[0]?.id ?? 0
        this.markPending(false)
    }

    hasPendingChanges(): boolean {
        return this.pendingChanges
    }

    async refreshPendingChanges(): Promise<boolean> {
        return this.pendingChanges
    }

    onPendingChangesChanged(cb: PendingChangesHandler): () => void {
        this.pendingChangesListeners.add(cb)
        return () => this.pendingChangesListeners.delete(cb)
    }

    /* ── notifications / export / lifecycle ─────────────────────────────── */

    subscribe(cb: NotificationHandler): () => void {
        this.notificationListeners.add(cb)
        return () => this.notificationListeners.delete(cb)
    }

    async exportConfig(): Promise<ExportedFile[]> {
        const live = raiseNeutralToConfig(this.layers, this.withEdits(this.config))
        return [
            {
                filename: `${this.deviceInfo.name || 'remappr'}.keymap.json`,
                mime: 'application/json',
                content: serializeKeymap(live),
            },
        ]
    }

    async getConfigSource(): Promise<string | null> {
        return serializeKeymap(this.config)
    }

    onClosed(cb: ClosedHandler): () => void {
        if (this.closed) {
            cb()
            return () => undefined
        }
        this.closedListeners.add(cb)
        return () => this.closedListeners.delete(cb)
    }

    private fireClosed(reason?: unknown): void {
        if (this.closed) return
        this.closed = true
        for (const cb of this.closedListeners) cb(reason)
    }

    async disconnect(): Promise<void> {
        if (this.closed) return
        this.fireClosed()
        // A node view borrows the dongle's RPC; never tear down a shared transport
        // (its owner does). A service that owns its transport — a direct keyboard
        // OR the dongle itself — closes it here.
        if (!this.sharesTransport) {
            await this.rpc.close({ abortTransport: true }).catch(() => undefined)
        }
    }
}
