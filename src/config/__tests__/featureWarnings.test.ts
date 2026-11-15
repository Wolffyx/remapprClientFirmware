import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { capabilityWarnings, configRequiredFamilies, configRequiredFeatures } from '../featureWarnings'
import { LimitsFeature } from '../../clients/remappr/protocol'
import type { CanonAction, ConfigKeymap } from '../types'

const kb = (n: number): string =>
    `"keyboard": { "id": "k", "name": "K", "keys": [${Array.from(
        { length: n },
        (_, i) => `{"x":${i},"y":0}`,
    ).join(',')} ] }`

const plain = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Plain", "target": "zmk" }, ${kb(1)},
    "defaults": { "tappingTermMs": 200 },
    "layers": [{ "name": "base", "bindings": ["A"] }]
}`)

// Sets every warnable timing default plus an inline hold-trigger-on-release.
const rich = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Rich", "target": "zmk" }, ${kb(2)},
    "defaults": { "tappingTermMs": 200, "capsWordIdleMs": 2000,
        "stickyReleaseDefaultMs": 1000, "macroDefaultWaitMs": 10,
        "matrixPollPeriodMs": 2 },
    "layers": [{ "name": "base", "bindings": [
        { "type": "tap_hold", "tap": { "type": "key_press", "key": "A" },
          "hold": { "type": "modifier", "modifier": "LEFT_GUI" },
          "holdTriggerOnRelease": true },
        "B"
    ] }]
}`)

describe('configRequiredFeatures', () => {
    it('a plain config requires no optional features', () => {
        expect(configRequiredFeatures(plain)).toBe(0)
    })

    it('a rich config requires each optional feature it uses', () => {
        const req = configRequiredFeatures(rich)
        expect(req & LimitsFeature.capsWordIdle).toBeTruthy()
        expect(req & LimitsFeature.stickyReleaseAfter).toBeTruthy()
        expect(req & LimitsFeature.macroDefaults).toBeTruthy()
        expect(req & LimitsFeature.matrixPollPeriod).toBeTruthy()
        expect(req & LimitsFeature.holdTriggerOnRelease).toBeTruthy()
    })

    it('detects hold-trigger-on-release on a hold-tap definition too', () => {
        // Minimal config touching only the fields the scanner reads.
        const defOnly = {
            defaults: {},
            layers: [{ name: 'base', bindings: [] }],
            holdTaps: [
                { id: 'hr', bindings: ['A', 'B'], holdTriggerOnRelease: true },
            ],
        } as unknown as ConfigKeymap
        expect(
            configRequiredFeatures(defOnly) & LimitsFeature.holdTriggerOnRelease,
        ).toBeTruthy()
    })
})

describe('capabilityWarnings', () => {
    const ALL = Object.values(LimitsFeature).reduce((a, b) => a | b, 0)

    it('no warnings when the device advertises everything used', () => {
        expect(capabilityWarnings(rich, ALL)).toHaveLength(0)
    })

    it('warns about every used feature on pre-Phase-2 firmware (bitmask 0)', () => {
        const feats = capabilityWarnings(rich, 0).map((w) => w.feature)
        expect(feats).toContain('capsWordIdle')
        expect(feats).toContain('stickyReleaseAfter')
        expect(feats).toContain('macroDefaults')
        expect(feats).toContain('matrixPollPeriod')
        expect(feats).toContain('holdTriggerOnRelease')
    })

    it('surfaces a ready-to-show "firmware ignores X" message', () => {
        const w = capabilityWarnings(rich, 0)
        expect(w[0].message).toMatch(/firmware ignores/i)
    })

    it('warns only about the features the device lacks', () => {
        // Device advertises everything EXCEPT hold-trigger-on-release.
        const bits =
            LimitsFeature.capsWordIdle |
            LimitsFeature.stickyReleaseAfter |
            LimitsFeature.macroDefaults |
            LimitsFeature.matrixPollPeriod |
            LimitsFeature.layerTailV3
        expect(capabilityWarnings(rich, bits).map((w) => w.feature)).toEqual([
            'holdTriggerOnRelease',
        ])
    })

    it('a plain config never warns, even against pre-Phase-2 firmware', () => {
        expect(capabilityWarnings(plain, 0)).toHaveLength(0)
    })
})

