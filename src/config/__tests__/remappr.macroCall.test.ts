// pattern-check: skip — test file, no production logic
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { BehaviorType, BlobBuilder, MacroOp, type BehaviorRecord } from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'
import { capabilityWarnings } from '../featureWarnings'
import { migrateMacroStep } from '../migrate'
import { serializeKeymapV2 } from '../serialize'
import { Feature } from '../../clients/remappr/protocol'
import type { RemapprCompileLimits } from '../compilers/remappr'

// A one-key keymap bound to the first macro, with `macros` spliced in.
const keymap = (macros: string): string => `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "MC", "target": "zmk" },
    "keyboard": { "id": "k", "name": "K", "keys": [{ "x": 0, "y": 0 }] },
    "layers": [{ "name": "base", "bindings": [{ "type": "macro", "ref": "outer" }] }],
    "macros": [${macros}]
}`

const errorsOf = (json: string, limits?: RemapprCompileLimits): string[] =>
    buildRemapprBlob(parseKeymap(json), { configVersion: 1, limits })
        .diagnostics.filter((d) => d.level === 'error')
        .map((d) => d.message)

// `outer` is defined BEFORE the macro it calls: a call may point forward.
const CALLS = keymap(`
    { "id": "outer", "steps": [
        { "type": "tap", "key": "A" },
        { "type": "call", "macro": "inner" },
        { "type": "tap", "key": "B" } ] },
    { "id": "inner", "steps": [{ "type": "tap", "key": "C" }] }`)

// A chain m0 → m1 → … → m<n>: `n` nested calls from outer.
const chain = (n: number): string =>
    keymap(
        Array.from({ length: n + 1 }, (_, i) => {
            const id = i === 0 ? 'outer' : `m${i}`
            const steps =
                i < n
                    ? `{ "type": "call", "macro": "m${i + 1}" }`
                    : `{ "type": "tap", "key": "A" }`
            return `{ "id": "${id}", "steps": [${steps}] }`
        }).join(','),
    )

// A behavior record binding macro 0.
const MACRO_0: BehaviorRecord = {
    type: BehaviorType.Macro, flavor: 0, flags: 0, subCount: 0, tap: 0, hold: 0,
    tappingTermMs: 0, quickTapMs: 0, requirePriorIdleMs: 0, subIndex: 0,
}

