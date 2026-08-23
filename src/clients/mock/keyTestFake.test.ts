// pattern-check: skip — unit tests for the KeyTestApi test double
import { describe, expect, it } from 'vitest'
import { createFakeKeyTest } from './keyTestFake'

describe('createFakeKeyTest', () => {
    it('pushes pressed-position sets to subscribers', () => {
        const fake = createFakeKeyTest()
        const seen: Array<number[]> = []
        const unsub = fake.api.onMatrixState((p) => seen.push([...p].sort()))

        fake.press([3, 1])
        fake.press([])

        expect(seen).toEqual([[1, 3], []])
        unsub()
    })

    it('stops delivering after unsubscribe and tracks subscriber count', () => {
        const fake = createFakeKeyTest()
        let calls = 0
        const unsub = fake.api.onMatrixState(() => calls++)
        expect(fake.subscriberCount()).toBe(1)

        fake.press([5])
        unsub()
        expect(fake.subscriberCount()).toBe(0)
        fake.press([6])

        expect(calls).toBe(1)
    })

    it('readMatrix returns the last pushed set', async () => {
        const fake = createFakeKeyTest()
        fake.press([2, 4])
        expect([...(await fake.api.readMatrix!())].sort()).toEqual([2, 4])
    })
})
