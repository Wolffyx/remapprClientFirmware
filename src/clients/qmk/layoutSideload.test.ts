// Pattern check: no GoF pattern (-) — rejected — unit tests for sideload parse + cache helpers.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    cacheKey,
    clearCached,
    loadCached,
    parseSideloadJson,
    saveCached,
} from './layoutSideload'

const sampleJson = JSON.stringify({
    name: 'Tiny',
    vendorId: '0x1234',
    productId: '0x5678',
    matrix: { rows: 1, cols: 2 },
    layouts: { keymap: [['0,0', '0,1']] },
})

class MemStorage {
    private data = new Map<string, string>()

    getItem(k: string): string | null {
        return this.data.get(k) ?? null
    }

    setItem(k: string, v: string): void {
        this.data.set(k, v)
    }

    removeItem(k: string): void {
        this.data.delete(k)
    }

    clear(): void {
        this.data.clear()
    }

    key(): string | null {
        return null
    }

    get length(): number {
        return this.data.size
    }
}

const stub = new MemStorage()
vi.stubGlobal('window', { localStorage: stub as unknown as Storage })

describe('layoutSideload', () => {
    beforeEach(() => {
        stub.clear()
    })

    it('parses valid VIA-style JSON', () => {
        const def = parseSideloadJson(sampleJson)
        expect(def.name).toBe('Tiny')
        expect(def.layoutKeys).toHaveLength(2)
    })

    it('rejects malformed JSON', () => {
        expect(() => parseSideloadJson('{')).toThrow(/Invalid layout JSON/)
    })

    it('rejects oversized JSON input', () => {
        const huge = '"' + 'a'.repeat(6 * 1024 * 1024) + '"'
        expect(() => parseSideloadJson(huge)).toThrow(/Layout JSON too large/)
    })

    it('rejects schema mismatch', () => {
        expect(() => parseSideloadJson('{"name":"x"}')).toThrow(
            /missing matrix/,
        )
    })

    it('round-trips via cache', () => {
        const def = parseSideloadJson(sampleJson)
        const key = cacheKey({
            name: 'Tiny',
            firmware: 'qmk-via',
            vid: 0x1234,
            pid: 0x5678,
        })
        expect(key).toBeTruthy()
        if (!key) return
        saveCached(key, def)
        const restored = loadCached(key)
        expect(restored?.name).toBe('Tiny')
        expect(restored?.layoutKeys).toHaveLength(2)
        clearCached(key)
        expect(loadCached(key)).toBeNull()
    })

    it('returns null cacheKey when vid/pid missing', () => {
        expect(cacheKey({ name: 'x', firmware: 'qmk-via' })).toBeNull()
    })
})
