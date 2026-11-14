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
    [Personality.joystick]: 'joystick',
}

/** The device's kind. The DONGLE role wins (an older dongle reports no
 *  personality at all); an unknown or recovery personality is treated as a
 *  keyboard, as before personalities were reported. A recovery image is
 *  shown read-only (see isRecovery). */
export function deviceKind(discovery: DiscoveryResult): DeviceKind {
    if (discovery.role === Role.DONGLE) return 'dongle'
    const code = discovery.personality?.personality
    if (code === undefined) return 'keyboard'
    return KIND_BY_PERSONALITY[code] ?? 'keyboard'
}

/** True for the §G recovery image (personality RECOVERY): it boots when the
 *  real firmware cannot, and is never edited. */
export function isRecovery(discovery: DiscoveryResult): boolean {
    return discovery.personality?.personality === Personality.recovery
}

/** Why a recovery image is shown read-only. */
export const RECOVERY_READ_ONLY =
    'This device is running its recovery image, so it is shown read-only. ' +
    'Flash the firmware again to edit it.'
