/* eslint-disable @typescript-eslint/no-unused-vars */
// Pattern check: Adapter (Tier 1) — extended — extends src/firmware/qmk/service.ts QmkKeyboardService; HidClient-backed Vial implementation of KeyboardService with on-device matrix, encoder, and lock support.
import { filterCatalogByCodec } from '@firmware/catalog/filter'
import type { KeyCatalog } from '@firmware/catalog/types'
import { ProtocolError, UnsupportedError } from '@firmware/errors'
import type { HidClient } from '@firmware/qmk/hidClient'
import {
    fetchKeymapBuffer,
    getKeycodeCmd,
    parseKeycode,
    parseSetKeycodeEcho,
    readU16BE,
    resetKeymapCmd,
    setKeycodeCmd,
} from '@firmware/qmk/protocol'
import type {
    Capabilities,
    DynamicEntriesApi,
    EncoderApi,
    KeyboardService,
    MacroApi,
} from '@firmware/service'
import type {
    ActionType,
    AdapterNotification,
    DeviceInfo,
    EncoderAction,
    ExportedFile,
    KeyAction,
    Keymap,
    KeyUpdate,
    Layer,
    LockState,
    MacroAction,
    PhysicalLayout,
} from '@firmware/types'

import { vialCodec } from './codec'
import { decodeMacro, encodeMacro } from './macroCodec'

import {
    decodeVialAsKeyAction,
    encodeVialKeycode,
    ensureEncodable,
    relabelVialLayer,
} from './actions'
import { buildVialActionTypes } from './actionTypes'
import { type DynamicEntryCount } from './protocol'
import {
    type AltRepeatKeyEntry,
    type ComboEntry,
    getAltRepeatKey,
    getCombo,
    getDynamicCounts,
    getKeyOverride,
    getTapDance,
    type KeyOverrideEntry,
    setAltRepeatKey,
    setCombo,
    setKeyOverride,
    setTapDance,
    type TapDanceEntry,
} from './dynamic'
import { readEncoder, writeEncoder } from './encoder'
import { type ParsedKeyboardDef, type VialCustomKeycode } from './keyboardDef'
import {
    getMacroBufferSize,
    getMacroCount,
    readMacro,
    readMacroBuffer,
    splitMacros,
    writeMacro,
    writeMacroBuffer,
} from './macros'
import { lockDevice, readUnlockStatus, runUnlockFlow } from './unlock'

