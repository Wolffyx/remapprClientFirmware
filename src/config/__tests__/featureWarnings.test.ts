import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { capabilityWarnings, configRequiredFeatures } from '../featureWarnings'
import { LimitsFeature } from '../../remappr/protocol'
import type { ConfigKeymap } from '../types'

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
