// Pattern check: Template Method (Tier 1) — extended — fills src/devices/keylessService.ts KeylessServiceBase with a read-only native profile; the live source is injected, so every generic source shares this one class.
//
// A device the app has no protocol for (a USB gamepad, a mouse): view and live
// test only. It serves its native profile through ControlsApi with no write
// methods, so the editor shows it read-only; a re-drawn layout is remembered
// per device.
import { KeylessServiceBase } from '../devices/keylessService'
import {
    createLayoutOverride,
    type LayoutOverride,
} from '../devices/layoutOverride'
import type { ControlsChange, DeviceKind } from '../devices/types'
import type { Capabilities, ControlsApi } from '../service'
import type { DeviceInfo } from '../types'
import type { LiveSource, NativeProfile } from './types'

/** The id the firmware field of a generic device's info carries. */
export const GENERIC_FIRMWARE = 'hid'

/** A generic device has one profile: what it does natively. */
export const NATIVE_PROFILE = { id: 'native', name: 'Default' } as const

const CAPABILITIES: Capabilities = {
    lock: 'none',
    rename: false,
    notifications: false,
    reorderLayers: false,
    variableLayerCount: false,
    exportFormats: [],
    saveMode: 'none',
    readOnly: true,
}

export interface GenericHidDeps {
    readonly kind: DeviceKind
    readonly deviceInfo: DeviceInfo
    readonly profile: NativeProfile
    /** Where a re-drawn layout of this device is remembered. */
    readonly layoutKey: string
    readonly live: LiveSource
    /** Calls `gone` once the device is unplugged; returns a stop function. */
    readonly watchGone?: (gone: () => void) => () => void
}

export class GenericHidService extends KeylessServiceBase {
    readonly kind: DeviceKind
    readonly deviceInfo: DeviceInfo
    readonly capabilities = CAPABILITIES
    readonly controls: ControlsApi

    private readonly changeListeners = new Set<(c: ControlsChange) => void>()
    private readonly layout: LayoutOverride
    private readonly stopWatching: () => void

    constructor(private readonly deps: GenericHidDeps) {
        super()
        this.kind = deps.kind
        this.deviceInfo = deps.deviceInfo
        this.layout = createLayoutOverride(deps.profile.model, {
            key: deps.layoutKey,
            onChanged: () => this.changed({ type: 'model' }),
        })
        this.controls = this.nativeControls()
        this.stopWatching =
            deps.watchGone?.(() => {
                this.stopWatching()
                this.closedBy(
                    new Error(`${deps.deviceInfo.name} was unplugged`),
                )
            }) ?? (() => {})
    }

    protected override close(): Promise<void> {
        this.stopWatching()
        this.changeListeners.clear()
        return Promise.resolve()
    }

    private changed(change: ControlsChange): void {
        for (const cb of [...this.changeListeners]) cb(change)
    }

    private nativeControls(): ControlsApi {
        const { profile, live } = this.deps
        return {
            getModel: () => Promise.resolve(this.layout.model()),
            getCatalog: () => Promise.resolve(profile.catalog),
            getProfiles: () =>
                Promise.resolve({
                    profiles: [NATIVE_PROFILE],
                    activeId: NATIVE_PROFILE.id,
                }),
            getBindings: (id) =>
                id === NATIVE_PROFILE.id
                    ? Promise.resolve(profile.bindings)
                    : Promise.reject(new Error(`Unknown profile ${id}`)),
            onChanged: (cb) => {
                this.changeListeners.add(cb)
                return () => {
                    this.changeListeners.delete(cb)
                }
            },
            onInput: (cb) => live.subscribe(cb),
            layout: this.layout.api,
        }
    }
}
