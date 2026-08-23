// Pattern check: no GoF pattern (-) — rejected — Vial unlock = poll loop with abort/timeout; state machine is overkill for three transitions.
// Vial unlock flow:
//   1. unlock_start
//   2. user holds the unlock keys (per get_unlock_status response) for ~5s
//   3. poll get_unlock_status until status=1 or timeout
//   4. lock to re-secure

import { ProtocolError } from '@firmware/errors'
import type { HidClient } from '@firmware/clients/qmk/hidClient'

import {
    getUnlockStatusCmd,
    lockCmd,
    parseUnlockStatus,
    unlockPollCmd,
    unlockStartCmd,
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
): Promise<UnlockStatusResponse> {
    await client.send(unlockPollCmd())
    return readUnlockStatus(client)
}

export async function lockDevice(client: HidClient): Promise<void> {
    await client.send(lockCmd())
}

export interface RunUnlockOptions {
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
    onProgress?: (status: UnlockStatusResponse) => void
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_MS = 200

export async function runUnlockFlow(
    client: HidClient,
    opts: RunUnlockOptions = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const start = Date.now()

    const initial = await readUnlockStatus(client)
    if (!initial.locked && !initial.inProgress) return
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
        const status = await pollUnlockOnce(client)
        opts.onProgress?.(status)
        if (!status.locked) return
        await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
    }
}
