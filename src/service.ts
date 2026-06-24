import type { KeyCatalog } from './catalog/types'
import type { KeycodeCodec } from './codec'
import type { LightingCatalog } from './lighting'
import type {
    ActionType,
    AdapterNotification,
    AltRepeatKeyEntry,
    ComboEntry,
    DeviceInfo,
    DynamicEntryCounts,
    ExportedFile,
    KeyAction,
    Keymap,
    KeyOverrideEntry,
    KeyUpdate,
    Layer,
    LockState,
    MacroAction,
    TapDanceEntry,
} from './types'

// pattern-check: skip optional behavior-flags field added to existing Capabilities DTO — feature gate per firmware
export interface FirmwareBehaviorFlags {
    capsWord?: boolean
    leader?: boolean
    autoShift?: boolean
    swapHands?: boolean
}

export interface Capabilities {
    lock: boolean
    rename: boolean
    notifications: boolean
    reorderLayers: boolean
    variableLayerCount: boolean
    exportFormats: string[]
    maxLayers?: number
    encoders?: number
    dynamicEntries?: { tapDance: number; combo: number; keyOverride: number }
    macros?: { count: number; bufferSize: number }
    behaviors?: FirmwareBehaviorFlags
    layoutSideloadable?: boolean
    /** Whole-device read-only: the service serves reads but rejects every edit
     *  (setKey/commit/addLayer/…). Set for behind-dongle node views, whose
     *  relayed-write path is HW-proof-pending. The UI gates editing affordances
     *  on this — never on a firmware name. */
    readOnly?: boolean
}

// Pattern check: Facade (Tier 1) — applied — group related optional methods into 3 cohesive feature facades for renderer single-guard reads
export interface EncoderApi {
    setEncoder(
        layerId: number,
        encoderIdx: number,
        direction: 0 | 1,
        action: KeyAction,
    ): Promise<void>
}

export interface DynamicEntriesApi {
    getCounts(): DynamicEntryCounts

    getTapDance(idx: number): Promise<TapDanceEntry>

    setTapDance(idx: number, entry: TapDanceEntry): Promise<void>

    getCombo(idx: number): Promise<ComboEntry>

    setCombo(idx: number, entry: ComboEntry): Promise<void>

    getKeyOverride(idx: number): Promise<KeyOverrideEntry>

    setKeyOverride(idx: number, entry: KeyOverrideEntry): Promise<void>

    getAltRepeatKey?(idx: number): Promise<AltRepeatKeyEntry>

    setAltRepeatKey?(idx: number, entry: AltRepeatKeyEntry): Promise<void>
}

export interface MacroApi {
    getCount(): number

    /** View-only firmwares (e.g. ZMK, whose macros are compile-time) expose
     *  `macros` with `readonly: true` and omit `setMacro`. The UI keys off this
     *  to disable every editing affordance — never gate on a firmware name. */
    readonly?: boolean

    getMacro(idx: number): Promise<MacroAction[]>

    setMacro?(idx: number, actions: MacroAction[]): Promise<void>
}

// Pattern check: Facade (Tier 1) — extended — mirrors EncoderApi/MacroApi/RgbApi:
// groups the live switch-matrix surface behind one optional service member so the
// renderer reads `service.keyTest` once instead of probing for a hardware channel.
export interface KeyTestApi {
    /** Subscribe to raw matrix state. Fires the full set of currently-pressed
     *  key *positions* (layout indices) whenever it changes. Returns an
     *  unsubscribe. Subscribe only while the Key Test view is open — the poll
     *  is hot and HID is serialized. */
    onMatrixState(cb: (pressed: Set<number>) => void): () => void

    /** Optional one-shot poll for firmwares with no push channel. */
    readMatrix?(): Promise<Set<number>>
}

// Pattern check: Facade (Tier 1) — applied — Keychron-style wireless surface (BT/2.4G/battery/LPM) grouped behind one optional service member; renderer reads service.wireless once instead of N capability flags.
export type WirelessTransport = 'usb' | 'bt' | 'p24g'

export interface WirelessLpm {
    enabled: boolean
    timeoutMs: number
}

export interface WirelessStatus {
    transport: WirelessTransport
    btSlot?: 1 | 2 | 3
    battery?: { level: number; charging: boolean }
}

export interface WirelessApi {
    getLpm(): Promise<WirelessLpm>

    setLpm(opts: WirelessLpm): Promise<void>

    getStatus(): Promise<WirelessStatus>

    onStatusChanged(cb: (status: WirelessStatus) => void): () => void

    getNkro?(): Promise<boolean>

    setNkro?(enabled: boolean): Promise<void>

    factoryReset?(): Promise<void>

    getModuleInfo?(): Promise<WirelessModuleInfo>
}

