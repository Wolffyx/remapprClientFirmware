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
    /** How the editor commits edits — declared per firmware so the UI shows the
     *  right save affordance. This models the CLIENT save ACTION, not any
     *  firmware-internal flash "persistence" (e.g. ZMK's debounced settings
     *  storage, https://zmk.dev/docs/config/settings, is a separate concern the
     *  client does not manage).
     *  - `'manual'`: the user saves explicitly; `commit()` sends the firmware's
     *    save command (ZMK Studio `saveChanges`, Remappr blob write) and can
     *    fail. UI shows Save + Discard + unsaved-change tracking. This is exactly
     *    the ZMK-Studio "save" the ZMK client mirrors.
     *  - `'automatic'`: every edit is written immediately (VIA / Vial / Keychron
     *    EEPROM); `commit()` only clears the pending flag. No Save button needed.
     *  - `'none'`: edits are session-only (mock). UI shows no save affordance. */
    saveMode: 'manual' | 'automatic' | 'none'
    /** The firmware owns a durable persistence save as a first-class feature —
     *  a committed edit is guaranteed written to non-volatile device storage.
     *  Declared only by firmwares that guarantee it (e.g. Remappr's config-blob
     *  commit); omitted elsewhere. Distinct from {@link saveMode}, which is the
     *  client save ACTION: ZMK has `saveMode: 'manual'` (ZMK Studio save) but
     *  does NOT set this — its studio save persists only if the firmware was
     *  built with settings storage, so persistence isn't a guaranteed capability. */
    persistence?: boolean
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

    /** Real per-index macro names (e.g. §24 config-blob DT names); index =
     *  pool position. Only the Remappr adapter implements this; the keycode
     *  picker keys off its presence to list macros as named tiles in the
     *  Macros tab. View-only firmwares whose macros aren't key-assignable
     *  (ZMK, QMK/Vial) omit it. */
    listNames?(): readonly string[]
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
    /** The node holds the §5 master (MAIN) election role. Exactly one bonded node
     *  is master in a cluster; false for every node until one reports a role. */
    isMaster: boolean
    /** Raw §5 election-role low byte (0 = unknown); `isMaster` is the decoded bit. */
    nodeRole: number
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

    /** Open (or close) the dongle's pairing window so a new node can bond — the
     *  remote equivalent of the physical pairing button. Resolves to the window
     *  state; rejects when the roster is full (all pipes bonded). */
    openPairWindow(open?: boolean): Promise<boolean>

    /** Unbond a node by id, clearing a stale dongle bond so its pipe is free to
     *  re-pair. Rejects on an unknown id. */
    forgetNode(id: number): Promise<void>

    /** Tell a node to forget its dongle bond and re-arm for a fresh pair
     *  (owner-sealed COMMON.UNPAIR_RADIO, §19). Establishes a node session over
     *  the relay, then sends the sealed verb. Rejects on a failed handshake or a
     *  refused seal. The relayed-seal data plane is HW-proof-pending. */
    unpairRadio(id: number): Promise<void>

    /** Wipe the dongle's entire bond table (recovery for stale bonds that
     *  forgetNode can't reach). Resolves to the number of pipes unbonded. */
    clearAllBonds(): Promise<number>

    /** Set (or query, when `enabled` is omitted) the dongle's USB keystroke
     *  routing: true = the NKRO interface, false = the boot 6KRO interface
     *  (default, BIOS-safe). Persists on the dongle across reboots. Resolves to
     *  the current state. */
    setNkro(enabled?: boolean): Promise<boolean>

    /** Read the dongle's radio link stats: the live hop map with per-channel
     *  packet-error counters and a generation counter that bumps on every
     *  adaptive channel swap. Idempotent read for a diagnostics view. */
    getLinkStats(): Promise<RadioLinkStats>
}

// pattern-check: skip — two plain DTO interfaces mirroring the wire reply;
// structural typing bridges the firmware adapters, no GoF abstraction.
/** One radio hop-map slot: the RF channel and its packet-error window so far
 *  (counters reset each verdict window). */
export interface RadioChannelStat {
    channel: number
    ok: number
    fail: number
}

/** Radio link diagnostics for a multi-node receiver (NodesApi.getLinkStats). */
export interface RadioLinkStats {
    /** Hop-map generation — bumps (mod 256) on every adaptive channel swap. */
    mapGeneration: number
    /** Replacement candidates outside the active map. */
    poolCount: number
    /** Samples per channel before a keep/swap verdict. */
    window: number
    /** Failure percentage that triggers an adaptive swap. */
    failPercent: number
    channels: RadioChannelStat[]
}

export interface KeyboardService {
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities
    /** Device class for the renderer's landing decision. `'dongle'` lands on the
     *  node roster (no keymap of its own); omitted/`'keyboard'` opens the editor.
     *  A behind-dongle node view is a keyboard, not a dongle. */
    readonly kind?: 'keyboard' | 'dongle'

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
