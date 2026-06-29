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
    ComboEntry,
    DeviceInfo,
    ExportedFile,
    KeyAction,
    Keymap,
    KeyUpdate,
    Layer,
    LockState,
    MacroAction,
    PhysicalLayout,
    TapDanceEntry,
} from '../types'
import { ProtocolError } from '../errors'
import {
    type CanonMacro,
    type CanonTapDance,
    type ConfigKeymap,
    serializeKeymap,
} from '../config'
import { buildRemapprBlob } from '../config/compilers/remappr'

import {
    buildRemapprActionTypes,
    buildRemapprKeyAction,
    relabelLayer,
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

    /** The sealed-write session, guaranteed present on a writable service. */
    private requireSession(): RemapprSession {
        if (!this.session) {
            throw new ProtocolError('No control-auth session for this service')
        }
        return this.session
    }

    /* ── editing buffer ─────────────────────────────────────────────────── */

    /** The macro at `idx` with any pending edit applied (read path). */
    private macroAt(idx: number): CanonMacro | undefined {
        return this.editedMacros.get(idx) ?? this.config.macros?.[idx]
    }

    private tapDanceAt(idx: number): CanonTapDance | undefined {
        return this.editedTapDances.get(idx) ?? this.config.tapDances?.[idx]
    }

    /** `base` with pending macro / tap-dance edits overlaid (for commit/export). */
    private withEdits(base: ConfigKeymap): ConfigKeymap {
        if (this.editedMacros.size === 0 && this.editedTapDances.size === 0) {
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
        }
    }

    private clearEdits(): void {
        this.editedMacros.clear()
        this.editedTapDances.clear()
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
        return buildRemapprKeyAction(kind, params, this.layerNames())
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

    async commit(): Promise<void> {
        this.assertWritable()
        const session = this.requireSession()
        // Fold pending macro / tap-dance edits (§24) into the config the layers
        // raise onto, so a committed blob carries them (and their names).
        const next = raiseNeutralToConfig(this.layers, this.withEdits(this.config))
        const version = this.configVersion + 1
        const { blob } = buildRemapprBlob(next, { configVersion: version })
        const padded = padTo(blob, BLOB_ALIGN)

        await this.sealedOk(Cmd.WRITE_CONFIG_BEGIN, undefined, 'WRITE_CONFIG_BEGIN')
        for (let off = 0; off < padded.length; off += this.sealedChunk) {
            const slice = padded.subarray(
                off,
                Math.min(off + this.sealedChunk, padded.length),
            )
            await this.sealedOk(Cmd.WRITE_CONFIG_CHUNK, slice, 'WRITE_CONFIG_CHUNK')
        }
        const validate = await this.rpc.callSealed(session, Cmd.VALIDATE_CONFIG)
        if (validate.status !== Status.OK) {
            await this.rpc
                .callSealed(session, Cmd.ROLLBACK_CONFIG)
                .catch(() => undefined)
            throw new ProtocolError(
                `VALIDATE_CONFIG failed: ${statusName(validate.status)}`,
            )
        }
        await this.sealedOk(Cmd.COMMIT_CONFIG, undefined, 'COMMIT_CONFIG')

        this.config = next
        this.configVersion = version
        this.clearEdits()
        this.markPending(false)
    }

    private async sealedOk(
        cmd: number,
        arg: Uint8Array | undefined,
        label: string,
    ): Promise<void> {
        const r = await this.rpc.callSealed(this.requireSession(), cmd, arg)
        if (r.status !== Status.OK) {
            throw new ProtocolError(`${label} failed: ${statusName(r.status)}`)
        }
    }

    async discardChanges(): Promise<void> {
        // Abort any staging the device started, then drop the in-memory edits by
        // re-lowering from the last-known config (source of truth). A read-only
        // view has no session and never staged anything — just re-seed.
        if (this.session) {
            await this.rpc
                .callSealed(this.session, Cmd.ROLLBACK_CONFIG)
                .catch(() => undefined)
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
