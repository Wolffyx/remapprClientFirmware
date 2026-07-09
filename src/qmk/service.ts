/* eslint-disable @typescript-eslint/no-unused-vars */
// Pattern check: Adapter (Tier 1) — extended — extends src/firmware/qmk/service.ts QmkKeyboardService; HidClient-backed VIA implementation of the neutral KeyboardService facade.
import { filterCatalogByCodec } from '@firmware/catalog/filter'
import type { KeyCatalog } from '@firmware/catalog/types'
import type { KeycodeCodec } from '@firmware/codec'
import type {
    AdvancedApi,
    Capabilities,
    KeyboardService,
    LayersApi,
    RgbApi,
    WirelessApi,
} from '@firmware/service'
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
} from '@firmware/types'
import { ProtocolError, UnsupportedError } from '@firmware/errors'
import type { ParsedKeyboardDef } from '@firmware/kle/parser'

import {
    buildQmkKeyAction,
    decodeAsKeyAction,
    encodeKeycode,
    relabelQmkLayer,
} from './actions'
import { qmkCodec } from './codec'
import { QMK_ACTION_TYPES } from './actionTypes'
import { exportKeymap } from './export'
import type { HidClient } from './hidClient'
import {
    fetchKeymapBuffer,
    getKeycodeCmd,
    getLayerCountCmd,
    parseKeycode,
    parseLayerCount,
    parseSetKeycodeEcho,
    readU16BE,
    resetKeymapCmd,
    setKeycodeCmd,
} from './protocol'

export const QMK_CAPABILITIES_BASE: Omit<Capabilities, 'maxLayers'> = {
    lock: false,
    rename: false,
    notifications: false,
    reorderLayers: false,
    variableLayerCount: false,
    exportFormats: ['keymap.c'],
    // VIA writes each keycode to EEPROM immediately; there is no separate save
    // step, so no Save button is shown.
    saveMode: 'automatic',
    behaviors: {
        capsWord: true,
        leader: true,
        autoShift: true,
        swapHands: true,
    },
}

type LockStateHandler = (state: LockState) => void
type PendingChangesHandler = (pending: boolean) => void
type NotificationHandler = (notification: AdapterNotification) => void
type ClosedHandler = (reason?: unknown) => void

// pattern-check: skip — extending existing config interface with optional fields, no new abstraction
export interface QmkServiceConfig {
    deviceInfo: DeviceInfo
    client: HidClient
    rows: number
    cols: number
    layerCount: number
    layerNames?: string[]
    capabilitiesOverride?: Partial<Capabilities>
    wireless?: WirelessApi
    rgb?: RgbApi
    advanced?: AdvancedApi
    layerControl?: LayersApi
    /**
     * Optional per-keycode decoder. Returns non-null to override stock QMK
     * decode (e.g. Keychron BT_HST1 at 0x7E0C). Returns null to fall through
     * to qmk/actions.ts decodeAsKeyAction.
     */
    decodeOverride?: (keycode: number) => KeyAction | null
    /** Extra ActionType entries appended to QMK_ACTION_TYPES in listActionTypes(). */
    extraActionTypes?: ActionType[]
    /** Codec strategy. Defaults to qmkCodec (HID page 7 only). Subclasses
     *  inject KeychronCodec / VialCodec to extend canonical coverage. */
    codec?: KeycodeCodec
    /** Optional VIA-style keyboard def. When present, drives physicalLayout
     *  + rowColMap (split/staggered/rotated geometry). When absent, the service
     *  falls back to a synthetic rows×cols grid. */
    def?: ParsedKeyboardDef
}

function makeGridLayout(rows: number, cols: number): PhysicalLayout {
    // PhysicalLayoutKey x/y/w/h are stored in centi-units (1u = 100) —
    // see src/firmware/labels.ts:42-45 where the renderer divides by 100.
    const keys = []
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            keys.push({ x: c * 100, y: r * 100, w: 100, h: 100 })
        }
    }
    return { id: 0, name: 'Default', keys }
}

function gridRowColMap(
    rows: number,
    cols: number,
): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = []
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) out.push({ row: r, col: c })
    }
    return out
}

function layoutFromDef(def: ParsedKeyboardDef): PhysicalLayout {
    return {
        id: 0,
        name: def.name || 'Default',
        keys: def.layoutKeys,
        encoders: def.encoderSlots.length ? def.encoderSlots : undefined,
    }
}

