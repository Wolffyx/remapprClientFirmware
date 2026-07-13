// pattern-check: skip — thin async wrappers over the COMMON report-rate verbs,
// same idiom as mouse.ts/nodes.ts; no abstraction.
//
// §7.4 report-rate control. GET_RATE_LIMITS is an open read; SET_REPORT_RATE is
// mutating — product builds seal it (§19); served plaintext while the node's
// control auth is dev-disabled, mirroring the MOUSE SET_* verbs. The device
// clamps a desired rate to the highest supported step within min(USB, radio)
// and echoes the applied rate. Pass `targetNode` to relay through a dongle.

import {
    buildReportRateArg,
    Cmd,
    Namespace,
    parseRateLimits,
    Status,
    statusName,
    type RateLimits,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

export type { RateLimits }

/** Read the device's report-rate limits (COMMON.GET_RATE_LIMITS): the USB +
 *  radio ceilings, the offerable rates, and the current applied rate.
 *  Idempotent read. Throws where no report-rate ops are wired (ERR_CMD). */
export async function getRateLimits(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<RateLimits> {
    const reply = await rpc.callUniversalPlain(
        Namespace.COMMON,
        Cmd.GET_RATE_LIMITS,
        undefined,
        targetNode ? { targetNode, retries: RELAY_READ_RETRIES } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`GET_RATE_LIMITS → ${statusName(reply.status)}`)
    return parseRateLimits(reply.data)
}

/** Request a report rate (COMMON.SET_REPORT_RATE, u16 Hz). The device clamps to
 *  the highest supported step within min(USB, radio); a rate below the lowest
 *  step is ERR_ARG. @returns the APPLIED rate (Hz) the device echoed. */
export async function setReportRate(
    rpc: RemapprRpc,
    hz: number,
    targetNode = 0,
): Promise<number> {
    const reply = await rpc.callUniversalPlain(
        Namespace.COMMON,
        Cmd.SET_REPORT_RATE,
        buildReportRateArg(hz),
        targetNode ? { targetNode } : undefined,
    )
    if (reply.status !== Status.OK)
        throw new Error(`SET_REPORT_RATE → ${statusName(reply.status)}`)
    // reply data = u16 applied Hz (LE); fall back to the request on an old fw.
    if (reply.data.length >= 2) return reply.data[0] | (reply.data[1] << 8)
    return hz
}