describe('macro CALL step (op 5)', () => {
    it('round-trips canonical → blob → decode byte-stable, with the real name', () => {
        const b1 = buildRemapprBlob(parseKeymap(CALLS), { configVersion: 1 })
        expect(b1.diagnostics.filter((d) => d.level === 'error')).toEqual([])
        const { code, config } = decodeRemapprBlob(b1.blob)
        expect(code).toBe(DecodeCode.OK)
        expect(config!.macros![0].steps[1]).toEqual({ type: 'call', macro: 'inner' })
        expect(config!.macros![1].id).toBe('inner')
        const b2 = buildRemapprBlob(config!, { configVersion: 1 })
        expect(b2.blob).toEqual(b1.blob)
    })

    it('decodes wire op 5 to a call naming the target index', () => {
        const blob = new BlobBuilder()
            .layerTable(1, 1, 200, 5)
            .behaviorTable([MACRO_0])
            .bindingTable([0])
            .macroTable([
                { steps: [{ op: MacroOp.Call, arg: 1 }] },
                { steps: [{ op: MacroOp.Tap, arg: 0x04 }] },
            ])
            .finalize(1, 1, 1)
        const { config } = decodeRemapprBlob(blob)
        expect(config!.macros![0].steps).toEqual([{ type: 'call', macro: 'macro_1' }])
    })

    it('reports an unknown op as unknown, not as a missing usage', () => {
        const blob = new BlobBuilder()
            .layerTable(1, 1, 200, 5)
            .behaviorTable([MACRO_0])
            .bindingTable([0])
            .macroTable([
                { steps: [{ op: 9, arg: 0x04 }, { op: MacroOp.Call, arg: 7 }] },
            ])
            .finalize(1, 1, 1)
        const { config, diagnostics } = decodeRemapprBlob(blob)
        const msgs = diagnostics.map((d) => d.message)
        expect(msgs).toContainEqual(expect.stringMatching(/op 9 unknown/))
        expect(msgs).not.toContainEqual(expect.stringMatching(/not in catalog/))
        expect(msgs).toContainEqual(expect.stringMatching(/calls macro 7, past the end/))
        expect(config!.macros![0].steps).toEqual([{ type: 'call', macro: 'macro_7' }])
    })

    it('is refused for a device without Feature.MACRO_CALL (bit 24)', () => {
        expect(Feature.MACRO_CALL).toBe(1 << 24)
        expect(errorsOf(CALLS, { featureBitmask: 0 })).toEqual([
            expect.stringMatching(/cannot run one macro from another/),
        ])
        expect(errorsOf(CALLS, { featureBitmask: Feature.MACRO_CALL })).toEqual([])
        // The app's pre-save check blocks it too.
        const w = capabilityWarnings(parseKeymap(CALLS), Feature.BEHAVIOR_FAMILIES | Feature.MACROS)
        expect(w).toEqual([expect.objectContaining({ feature: 'macroCall', blocking: true })])
        expect(
            capabilityWarnings(parseKeymap(CALLS), Feature.BEHAVIOR_FAMILIES | Feature.MACROS | Feature.MACRO_CALL),
        ).toEqual([])
    })

    it('refuses a call to an unknown or parameterized macro', () => {
        expect(
            errorsOf(keymap(`{ "id": "outer", "steps": [{ "type": "call", "macro": "nope" }] }`)),
        ).toEqual([expect.stringMatching(/calls unknown macro "nope"/)])
        expect(
            errorsOf(
                keymap(`
                { "id": "outer", "steps": [{ "type": "call", "macro": "tpl" }] },
                { "id": "tpl", "steps": [{ "type": "param" }, { "type": "tap", "key": "A" }] }`),
            ),
        ).toEqual([expect.stringMatching(/takes a parameter/)])
    })

    it('refuses a call cycle, self-call included', () => {
        expect(
            errorsOf(
                keymap(`
                { "id": "outer", "steps": [{ "type": "call", "macro": "b" }] },
                { "id": "b", "steps": [{ "type": "call", "macro": "outer" }] }`),
            ),
        ).toEqual([expect.stringMatching(/calls back into it/)])
        expect(
            errorsOf(keymap(`{ "id": "outer", "steps": [{ "type": "call", "macro": "outer" }] }`)),
        ).toEqual([expect.stringMatching(/calls back into it/)])
    })

    it('warns (never refuses) nesting past the default depth of 4', () => {
        const warnsOf = (json: string, limits?: RemapprCompileLimits): string[] =>
            buildRemapprBlob(parseKeymap(json), { configVersion: 1, limits })
                .diagnostics.filter((d) => d.level === 'warn')
                .map((d) => d.message)
        expect(warnsOf(chain(4))).toEqual([])
        // The build's limit is not reported, so depth never blocks a save.
        expect(errorsOf(chain(5))).toEqual([])
        expect(warnsOf(chain(5))).toEqual([
            expect.stringMatching(/"outer" nests calls 5 deep; default firmware allows 4/),
        ])
        expect(warnsOf(chain(5), { macroCallDepth: 5 })).toEqual([])
    })

    it('survives the v2 surface spelling both ways', () => {
        expect(migrateMacroStep('call:inner')).toEqual({ type: 'call', macro: 'inner' })
        const v2 = serializeKeymapV2(parseKeymap(CALLS))
        expect(v2).toContain('"call:inner"')
        expect(parseKeymap(v2).macros![0].steps[1]).toEqual({ type: 'call', macro: 'inner' })
    })
})
