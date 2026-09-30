// Pattern check: no GoF pattern (-) — rejected — Vial unlock = poll loop with abort/timeout; state machine is overkill for three transitions.
// Vial unlock flow:
//   1. unlock_start
//   2. user holds the unlock keys (per get_unlock_status response) for ~5s
//   3. poll (unlock_poll) until it reports unlocked, or timeout; each reply
//      carries the hold counter, which drives the progress
//   4. lock to re-secure

import { ProtocolError } from '@firmware/errors'
import type { HidClient } from '@firmware/clients/qmk/hidClient'

import {
    getUnlockStatusCmd,
    lockCmd,
    parseUnlockPoll,
    parseUnlockStatus,
    unlockPollCmd,
    unlockStartCmd,
    VIAL_UNLOCK_COUNTER_MAX,
    type UnlockPollResponse,
    type UnlockStatusResponse,
} from './protocol'

export async function readUnlockStatus(
    client: HidClient,
): Promise<UnlockStatusResponse> {
    const resp = await client.send(getUnlockStatusCmd())
    return parseUnlockStatus(resp)
}

export async function startUnlock(client: HidClient): Promise<void> {
    await client.send(unlockStartCmd())
}

export async function pollUnlockOnce(
    client: HidClient,
): Promise<UnlockPollResponse> {
    return parseUnlockPoll(await client.send(unlockPollCmd()))
}

export async function lockDevice(client: HidClient): Promise<void> {
    await client.send(lockCmd())
}

export interface RunUnlockOptions {
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
    onProgress?: (p: UnlockFlowProgress) => void
}

export interface UnlockFlowProgress {
    /** The combo the board asks for (matrix positions), from get_unlock_status. */
    keys: { row: number; col: number }[]
    /** 0 → 1 as the hold completes. */
    progress: number
}

const DEFAULT_TIMEOUT_MS = 30_000
// vial.c counts one hold tick per poll, and only when >100 ms passed since the
// last tick — so polling faster than that wastes requests and polling slower
// stretches the ~5 s unlock (50 ticks).
const DEFAULT_POLL_INTERVAL_MS = 100

export async function runUnlockFlow(
    client: HidClient,
    opts: RunUnlockOptions = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const start = Date.now()

    const initial = await readUnlockStatus(client)
    if (!initial.locked && !initial.inProgress) return
    const keys = initial.unlockKeys
    opts.onProgress?.({ keys, progress: 0 })
    if (!initial.inProgress) {
        await startUnlock(client)
    }

    while (true) {
        if (opts.signal?.aborted) {
            throw opts.signal.reason ?? new Error('unlock aborted')
        }
        if (Date.now() - start > timeoutMs) {
            throw new ProtocolError(
                'Vial unlock: timeout waiting for hold-key release',
            )
        }
        const poll = await pollUnlockOnce(client)
        if (poll.unlocked) {
            opts.onProgress?.({ keys, progress: 1 })
            return
        }
        const left = Math.min(poll.counter, VIAL_UNLOCK_COUNTER_MAX)
        opts.onProgress?.({
            keys,
            progress: 1 - left / VIAL_UNLOCK_COUNTER_MAX,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
    }
}
