// Pattern check: Facade (Tier 1) — extended — buildUnicodeApi backs the
// `service.unicode` facade, the sibling of buildClusterApi in clusterView.ts and
// buildNodesApi in nodeView.ts: it wraps the two KEYBOARD unicode verbs in the
// getMode/setMode shape the renderer's settings modals consume, so no view has
// to know the namespace or opcode.
import type { UnicodeApi } from '../service'

import type { RemapprRpc } from './rpc'
import { getUnicodeMode, setUnicodeMode } from './unicode'

/**
 * Build the `unicode` facade for a directly-attached Remappr node. Both calls are
 * plain (relay-capable) verb wrappers — the read is idempotent, the write is
 * persisted by the device — so unlike the cluster facade there is nothing to
 * bridge here beyond naming.
 */
export function buildUnicodeApi(rpc: RemapprRpc): UnicodeApi {
    return {
        getMode() {
            return getUnicodeMode(rpc)
        },

        setMode(mode: number) {
            return setUnicodeMode(rpc, mode)
        },
    }
}
