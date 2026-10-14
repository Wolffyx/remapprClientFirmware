// pattern-check: skip — unit tests for KeylessServiceBase.
import { describe, expect, it, vi } from 'vitest'
import { UnsupportedError } from '../errors'
import type { Capabilities } from '../service'
import type { DeviceInfo } from '../types'
import { KeylessServiceBase } from './keylessService'

class TestDevice extends KeylessServiceBase {
    readonly kind = 'mouse' as const
    readonly deviceInfo: DeviceInfo = { name: 'Test', firmware: 'test' }
    readonly capabilities: Capabilities = {
        lock: 'none',
        rename: false,
        notifications: false,
        reorderLayers: false,
        variableLayerCount: false,
        exportFormats: [],
        saveMode: 'manual',
    }
    closeCalls = 0
    stage(): void {
        this.setPending(true)
    }
    protected override close(): Promise<void> {
        this.closeCalls++
        return Promise.resolve()
    }
}

describe('KeylessServiceBase', () => {
    it('answers the keymap half with an empty keymap and no lock', async () => {
        const d = new TestDevice()
        expect(await d.getLockState()).toBe('not-applicable')
        expect(await d.getKeymap()).toEqual({
            layers: [],
            availableLayers: 0,
            activeLayoutId: 0,
            layouts: [],
        })
        expect((await d.getPhysicalLayouts()).layouts).toEqual([])
        expect(await d.listActionTypes()).toEqual([])
    })

    it('rejects keymap edits as unsupported', async () => {
        const d = new TestDevice()
        await expect(d.setKey()).rejects.toBeInstanceOf(UnsupportedError)
        await expect(d.addLayer()).rejects.toBeInstanceOf(UnsupportedError)
        await expect(d.resetSettings()).rejects.toBeInstanceOf(UnsupportedError)
        expect(() => d.buildKeyAction()).toThrow(UnsupportedError)
    })

    it('tracks pending changes and clears them on commit', async () => {
        const d = new TestDevice()
        const seen: boolean[] = []
        const off = d.onPendingChangesChanged((p) => seen.push(p))
        d.stage()
        d.stage()
        expect(d.hasPendingChanges()).toBe(true)
        await d.commit()
        expect(seen).toEqual([true, false])
        off()
        d.stage()
        expect(seen).toEqual([true, false])
    })

    it('closes once and tells every listener', async () => {
        const d = new TestDevice()
        const onClosed = vi.fn()
        d.onClosed(onClosed)
        await d.disconnect()
        await d.disconnect()
        expect(d.closeCalls).toBe(1)
        expect(onClosed).toHaveBeenCalledTimes(1)
    })
})
