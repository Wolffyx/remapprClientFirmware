// Pattern check: Dispatch Map (Tier 0) — applied — firmware personality code →
// DeviceKind table; replaces the chained isDongle / isMouse booleans so a new
// personality (joystick) is one more entry.
//
// What a Remappr device is, from its GET_PERSONALITY_MAP reply. The firmware's
// `remappr_personality` (role.h) is the source of truth; DeviceKind uses the
// same vocabulary.
import { Personality } from '../../config/compilers/remappr/blobWriter'
import type { DeviceKind } from '../../devices/types'
import type { DiscoveryResult } from './discovery'
import { Role } from './protocol'

const KIND_BY_PERSONALITY: Readonly<Partial<Record<number, DeviceKind>>> = {
    [Personality.keyboard]: 'keyboard',
    [Personality.mouse]: 'mouse',
    [Personality.dongle]: 'dongle',
}

/** The device's kind. The DONGLE role wins (an older dongle reports no
 *  personality at all); an unknown or recovery personality is treated as a
 *  keyboard, as before personalities were reported. */
export function deviceKind(discovery: DiscoveryResult): DeviceKind {
    if (discovery.role === Role.DONGLE) return 'dongle'
    const code = discovery.personality?.personality
    if (code === undefined) return 'keyboard'
    return KIND_BY_PERSONALITY[code] ?? 'keyboard'
}