// pattern-check: skip — plain DTO for wireless-module firmware label
export interface WirelessModuleInfo {
    label: string
    moduleType: number
    versionMajor: number
    versionMinor: number
    versionPatch: number
}

// Pattern check: Facade (Tier 1) — applied — firmware's hardware-default layer
// (e.g. Keychron Mac/Win DIP switch) behind one optional service member. Adapters
// that have no such concept omit it; the editor then keeps its own layer selection.
export interface LayersApi {
    /** The keyboard's current hardware default layer index. */
    getDefaultLayer(): Promise<number>

    /** Fires when the default layer changes on-device (e.g. DIP toggle). */
    onDefaultLayerChanged(cb: (layer: number) => void): () => void
}

// Pattern check: Facade (Tier 1) — applied — Keychron "Advanced Mode" surface
// (debounce / report-rate / snap-click / quick-start) behind one optional member.
// Each method is optional: present only when the firmware advertises that feature.
export interface AdvancedDebounce {
    /** Debounce algorithm index (raw; firmware-specific enum). */
    mode: number
    /** Response time in ms. */
    responseMs: number
}

export interface AdvancedApi {
    /** Whether the firmware exposes the Quick-Start onboarding feature. */
    quickStart: boolean

    getDebounce?(): Promise<AdvancedDebounce>
    setDebounce?(cfg: AdvancedDebounce): Promise<void>

    /** Raw report-rate value/divisor (units firmware-specific). */
    getReportRate?(): Promise<number>
    setReportRate?(value: number): Promise<void>

    /** Snap-click (rapid-trigger / SOCD) toggle — analog/magnetic boards only. */
    getSnapClick?(): Promise<boolean>
    setSnapClick?(enabled: boolean): Promise<void>
}

// Pattern check: Facade (Tier 1) — applied — Keychron RGB surface (LED count, indicators, save) grouped behind one optional service member.

/** OS-lock indicators present on / toggled per board (num/caps/scroll/compose/
 *  kana). The firmware drives every supported indicator with one shared colour
 *  and lights it only while that OS lock is active. */
export interface IndicatorFlags {
    numLock: boolean
    capsLock: boolean
    scrollLock: boolean
    compose: boolean
    kana: boolean
}

export interface IndicatorConfig {
    /** Indicators this board physically has (others are absent, not just off). */
    supported: IndicatorFlags
    /** Indicators the user has turned off. */
    disabled: IndicatorFlags
    /** Shared indicator colour (device HSV, each channel 0–255). */
    color: HsvColor
    /** Raw GET payload — kept for diagnostics. */
    raw: Uint8Array
}

export interface HsvColor {
    h: number
    s: number
    v: number
}

// pattern-check: skip — data contract field additions, no abstraction
// Global backlight (RGB-matrix) effect state. `mode` indexes into RgbApi.effectNames.
export interface RgbEffectState {
    mode: number
    brightness: number // 0..255
    speed: number // 0..255
    color: HsvColor
}

export interface RgbApi {
    getLedCount(): Promise<number>

    getIndicators(): Promise<IndicatorConfig>

    setIndicators(cfg: IndicatorConfig): Promise<void>

    save(): Promise<void>

    // Backlight effect mode. Presence of effectCatalog + get/setEffect enables the
    // "Backlight" tab; firmware that can't drive a global effect omits them.
    effectCatalog?: LightingCatalog

    getEffect?(): Promise<RgbEffectState>

    setEffect?(state: RgbEffectState): Promise<void>

    /** Resolve the RGB-matrix effect index that displays the stored per-key
     *  colour buffer. Firmware-specific: Keychron registers PER_KEY_RGB as a
     *  *custom* effect appended after the built-ins, so it isn't in the VIA
     *  definition's effect catalog and can't be matched by name. Returns null
     *  when undeterminable. */
    getPerKeyEffectMode?(): Promise<number | null>

    getPerKeyType?(): Promise<number>

    setPerKeyType?(type: number): Promise<void>

    getPerKeyColors?(startLed: number, count: number): Promise<HsvColor[]>

    setPerKeyColors?(startLed: number, colors: HsvColor[]): Promise<void>

    /** Map physical-layout key index → LED index for per-key colour I/O. Identity
     *  when the firmware's LED order matches layout order; firmware-specific
     *  otherwise. `keyCount` is the number of layout keys. */
    getLedIndexMap?(keyCount: number): Promise<number[]>

    getMixedRegions?(): Promise<Uint8Array>

    setMixedRegions?(payload: Uint8Array): Promise<void>

    getMixedEffect?(): Promise<Uint8Array>

    setMixedEffect?(payload: Uint8Array): Promise<void>
}

