// pattern-check: skip vitest cases over fixture files
//
// L3.28: decode what the firmware's own encoder writes (keymap_encode.c, the
// blob a fresh device returns). The fixtures are byte-identical copies of the
// firmware repo's tests/config_blob/golden/*.bin, which its blob_golden_encode
// suite locks against the encoder (fixtures/firmware/README.md).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRemapprBlob } from '../compilers/remappr'
import { DecodeCode, decodeRemapprBlob, readBlobFrames } from '../compilers/remappr/decode'
import { TableId } from '../compilers/remappr/blobWriter'

const fixture = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(new URL(`./fixtures/firmware/${name}.bin`, import.meta.url)))

const errorsOf = (d: readonly { level: string }[]) => d.filter((x) => x.level === 'error')

/** Decode -> compile -> decode gives the same config: the client writes back
 *  what it read (its own layout, deduplicated, not the firmware's bytes). */
function stable(blob: Uint8Array): void {
    const first = decodeRemapprBlob(blob)
    const again = buildRemapprBlob(first.config!, { configVersion: first.configVersion! })
    expect(errorsOf(again.diagnostics)).toEqual([])
    expect(decodeRemapprBlob(again.blob).config).toEqual(first.config)
}

describe('firmware-produced golden blobs (L3.28)', () => {
    it('reads the plain keymap: one layer, all-default v3 LAYER tail', () => {
        const blob = fixture('fw_keymap_plain')
        const ids = readBlobFrames(blob).frames.map((f) => f.id)
        expect(ids).toEqual([TableId.Layer, TableId.Behavior, TableId.Binding])
        const r = decodeRemapprBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(r.diagnostics).toEqual([])
        expect(r.configVersion).toBe(1)
        expect(r.config!.defaults).toEqual({ tappingTermMs: 200 })
        expect(r.config!.layers).toEqual([
            {
                name: 'Layer 0',
                bindings: [
                    { type: 'key_press', key: 'key.keyboard_a' },
                    { type: 'key_press', key: 'key.keyboard_b' },
                    { type: 'transparent' },
                ],
            },
        ])
        stable(blob)
    })

    it('reads the rich keymap: v3 tail, v2 MACRO with a private macro, SUBS, POSHOLD, NAMES', () => {
        const blob = fixture('fw_keymap_rich')
        const frames = readBlobFrames(blob).frames
        expect(frames.find((f) => f.id === TableId.Macro)?.version).toBe(2)
        expect(frames.map((f) => f.id)).toEqual([
            TableId.Layer,
            TableId.Behavior,
            TableId.Binding,
            TableId.Subs,
            TableId.Macro,
            TableId.Poshold,
            TableId.Names,
        ])
        const r = decodeRemapprBlob(blob)
        expect(r.code).toBe(DecodeCode.OK)
        expect(errorsOf(r.diagnostics)).toEqual([])
        expect(r.configVersion).toBe(5)
        const cfg = r.config!
        expect(cfg.defaults).toEqual({
            tappingTermMs: 200,
            releaseDebounceMs: 5,
            pressDebounceMs: 3,
            matrixPressDebounceMs: 4,
            matrixReleaseDebounceMs: 8,
            capsWordIdleMs: 2000,
            stickyReleaseDefaultMs: 1000,
            macroDefaultWaitMs: 10,
            macroDefaultTapMs: 5,
            matrixPollPeriodMs: 2,
        })
        const [base, fn] = cfg.layers.map((l) => l.bindings)
        expect(base[0]).toEqual({ type: 'key_press', key: 'key.keyboard_a' })
        expect(base[1]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'modifier', modifier: 'LEFT_SHIFT' },
            tappingTermMs: 180,
            quickTapMs: 120,
            requirePriorIdleMs: 150,
            holdTriggerOnRelease: true,
            holdTriggerKeyPositions: [2, 3],
        })
        expect(base[2]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'layer', layer: 'Layer 1' },
        })
        expect(base[3]).toEqual({ type: 'key_press', key: 'key.keyboard_international1' })
        expect(fn).toEqual([
            { type: 'mod_morph', ref: 'brackets' },
            { type: 'tap_dance', ref: 'td12' },
            { type: 'macro', ref: 'secret' },
            { type: 'macro', ref: 'shout' },
        ])
        const secret = cfg.macros!.find((m) => m.id === 'secret')!
        expect(secret.private).toBe(true)
        expect(secret.steps).toHaveLength(3)
        expect(cfg.macros!.find((m) => m.id === 'shout')!.private).toBeUndefined()
        expect(cfg.tapDances![0].taps.map((t) => t.count)).toEqual([1, 2])
        expect(cfg.modMorphs![0].id).toBe('brackets')
        stable(blob)
    })
})
