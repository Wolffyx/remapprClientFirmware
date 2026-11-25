// pattern-check: skip barrel module — re-exports + single registerAdapter side effect
import { registerAdapter } from '@firmware/registry'

import { mchoseAdapter } from './adapter'

export { mchoseAdapter, MCHOSE_USAGE_PAGE } from './adapter'
export { MCHOSE_FIRMWARE, MchoseMouseService } from './service'
export { MCHOSE_VIDS, modelFor, type MchoseModel } from './mouse'

registerAdapter(mchoseAdapter)