export async function readQmkLayerCount(client: HidClient): Promise<number> {
    const resp = await client.send(getLayerCountCmd())
    const n = parseLayerCount(resp)
    if (n <= 0 || n > 32) {
        throw new ProtocolError(`QMK reported invalid layer count: ${n}`)
    }
    return n
}

// pattern-check: skip — function signature refactor (rows/cols → rowColMap) to support sparse VIA defs
async function readLayerKeycodes(
    client: HidClient,
    layer: number,
    rowColMap: { row: number; col: number }[],
    decodeOverride?: (kc: number) => KeyAction | null,
    codec?: KeycodeCodec,
): Promise<KeyAction[]> {
    const out: KeyAction[] = []
    for (const { row, col } of rowColMap) {
        const resp = await client.send(getKeycodeCmd(layer, row, col))
        const { keycode } = parseKeycode(resp)
        const overridden = decodeOverride?.(keycode) ?? null
        out.push(overridden ?? decodeAsKeyAction(keycode, undefined, codec))
    }
    return out
}

// pattern-check: skip — function signature refactor (rows/cols → rowColMap) to support sparse VIA defs
export async function loadInitialKeymap(
    client: HidClient,
    rowColMap: { row: number; col: number }[],
    layerCount: number,
    decodeOverride?: (kc: number) => KeyAction | null,
    codec?: KeycodeCodec,
    matrix?: { rows: number; cols: number },
): Promise<Layer[]> {
    if (matrix) {
        // Bulk-read fast path: pull the entire keymap as one byte stream and
        // index per (row,col). 2-3 round trips total instead of N per layer.
        return loadKeymapBulk(
            client,
            rowColMap,
            layerCount,
            matrix,
            decodeOverride,
            codec,
        )
    }
    const layers: Layer[] = []
    for (let i = 0; i < layerCount; i++) {
        const keys = await readLayerKeycodes(
            client,
            i,
            rowColMap,
            decodeOverride,
            codec,
        )
        layers.push({ id: i, name: `Layer ${i}`, keys })
    }
    return layers
}

// pattern-check: skip — bulk decoding helper, mirrors qmk-vial/service.ts
async function loadKeymapBulk(
    client: HidClient,
    rowColMap: { row: number; col: number }[],
    layerCount: number,
    matrix: { rows: number; cols: number },
    decodeOverride?: (kc: number) => KeyAction | null,
    codec?: KeycodeCodec,
): Promise<Layer[]> {
    const buffer = await fetchKeymapBuffer(
        client,
        layerCount,
        matrix.rows,
        matrix.cols,
    )
    const stride = matrix.rows * matrix.cols * 2
    const layers: Layer[] = []
    for (let l = 0; l < layerCount; l++) {
        const base = l * stride
        const keys: KeyAction[] = rowColMap.map(({ row, col }) => {
            const off = base + row * matrix.cols * 2 + col * 2
            const kc = readU16BE(buffer, off)
            const overridden = decodeOverride?.(kc) ?? null
            return overridden ?? decodeAsKeyAction(kc, undefined, codec)
        })
        layers.push({ id: l, name: `Layer ${l}`, keys })
    }
    return layers
}

export class QmkKeyboardService implements KeyboardService {
    public readonly capabilities: Capabilities
    public readonly deviceInfo: DeviceInfo
    public readonly wireless?: WirelessApi
    public readonly rgb?: RgbApi
    public readonly advanced?: AdvancedApi
    public readonly layerControl?: LayersApi
    public readonly codec: KeycodeCodec

    protected readonly client: HidClient
    private layout: PhysicalLayout
    private rowColMap: { row: number; col: number }[]
    private layers: Layer[]
    private layerNames: string[]
    private pendingChanges = false
    private closed = false

    private readonly notificationListeners = new Set<NotificationHandler>()
    private readonly pendingChangesListeners = new Set<PendingChangesHandler>()
    private readonly closedListeners = new Set<ClosedHandler>()

    protected readonly cfg: QmkServiceConfig

