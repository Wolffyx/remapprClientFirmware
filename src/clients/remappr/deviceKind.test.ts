// pattern-check: skip — unit tests for the personality → kind table.
import { describe, expect, it } from 'vitest'
import { Personality } from '../../config/compilers/remappr/blobWriter'
import { deviceKind } from './deviceKind'
import type { DiscoveryResult } from './discovery'
import { Role, type PersonalityMap } from './protocol'

function discovery(role: number, personality?: number): DiscoveryResult {
    const map: PersonalityMap | undefined =
        personality === undefined
            ? undefined
            : {
                  role,
                  personality,
                  protoMajor: 2,
                  namespaces: [],
                  hwCaps: 0,
              }
    return {
        protoMax: 2,
        deviceInfo: {} as DiscoveryResult['deviceInfo'],
        personality: map,
        role,
    }
}

describe('deviceKind', () => {
    it('maps the firmware personality to the device kind', () => {
        expect(deviceKind(discovery(Role.NODE, Personality.keyboard))).toBe(
            'keyboard',
        )
        expect(deviceKind(discovery(Role.NODE, Personality.mouse))).toBe(
            'mouse',
        )
    })

    it('treats the DONGLE role as a dongle whatever the personality says', () => {
        expect(deviceKind(discovery(Role.DONGLE))).toBe('dongle')
        expect(deviceKind(discovery(Role.DONGLE, Personality.dongle))).toBe(
            'dongle',
        )
    })

    it('falls back to keyboard for unknown, recovery or missing personality', () => {
        expect(deviceKind(discovery(Role.NODE))).toBe('keyboard')
        expect(deviceKind(discovery(Role.NODE, Personality.recovery))).toBe(
            'keyboard',
        )
        expect(deviceKind(discovery(Role.NODE, 0x0f))).toBe('keyboard')
    })
})
