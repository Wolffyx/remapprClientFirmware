// pattern-check: skip — unit tests for the identity helpers
import { describe, expect, it } from 'vitest'
import { layoutFingerprint } from './config/describe'
import {
    createIdentity,
    layoutIdentifier,
    nameIdentifier,
    usbIdentifier,
} from './identity'

describe('identity helpers', () => {
    it('formats usb ids and names', () => {
        expect(
            usbIdentifier({
                name: 'x',
                firmware: 'zmk',
                vid: 0x1d50,
                pid: 0x615e,
            }),
        ).toBe('usb:1d50:615e')
        expect(usbIdentifier({ name: 'x', firmware: 'zmk' })).toBeNull()
        expect(nameIdentifier('zmk_name', '  Corne ')).toBe('zmk_name:corne')
        expect(nameIdentifier('zmk_name', '')).toBeNull()
    })

    it('hashes a physical layout like the builder hashes its keys', () => {
        const id = layoutIdentifier({
            id: 0,
            name: 'Default',
            keys: [
                { x: 0, y: 0, w: 100, h: 100 },
                { x: 100, y: 0, w: 150, h: 100 },
                { x: 300, y: 0, w: 100, h: 100, element: 'encoder' },
            ],
        })
        expect(id).toBe(
            `layout_hash:${layoutFingerprint([
                { x: 0, y: 0, w: 1, h: 1, r: 0 },
                { x: 1, y: 0, w: 1.5, h: 1, r: 0 },
            ])}`,
        )
    })

    it('skips failing sources and deduplicates', async () => {
        const identity = createIdentity([
            () => 'usb:1d50:615e',
            () => 'usb:1d50:615e',
            () => {
                throw new Error('no layout')
            },
            async () => null,
        ])
        expect(await identity.identifiers()).toEqual(['usb:1d50:615e'])
    })
})
