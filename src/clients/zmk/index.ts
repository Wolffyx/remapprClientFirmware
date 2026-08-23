// pattern-check: skip barrel module — re-exports + single registerAdapter side effect
import { registerAdapter } from '@firmware/registry'
import { zmkAdapter } from './adapter'

export { zmkAdapter } from './adapter'
export { ZmkKeyboardService } from './service'
export {
    ZMK_CHAR_UUID,
    ZMK_CHAR_UUID_NOBLE,
    ZMK_SERVICE_UUID,
    ZMK_SERVICE_UUID_NOBLE,
} from './ble/constants'
export {
    bindingPrefix,
    bindingToKeyAction,
    buildKeyLabel,
    keyActionToBinding,
    zmkBindingFromAction,
    type BehaviorMap,
    type ZmkBindingView,
} from './actions'
export {
    behaviorToActionType,
    behaviorsToActionTypes,
    validateSlotValue,
} from './actionTypes'
export { displayNameToBinding } from './displayNameToBinding'
export { zmkKeymapToNeutral } from './keymap'

// Re-exported upstream ZMK protocol types so renderer code never needs
// to import @zmkfirmware/zmk-studio-ts-client directly. The firmware
// adapter mediates the protocol surface.
export type {
    BehaviorBinding,
    BehaviorBindingParametersSet,
    BehaviorParameterValueDescription,
    GetBehaviorDetailsResponse,
} from './protocol'
export type { RpcTransport } from './protocol'
export { UserCancelledError } from './protocol'
export {
    downloadConfigFile,
    downloadConfigZip,
    generateZMKConfigFile,
    generateZMKKeymapFile,
    type ZMKConfigOptions,
} from './export'

registerAdapter(zmkAdapter)
