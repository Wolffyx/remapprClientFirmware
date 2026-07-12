import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { preflightConfigBlob } from '../preflight'

// pattern-check: skip — test fixtures + assertions, no production logic
const kb = (n: number): string =>
    `"keyboard": { "id": "k", "name": "K", "keys": [${Array.from({ length: n }, (_, i) => `{"x":${i},"y":0}`).join(',')} ] }`

const blobOf = (layers: number): Uint8Array => {
    const rows = Array.from(
        { length: layers },
        (_, i) => `{ "name": "L${i}", "bindings": ["A", "B"] }`,
    ).join(',')
    const cfg = parseKeymap(`{
        "schemaVersion": 1, "kind": "remappr.keymap",
        "meta": { "name": "PF", "target": "zmk" }, ${kb(2)},
        "layers": [${rows}]
    }`)
    const { blob, diagnostics } = buildRemapprBlob(cfg, { configVersion: 1 })
    expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0)
    return blob
}

describe('preflightConfigBlob', () => {
    it('passes a blob that fits every advertised cap', () => {
        const blob = blobOf(2)
        expect(
            preflightConfigBlob(blob, {
                maxConfigBytes: 4096,
                maxLayers: 8,
                supportsFragmentation: true,
                maxUnsealedChunk: 32,
            }),
        ).toEqual([])
    })

    it('reports config-too-large with an actual/limit message', () => {
        const blob = blobOf(2)
        const issues = preflightConfigBlob(blob, { maxConfigBytes: 8 })
        expect(issues).toHaveLength(1)
        expect(issues[0].code).toBe('config-too-large')
        expect(issues[0].message).toContain(`${blob.length} bytes`)
        expect(issues[0].message).toContain('8')
    })

    it('reports too-many-layers from the LAYER table without a full decode', () => {
        const issues = preflightConfigBlob(blobOf(3), { maxLayers: 2 })
        expect(issues).toHaveLength(1)
        expect(issues[0].code).toBe('too-many-layers')
        expect(issues[0].message).toContain('3 layers')
    })

    it('accepts a layer count exactly at the cap', () => {
        expect(preflightConfigBlob(blobOf(2), { maxLayers: 2 })).toEqual([])
    })

    it('reports needs-fragmentation only when the device lacks it', () => {
        const blob = blobOf(4) // comfortably over a 32-byte chunk
        expect(
            preflightConfigBlob(blob, {
                supportsFragmentation: false,
                maxUnsealedChunk: 32,
            }).map((i) => i.code),
        ).toContain('needs-fragmentation')
        expect(
            preflightConfigBlob(blob, {
                supportsFragmentation: true,
                maxUnsealedChunk: 32,
            }),
        ).toEqual([])
    })

    it('enforces nothing when caps are unknown', () => {
        expect(preflightConfigBlob(blobOf(2), {})).toEqual([])
    })

    it('does not throw on a malformed blob — skips the layer check', () => {
        const junk = Uint8Array.from([1, 2, 3, 4, 5])
        expect(preflightConfigBlob(junk, { maxLayers: 1 })).toEqual([])
    })
})
