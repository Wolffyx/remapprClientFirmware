// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; ZMK-protocol KeyboardService implementation wrapping call_rpc.
import {
    call_rpc,
    Request,
    RequestResponse,
    RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import type {
    BehaviorBinding,
    Keymap as ZmkKeymap,
    PhysicalLayouts as ZmkPhysicalLayouts,
} from '@zmkfirmware/zmk-studio-ts-client/keymap'
import { LockState as ZmkLockState } from '@zmkfirmware/zmk-studio-ts-client/core'
import type { Notification } from '@zmkfirmware/zmk-studio-ts-client/studio'

import { filterCatalogByCodec } from '@firmware/catalog/filter'
import type { KeyCatalog } from '@firmware/catalog/types'
import type { Capabilities, KeyboardService } from '@firmware/service'
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
} from '@firmware/types'
import { ProtocolError } from '@firmware/errors'

import {
    type BehaviorMap,
    bindingToKeyAction,
    keyActionToBinding,
} from './actions'
import { zmkCodec } from './codec'
import { behaviorsToActionTypes } from './actionTypes'
import { zmkKeymapToNeutral } from './keymap'
import { zmkNeutralToConfig } from './raise'
import { serializeKeymap } from '@firmware/config'
import { generateZMKConfigFile, generateZMKKeymapFile } from './export'

const ZMK_CAPABILITIES: Capabilities = {
    lock: true,
    rename: true,
    notifications: true,
    reorderLayers: true,
    variableLayerCount: true,
    exportFormats: ['devicetree'],
    behaviors: { capsWord: true },
    // No `macros`: ZMK macros are compile-time devicetree nodes, and the Studio
    // protocol exposes only keymap *bindings* (`&macro_name`), not the macro step
    // sequences — so they can't be read or edited live. The Header gates the macro
    // editor on `service.macros` (see useFeatureAvailable), so omitting the facade
    // hides the feature entirely. When a config source that carries macro
    // definitions becomes available (e.g. a builder-seeded board), expose `macros`
    // with `readonly: true` and no `setMacro`; the Advanced sheet's MacrosTab already
    // renders that view-only with a banner. Never fabricate macros the device can't read.
}

function mapLockState(state: ZmkLockState): LockState {
    switch (state) {
        case ZmkLockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED:
            return 'unlocked'
        case ZmkLockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED:
        default:
            return 'locked'
    }
}

type NotificationHandler = (notification: AdapterNotification) => void
type LockStateHandler = (state: LockState) => void
type PendingChangesHandler = (pending: boolean) => void
type ClosedHandler = (reason?: unknown) => void

export class ZmkKeyboardService implements KeyboardService {
    public readonly capabilities: Capabilities = ZMK_CAPABILITIES
    public readonly codec = zmkCodec

    private readonly connection: RpcConnection
    private readonly behaviors: BehaviorMap = {}
    private layouts: ZmkPhysicalLayouts | null = null
    private cachedKeymap: ZmkKeymap | null = null

    private readonly notificationListeners = new Set<NotificationHandler>()
    private readonly lockStateListeners = new Set<LockStateHandler>()
    private readonly pendingChangesListeners = new Set<PendingChangesHandler>()
    private readonly closedListeners = new Set<ClosedHandler>()
    private closed = false
    private pendingChanges = false
    private notificationLoop: Promise<void> | null = null
    private readonly notificationAbort = new AbortController()
    public readonly deviceInfo: DeviceInfo

    constructor(connection: RpcConnection, deviceInfo: DeviceInfo) {
        this.connection = connection
        this.deviceInfo = deviceInfo
        this.notificationLoop = this.runNotificationLoop()
    }

    private async call(
        request: Omit<Request, 'requestId'>,
    ): Promise<RequestResponse> {
        return call_rpc(this.connection, request)
    }

