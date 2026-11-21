// pattern-check: skip — unit test, no production logic
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeDocument, layoutFingerprint, parseKeymap } from '../index'
import { newDeviceConfig } from '../device'

const corne = parseKeymap(
    readFileSync(
        fileURLToPath(new URL('./corne.keymap.json', import.meta.url)),
        'utf8',
    ),
)

describe('layoutFingerprint', () => {
    it('is 32 hex and ignores key order', () => {
        const keys = corne.keyboard.keys
        const fp = layoutFingerprint(keys)
        expect(fp).toMatch(/^[0-9a-f]{32}$/)
        expect(layoutFingerprint([...keys].reverse())).toBe(fp)
    })

    it('ignores sub-quarter jitter but not a moved key', () => {
        const keys = corne.keyboard.keys
        const fp = layoutFingerprint(keys)
        const jitter = keys.map((k, i) =>
            i === 0 ? { ...k, x: k.x + 0.05 } : k,
        )
        expect(layoutFingerprint(jitter)).toBe(fp)
        const moved = keys.map((k, i) => (i === 0 ? { ...k, x: k.x + 1 } : k))
        expect(layoutFingerprint(moved)).not.toBe(fp)
    })
})

describe('describeDocument', () => {
    it('describes a keymap', () => {
        const d = describeDocument({
            ...corne,
            meta: { ...corne.meta, vendorId: '0xFEED', productId: '0x1' },
        })
        expect(d).toMatchObject({
            deviceKind: 'keyboard',
            form: 'keyboard',
            keyCount: corne.keyboard.keys.length,
            layerCount: corne.layers.length,
            target: 'zmk',
        })
        expect(d?.firmware).toContain('zmk')
        expect(d?.identifiers).toEqual([
            `layout_hash:${layoutFingerprint(corne.keyboard.keys)}`,
            'usb:feed:0001',
        ])
    })

    it('describes a device layout and a device config', () => {
        expect(
            describeDocument({
                kind: 'remappr.device-layout',
                deviceKind: 'mouse',
                form: 'mouse',
                controls: [{}, {}],
            }),
        ).toMatchObject({ deviceKind: 'mouse', form: 'mouse', controlCount: 2 })
        expect(
            describeDocument(newDeviceConfig('gamepad', 'Pad')),
        ).toMatchObject({
            deviceKind: 'joystick',
            target: 'remappr',
        })
    })

    it('returns null for an unknown kind', () => {
        expect(describeDocument({ kind: 'nope' })).toBeNull()
        expect(describeDocument(null)).toBeNull()
    })
})
