// Pattern check: Facade (Tier 1) — applied — the optional `identity` facade on
// KeyboardService; each client composes its own sources from these neutral
// helpers. A client without the facade declares no identifiers.
//
// What a connected device can be matched by in the community library:
// `scheme:value` strings, lower case, in the same vocabulary the cloud's
// identifier schemes use (usb, vial_uid, via_name, zmk_name, layout_hash …).
// There is no global list of which firmware reports what — every client says
// what it knows.
import { layoutFingerprint } from './config/describe'
import type { DeviceInfo, PhysicalLayout } from './types'

export interface IdentityApi {
    /** The device's identifiers, `scheme:value`, deduplicated. */
    identifiers(): Promise<string[]>
}

/** One source of identifiers; null/undefined when it has nothing. */
export type IdentitySource = () =>
    string | null | undefined | Promise<string | null | undefined>

const hex4 = (n: number): string => n.toString(16).padStart(4, '0')

/** `usb:vvvv:pppp`, or null when the transport reported no ids. */
export function usbIdentifier(info: DeviceInfo): string | null {
    if (info.vid === undefined || info.pid === undefined) return null
    return `usb:${hex4(info.vid)}:${hex4(info.pid)}`
}

/** `scheme:name`, trimmed and lower-cased, at most 64 characters; null when
 *  the name is empty. */
export function nameIdentifier(
    scheme: string,
    name: string | undefined,
): string | null {
    const value = name?.trim().toLowerCase().slice(0, 64)
    return value ? `${scheme}:${value}` : null
}

/** `layout_hash:…` of a physical layout (centi-key units, as every client
 *  reports them). Knobs, sliders and buttons are not keys and do not count,
 *  so it matches the hash of the same board drawn in the builder. */
export function layoutIdentifier(
    layout: PhysicalLayout | undefined,
): string | null {
    const keys = layout?.keys.filter((k) => !k.element) ?? []
    if (keys.length === 0) return null
    const ku = (v: number | undefined): number => (v ?? 0) / 100
    return `layout_hash:${layoutFingerprint(
        keys.map((k) => ({
            x: ku(k.x),
            y: ku(k.y),
            w: ku(k.w),
            h: ku(k.h),
            r: ku(k.r),
            rx: ku(k.rx),
            ry: ku(k.ry),
        })),
    )}`
}

/** The layout hash of a service's active physical layout. */
export function activeLayoutSource(
    read: () => Promise<{ layouts: PhysicalLayout[]; activeLayoutId: number }>,
): IdentitySource {
    return async () => {
        const { layouts, activeLayoutId } = await read()
        return layoutIdentifier(
            layouts.find((l) => l.id === activeLayoutId) ?? layouts[0],
        )
    }
}

/** An identity facade over sources; a source that fails is skipped (a
 *  device that cannot report its layout still matches by name or USB id). */
export function createIdentity(
    sources: readonly IdentitySource[],
): IdentityApi {
    return {
        async identifiers() {
            const found = await Promise.all(
                sources.map(async (source) => {
                    try {
                        return await source()
                    } catch (e) {
                        console.warn('[identity] a source failed', e)
                        return null
                    }
                }),
            )
            return [...new Set(found.filter((v): v is string => !!v))]
        },
    }
}
