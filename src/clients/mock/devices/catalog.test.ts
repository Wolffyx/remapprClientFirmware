// pattern-check: skip — unit test for the demo catalog's key usages.
import { describe, expect, it } from 'vitest'
import { hidUsageCodec } from '../../../catalog/hidUsageCodec'
import { act, DEMO_CATALOG } from './catalog'

const byId = new Map(DEMO_CATALOG.actions.map((a) => [a.id, a]))

describe('demo catalog key usages', () => {
    it('gives plain keys and media keys a usage the HID codec knows', () => {
        const keyed = DEMO_CATALOG.actions.filter((a) => a.usage !== undefined)
        expect(keyed.length).toBeGreaterThan(40)
        for (const a of keyed) {
            expect(hidUsageCodec.decode(a.usage!), a.id).not.toBeNull()
        }
        expect(byId.get(act('key', 'Q'))?.usage).toBe((7 << 16) | 0x14)
        expect(byId.get(act('media', 'Mute'))?.usage).toBe((0x0c << 16) | 0xe2)
    })

    it('keeps usages unique', () => {
        const usages = DEMO_CATALOG.actions.flatMap((a) =>
            a.usage === undefined ? [] : [a.usage],
        )
        expect(new Set(usages).size).toBe(usages.length)
    })

    it('leaves shortcuts, mouse and gamepad actions as list picks', () => {
        for (const id of [
            act('key', 'Ctrl + C'),
            act('media', 'Mic mute'),
            act('mouse', 'Left click'),
            act('pad', 'A'),
        ]) {
            expect(byId.get(id)?.usage, id).toBeUndefined()
        }
    })
})
