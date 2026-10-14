// Pattern check: Template Method (Tier 1) — applied — every keyless device (demo
// devices, generic HID, Remappr mouse/dongle) shares the keymap-free half of
// KeyboardService; subclasses supply identity, capabilities, their facades and
// the close/reset/export steps.
//
// The app holds every connection as a KeyboardService. A device with no keymap
// still has to answer the keymap half of that contract; this base answers it
// once — an empty keymap, no lock, keymap edits rejected — and carries the
// listener plumbing, so a device class only writes what makes it different.
import { UnsupportedError } from '../errors'
import type { Capabilities, KeyboardService } from '../service'
import type {
    ActionType,
    AdapterNotification,
    DeviceInfo,
    ExportedFile,
    KeyAction,
    Keymap,
    Layer,
    LockState,
    PhysicalLayout,
} from '../types'
import type { DeviceKind } from './types'

type Listener<T> = (value: T) => void

function listen<T>(set: Set<Listener<T>>, cb: Listener<T>): () => void {
    set.add(cb)
    return () => {
        set.delete(cb)
    }
}

function emit<T>(set: Set<Listener<T>>, value: T): void {
    for (const cb of [...set]) cb(value)
}

const unsupported = (op: string): Promise<never> =>
    Promise.reject(new UnsupportedError(op))

export abstract class KeylessServiceBase implements KeyboardService {
    abstract readonly deviceInfo: DeviceInfo
    abstract readonly capabilities: Capabilities
    abstract readonly kind: DeviceKind

    private readonly closedListeners = new Set<Listener<unknown>>()
    private readonly pendingListeners = new Set<Listener<boolean>>()
    private readonly notificationListeners = new Set<
        Listener<AdapterNotification>
    >()
    private pending = false
    private closed = false

    // --- lock: keyless devices have none ---------------------------------
    getLockState(): Promise<LockState> {
        return Promise.resolve('not-applicable')
    }
    unlock(): Promise<void> {
        return Promise.resolve()
    }
    onLockStateChanged(): () => void {
        return () => {}
    }

    // --- keymap half: empty, edits rejected ------------------------------
    listActionTypes(): Promise<ActionType[]> {
        return Promise.resolve([])
    }
    buildKeyAction(): KeyAction {
        throw new UnsupportedError('buildKeyAction')
    }
    getKeymap(): Promise<Keymap> {
        return Promise.resolve({
            layers: [],
            availableLayers: 0,
            activeLayoutId: 0,
            layouts: [],
        })
    }
    getPhysicalLayouts(): Promise<{
        layouts: PhysicalLayout[]
        activeLayoutId: number
    }> {
        return Promise.resolve({ layouts: [], activeLayoutId: 0 })
    }
    setKey(): Promise<void> {
        return unsupported('setKey')
    }
    setKeys(): Promise<void> {
        return unsupported('setKeys')
    }
    addLayer(): Promise<Layer> {
        return unsupported('addLayer')
    }
    removeLayer(): Promise<void> {
        return unsupported('removeLayer')
    }
    renameLayer(): Promise<void> {
        return unsupported('renameLayer')
    }
    moveLayer(): Promise<void> {
        return unsupported('moveLayer')
    }
    restoreLayer(): Promise<Layer> {
        return unsupported('restoreLayer')
    }
    setActivePhysicalLayout(): Promise<Keymap> {
        return unsupported('setActivePhysicalLayout')
    }

    // --- save, reset, export: subclasses override what they support ------
    commit(): Promise<void> {
        this.setPending(false)
        return Promise.resolve()
    }
    discardChanges(): Promise<void> {
        this.setPending(false)
        return Promise.resolve()
    }
    resetSettings(): Promise<void> {
        return unsupported('resetSettings')
    }
    exportConfig(): Promise<ExportedFile[]> {
        return Promise.resolve([])
    }

    // --- pending changes ---------------------------------------------------
    hasPendingChanges(): boolean {
        return this.pending
    }
    refreshPendingChanges(): Promise<boolean> {
        return Promise.resolve(this.pending)
    }
    onPendingChangesChanged(cb: (pending: boolean) => void): () => void {
        return listen(this.pendingListeners, cb)
    }
    protected setPending(pending: boolean): void {
        if (pending === this.pending) return
        this.pending = pending
        emit(this.pendingListeners, pending)
    }

    // --- notifications and lifetime ----------------------------------------
    subscribe(cb: (notification: AdapterNotification) => void): () => void {
        return listen(this.notificationListeners, cb)
    }
    protected notify(notification: AdapterNotification): void {
        emit(this.notificationListeners, notification)
    }
    onClosed(cb: (reason?: unknown) => void): () => void {
        return listen(this.closedListeners, cb)
    }
    async disconnect(): Promise<void> {
        if (this.closed) return
        this.closed = true
        await this.close()
        emit(this.closedListeners, undefined)
    }
    /** Release the device (stop timers, close the transport). */
    protected close(): Promise<void> {
        return Promise.resolve()
    }
}
