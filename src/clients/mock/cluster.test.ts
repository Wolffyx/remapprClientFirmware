// pattern-check: skip — exercises the mock cluster facade (demo snapshot + the
// simulated role-event emitter) via fake timers. No GoF abstraction.
import { describe, expect, it, vi } from 'vitest'

import type { RoleEvent } from '@firmware/service'

import { MockKeyboardService } from './service'

describe('MockKeyboardService.cluster', () => {
    it('getDiag reports a coordinator with two node-bus peers', async () => {
        const diag = await new MockKeyboardService().cluster.getDiag()

        expect(diag.coordinator).toBe(true)
        expect(diag.peers).toHaveLength(2)
        expect(diag.peers[0]).toMatchObject({
            coordinator: false,
            ready: true,
            seen: true,
        })
        expect(diag.peers[1]).toMatchObject({
            coordinator: false,
            ready: false,
            seen: true,
        })
    })

    it('onRoleChanged emits one simulated transition to the demo device', () => {
        vi.useFakeTimers()
        try {
            const svc = new MockKeyboardService()
            const seen: RoleEvent[] = []
            svc.cluster.onRoleChanged((e) => seen.push(e))

            vi.advanceTimersByTime(2000)
            expect(seen).toHaveLength(1)
            expect(seen[0].coordinator).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('disposing before the demo fires cancels the emission', () => {
        vi.useFakeTimers()
        try {
            const svc = new MockKeyboardService()
            const seen: RoleEvent[] = []
            const dispose = svc.cluster.onRoleChanged((e) => seen.push(e))

            dispose() // clears the armed demo timer
            vi.advanceTimersByTime(5000)
            expect(seen).toHaveLength(0)
        } finally {
            vi.useRealTimers()
        }
    })
})