describe('behavior families', () => {
    const F = LimitsFeature
    // A keyboard advertising families (bit 13) with every family but `without`.
    const allBut = (...without: number[]): number =>
        [F.behaviorFamilies, F.tapHold, F.combos, F.macros, F.sequences, F.unicode, F.conditionals, F.keyOverrides]
            .filter((b) => !without.includes(b))
            .reduce((a, b) => a | b, 0)
    const base = plain as ConfigKeymap
    const withBindings = (...bindings: CanonAction[]): ConfigKeymap => ({
        ...base,
        layers: [{ ...base.layers[0], bindings }],
    })
    const A: CanonAction = { type: 'key_press', key: 'A' } as CanonAction

    it('a plain config needs no family', () => {
        expect([...configRequiredFamilies(plain)]).toEqual([])
    })

    it('finds each family from its actions', () => {
        const cfg = withBindings(
            { type: 'auto_shift', key: 'A', mods: ['LEFT_SHIFT'] } as CanonAction,
            { type: 'macro_play', slot: 0 },
            { type: 'leader' },
            { type: 'unicode', codepoint: 0x263a },
        )
        expect([...configRequiredFamilies(cfg)].sort()).toEqual(['macros', 'sequences', 'tapHold', 'unicode'])
    })

    it('finds each table family from a non-empty table', () => {
        const cfg: ConfigKeymap = {
            ...base,
            combos: [{ name: 'c', keys: [0, 1], action: A }],
            conditionalLayers: [{ ifLayers: ['base'], thenLayer: 'base' }],
            keyOverrides: [{ trigger: 'A', triggerMods: ['LEFT_SHIFT'], replacement: 'B' }],
            leaderSequences: [{ sequence: ['A'], action: A }],
            macros: [{ id: 'm', steps: [{ type: 'tap', key: 'A' }] }],
        } as ConfigKeymap
        expect([...configRequiredFamilies(cfg)].sort()).toEqual([
            'combos',
            'conditionals',
            'keyOverrides',
            'macros',
            'sequences',
        ])
    })

    it('ignores an unbound parameterized macro and an unreferenced tap-dance', () => {
        const cfg = {
            ...base,
            macros: [{ id: 'm', params: 1, steps: [{ type: 'param' }] }],
            tapDances: [{ id: 'td', taps: [{ count: 1, action: { type: 'unicode', codepoint: 65 } }] }],
        } as ConfigKeymap
        expect([...configRequiredFamilies(cfg)]).toEqual([])
    })

    it('follows a bound tap-dance into its taps', () => {
        const cfg = {
            ...withBindings({ type: 'tap_dance', ref: 'td' }),
            tapDances: [{ id: 'td', taps: [{ count: 1, action: { type: 'unicode', codepoint: 65 } }] }],
        } as ConfigKeymap
        expect([...configRequiredFamilies(cfg)].sort()).toEqual(['sequences', 'unicode'])
    })

    it('blocks a config using a family the keyboard was built without', () => {
        const cfg = { ...base, combos: [{ name: 'c', keys: [0], action: A }] } as ConfigKeymap
        const w = capabilityWarnings(cfg, allBut(F.combos))
        expect(w).toHaveLength(1)
        expect(w[0]).toMatchObject({ feature: 'combos', blocking: true })
        expect(w[0].message).toMatch(/built without combos/)
        expect(capabilityWarnings(cfg, allBut())).toEqual([])
    })

    it('never blocks on firmware that predates family advertisement', () => {
        const cfg = withBindings({ type: 'unicode', codepoint: 0x263a })
        // No bit 13: every family is present, whatever bits 14-20 read.
        expect(capabilityWarnings(cfg, 0)).toEqual([])
        expect(capabilityWarnings(cfg, F.kbdExt)).toEqual([])
    })

    it('keeps the ignored-field warnings non-blocking', () => {
        const w = capabilityWarnings(rich, allBut())
        expect(w.length).toBeGreaterThan(0)
        expect(w.every((x) => !x.blocking)).toBe(true)
        // rich binds a tap-hold: blocking once the keyboard lacks the family.
        const lacking = capabilityWarnings(rich, allBut(F.tapHold))
        expect(lacking.filter((x) => x.blocking).map((x) => x.feature)).toEqual(['tapHold'])
    })
})
