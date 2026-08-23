import type { Transport } from './transport'
import type { KeyboardService } from './service'
import type { DeviceInfo, TransportKind } from './types'

export interface BleDiscovery {
    serviceUuid: string
    charUuid: string
}

export interface HidDiscovery {
    vendorIds?: number[]
    usagePage?: number
    usage?: number
}

export interface Discovery {
    ble?: BleDiscovery
    hid?: HidDiscovery
    serial?: Record<string, never>
    /** Ordering weight when a host can only apply ONE discovery filter (the
     *  Electron HID path). Highest wins; default 0. Client registration order is
     *  nondeterministic under lazy chunk loading, so an adapter that must own
     *  the filter declares it here rather than relying on import order. */
    priority?: number
}

export type Probe =
    | { ok: true; deviceInfo: DeviceInfo }
    | { ok: false; reason?: string }

export interface ProbeHint {
    transportKind: TransportKind
}

/** UI grouping for the connection settings: several adapters can belong to one
 *  family (qmk, qmk-vial, keychron-… are all "QMK"), and the user picks a family
 *  rather than an individual adapter. Declared by the adapter so the app builds
 *  the picker from the registry instead of a hardcoded list of firmware names. */
export interface AdapterCategoryInfo {
    /** Stable id persisted in user settings, e.g. `'qmk'`. */
    readonly id: string
    /** Display name, e.g. `'QMK'`. Adapters sharing an id must agree on it. */
    readonly label: string
    /** Ordering in the picker; lower first, default 0. */
    readonly order?: number
    /** True when adapters in this family can look a board up in an online
     *  layout registry, so the app offers the auto-load-layout setting. */
    readonly layoutRegistry?: boolean
}

export interface FirmwareAdapter {
    readonly id: string
    readonly displayName: string
    readonly discovery: Discovery
    /** Which family this adapter appears under in the connection settings.
     *  Adapters that omit it are not offered as a user-selectable family. */
    readonly category?: AdapterCategoryInfo

    /** Optional one-time host-side warmup, awaited once after the adapter
     *  registers and before any connect. For anything a client must pull from
     *  the host before it can talk to a device — e.g. reading a persisted bonded
     *  identity out of the host secret store. Idempotent: it may be awaited more
     *  than once. Keeps such setup inside the client instead of making the app
     *  call a named firmware's init. */
    prepare?(): Promise<void>

    canHandle(transport: Transport, hint?: ProbeHint): Promise<Probe>

    connect(transport: Transport, signal: AbortSignal): Promise<KeyboardService>
}
