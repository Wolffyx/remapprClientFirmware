// Pattern check: no GoF pattern (-) — rejected — tests for the demo's simulated lock kinds.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LockedError } from '@firmware/errors'
import type { UnlockProgress } from '@firmware/types'

import { MockKeyboardService } from './service'

afterEach(() => {
    vi.useRealTimers()
})

describe('mock — simulated lock kinds', () => {
    it("'actions': keys edit while locked, macro saves wait for the unlock", async () => {
        const svc = new MockKeyboardService({
            lock: 'actions',
            initiallyLocked: true,
            unlockHoldMs: 30,
        })
        expect(svc.capabilities.lock).toBe('actions')
        const km = await svc.getKeymap()
        await svc.setKey(km.layers[0].id, 0, km.layers[0].keys[1])
        await expect(svc.macros.setMacro!(0, [])).rejects.toBeInstanceOf(
            LockedError,
        )

        const seen: UnlockProgress[] = []
        await svc.unlock({ onProgress: (p) => seen.push(p) })
        expect(seen[0]).toEqual({ keys: [0, 1], progress: 0 })
        expect(seen.at(-1)?.progress).toBe(1)
        expect(await svc.getLockState()).toBe('unlocked')
        await svc.macros.setMacro!(0, [])
    })

    it("'actions': a cancelled hold leaves the board locked", async () => {
        const svc = new MockKeyboardService({
            lock: 'actions',
            initiallyLocked: true,
            unlockHoldMs: 1_000,
        })
        const abort = new AbortController()
        const run = svc.unlock({
            signal: abort.signal,
            onProgress: () => abort.abort(new Error('cancelled')),
        })
        await expect(run).rejects.toThrow('cancelled')
        expect(await svc.getLockState()).toBe('locked')
    })

    it("'editor': the demo device unlocks itself after the delay", async () => {
        vi.useFakeTimers()
        const svc = new MockKeyboardService({
            lock: 'editor',
            initiallyLocked: true,
            deviceUnlockAfterMs: 5_000,
        })
        const states: string[] = []
        svc.onLockStateChanged((s) => states.push(s))
        expect(svc.capabilities.unlockHint?.message).toMatch(/5 s/)
        const km = await svc.getKeymap()
        await expect(
            svc.setKey(km.layers[0].id, 0, km.layers[0].keys[1]),
        ).rejects.toBeInstanceOf(LockedError)
        vi.advanceTimersByTime(5_000)
        expect(states).toEqual(['unlocked'])
    })

    it("'none': never locked", async () => {
        const svc = new MockKeyboardService({ lock: 'none' })
        expect(await svc.getLockState()).toBe('not-applicable')
        await svc.unlock()
        await svc.macros.setMacro!(0, [])
    })
})