    protected constructor(cfg: QmkServiceConfig, layers: Layer[]) {
        this.cfg = cfg
        this.deviceInfo = cfg.deviceInfo
        this.client = cfg.client
        if (cfg.def) {
            this.layout = layoutFromDef(cfg.def)
            this.rowColMap = cfg.def.rowColMap
        } else {
            this.layout = makeGridLayout(cfg.rows, cfg.cols)
            this.rowColMap = gridRowColMap(cfg.rows, cfg.cols)
        }
        this.layers = layers
        this.layerNames = cfg.layerNames ?? layers.map((l) => l.name)
        this.capabilities = {
            ...QMK_CAPABILITIES_BASE,
            maxLayers: cfg.layerCount,
            layoutSideloadable: true,
            ...(cfg.capabilitiesOverride ?? {}),
        }
        this.wireless = cfg.wireless
        this.rgb = cfg.rgb
        this.advanced = cfg.advanced
        this.layerControl = cfg.layerControl
        this.codec = cfg.codec ?? qmkCodec
        cfg.client.onClosed((reason) => this.handleClientClosed(reason))
    }

    static async create(cfg: QmkServiceConfig): Promise<QmkKeyboardService> {
        const map = cfg.def
            ? cfg.def.rowColMap
            : gridRowColMap(cfg.rows, cfg.cols)
        const matrix = cfg.def
            ? { rows: cfg.def.rows, cols: cfg.def.cols }
            : { rows: cfg.rows, cols: cfg.cols }
        const layers = await loadInitialKeymap(
            cfg.client,
            map,
            cfg.layerCount,
            cfg.decodeOverride,
            cfg.codec ?? qmkCodec,
            matrix,
        )
        return new QmkKeyboardService(cfg, layers)
    }

    private handleClientClosed(reason?: unknown): void {
        if (this.closed) return
        this.closed = true
        for (const cb of this.closedListeners) {
            try {
                cb(reason)
            } catch {
                /* ignore */
            }
        }
    }

    private positionToCoord(position: number): { row: number; col: number } {
        if (position < 0 || position >= this.rowColMap.length) {
            throw new ProtocolError(
                `QMK position out of range: ${position} (max ${this.rowColMap.length - 1})`,
            )
        }
        return this.rowColMap[position]
    }

    private setPending(next: boolean): void {
        if (this.pendingChanges === next) return
        this.pendingChanges = next
        for (const cb of this.pendingChangesListeners) cb(next)
    }

    private layerIndexById(layerId: number): number {
        return this.layers.findIndex((l) => l.id === layerId)
    }

    async getLockState(): Promise<LockState> {
        return 'not-applicable'
    }

    async unlock(): Promise<void> {
        // VIA: no lock semantics.
    }

    onLockStateChanged(_cb: LockStateHandler): () => void {
        return () => undefined
    }

    async listActionTypes(): Promise<ActionType[]> {
        if (
            !this.cfg.extraActionTypes ||
            this.cfg.extraActionTypes.length === 0
        ) {
            return QMK_ACTION_TYPES
        }
        return [...QMK_ACTION_TYPES, ...this.cfg.extraActionTypes]
    }

    buildKeyAction(kind: string, params: number[]): KeyAction {
        return buildQmkKeyAction(kind, params, this.layerNames, this.codec)
    }

    async listKeyCatalog(): Promise<KeyCatalog> {
        return filterCatalogByCodec(this.codec)
    }

    async getKeymap(): Promise<Keymap> {
        return {
            layers: this.layers.map((l) => ({
                id: l.id,
                name: l.name,
                keys: relabelQmkLayer(l.keys, this.layerNames, this.codec),
            })),
            availableLayers: 0,
            activeLayoutId: this.layout.id,
            layouts: [this.layout],
        }
    }

    async getPhysicalLayouts(): Promise<{
        layouts: PhysicalLayout[]
        activeLayoutId: number
    }> {
        return { layouts: [this.layout], activeLayoutId: this.layout.id }
    }

    async setKey(
        layerId: number,
        position: number,
        action: KeyAction,
    ): Promise<void> {
        if (this.closed) throw new UnsupportedError('setKey: connection closed')
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        const { row, col } = this.positionToCoord(position)
        const kc = encodeKeycode(action)
        const resp = await this.client.send(setKeycodeCmd(idx, row, col, kc))
        const echo = parseSetKeycodeEcho(resp)
        if (
            echo.layer !== idx ||
            echo.row !== row ||
            echo.col !== col ||
            echo.keycode !== kc
        ) {
            throw new ProtocolError(
                `setKey echo mismatch: sent (${idx},${row},${col},0x${kc.toString(16)}) got (${echo.layer},${echo.row},${echo.col},0x${echo.keycode.toString(16)})`,
            )
        }
        const next = this.layers[idx].keys.slice()
        next[position] = buildQmkKeyAction(
            action.kind,
            action.params,
            this.layerNames,
        )
        this.layers[idx] = { ...this.layers[idx], keys: next }
        // saveMode 'automatic': the write above is already durable (EEPROM,
        // echo-verified), so nothing pends. Raising the flag here would strand
        // the UI in "unsaved" (Save/Discard are hidden for automatic) and block
        // applyLayout behind its pending-changes guard.
    }

