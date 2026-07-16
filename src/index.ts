export type {
    ActionSlot,
    ActionSlotKind,
    ActionType,
    AdapterNotification,
    AltRepeatKeyEntry,
    AltRepeatKeyOptions,
    ComboEntry,
    DeviceInfo,
    DynamicEntryCounts,
    EncoderAction,
    EncoderSlot,
    ExportedFile,
    KeyAction,
    HoldTapLabelData,
    KeyLabel,
    KeyOverrideEntry,
    KeyOverrideOptions,
    KeyUpdate,
    Keymap,
    Layer,
    LockState,
    MacroAction,
    PhysicalLayout,
    PhysicalLayoutKey,
    TapDanceEntry,
    TransportKind,
} from './types'

export { isUnlocked } from './types'

export type {
    Capabilities,
    ClusterApi,
    ClusterDiag,
    ClusterPeer,
    DynamicEntriesApi,
    EncoderApi,
    HsvColor,
    IndicatorConfig,
    KeyboardService,
    MacroApi,
    NodesApi,
    NodeView,
    RgbApi,
    RoleEvent,
    WirelessApi,
    WirelessLpm,
    WirelessStatus,
    WirelessTransport,
} from './service'

export type {
    BleDiscovery,
    Discovery,
    FirmwareAdapter,
    HidDiscovery,
    Probe,
    ProbeHint,
} from './adapter'

export type { Transport } from './transport'
export { parseVidPidFromLabel, readTransportIds } from './transport'

export {
    FirmwareError,
    LockedError,
    ProtocolError,
    TransportError,
    UnsupportedError,
} from './errors'

// Re-exported transport error: thrown by every transport factory when
// the user cancels a system picker (web-serial / web-bluetooth / native
// equivalents). Surfaced from @firmware so the renderer never needs to
// import @firmware/zmk for it.
export { UserCancelledError } from '@zmkfirmware/zmk-studio-ts-client/transport/errors'

export {
    resolveBindingLabels,
    type ResolvedBindingPosition,
    type ResolvedHoldTapDescriptor,
} from './labels'

export { getAdapters, pickAdapter, registerAdapter } from './registry'

// One-call bootstrap for every built-in firmware (adapters + compilers). Apps
// call this at boot instead of importing each firmware barrel by hand.
export { registerBuiltinFirmwares } from './builtins'

// Mock / demo entry point. The adapter is registered (id 'mock') but only
// matches a sentinel transport label; `connectMock()` bypasses pickAdapter so
// the Try Demo flow is independent of probe ordering.
export {
    connectMock,
    connectMockWithConfig,
    MOCK_TRANSPORT_LABEL,
} from './mock/adapter'
