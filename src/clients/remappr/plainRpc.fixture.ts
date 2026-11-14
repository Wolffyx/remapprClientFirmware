// pattern-check: skip — test fixture: fills the mutation verbs of a fake RPC.
import type { RemapprRpc } from './rpc'

type Fake = Partial<Record<keyof RemapprRpc, unknown>>

/**
 * Give a fake RPC the mutation entry points of a device with control auth
 * off, where the real RPC holds no session: `callMutation` goes as
 * `callUniversalPlain` and `callWrite` as `callPlain`.
 */
export function plainMutations<T extends Fake>(rpc: T): T {
    const r = rpc as unknown as RemapprRpc
    return Object.assign(rpc, {
        callMutation: (...a: Parameters<RemapprRpc['callMutation']>) =>
            r.callUniversalPlain(...a),
        callWrite: (...a: Parameters<RemapprRpc['callWrite']>) => r.callPlain(...a),
    })
}
