// pattern-check: skip — thin async wrappers over the LIGHTING output-feedback
// verbs (HAPTIC_PULSE / SET_DISPLAY), same idiom as nodes.ts; no abstraction.
//
// §5.7 output feedback (§18 → §7): a host fires a haptic effect or pushes an
// OLED text slot; the receiving node floods it cluster-wide over the node bus
// and applies it locally. Both verbs are manifest-gated on the node actually
// having a handler wired (CAP bits 8/9) and answer ERR_CMD otherwise. They are
// mutating verbs — product builds seal them (§19); served plaintext while the
// node's control auth is dev-disabled. Pass `targetNode` to relay through a
// dongle to a behind-dongle node.

import {
    buildDisplayArg,
    buildHapticArg,
    LightingVerb,
    Namespace,
    Status,
    statusName,
} from './protocol'
import type { RemapprRpc } from './rpc'

export { DISPLAY_TEXT_MAX } from './protocol'

/** Fire a haptic effect (LIGHTING.HAPTIC_PULSE) cluster-wide. `effect` and
 *  `intensity` are device-defined 0..255 scales; `durationMs` caps at u16. */
export async function hapticPulse(
    rpc: RemapprRpc,
    effect: number,
    intensity: number,
    durationMs: number,
    targetNode = 0,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.LIGHTING,
        LightingVerb.HAPTIC_PULSE,
        buildHapticArg(effect, intensity, durationMs),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`HAPTIC_PULSE → ${statusName(reply.status)}`)
}

/** Push one OLED text slot (LIGHTING.SET_DISPLAY) cluster-wide. Text is UTF-8,
 *  ≤ DISPLAY_TEXT_MAX bytes encoded (throws beyond). `clear` wipes the slot
 *  before drawing; `invert` renders inverse video. */
export async function setDisplay(
    rpc: RemapprRpc,
    slot: number,
    text: string,
    opts?: { clear?: boolean; invert?: boolean; targetNode?: number },
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.LIGHTING,
        LightingVerb.SET_DISPLAY,
        buildDisplayArg(slot, text, opts),
        opts?.targetNode ? { targetNode: opts.targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_DISPLAY → ${statusName(reply.status)}`)
}
