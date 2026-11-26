// pattern-check: skip — barrel + side-effect registration of the remappr adapter
import { registerAdapter } from '../../registry'
import { remapprAdapter } from './adapter'

registerAdapter(remapprAdapter)

export { remapprAdapter } from './adapter'
export { RemapprKeyboardService, type RemapprServiceDeps } from './service'
export { RemapprCodec, remapprCodec } from './codec'
export {
    lowerConfigToNeutral,
    raiseNeutralToConfig,
    type LowerResult,
} from './configBridge'
export { fetchPhysicalLayouts } from './geometry'
export { buildNodesApi } from './nodeView'
export { readConfigBlob, loadDeviceConfig } from './configRead'

// Control client (Workstream B) re-exports for advanced / Electron consumers.
export {
    createRemapprRpc,
    type RemapprRpc,
    type UniversalReply,
} from './rpc'
export {
    loadOrCreateIdentity,
    RemapprSession,
    setRemapprIdentityStore,
    type RemapprIdentity,
    type RemapprIdentityStore,
} from './auth'
export {
    discover,
    nsVersionOf,
    servesNamespace,
    type DiscoveryResult,
} from './discovery'
export {
    listNodes,
    getNodeInfo,
    getErrorCounters,
    establishNodeSession,
    unpairRadio,
    clearAllBonds,
    enterDongleBootloader,
    type NodeRecord,
} from './nodes'
export { hapticPulse, setDisplay, DISPLAY_TEXT_MAX } from './feedback'
export {
    servesHost,
    buildHostValuesApi,
    buildHostSetArgs,
    parseHostKeys,
    HostVerb,
    HOST_DATA_MAX,
    HOST_TEXT_MAX,
    HOST_KEY_MAX,
} from './hostValues'
export {
    getRateLimits,
    setReportRate,
    type RateLimits,
} from './reportRate'
export {
    getUnicodeMode,
    setUnicodeMode,
    type UnicodeModeState,
} from './unicode'
export * as remapprProtocol from './protocol'
