// pattern-check: skip barrel module — re-exports + single registerAdapter side effect
import { registerAdapter } from '@firmware/registry'

import { keychronAdapter } from './adapter'

export {
    keychronAdapter,
    createKeychronAdapter,
    type KeychronAdapterOptions,
} from './adapter'
export {
    KC_ID,
    MISC_SUB,
    RGB_SUB,
    FEATURE_BIT,
    MISC_FEATURE_BIT,
    KEYCHRON_PAYLOAD_SIZE,
    KEYCHRON_USAGE,
    KEYCHRON_USAGE_PAGE,
    type FeatureFlags,
    type MiscFeatureFlags,
} from './protocol'
export { createWirelessFacade } from './wireless'
export { createRgbFacade } from './rgb'
export {
    KEYCHRON_BOARDS,
    matchBoard,
    getBoardById,
    type KeychronBoardPreset,
} from './boards'

registerAdapter(keychronAdapter)
