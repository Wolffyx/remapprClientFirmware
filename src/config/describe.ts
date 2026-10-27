// Pattern check: Dispatch Map (Tier 0) — applied — one describer per document
// kind, keyed by the document's `kind`; no per-firmware branching.
//
// The listing facts for a saved document: what device it is for, how big it is,
// which firmware it targets and which identifiers can match it to a connected
// device. This is the single source of truth for a library item's metadata; the
// cloud only checks the format.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { DeviceKind } from '../devices/types'
import type { CanonGeometry, ConfigKeymap } from './types'

export interface DocumentDescription {
    deviceKind?: DeviceKind
    form?: string
    keyCount: number
    controlCount: number
    layerCount: number
    /** The firmware the document is written for (target + per-firmware sections). */
    firmware: string[]
    target: string | null
    /** `scheme:value` identifiers, lower case (see `layoutFingerprint`). */
    identifiers: string[]
}

const QUARTER = 4

function quarter(n: number | undefined): number {
    return Math.round((n ?? 0) * QUARTER) / QUARTER
}

/** A stable hash of a board's physical layout: every key's rect rounded to
 *  0.25u, sorted, sha-256, first 32 hex. Moving a key or changing its size
 *  changes it; order, legends and bindings do not. */
export function layoutFingerprint(keys: readonly CanonGeometry[]): string {
    const rects = keys
        .map((k) =>
            [k.x, k.y, k.w, k.h, k.r, k.rx, k.ry].map(quarter).join(','),
        )
        .sort()
        .join(';')
    return bytesToHex(sha256(utf8ToBytes(rects))).slice(0, 32)
}

/** "0xFEED" → "feed"; null when it is not a 16-bit hex id. */
function usbId(hex: string | undefined): string | null {
    const m = /^(?:0x)?([0-9a-f]{1,4})$/i.exec(hex?.trim() ?? '')
    return m ? m[1].toLowerCase().padStart(4, '0') : null
}

function keymapIdentifiers(doc: ConfigKeymap): string[] {
    const ids: string[] = []
    if (doc.keyboard.keys.length > 0)
        ids.push(`layout_hash:${layoutFingerprint(doc.keyboard.keys)}`)
    const vid = usbId(doc.meta.vendorId)
    const pid = usbId(doc.meta.productId)
    if (vid && pid) ids.push(`usb:${vid}:${pid}`)
    return ids
}

function describeKeymap(doc: ConfigKeymap): DocumentDescription {
    const target = doc.meta.target ?? null
    const firmware = new Set<string>(target ? [target] : [])
    for (const name of Object.keys(doc.firmware ?? {})) firmware.add(name)
    return {
        deviceKind: 'keyboard',
        form: 'keyboard',
        keyCount: doc.keyboard.keys.length,
        controlCount: doc.keyboard.encoders?.length ?? 0,
        layerCount: doc.layers.length,
        firmware: [...firmware],
        target,
        identifiers: keymapIdentifiers(doc),
    }
}

interface LayoutDocLike {
    deviceKind?: DeviceKind
    form?: string
    controls?: unknown[]
}

function describeDeviceLayout(doc: LayoutDocLike): DocumentDescription {
    return {
        deviceKind: doc.deviceKind,
        form: doc.form,
        keyCount: 0,
        controlCount: doc.controls?.length ?? 0,
        layerCount: 0,
        firmware: [],
        target: null,
        identifiers: [],
    }
}

interface DeviceConfigLike {
    personality?: DeviceKind
}

function describeDeviceConfig(doc: DeviceConfigLike): DocumentDescription {
    return {
        deviceKind: doc.personality,
        keyCount: 0,
        controlCount: 0,
        layerCount: 0,
        firmware: ['remappr'],
        target: 'remappr',
        identifiers: [],
    }
}

const DESCRIBERS: Record<string, (doc: never) => DocumentDescription> = {
    'remappr.keymap': describeKeymap,
    'remappr.device-layout': describeDeviceLayout,
    'remappr.device': describeDeviceConfig,
}

/** The listing facts of a parsed document, or null for an unknown kind. */
export function describeDocument(doc: unknown): DocumentDescription | null {
    const kind = (doc as { kind?: unknown } | null)?.kind
    if (typeof kind !== 'string') return null
    const describe = DESCRIBERS[kind]
    return describe ? describe(doc as never) : null
}