// Pattern check: Facade (Tier 1) — applied — the behind-dongle node roster behind
// one optional service member (sibling of keyTest/wireless/rgb). The renderer reads
// `service.nodes` once instead of threading the relay RPC; the dongle's adapter
// owns the wire (listNodes + relayed reads), the consumer just sees views.

/** A node reachable through a dongle, as surfaced to the UI. Decoupled from the
 *  wire NodeRecord so the contract stays firmware-neutral. */
export interface NodeView {
    /** Short-id used to address the node over the relay (stable per bond). */
    id: number
    /** Adapter-formatted human label (e.g. "Node 0x0007"). */
    label: string
    /** Firmware personality byte (board kind); 0 when unknown. */
    personality: number
    /** Link is up right now. */
    online: boolean
    /** Node is bonded to the dongle (vs. a transient sighting). */
    bonded: boolean
    /** Last-seen signal strength in dBm (0 when unknown). */
    rssi: number
    /** Mesh hops to reach the node (0 = direct child of the dongle). */
    hopCount: number
}

export interface NodesApi {
    /** Enumerate the nodes reachable through this device. Empty for a
     *  directly-attached (non-dongle) device. */
    list(): Promise<NodeView[]>

    /** Open a **read-only** KeyboardService view of one node (relayed read of its
     *  device-info + active config + geometry). The returned service has
     *  `capabilities.readOnly === true`; every editing call throws. Editing a
     *  behind-dongle node is gated on the relayed-write HW-proof. */
    open(id: number): Promise<KeyboardService>
}

export interface KeyboardService {
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities

    getLockState(): Promise<LockState>

    unlock(): Promise<void>

    onLockStateChanged(cb: (state: LockState) => void): () => void

    listActionTypes(): Promise<ActionType[]>

    buildKeyAction(kind: string, params: number[]): KeyAction

    /** Unified canonical catalog filtered by codec.supports(). PR 1 optional;
     *  promoted to required after every adapter ships a codec (PR 2). */
    listKeyCatalog?(): Promise<KeyCatalog>

    /** Strategy reference. Adapters expose codec for cross-firmware encode/decode. */
    codec?: KeycodeCodec

    getKeymap(): Promise<Keymap>

    getPhysicalLayouts(): Promise<{
        layouts: import('./types').PhysicalLayout[]
        activeLayoutId: number
    }>

    setKey(layerId: number, position: number, action: KeyAction): Promise<void>

    setKeys(updates: KeyUpdate[]): Promise<void>

    encoders?: EncoderApi
    dynamic?: DynamicEntriesApi
    macros?: MacroApi
    /** Live switch-matrix readout for the Key Test view. Present only when the
     *  firmware can report raw matrix state over the wire; absent firmwares fall
     *  back to OS-event press detection. */
    keyTest?: KeyTestApi
    wireless?: WirelessApi
    rgb?: RgbApi
    advanced?: AdvancedApi
    /** Hardware default-layer reporting (Keychron Mac/Win DIP). Named `layerControl`
     *  to avoid colliding with adapters' internal keymap `layers`. */
    layerControl?: LayersApi
    /** Behind-dongle node roster (present on dongle devices; `list()` is empty for
     *  a directly-attached keyboard). Views are read-only today. */
    nodes?: NodesApi

    addLayer(): Promise<Layer>

    removeLayer(layerId: number): Promise<void>

    renameLayer(layerId: number, name: string): Promise<void>

    moveLayer(startIndex: number, destIndex: number): Promise<void>

    restoreLayer(layerId: number, atIndex: number): Promise<Layer>

    setActivePhysicalLayout(layoutId: number): Promise<Keymap>

    /** Optional: swap to a sideloaded/registry-fetched VIA-style keyboard def.
     *  Throws on matrix-mismatch or pendingChanges. Adapters that don't expose
     *  this capability omit it. */
    applyLayout?(def: import('./kle/parser').ParsedKeyboardDef): Promise<void>

    commit(): Promise<void>

    discardChanges(): Promise<void>

    resetSettings(): Promise<void>

    hasPendingChanges(): boolean

    refreshPendingChanges(): Promise<boolean>

    onPendingChangesChanged(cb: (pending: boolean) => void): () => void

    subscribe(cb: (notification: AdapterNotification) => void): () => void

    exportConfig(): Promise<ExportedFile[]>

    /** Optional: raw `remappr.keymap` JSON this device seeds the config editor
     *  from — the source-of-truth document the download modal compiles per
     *  firmware. Demo/mock devices ship a seed; real adapters omit it until
     *  raise-from-runtime (config ← live keymap) lands. */
    getConfigSource?(): Promise<string | null>

    onClosed(cb: (reason?: unknown) => void): () => void

    disconnect(): Promise<void>
}
