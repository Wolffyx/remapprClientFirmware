// pattern-check: skip — thin async wrappers over the KEYBOARD unicode verbs,
// same idiom as reportRate.ts/mouse.ts; no abstraction.
//
// §5.2-E &unicode input method. GET_UNICODE_MODE is an open read;
// SET_UNICODE_MODE is mutating — product builds seal it (§19) — and the node
// persists the choice across reboots. A method the node cannot type comes back
// ERR_ARG rather than being guessed at, since typing an unknown sequence at a
// host injects garbage. Pass `targetNode` to relay through a dongle.

import {
    buildUnicodeModeArg,
    Cmd,
    Namespace,
    parseUnicodeMode,
    Status,
    statusName,
    type UnicodeModeState,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

export type { UnicodeModeState }

/** Read the selected host input method and the ones this node can type
 *  (KEYBOARD.GET_UNICODE_MODE). Idempotent read. Throws where no unicode ops
 *  are wired — a node without a keyboard engine (ERR_CMD). */
export async function getUnicodeMode(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<UnicodeModeState> {
    const reply = await rpc.callUniversalPlain(
        Namespace.KEYBOARD,
        Cmd.GET_UNICODE_MODE,
        undefined,
        targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_UNICODE_MODE → ${statusName(reply.status)}`)
    return parseUnicodeMode(reply.data)
}

/** Select the host input method (KEYBOARD.SET_UNICODE_MODE, u8 mode). The node
 *  persists it; a mode outside the reported `supported` set is ERR_ARG. */
export async function setUnicodeMode(
    rpc: RemapprRpc,
    mode: number,
    targetNode = 0,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.KEYBOARD,
        Cmd.SET_UNICODE_MODE,
        buildUnicodeModeArg(mode),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_UNICODE_MODE → ${statusName(reply.status)}`)
}