    private async runNotificationLoop(): Promise<void> {
        const reader = this.connection.notification_readable.getReader()
        const onAbort = (): void => {
            reader.cancel().catch(() => undefined)
        }
        this.notificationAbort.signal.addEventListener('abort', onAbort, {
            once: true,
        })
        let closeReason: unknown = undefined
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (!value) continue
                this.dispatchNotification(value)
            }
        } catch (e) {
            closeReason = e
        } finally {
            this.notificationAbort.signal.removeEventListener('abort', onAbort)
            try {
                reader.releaseLock()
            } catch {
                // ignore
            }
            this.markClosed(closeReason)
        }
    }

    private markClosed(reason?: unknown): void {
        if (this.closed) return
        this.closed = true
        for (const cb of this.closedListeners) cb(reason)
    }

    onClosed(cb: ClosedHandler): () => void {
        if (this.closed) {
            cb()
            return () => undefined
        }
        this.closedListeners.add(cb)
        return () => this.closedListeners.delete(cb)
    }

    private dispatchNotification(value: Notification): void {
        const subsystem = Object.entries(value).find(([, v]) => v !== undefined)
        if (!subsystem) return
        const [subId, subData] = subsystem
        const event = Object.entries(subData as object).find(
            ([, v]) => v !== undefined,
        )
        if (!event) return
        const [eventName, eventData] = event
        const topic = `${subId}.${eventName}`
        for (const cb of this.notificationListeners) {
            cb({ topic, payload: eventData })
        }
        if (subId === 'core' && eventName === 'lockStateChanged') {
            const next = mapLockState(eventData as ZmkLockState)
            for (const cb of this.lockStateListeners) cb(next)
        }
        if (subId === 'keymap' && eventName === 'unsavedChangesStatusChanged') {
            this.markPending(!!eventData)
        }
    }

    async getLockState(): Promise<LockState> {
        const resp = await this.call({ core: { getLockState: true } })
        const state = resp.core?.getLockState
        return mapLockState(
            state ?? ZmkLockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED,
        )
    }

    async unlock(): Promise<void> {
        // ZMK unlock requires physical interaction; state arrives via notification.
    }

    onLockStateChanged(cb: LockStateHandler): () => void {
        this.lockStateListeners.add(cb)
        return () => this.lockStateListeners.delete(cb)
    }

    private async loadBehaviors(): Promise<void> {
        const list = await this.call({ behaviors: { listAllBehaviors: true } })
        const ids = list.behaviors?.listAllBehaviors?.behaviors ?? []
        for (const behaviorId of ids) {
            const detailsResp = await this.call({
                behaviors: { getBehaviorDetails: { behaviorId } },
            })
            const details: GetBehaviorDetailsResponse | undefined =
                detailsResp.behaviors?.getBehaviorDetails
            if (details) this.behaviors[details.id] = details
        }
    }

    async listActionTypes(): Promise<ActionType[]> {
        if (Object.keys(this.behaviors).length === 0) await this.loadBehaviors()
        return behaviorsToActionTypes(this.behaviors)
    }

    private async ensureLayouts(): Promise<ZmkPhysicalLayouts> {
        if (this.layouts) return this.layouts
        const resp = await this.call({ keymap: { getPhysicalLayouts: true } })
        const got = resp.keymap?.getPhysicalLayouts
        if (!got) throw new ProtocolError('getPhysicalLayouts returned empty')
        this.layouts = got
        return got
    }

    async getPhysicalLayouts(): Promise<{
        layouts: import('@firmware/types').PhysicalLayout[]
        activeLayoutId: number
    }> {
        const got = await this.ensureLayouts()
        return {
            layouts: got.layouts.map((l, i) => ({
                id: i,
                name: l.name,
                keys: l.keys.map((k) => ({
                    x: k.x,
                    y: k.y,
                    w: k.width,
                    h: k.height,
                    r: k.r,
                    rx: k.rx,
                    ry: k.ry,
                })),
            })),
            activeLayoutId: got.activeLayoutIndex,
        }
    }

    async getKeymap(): Promise<Keymap> {
        if (Object.keys(this.behaviors).length === 0) await this.loadBehaviors()
        const layouts = await this.ensureLayouts()
        const resp = await this.call({ keymap: { getKeymap: true } })
        const km = resp.keymap?.getKeymap
        if (!km) throw new ProtocolError('getKeymap returned empty')
        this.cachedKeymap = km
        return zmkKeymapToNeutral(km, layouts, this.behaviors)
    }

    private actionToBinding(action: KeyAction): BehaviorBinding {
        return keyActionToBinding(action)
    }

    buildKeyAction(kind: string, params: number[]): KeyAction {
        const behaviorId = Number.parseInt(kind, 10)
        const binding = {
            behaviorId: Number.isNaN(behaviorId) ? 0 : behaviorId,
            param1: params[0] ?? 0,
            param2: params[1] ?? 0,
        } as BehaviorBinding
        const layerNames =
            this.cachedKeymap?.layers.map((l) => ({ name: l.name })) ?? []
        return bindingToKeyAction(binding, this.behaviors, {
            layers: layerNames,
        })
    }

    async listKeyCatalog(): Promise<KeyCatalog> {
        return filterCatalogByCodec(this.codec)
    }

    async setKey(
        layerId: number,
        position: number,
        action: KeyAction,
    ): Promise<void> {
        const binding = this.actionToBinding(action)
        const resp = await this.call({
            keymap: {
                setLayerBinding: {
                    layerId,
                    keyPosition: position,
                    binding,
                },
            },
        })
        if (resp.keymap?.setLayerBinding !== 0) {
            throw new ProtocolError(
                `setLayerBinding failed: ${resp.keymap?.setLayerBinding}`,
            )
        }
        this.markPending(true)
    }

    async setKeys(updates: KeyUpdate[]): Promise<void> {
        for (const u of updates) {
            await this.setKey(u.layerId, u.position, u.action)
        }
    }

    // pattern-check: skip — bug fix; sync cachedKeymap with each layer mutation
    private async ensureCachedKeymap(): Promise<ZmkKeymap> {
        if (this.cachedKeymap) return this.cachedKeymap
        await this.getKeymap()
        if (!this.cachedKeymap) {
            throw new ProtocolError('cachedKeymap unavailable')
        }
        return this.cachedKeymap
    }

    private layerIndexById(layerId: number): number {
        return (
            this.cachedKeymap?.layers.findIndex((l) => l.id === layerId) ?? -1
        )
    }

    async addLayer(): Promise<Layer> {
        const resp = await this.call({ keymap: { addLayer: {} } })
        const ok = resp.keymap?.addLayer?.ok
        if (!ok || !ok.layer) {
            throw new ProtocolError(
                `addLayer failed: ${resp.keymap?.addLayer?.err}`,
            )
        }
        this.markPending(true)
        const zmkLayer = ok.layer
        if (this.cachedKeymap) {
            this.cachedKeymap.layers.push(zmkLayer)
            this.cachedKeymap.availableLayers--
        }
        // Build labels against ALL layer names (cachedKeymap now includes the
        // new layer) so layer-index lookups (&mo / &lt hold legends) resolve the
        // right name — a one-element {layers:[zmkLayer]} would mislabel them.
        const layers = this.cachedKeymap?.layers.map((l) => ({
            name: l.name,
        })) ?? [zmkLayer]
        return {
            id: zmkLayer.id,
            name: zmkLayer.name,
            keys: zmkLayer.bindings.map((b) =>
                bindingToKeyAction(b, this.behaviors, { layers }),
            ),
        }
    }

    async removeLayer(layerId: number): Promise<void> {
        await this.ensureCachedKeymap()
        let layerIndex = this.layerIndexById(layerId)
        if (layerIndex < 0) {
            await this.getKeymap()
            layerIndex = this.layerIndexById(layerId)
        }
        if (layerIndex < 0) {
            throw new ProtocolError(`Unknown layer id: ${layerId}`)
        }
        const resp = await this.call({
            keymap: { removeLayer: { layerIndex } },
        })
        if (!resp.keymap?.removeLayer?.ok) {
            throw new ProtocolError(
                `removeLayer failed: ${resp.keymap?.removeLayer?.err}`,
            )
        }
        if (this.cachedKeymap) {
            this.cachedKeymap.layers.splice(layerIndex, 1)
            this.cachedKeymap.availableLayers++
        }
        this.markPending(true)
    }

    async renameLayer(layerId: number, name: string): Promise<void> {
        const resp = await this.call({
            keymap: { setLayerProps: { layerId, name } },
        })
        if (resp.keymap?.setLayerProps !== 0) {
            throw new ProtocolError(
                `setLayerProps failed: ${resp.keymap?.setLayerProps}`,
            )
        }
        if (this.cachedKeymap) {
            const layer = this.cachedKeymap.layers.find((l) => l.id === layerId)
            if (layer) layer.name = name
        }
        this.markPending(true)
    }

    async moveLayer(startIndex: number, destIndex: number): Promise<void> {
        const resp = await this.call({
            keymap: { moveLayer: { startIndex, destIndex } },
        })
        if (!resp.keymap?.moveLayer?.ok) {
            throw new ProtocolError(
                `moveLayer failed: ${resp.keymap?.moveLayer?.err}`,
            )
        }
        if (this.cachedKeymap) {
            const [moved] = this.cachedKeymap.layers.splice(startIndex, 1)
            this.cachedKeymap.layers.splice(destIndex, 0, moved)
        }
        this.markPending(true)
    }

    async restoreLayer(layerId: number, atIndex: number): Promise<Layer> {
        const resp = await this.call({
            keymap: { restoreLayer: { layerId, atIndex } },
        })
        const ok = resp.keymap?.restoreLayer?.ok
        if (!ok) {
            throw new ProtocolError(
                `restoreLayer failed: ${resp.keymap?.restoreLayer?.err}`,
            )
        }
        if (this.cachedKeymap) {
            this.cachedKeymap.layers.splice(atIndex, 0, ok)
            this.cachedKeymap.availableLayers--
        }
        this.markPending(true)
        // Label against ALL layer names (cachedKeymap now includes the restored
        // layer) so layer-index lookups resolve correctly.
        const layers = this.cachedKeymap?.layers.map((l) => ({
            name: l.name,
        })) ?? [ok]
        return {
            id: ok.id,
            name: ok.name,
            keys: ok.bindings.map((b) =>
                bindingToKeyAction(b, this.behaviors, { layers }),
            ),
        }
    }

    async setActivePhysicalLayout(layoutId: number): Promise<Keymap> {
        const resp = await this.call({
            keymap: { setActivePhysicalLayout: layoutId },
        })
        const newKeymap = resp.keymap?.setActivePhysicalLayout?.ok
        if (!newKeymap) {
            throw new ProtocolError(
                `setActivePhysicalLayout failed: ${resp.keymap?.setActivePhysicalLayout?.err}`,
            )
        }
        this.cachedKeymap = newKeymap
        if (this.layouts) {
            this.layouts = {
                ...this.layouts,
                activeLayoutIndex: layoutId,
            }
        }
        const layouts = await this.ensureLayouts()
        return zmkKeymapToNeutral(newKeymap, layouts, this.behaviors)
    }

    async commit(): Promise<void> {
        const resp = await this.call({ keymap: { saveChanges: true } })
        if (resp.keymap?.saveChanges?.ok !== undefined) {
            this.markPending(false)
            return
        }
        throw new ProtocolError(
            `saveChanges failed: ${resp.keymap?.saveChanges?.err}`,
        )
    }

    async discardChanges(): Promise<void> {
        const resp = await this.call({ keymap: { discardChanges: true } })
        if (!resp.keymap?.discardChanges) {
            throw new ProtocolError(
                `discardChanges failed: ${resp.keymap?.discardChanges}`,
            )
        }
        this.markPending(false)
    }

    async resetSettings(): Promise<void> {
        const resp = await this.call({ core: { resetSettings: true } })
        if (!resp.core?.resetSettings) {
            throw new ProtocolError(
                `resetSettings failed: ${resp.core?.resetSettings}`,
            )
        }
        this.markPending(false)
    }

    hasPendingChanges(): boolean {
        return this.pendingChanges
    }

    async refreshPendingChanges(): Promise<boolean> {
        const resp = await this.call({ keymap: { checkUnsavedChanges: true } })
        const pending = !!resp.keymap?.checkUnsavedChanges
        this.markPending(pending)
        return pending
    }

    onPendingChangesChanged(cb: PendingChangesHandler): () => void {
        this.pendingChangesListeners.add(cb)
        return () => this.pendingChangesListeners.delete(cb)
    }

    private markPending(pending: boolean): void {
        if (this.pendingChanges === pending) return
        this.pendingChanges = pending
        for (const cb of this.pendingChangesListeners) cb(pending)
    }

    subscribe(cb: NotificationHandler): () => void {
        this.notificationListeners.add(cb)
        return () => this.notificationListeners.delete(cb)
    }

    async exportConfig(): Promise<ExportedFile[]> {
        if (Object.keys(this.behaviors).length === 0) await this.loadBehaviors()
        const km = await this.getKeymap()
        const keyboardName = this.deviceInfo.name || 'keyboard'
        const keymapName = 'default'
        const keymap = generateZMKKeymapFile(km, this.behaviors, {
            keyboardName,
            keymapName,
            includeLayers: true,
        })
        const conf = generateZMKConfigFile({ keyboardName, keymapName })
        return [
            {
                filename: `${keyboardName}.keymap`,
                mime: 'text/plain',
                content: keymap,
            },
            {
                filename: `${keyboardName}.conf`,
                mime: 'text/plain',
                content: conf,
            },
        ]
    }

    // Raise the live keymap into the remappr config (source of truth) so the
    // download modal can compile it per firmware (.keymap + .overlay) instead of
    // falling back to the native exporter. Bindings the inverse can't model yet
    // degrade to transparent and are logged — see ./raise.
    async getConfigSource(): Promise<string | null> {
        try {
            const km = await this.getKeymap()
            const { config, diagnostics } = zmkNeutralToConfig(
                km,
                this.deviceInfo,
            )
            if (diagnostics.length) {
                console.warn(
                    `[zmk] device→config raise: ${diagnostics.length} binding(s) not fully modeled`,
                    diagnostics,
                )
            }
            return serializeKeymap(config)
        } catch (err) {
            console.warn('[zmk] getConfigSource failed', err)
            return null
        }
    }

    async disconnect(): Promise<void> {
        // Trigger reader.cancel() inside the notification loop, then wait for
        // it to release the lock on notification_readable. Cancelling the
        // stream itself while the reader still owns the lock throws
        // "Cannot cancel a locked stream".
        this.notificationAbort.abort()
        await this.notificationLoop?.catch(() => undefined)

        // The transport's ReadableStream is locked by the lib's pipeThrough
        // chain (decoder → tee → notification_readable + request_response_readable).
        // Cancelling only one tee branch leaves the other branch keeping the
        // upstream locked. Cancel both so the cancel propagates through the
        // tee + decoder all the way to transport.readable.
        // Likewise, transport.writable is locked by pipeTo from the encoder
        // pipeline; aborting request_writable errors the source TransformStream,
        // which causes pipeTo to abort and release the transport.writable lock.
        await Promise.allSettled([
            this.connection.notification_readable.cancel(),
            this.connection.request_response_readable.cancel(),
            this.connection.request_writable.abort(),
        ])
    }
}
