// Pattern check: Facade (Tier 1) — extended — buildClusterApi backs the
// `service.cluster` facade (sibling of buildNodesApi in nodeView.ts): getDiag()
// wraps the GET_CLUSTER_DIAG read and onRoleChanged() adapts the async RUCP role
// subscription into the synchronous-disposer contract the UI facades share.
import type { ClusterApi } from '../service'

import { getClusterDiag } from './nodes'
import type { RemapprRpc } from './rpc'

/**
 * Build the `cluster` facade for a directly-attached Remappr node. `getDiag` is a
 * plain (relay-capable) read; `onRoleChanged` bridges the async
 * `rpc.subscribeRole` — which awaits SUBSCRIBE_EVENTS(ROLE) and resolves to an
 * async disposer — into the synchronous `() => void` disposer the renderer's
 * subscription effects expect. The subscribe is kicked off eagerly; if the caller
 * disposes before it resolves, the resolved disposer is invoked immediately so no
 * subscription is ever left dangling on the wire.
 */
export function buildClusterApi(rpc: RemapprRpc): ClusterApi {
    return {
        getDiag() {
            return getClusterDiag(rpc)
        },

        onRoleChanged(cb) {
            let dispose: (() => Promise<void>) | null = null
            let disposed = false
            void rpc
                .subscribeRole(cb)
                .then((d) => {
                    if (disposed) void d()
                    else dispose = d
                })
                .catch(() => {
                    /* subscribe failed (verb unsupported / transport gone) —
                       nothing was armed, so there is nothing to fan or tear down */
                })
            return () => {
                disposed = true
                if (dispose) {
                    void dispose()
                    dispose = null
                }
            }
        },
    }
}
