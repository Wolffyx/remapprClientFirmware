// pattern-check: skip barrel module — re-exports + single registerAdapter side effect
import { registerAdapter } from '@firmware/registry'
import { qmkAdapter } from './adapter'

export {
    qmkAdapter,
    createQmkAdapter,
    QMK_DEFAULT_ROWS,
    QMK_DEFAULT_COLS,
    type QmkAdapterOptions,
} from './adapter'
export { QmkKeyboardService } from './service'
export { QMK_ACTION_TYPES } from './actionTypes'
export {
    createHidClientFromTransport,
    type HidClient,
    type HidClientOpts,
} from './hidClient'
export {
    encodeKeycode,
    decodeKeycode,
    decodeAsKeyAction,
    buildQmkKeyAction,
    QMK_KIND,
} from './actions'
export { emitKeymapC, exportKeymap } from './export'
export {
    VIA_PAYLOAD_SIZE,
    VIA_USAGE,
    VIA_USAGE_PAGE,
    VIA_ID,
    VIA_KBV,
} from './protocol'

registerAdapter(qmkAdapter)
