// Pattern check: no GoF pattern (-) — rejected — pure parse + localStorage cache helpers around shared KLE parser.
import {
    type ParsedKeyboardDef,
    parseKeyboardDef,
    type RawKeyboardDef,
    validateDef,
} from '@firmware/kle/parser'
import type { DeviceInfo } from '@firmware/types'
import { ProtocolError } from '@firmware/errors'

const CACHE_PREFIX = 'qmk-via-layout:v1:'
// User-supplied layout JSON. Real VIA/QMK definitions are tens of KB; cap
// at 5 MB to bound parser memory and reject obviously hostile inputs early.
const MAX_LAYOUT_JSON_BYTES = 5 * 1024 * 1024

export function parseSideloadJson(text: string): ParsedKeyboardDef {
    if (text.length > MAX_LAYOUT_JSON_BYTES) {
        throw new ProtocolError('Layout JSON too large')
    }
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        // Don't leak the raw parser message into UI/log surfaces — the input
        // came from a user-supplied file and may contain attacker text.
        throw new ProtocolError('Invalid layout JSON')
    }
    return parseKeyboardDef(validateDef(json))
}

export function cacheKey(deviceInfo: DeviceInfo): string | null {
    if (deviceInfo.vid === undefined || deviceInfo.pid === undefined)
        return null
    const vid = deviceInfo.vid.toString(16).padStart(4, '0')
    const pid = deviceInfo.pid.toString(16).padStart(4, '0')
    return `${CACHE_PREFIX}${vid}:${pid}`
}

interface CacheEntry {
    v: 1
    raw: RawKeyboardDef
}

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

export function loadCached(key: string): ParsedKeyboardDef | null {
    const store = getStorage()
    if (!store) return null
    const text = store.getItem(key)
    if (!text) return null
    try {
        const entry = JSON.parse(text) as CacheEntry
        if (entry.v !== 1 || !entry.raw) return null
        return parseKeyboardDef(validateDef(entry.raw))
    } catch {
        return null
    }
}

export function saveCached(key: string, def: ParsedKeyboardDef): void {
    const store = getStorage()
    if (!store) return
    const entry: CacheEntry = { v: 1, raw: def.raw }
    try {
        store.setItem(key, JSON.stringify(entry))
    } catch {
        /* quota exceeded — silent */
    }
}

export function clearCached(key: string): void {
    const store = getStorage()
    if (!store) return
    try {
        store.removeItem(key)
    } catch {
        /* ignore */
    }
}
