// pattern-check: skip — thin async wrappers over the MOUSE namespace verbs,
// same idiom as nodes.ts/feedback.ts; no abstraction.
//
// §5.4 pointer-device motion control. MOUSE opcodes are namespace-scoped and
// ride ONLY the 0xE2/UCH router. Every verb is manifest-gated on the firmware
// actually having the op wired (a keyboard without a pointer sensor answers
// ERR_CMD and doesn't list the namespace). The SET_* verbs are mutating —
// product builds seal them (§19); served plaintext while the node's control
// auth is dev-disabled. Pass `targetNode` to relay through a dongle.

import {
    buildDpiArg,
    MouseVerb,
    Namespace,
    parseMotionConfig,
    Status,
    statusName,
    type MotionConfig,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

export type { MotionConfig }

/** Read the pointer device's motion configuration (MOUSE.GET_MOTION_CONFIG):
 *  the sensor's DPI range/step and the current DPI / acceleration profile /
 *  scroll mode. Idempotent read. Throws where no pointer ops are wired
 *  (ERR_CMD). */
export async function getMotionConfig(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<MotionConfig> {
    const reply = await rpc.callUniversalPlain(
        Namespace.MOUSE,
        MouseVerb.GET_MOTION_CONFIG,
        undefined,
        targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_MOTION_CONFIG → ${statusName(reply.status)}`)
    return parseMotionConfig(reply.data)
}

/** Set the sensor DPI (MOUSE.SET_DPI). The firmware rejects a value outside
 *  the sensor's min..max (ERR_ARG). */
export async function setDpi(
    rpc: RemapprRpc,
    dpi: number,
    targetNode = 0,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.MOUSE,
        MouseVerb.SET_DPI,
        buildDpiArg(dpi),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_DPI → ${statusName(reply.status)}`)
}

/** Select an acceleration profile (MOUSE.SET_ACCEL_PROFILE). */
export async function setAccelProfile(
    rpc: RemapprRpc,
    profile: number,
    targetNode = 0,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.MOUSE,
        MouseVerb.SET_ACCEL_PROFILE,
        new Uint8Array([profile]),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_ACCEL_PROFILE → ${statusName(reply.status)}`)
}

/** Select a scroll mode (MOUSE.SET_SCROLL_MODE). */
export async function setScrollMode(
    rpc: RemapprRpc,
    mode: number,
    targetNode = 0,
): Promise<void> {
    const reply = await rpc.callUniversalPlain(
        Namespace.MOUSE,
        MouseVerb.SET_SCROLL_MODE,
        new Uint8Array([mode]),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_SCROLL_MODE → ${statusName(reply.status)}`)
}
