// pattern-check: skip — seeded property/fuzz harness + assertions, no production logic
//
// Property-based round-trip fuzz (no external dep — deterministic seeded LCG so
// CI is reproducible; Date.now/Math.random are avoided on purpose). For each of
// N generated valid keymaps: encode → decode → re-encode must be BYTE-STABLE,
// and decode must succeed with no error diagnostics. This is the moving-target
// guard beside the fixed golden fixtures — it exercises the fields the fidelity
// work made round-trippable (inline tap-hold timings + §28 positions, combos,
// the quickTap/comboTimeout defaults lowering) across random shapes.

import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'

// A tiny linear-congruential PRNG (glibc constants) — pure + reproducible.
const makeRng = (seed: number) => {
    let s = (seed ^ 0x9e3779b9) & 0x7fffffff
    const next = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        return s / 0x7fffffff
    }
    return {
        int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
        pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
        bool: () => next() < 0.5,
    }
}

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'X', 'Y', 'Z', '0', '1', '9'] as const
const MODS = [
    'LEFT_GUI', 'LEFT_CTRL', 'LEFT_SHIFT', 'LEFT_ALT',
    'RIGHT_GUI', 'RIGHT_CTRL', 'RIGHT_SHIFT', 'RIGHT_ALT',
] as const

type Rng = ReturnType<typeof makeRng>

// Distinct positions in [0, count) — for combos and §28 hold-trigger lists.
const distinctPositions = (rng: Rng, count: number, want: number): number[] => {
    const pool = Array.from({ length: count }, (_, i) => i)
    const out: number[] = []
    for (let i = 0; i < want && pool.length; i++) {
        out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0])
    }
    return out.sort((a, b) => a - b)
}

const genTapHold = (rng: Rng, numLayers: number, numPositions: number): unknown => {
    const hold = rng.bool()
        ? { type: 'modifier', modifier: rng.pick(MODS) }
        : { type: 'layer', layer: `L${rng.int(0, numLayers - 1)}` }
    const th: Record<string, unknown> = {
        type: 'tap_hold',
        tap: { type: 'key_press', key: rng.pick(KEYS) },
        hold,
        flavor: rng.pick(['balanced', 'hold-preferred', 'tap-preferred', 'tap-unless-interrupted']),
    }
    if (rng.bool()) th.tappingTermMs = rng.int(100, 400)
    if (rng.bool()) th.quickTapMs = rng.int(0, 200) // includes 0 = "no quick tap"
    if (rng.bool()) th.requirePriorIdleMs = rng.int(0, 200)
    if (rng.bool()) th.retroTap = true
    if (rng.bool()) {
        const positions = distinctPositions(rng, numPositions, rng.int(1, 3))
        if (positions.length) th.holdTriggerKeyPositions = positions
    }
    return th
}

const genBinding = (rng: Rng, numLayers: number, numPositions: number): unknown => {
    switch (rng.int(0, 5)) {
        case 0:
            return rng.pick(KEYS)
        case 1:
            return { type: 'key_press', key: rng.pick(KEYS), mods: [rng.pick(MODS)] }
        case 2:
            return genTapHold(rng, numLayers, numPositions)
        case 3:
            return { type: 'sticky_key', key: rng.pick(KEYS) }
        case 4:
            return { type: 'layer', mode: 'momentary', layer: `L${rng.int(0, numLayers - 1)}` }
        default:
            return rng.bool() ? { type: 'transparent' } : { type: 'none' }
    }
}

const genConfig = (rng: Rng): string => {
    const numLayers = rng.int(1, 4)
    const numPositions = rng.int(2, 8)
    const keys = Array.from({ length: numPositions }, (_, i) => ({ x: i, y: 0 }))
    const layers = Array.from({ length: numLayers }, (_, li) => ({
        name: `L${li}`,
        bindings: Array.from({ length: numPositions }, () =>
            genBinding(rng, numLayers, numPositions),
        ),
    }))

    const defaults: Record<string, number> = { tappingTermMs: rng.int(120, 300) }
    if (rng.bool()) defaults.quickTapMs = rng.int(0, 200)
    if (rng.bool()) defaults.comboTimeoutMs = rng.int(10, 80)

    const combos: unknown[] = []
    if (numPositions >= 2 && rng.bool()) {
        for (let i = 0; i < rng.int(1, 3); i++) {
            const positions = distinctPositions(rng, numPositions, rng.int(2, 3))
            if (positions.length < 2) continue
            const combo: Record<string, unknown> = {
                name: `c${i}`,
                keys: positions,
                action: rng.pick(KEYS),
            }
            if (rng.bool()) combo.timeoutMs = rng.int(10, 90)
            combos.push(combo)
        }
    }

    return JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Fuzz', target: 'zmk' },
        keyboard: { id: 'k', name: 'K', keys },
        defaults,
        layers,
        ...(combos.length ? { combos } : {}),
    })
}

describe('remappr round-trip fuzz (encode → decode → re-encode byte-stable)', () => {
    it('holds byte-stability + clean decode across 300 seeded keymaps', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const json = genConfig(makeRng(seed))
            const b1 = buildRemapprBlob(parseKeymap(json), { configVersion: 1 })
            const b1Errors = b1.diagnostics.filter((d) => d.level === 'error')
            expect(b1Errors, `seed ${seed} compile errors: ${JSON.stringify(b1Errors)}`).toHaveLength(0)

            const decoded = decodeRemapprBlob(b1.blob)
            expect(decoded.code, `seed ${seed} decode code`).toBe(DecodeCode.OK)
            const dErrors = decoded.diagnostics.filter((d) => d.level === 'error')
            expect(dErrors, `seed ${seed} decode errors: ${JSON.stringify(dErrors)}`).toHaveLength(0)

            const b2 = buildRemapprBlob(decoded.config!, { configVersion: 1 })
            expect(b2.blob, `seed ${seed} not byte-stable`).toEqual(b1.blob)
        }
    })
})