const VIAL_CAPABILITIES_BASE: Omit<Capabilities, 'maxLayers'> = {
    lock: true,
    rename: false,
    notifications: false,
    reorderLayers: false,
    variableLayerCount: false,
    exportFormats: ['vial.json', 'keymap.c'],
    // Vial writes immediately (like VIA); `commit()` only clears the pending flag
    // and `discardChanges` is unsupported — so no Save button is shown.
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
type NotificationHandler = (n: AdapterNotification) => void
type ClosedHandler = (reason?: unknown) => void

export interface VialServiceConfig {
    deviceInfo: DeviceInfo
    client: HidClient
    def: ParsedKeyboardDef
    layerCount: number
    vialProtocol: number
    keyboardId: bigint
    layerNames?: string[]
}

function bufferOffsetFor(
    layer: number,
    row: number,
    col: number,
    rows: number,
    cols: number,
): number {
    return layer * rows * cols * 2 + row * cols * 2 + col * 2
}

async function loadLayers(
    client: HidClient,
    def: ParsedKeyboardDef,
    layerCount: number,
    layerNames: string[],
    customNames: string[],
): Promise<Layer[]> {
    const buffer = await fetchKeymapBuffer(
        client,
        layerCount,
        def.rows,
        def.cols,
    )
    const layers: Layer[] = []
    for (let l = 0; l < layerCount; l++) {
        const keys: KeyAction[] = def.rowColMap.map(({ row, col }) => {
            const off = bufferOffsetFor(l, row, col, def.rows, def.cols)
            const kc = readU16BE(buffer, off)
            return decodeVialAsKeyAction(kc, layerNames, customNames)
        })
        const encoders: EncoderAction[] = []
        for (const idx of def.encoderIndices) {
            const e = await readEncoder(client, l, idx, layerNames)
            encoders.push(e)
        }
        layers.push({
            id: l,
            name: layerNames[l] ?? `Layer ${l}`,
            keys,
            encoders: encoders.length ? encoders : undefined,
        })
    }
    return layers
}

interface VialDeviceProfile {
    dynamicCounts: DynamicEntryCount
    macroCount: number
    macroBufferSize: number
}

async function loadDeviceProfile(
    client: HidClient,
): Promise<VialDeviceProfile> {
    let dynamicCounts: DynamicEntryCount = {
        tapDance: 0,
        combo: 0,
        keyOverride: 0,
    }
    try {
        dynamicCounts = await getDynamicCounts(client)
    } catch {
        // Older Vial protocols (< 4) lack DYNAMIC_ENTRY_OP — leave zeroed.
    }
    let macroCount = 0
    let macroBufferSize = 0
    try {
        macroCount = await getMacroCount(client)
        macroBufferSize = await getMacroBufferSize(client)
    } catch {
        // Tolerate boards without macro support.
    }
    return { dynamicCounts, macroCount, macroBufferSize }
}

// pattern-check: skip — wires sub-bundles required by service.ts Facade refactor
export class VialKeyboardService implements KeyboardService {
    public readonly capabilities: Capabilities
    public readonly deviceInfo: DeviceInfo
    public readonly encoders?: EncoderApi
    public readonly dynamic?: DynamicEntriesApi
    public readonly macros?: MacroApi
    public readonly codec = vialCodec

    private readonly client: HidClient
    private readonly def: ParsedKeyboardDef
    private readonly physicalLayout: PhysicalLayout
    private readonly vialProtocol: number
    private readonly keyboardId: bigint
    private layers: Layer[]
    private layerNames: string[]
    private lockState: LockState = 'locked'
    private pendingChanges = false
    private closed = false

    private readonly notificationListeners = new Set<NotificationHandler>()
    private readonly pendingChangesListeners = new Set<PendingChangesHandler>()
    private readonly lockListeners = new Set<LockStateHandler>()
    private readonly closedListeners = new Set<ClosedHandler>()

    // Pattern check: Adapter (Tier 1) — extended — same VialKeyboardService class; expanded ctor wires DeviceProfile + customNames into capabilities and labels.
    private readonly customNames: string[]
    private readonly profile: VialDeviceProfile

    private constructor(
        cfg: VialServiceConfig,
        layers: Layer[],
        lock: LockState,
        profile: VialDeviceProfile,
    ) {
        this.deviceInfo = cfg.deviceInfo
        this.client = cfg.client
        this.def = cfg.def
        this.vialProtocol = cfg.vialProtocol
        this.keyboardId = cfg.keyboardId
        this.layers = layers
        this.layerNames = cfg.layerNames ?? layers.map((l) => l.name)
        this.customNames = cfg.def.customKeycodes.map(
            (k) => k.shortName || k.name,
        )
        this.profile = profile
        this.physicalLayout = {
            id: 0,
            name: cfg.def.name || 'Default',
            keys: cfg.def.layoutKeys,
            encoders: cfg.def.encoderSlots.length
                ? cfg.def.encoderSlots
                : undefined,
        }
        this.capabilities = {
            ...VIAL_CAPABILITIES_BASE,
            maxLayers: cfg.layerCount,
            encoders: cfg.def.encoderIndices.length || undefined,
            dynamicEntries:
                profile.dynamicCounts.tapDance +
                    profile.dynamicCounts.combo +
                    profile.dynamicCounts.keyOverride >
                0
                    ? profile.dynamicCounts
                    : undefined,
            macros:
                profile.macroCount > 0
                    ? {
                          count: profile.macroCount,
                          bufferSize: profile.macroBufferSize,
                      }
                    : undefined,
        }
        this.lockState = lock
        if (this.capabilities.encoders) {
            this.encoders = {
                setEncoder: (layerId, encoderIdx, direction, action) =>
                    this.setEncoder(layerId, encoderIdx, direction, action),
            }
        }
        if (this.capabilities.dynamicEntries) {
            this.dynamic = {
                getCounts: () => this.getDynamicEntryCounts(),
                getTapDance: (idx) => this.getTapDance(idx),
                setTapDance: (idx, e) => this.setTapDance(idx, e),
                getCombo: (idx) => this.getCombo(idx),
                setCombo: (idx, e) => this.setCombo(idx, e),
                getKeyOverride: (idx) => this.getKeyOverride(idx),
                setKeyOverride: (idx, e) => this.setKeyOverride(idx, e),
                getAltRepeatKey: (idx) => this.getAltRepeatKey(idx),
                setAltRepeatKey: (idx, e) => this.setAltRepeatKey(idx, e),
            }
        }
        if (this.capabilities.macros) {
            this.macros = {
                getCount: () => this.getMacroCount(),
                getMacro: (idx) => this.getMacro(idx),
                setMacro: (idx, actions) => this.setMacro(idx, actions),
            }
        }
        cfg.client.onClosed((reason) => this.handleClientClosed(reason))
    }

    static async create(cfg: VialServiceConfig): Promise<VialKeyboardService> {
        const layerNames =
            cfg.layerNames ??
            Array.from({ length: cfg.layerCount }, (_, i) => `Layer ${i}`)
        const customNames = cfg.def.customKeycodes.map(
            (k) => k.shortName || k.name,
        )
        const layers = await loadLayers(
            cfg.client,
            cfg.def,
            cfg.layerCount,
            layerNames,
            customNames,
        )
        const profile = await loadDeviceProfile(cfg.client)
        const initialLock = await readUnlockStatus(cfg.client)
        const lockState: LockState = initialLock.locked ? 'locked' : 'unlocked'
        return new VialKeyboardService(cfg, layers, lockState, profile)
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

    private setPending(next: boolean): void {
        if (this.pendingChanges === next) return
        this.pendingChanges = next
        for (const cb of this.pendingChangesListeners) cb(next)
    }

    private setLockState(next: LockState): void {
        if (this.lockState === next) return
        this.lockState = next
        for (const cb of this.lockListeners) cb(next)
    }

    private layerIndexById(layerId: number): number {
        return this.layers.findIndex((l) => l.id === layerId)
    }

    private positionToCoord(position: number): { row: number; col: number } {
        if (position < 0 || position >= this.def.rowColMap.length) {
            throw new ProtocolError(
                `Vial position out of range: ${position} (max ${this.def.rowColMap.length - 1})`,
            )
        }
        return this.def.rowColMap[position]
    }

    async getLockState(): Promise<LockState> {
        if (this.closed) return 'not-applicable'
        const status = await readUnlockStatus(this.client)
        const next: LockState = status.inProgress
            ? 'unlocking'
            : status.locked
              ? 'locked'
              : 'unlocked'
        this.setLockState(next)
        return next
    }

    async unlock(): Promise<void> {
        this.setLockState('unlocking')
        try {
            await runUnlockFlow(this.client)
            this.setLockState('unlocked')
        } catch (err) {
            this.setLockState('locked')
            throw err
        }
    }

    async lock(): Promise<void> {
        await lockDevice(this.client)
        this.setLockState('locked')
    }

    onLockStateChanged(cb: LockStateHandler): () => void {
        this.lockListeners.add(cb)
        return () => this.lockListeners.delete(cb)
    }

    async listActionTypes(): Promise<ActionType[]> {
        return buildVialActionTypes(this.def.customKeycodes)
    }

    buildKeyAction(kind: string, params: number[]): KeyAction {
        return decodeVialAsKeyAction(
            encodeVialKeycode({ kind, params, label: { primary: '' } }),
            this.layerNames,
            this.customNames,
        )
    }

    async listKeyCatalog(): Promise<KeyCatalog> {
        return filterCatalogByCodec(this.codec)
    }

    async getKeymap(): Promise<Keymap> {
        return {
            layers: this.layers.map((l) => ({
                id: l.id,
                name: l.name,
                keys: relabelVialLayer(
                    l.keys,
                    this.layerNames,
                    this.customNames,
                ),
                encoders: l.encoders,
            })),
            availableLayers: 0,
            activeLayoutId: this.physicalLayout.id,
            layouts: [this.physicalLayout],
        }
    }

    async getPhysicalLayouts(): Promise<{
        layouts: PhysicalLayout[]
        activeLayoutId: number
    }> {
        return {
            layouts: [this.physicalLayout],
            activeLayoutId: this.physicalLayout.id,
        }
    }

    async setKey(
        layerId: number,
        position: number,
        action: KeyAction,
    ): Promise<void> {
        if (this.closed) throw new UnsupportedError('setKey: connection closed')
        ensureEncodable(action)
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        const { row, col } = this.positionToCoord(position)
        const kc = encodeVialKeycode(action)
        const resp = await this.client.send(setKeycodeCmd(idx, row, col, kc))
        const echo = parseSetKeycodeEcho(resp)
        if (
            echo.layer !== idx ||
            echo.row !== row ||
            echo.col !== col ||
            echo.keycode !== kc
        ) {
            throw new ProtocolError(
                `Vial setKey echo mismatch: sent (${idx},${row},${col},0x${kc.toString(16)}) got (${echo.layer},${echo.row},${echo.col},0x${echo.keycode.toString(16)})`,
            )
        }
        const next = this.layers[idx].keys.slice()
        next[position] = decodeVialAsKeyAction(
            kc,
            this.layerNames,
            this.customNames,
        )
        this.layers[idx] = { ...this.layers[idx], keys: next }
        // saveMode 'automatic': write already durable (echo-verified) — nothing
        // pends; raising the flag strands the UI with Save/Discard hidden.
    }

    async setKeys(updates: KeyUpdate[]): Promise<void> {
        for (const u of updates) {
            await this.setKey(u.layerId, u.position, u.action)
        }
    }

    async setEncoder(
        layerId: number,
        encoderIdx: number,
        direction: 0 | 1,
        action: KeyAction,
    ): Promise<void> {
        if (this.closed) throw new UnsupportedError('setEncoder: closed')
        ensureEncodable(action)
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        const slot = this.def.encoderIndices.indexOf(encoderIdx)
        if (slot < 0) {
            throw new ProtocolError(`Unknown encoder index: ${encoderIdx}`)
        }
        await writeEncoder(this.client, idx, encoderIdx, direction, action)
        const layer = this.layers[idx]
        const encs = (layer.encoders ?? []).slice()
        const current =
            encs[slot] ??
            ({
                cw: action,
                ccw: action,
            } as EncoderAction)
        encs[slot] =
            direction === 0
                ? { cw: action, ccw: current.ccw }
                : { cw: current.cw, ccw: action }
        this.layers[idx] = { ...layer, encoders: encs }
        // saveMode 'automatic': see setKey — durable write, nothing pends.
    }

    async addLayer(): Promise<Layer> {
        throw new UnsupportedError('addLayer: Vial layer count is fixed')
    }

    async removeLayer(_layerId: number): Promise<void> {
        throw new UnsupportedError('removeLayer: Vial layer count is fixed')
    }

    async renameLayer(_layerId: number, _name: string): Promise<void> {
        throw new UnsupportedError(
            'renameLayer: Vial does not persist layer names',
        )
    }

    async moveLayer(_startIndex: number, _destIndex: number): Promise<void> {
        throw new UnsupportedError(
            'moveLayer: Vial does not support reordering',
        )
    }

    async restoreLayer(_layerId: number, _atIndex: number): Promise<Layer> {
        throw new UnsupportedError(
            'restoreLayer: Vial does not retain prior layers',
        )
    }

    async setActivePhysicalLayout(layoutId: number): Promise<Keymap> {
        if (layoutId !== this.physicalLayout.id) {
            throw new UnsupportedError(
                'setActivePhysicalLayout: Vial exposes a single fixed layout',
            )
        }
        return this.getKeymap()
    }

    async commit(): Promise<void> {
        // Vial writes immediately; clearing the pending flag matches VIA semantics.
        this.setPending(false)
    }

    async discardChanges(): Promise<void> {
        throw new UnsupportedError('discardChanges: Vial writes immediately')
    }

    async resetSettings(): Promise<void> {
        await this.client.send(resetKeymapCmd())
        this.layers = await loadLayers(
            this.client,
            this.def,
            this.capabilities.maxLayers ?? this.layers.length,
            this.layerNames,
            this.customNames,
        )
        this.setPending(false)
    }

    async refreshKeymap(): Promise<Keymap> {
        // Re-read a single key's keycode round-trip path, used by the contract suite
        // when verifying the device echoed our writes — uses qmk get-keycode.
        const layer = this.layers[0]
        if (!layer || !this.def.rowColMap[0]) return this.getKeymap()
        const { row, col } = this.def.rowColMap[0]
        const resp = await this.client.send(getKeycodeCmd(0, row, col))
        parseKeycode(resp)
        return this.getKeymap()
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
        this.notificationListeners.add(cb)
        return () => this.notificationListeners.delete(cb)
    }

    async exportConfig(): Promise<ExportedFile[]> {
        const payload = this.buildVialJson()
        return [
            {
                filename: `${this.deviceInfo.name || 'vial'}.vil`,
                mime: 'application/json',
                content: JSON.stringify(payload, null, 2),
            },
        ]
    }

    private buildVialJson(): Record<string, unknown> {
        const layout: number[][][] = []
        for (let l = 0; l < this.layers.length; l++) {
            const layer: number[][] = []
            for (let r = 0; r < this.def.rows; r++) {
                const row: number[] = []
                for (let c = 0; c < this.def.cols; c++) {
                    row.push(-1)
                }
                layer.push(row)
            }
            layout.push(layer)
        }
        for (let l = 0; l < this.layers.length; l++) {
            const keys = this.layers[l].keys
            for (let p = 0; p < keys.length; p++) {
                const { row, col } = this.def.rowColMap[p]
                layout[l][row][col] = encodeVialKeycode(keys[p])
            }
        }
        const encoderLayout: [number, number][][] = []
        for (let l = 0; l < this.layers.length; l++) {
            const layer: [number, number][] = []
            const encs = this.layers[l].encoders ?? []
            for (const e of encs) {
                layer.push([encodeVialKeycode(e.cw), encodeVialKeycode(e.ccw)])
            }
            encoderLayout.push(layer)
        }
        return {
            version: 1,
            uid: this.keyboardId.toString(),
            vial_protocol: this.vialProtocol,
            via_protocol: 9,
            layout,
            encoder_layout: encoderLayout,
            layout_options: -1,
        }
    }

    // --- Vial-specific facade: custom keycodes + dynamic entries + macros ----

    getCustomKeycodes(): VialCustomKeycode[] {
        return this.def.customKeycodes
    }

    getDynamicEntryCounts(): DynamicEntryCount {
        return this.profile.dynamicCounts
    }

    async getTapDance(idx: number): Promise<TapDanceEntry> {
        return getTapDance(this.client, idx)
    }

    async setTapDance(idx: number, entry: TapDanceEntry): Promise<void> {
        await setTapDance(this.client, idx, entry)
        // saveMode 'automatic': durable write, nothing pends.
    }

    async getCombo(idx: number): Promise<ComboEntry> {
        return getCombo(this.client, idx)
    }

    async setCombo(idx: number, entry: ComboEntry): Promise<void> {
        await setCombo(this.client, idx, entry)
        this.setPending(true)
    }

    async getKeyOverride(idx: number): Promise<KeyOverrideEntry> {
        return getKeyOverride(this.client, idx)
    }

    async setKeyOverride(idx: number, entry: KeyOverrideEntry): Promise<void> {
        await setKeyOverride(this.client, idx, entry)
        this.setPending(true)
    }

    async getAltRepeatKey(idx: number): Promise<AltRepeatKeyEntry> {
        return getAltRepeatKey(this.client, idx)
    }

    async setAltRepeatKey(
        idx: number,
        entry: AltRepeatKeyEntry,
    ): Promise<void> {
        await setAltRepeatKey(this.client, idx, entry)
        this.setPending(true)
    }

    getMacroCount(): number {
        return this.profile.macroCount
    }

    getMacroBufferSize(): number {
        return this.profile.macroBufferSize
    }

    async getMacroBytes(idx: number): Promise<Uint8Array> {
        return readMacro(this.client, idx)
    }

    async setMacroBytes(idx: number, bytes: Uint8Array): Promise<void> {
        await writeMacro(this.client, idx, bytes)
        this.setPending(true)
    }

    async getMacro(idx: number): Promise<MacroAction[]> {
        const bytes = await readMacro(this.client, idx)
        return decodeMacro(bytes)
    }

    async setMacro(idx: number, actions: MacroAction[]): Promise<void> {
        const bytes = encodeMacro(actions)
        await writeMacro(this.client, idx, bytes)
        this.setPending(true)
    }

    async getAllMacros(): Promise<Uint8Array[]> {
        if (this.profile.macroCount === 0) return []
        const buffer = await readMacroBuffer(this.client)
        return splitMacros(buffer, this.profile.macroCount)
    }

    async setMacroBuffer(buffer: Uint8Array): Promise<void> {
        await writeMacroBuffer(this.client, buffer)
        this.setPending(true)
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
