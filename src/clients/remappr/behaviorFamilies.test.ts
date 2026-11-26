// GET_LIMITS behavior-family bits (§7.4.1, fw PR #199): bit 13 says bits 14-20
// are valid; firmware without it has every family.
import { describe, expect, it } from 'vitest'
import {
    BEHAVIOR_FAMILIES,
    bitmaskHas,
    effectiveFeatureBitmask,
    familiesFromBitmask,
    Feature,
    hasFamily,
    LimitsFeature,
    parseLimits,
} from './protocol'
import { buildRemapprActionTypes, REMAPPR_KIND_MOD_TAP, REMAPPR_KIND_TAP_DANCE } from './actions'
import { behaviorFlagsFor } from './service'

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const limitsPayload = (mask?: number): Uint8Array =>
    Uint8Array.from([
        ...le16(48), ...le16(16), ...le16(64), ...le16(16), ...le16(4096), 4, 1,
        ...(mask === undefined ? [] : [...le16(mask & 0xffff), ...le16(mask >>> 16)]),
    ])

describe('feature bits', () => {
    it('names bits 0-24 as the firmware does, in one table', () => {
        expect(Object.values(Feature)).toEqual(Array.from({ length: 25 }, (_, i) => 1 << i))
        expect(Feature.CLUSTER_MODE).toBe(1 << 21) // §5.4, after the families
        expect(Feature.CLUSTER_POWER).toBe(1 << 22) // §5.8
        expect(Feature.TBL_CLUSTER_V2).toBe(1 << 23) // §5.3
        expect(Feature.MACRO_CALL).toBe(1 << 24) // TBL_MACRO CALL step
        expect([Feature.KBD_EXT, Feature.BEHAVIOR_FAMILIES, Feature.TAP_HOLD]).toEqual([1 << 12, 1 << 13, 1 << 14])
        expect([Feature.COMBOS, Feature.MACROS, Feature.SEQUENCES]).toEqual([1 << 15, 1 << 16, 1 << 17])
        expect([Feature.UNICODE, Feature.CONDITIONALS, Feature.KEY_OVERRIDES]).toEqual([1 << 18, 1 << 19, 1 << 20])
    })

    it('keeps the camelCase names on the same bits', () => {
        expect(new Set(Object.values(LimitsFeature))).toEqual(new Set(Object.values(Feature)))
        expect(LimitsFeature.kbdExt).toBe(Feature.KBD_EXT)
        expect(LimitsFeature.holdTriggerOnRelease).toBe(Feature.HOLD_ON_RELEASE)
    })
})

describe('parseLimits families', () => {
    it('reports null families without bit 13, even if bits 14-20 read set', () => {
        expect(parseLimits(limitsPayload(0x3f)).families).toBeNull()
        expect(parseLimits(limitsPayload(0x3f | Feature.COMBOS)).families).toBeNull()
        // Pre-Phase-2: no feature word at all.
        expect(parseLimits(limitsPayload()).families).toBeNull()
    })

    it('reads each family bit once bit 13 is set', () => {
        const lim = parseLimits(limitsPayload(Feature.BEHAVIOR_FAMILIES | Feature.MACROS | Feature.KEY_OVERRIDES))
        expect(lim.families).toEqual({
            tapHold: false,
            combos: false,
            macros: true,
            sequences: false,
            unicode: false,
            conditionals: false,
            keyOverrides: true,
        })
        expect(lim.featureBitmask).toBe(Feature.BEHAVIOR_FAMILIES | Feature.MACROS | Feature.KEY_OVERRIDES)
    })
})

describe('hasFamily', () => {
    it('is true when the device says nothing', () => {
        expect(hasFamily(undefined, 'combos')).toBe(true)
        expect(hasFamily({ families: null }, 'combos')).toBe(true)
    })

    it('follows the advertised family bit', () => {
        const families = familiesFromBitmask(Feature.BEHAVIOR_FAMILIES | Feature.UNICODE)
        expect(hasFamily({ families }, 'unicode')).toBe(true)
        expect(hasFamily({ families }, 'tapHold')).toBe(false)
    })
})

describe('bitmaskHas / effectiveFeatureBitmask', () => {
    it('counts every family present on firmware without bit 13', () => {
        expect(bitmaskHas(0, Feature.SEQUENCES)).toBe(true)
        expect(bitmaskHas(0, Feature.KBD_EXT)).toBe(false)
        expect(effectiveFeatureBitmask(0x3f) & Feature.KEY_OVERRIDES).toBeTruthy()
    })

    it('trusts the family bits once bit 13 is set', () => {
        const mask = Feature.BEHAVIOR_FAMILIES | Feature.COMBOS
        expect(bitmaskHas(mask, Feature.COMBOS)).toBe(true)
        expect(bitmaskHas(mask, Feature.SEQUENCES)).toBe(false)
        expect(effectiveFeatureBitmask(mask)).toBe(mask)
    })
})

describe('behaviorFlagsFor', () => {
    it('sets every family flag on firmware that predates advertisement', () => {
        const flags = behaviorFlagsFor(null)
        for (const f of BEHAVIOR_FAMILIES) expect(flags[f]).toBe(true)
        expect(flags.leader).toBe(true)
        expect(flags.autoShift).toBe(true)
    })

    it('clears the flags of a built-out family, leader and auto shift included', () => {
        const flags = behaviorFlagsFor(familiesFromBitmask(Feature.BEHAVIOR_FAMILIES | Feature.TAP_HOLD))
        expect(flags).toMatchObject({ tapHold: true, autoShift: true, sequences: false, leader: false, macros: false })
        expect(flags.capsWord).toBeUndefined()
    })
})

describe('buildRemapprActionTypes families', () => {
    it('lists every kind without family information', () => {
        const ids = buildRemapprActionTypes(4).map((t) => t.id)
        expect(ids).toContain(REMAPPR_KIND_MOD_TAP)
        expect(ids).toContain(REMAPPR_KIND_TAP_DANCE)
    })

    it('drops only the kinds of a built-out family', () => {
        const families = familiesFromBitmask(Feature.BEHAVIOR_FAMILIES | Feature.TAP_HOLD | Feature.MACROS)
        const ids = buildRemapprActionTypes(4, families).map((t) => t.id)
        expect(ids).toContain(REMAPPR_KIND_MOD_TAP)
        expect(ids).not.toContain(REMAPPR_KIND_TAP_DANCE)
        expect(ids.length).toBe(buildRemapprActionTypes(4).length - 1)
    })
})
