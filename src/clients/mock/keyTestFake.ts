// pattern-check: skip — test double implementing KeyTestApi, no abstraction
import type { KeyTestApi } from '../../service'

/** A driveable {@link KeyTestApi} for storybook/tests: `press(set)` pushes a
 *  pressed-position set to every live subscriber, exactly as a real firmware's
 *  matrix-state report would. Real adapters expose `keyTest` only where the
 *  protocol can report the raw switch matrix (e.g. Keychron-QMK); the mock
 *  service omits it so the demo's Key Test falls back to OS-event detection. */
export interface FakeKeyTest {
    api: KeyTestApi
    /** Push the current pressed-position set to all subscribers. */
    press(pressed: Iterable<number>): void
    /** Number of live subscribers (asserts subscribe/unsubscribe in tests). */
    subscriberCount(): number
}

export function createFakeKeyTest(): FakeKeyTest {
    const subs = new Set<(pressed: Set<number>) => void>()
    let last = new Set<number>()
    return {
        api: {
            onMatrixState(cb) {
                subs.add(cb)
                return () => subs.delete(cb)
            },
            readMatrix: async () => new Set(last),
        },
        press(pressed) {
            last = new Set(pressed)
            for (const cb of subs) cb(new Set(last))
        },
        subscriberCount: () => subs.size,
    }
}
