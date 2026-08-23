// pattern-check: skip barrel module — re-exports + single registerAdapter side effect
import { registerAdapter } from '@firmware/registry'
import { vialAdapter } from './adapter'

export { vialAdapter, createVialAdapter } from './adapter'
export { VialKeyboardService } from './service'
export { VIAL_ACTION_TYPES, buildVialActionTypes } from './actionTypes'
export {
    getMacroCount,
    getMacroBufferSize,
    readMacroBuffer,
    writeMacroBuffer,
    splitMacros,
    joinMacros,
    readMacro,
    writeMacro,
} from './macros'
export {
    decodeVialAsKeyAction,
    decodeVialKeycode,
    encodeVialKeycode,
    VIAL_KIND,
    buildVialKeyAction,
    relabelVialLayer,
} from './actions'
export {
    VIAL_PREFIX,
    VIAL_CMD,
    DYNAMIC_OP,
    SUPPORTED_VIAL_PROTOCOLS,
    VIAL_FEATURE,
} from './protocol'
export type {
    KeyboardIdResponse,
    UnlockStatusResponse,
    DynamicEntryCount,
    EncoderPair,
} from './protocol'
export {
    fetchAndParseKeyboardDef,
    fetchKeyboardDefBytes,
    decompressDef,
    parseKeyboardDef,
} from './keyboardDef'
export type {
    ParsedKeyboardDef,
    RawKeyboardDef,
    VialCustomKeycode,
} from './keyboardDef'
export {
    runUnlockFlow,
    readUnlockStatus,
    startUnlock,
    pollUnlockOnce,
    lockDevice,
} from './unlock'
export {
    getDynamicCounts,
    getTapDance,
    setTapDance,
    getCombo,
    setCombo,
    getKeyOverride,
    setKeyOverride,
    getAltRepeatKey,
    setAltRepeatKey,
} from './dynamic'
export type {
    TapDanceEntry,
    ComboEntry,
    KeyOverrideEntry,
    KeyOverrideOptions,
    AltRepeatKeyEntry,
    AltRepeatKeyOptions,
} from './dynamic'
export { readEncoder, writeEncoder } from './encoder'

registerAdapter(vialAdapter)