    async setKeys(updates: KeyUpdate[]): Promise<void> {
        for (const u of updates) {
            await this.setKey(u.layerId, u.position, u.action)
        }
    }

    async addLayer(): Promise<Layer> {
        throw new UnsupportedError(
            'addLayer: VIA layer count is fixed by firmware',
        )
    }

    async removeLayer(_layerId: number): Promise<void> {
        throw new UnsupportedError(
            'removeLayer: VIA layer count is fixed by firmware',
        )
    }

    async renameLayer(_layerId: number, _name: string): Promise<void> {
        throw new UnsupportedError('renameLayer: VIA does not support rename')
    }

    async moveLayer(_startIndex: number, _destIndex: number): Promise<void> {
        throw new UnsupportedError('moveLayer: VIA does not support reordering')
    }

    async restoreLayer(_layerId: number, _atIndex: number): Promise<Layer> {
        throw new UnsupportedError(
            'restoreLayer: VIA does not retain prior layers',
        )
    }

    async setActivePhysicalLayout(layoutId: number): Promise<Keymap> {
        if (layoutId !== this.layout.id) {
            throw new UnsupportedError(
                'setActivePhysicalLayout: VIA exposes a single fixed layout',
            )
        }
        return this.getKeymap()
    }

    // pattern-check: skip — atomic swap-and-reload on existing Adapter
    async applyLayout(def: ParsedKeyboardDef): Promise<void> {
        if (this.closed) {
            throw new UnsupportedError('applyLayout: connection closed')
        }
        if (this.pendingChanges) {
            throw new UnsupportedError(
                'applyLayout: commit or discard pending changes first',
            )
        }
        // Read layers under the NEW rowColMap before mutating service state.
        // If the device read fails partway, no state is touched.
        const nextLayers = await loadInitialKeymap(
            this.client,
            def.rowColMap,
            this.capabilities.maxLayers ?? this.layers.length,
            this.cfg.decodeOverride,
            this.codec,
            { rows: def.rows, cols: def.cols },
        )
        this.rowColMap = def.rowColMap
        this.layout = layoutFromDef(def)
        this.layers = nextLayers
        for (const cb of this.notificationListeners) {
            try {
                cb({ topic: 'layout-changed', payload: null })
            } catch {
                /* ignore */
            }
        }
    }

    async commit(): Promise<void> {
        // VIA writes immediately on setKey; commit() resets the UI's
        // pending-changes flag so the user can re-export from a stable state.
        this.setPending(false)
    }

    async discardChanges(): Promise<void> {
        throw new UnsupportedError(
            'discardChanges: VIA writes immediately — no pending buffer to discard',
        )
    }

    async resetSettings(): Promise<void> {
        await this.client.send(resetKeymapCmd())
        const matrix = this.cfg.def
            ? { rows: this.cfg.def.rows, cols: this.cfg.def.cols }
            : { rows: this.cfg.rows, cols: this.cfg.cols }
        this.layers = await loadInitialKeymap(
            this.client,
            this.rowColMap,
            this.capabilities.maxLayers ?? this.layers.length,
            this.cfg.decodeOverride,
            this.codec,
            matrix,
        )
        this.setPending(false)
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

    subscribe(cb: NotificationHandler): () => void {
        // VIA has no firmware-pushed notifications; expose the registration
        // surface so UI code is uniform with ZMK/mock adapters.
        this.notificationListeners.add(cb)
        return () => this.notificationListeners.delete(cb)
    }

    async exportConfig(): Promise<ExportedFile[]> {
        const km = await this.getKeymap()
        return exportKeymap(km, this.deviceInfo.name)
    }

    onClosed(cb: ClosedHandler): () => void {
        if (this.closed) {
            cb()
            return () => undefined
        }
        this.closedListeners.add(cb)
        return () => this.closedListeners.delete(cb)
    }

    async disconnect(): Promise<void> {
        if (this.closed) return
        await this.client.close({ abortTransport: true })
        this.handleClientClosed('disconnect')
    }
}
