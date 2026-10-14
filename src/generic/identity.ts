// pattern-check: skip — id formatting and the remembered-layout lookup every generic source shares; three small helpers.
import { createLayoutOverride } from '../devices/layoutOverride'
import type { NativeProfile } from './types'

/** "054C:0CE6". */
export const usbIds = (vendorId: number, productId: number): string =>
    [vendorId, productId]
        .map((n) => n.toString(16).padStart(4, '0').toUpperCase())
        .join(':')

/** Where a generic device's re-drawn layout is remembered. Keyed per model
 *  (USB ids), so every unit of one model shares it. */
export const genericLayoutKey = (id: string): string => `hid:${id}`

/** `profile` drawn with the layout the user re-drew under `key`, if any. */
export function withRememberedLayout<P extends NativeProfile>(
    profile: P,
    key: string,
): P {
    const layout = createLayoutOverride(profile.model, {
        key,
        onChanged: () => {},
    })
    return { ...profile, model: layout.model() }
}
