// pattern-check: skip — unit tests for the device-layout document, fit check and override.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLayout } from './defaultLayout'
import { createLayoutOverride } from './layoutOverride'
import {
    deviceLayoutJsonSchema,
    layoutFits,
    layoutFromModel,
    modelFromLayout,
    parseDeviceLayout,
} from './schema'
import type { DeviceModel } from './types'

const base = defaultLayout('gamepad', 'Pad', { buttons: 12, axes: 6, hats: 1 })

const moved = (m: DeviceModel): DeviceModel => ({
    ...m,
    controls: m.controls.map((c, i) =>
        i === 0 ? { ...c, x: c.x + 1, name: 'Renamed' } : c,
    ),
})

function memoryStorage(): Storage {
    const data = new Map<string, string>()
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
        clear: () => data.clear(),
        key: (i) => [...data.keys()][i] ?? null,
        get length() {
            return data.size
        },
    }
}

afterEach(() => vi.unstubAllGlobals())

describe('device layout document', () => {
    it('round-trips a model and drops the defaulted marks', () => {
        const doc = layoutFromModel(base)
        expect(doc).toMatchObject({
            schemaVersion: 1,
            kind: 'remappr.device-layout',
            form: 'gamepad',
            deviceKind: 'joystick',
        })
        const back = modelFromLayout(doc)
        expect(back.controls).toEqual(base.controls)
        expect(back.defaulted).toBeUndefined()
    })

    it('says what is wrong with an invalid document', () => {
        const doc = layoutFromModel(base)
        const dup = { ...doc, controls: [...doc.controls, doc.controls[0]] }
        expect(parseDeviceLayout(JSON.stringify(dup))).toEqual({
            ok: false,
            error: expect.stringContaining('duplicate control id'),
        })
        expect(parseDeviceLayout('{').ok).toBe(false)
        const bad = { ...doc, controls: [{ ...doc.controls[0], w: -1 }] }
        expect(parseDeviceLayout(JSON.stringify(bad))).toEqual({
            ok: false,
            error: expect.stringMatching(/^controls\.0\.w: /),
        })
    })
})

describe('deviceLayoutJsonSchema', () => {
    it('describes the document a layout editor shows', () => {
        const schema = deviceLayoutJsonSchema() as {
            type: string
            required: string[]
            properties: Record<string, { const?: unknown; enum?: unknown[] }>
        }
        expect(schema.type).toBe('object')
        expect(schema.required).toEqual(
            expect.arrayContaining(['kind', 'form', 'controls']),
        )
        expect(schema.properties.kind?.const).toBe('remappr.device-layout')
        expect(schema.properties.form?.enum).toContain('gamepad')
        expect(deviceLayoutJsonSchema()).toBe(schema) // generated once
    })
})

describe('layoutFits', () => {
    it('accepts moved, resized and renamed controls', () => {
        expect(layoutFits(base, moved(base))).toBeNull()
    })

    it('refuses a missing, extra or re-kinded control', () => {
        const [first, ...rest] = base.controls
        expect(layoutFits(base, { ...base, controls: rest })).toMatch(/missing/)
        const extra = { ...first!, id: 'extra', name: 'Extra' }
        expect(
            layoutFits(base, { ...base, controls: [...base.controls, extra] }),
        ).toMatch(/not one of this device's inputs/)
        const rekind = { ...first!, kind: 'axis' as const }
        expect(
            layoutFits(base, { ...base, controls: [rekind, ...rest] }),
        ).toMatch(/must stay/)
    })
})

describe('createLayoutOverride', () => {
    it('applies a fitting layout, notifies, and resets', async () => {
        const onChanged = vi.fn()
        const o = createLayoutOverride(base, { onChanged })
        await o.api.apply(moved(base))
        expect(o.model().controls[0]!.name).toBe('Renamed')
        expect(o.model().defaulted).toBeUndefined()
        expect(o.api.overridden()).toBe(true)
        await o.api.reset()
        expect(o.model()).toBe(base)
        expect(onChanged).toHaveBeenCalledTimes(2)
    })

    it('rejects a layout that does not fit and keeps the current one', async () => {
        const o = createLayoutOverride(base, { onChanged: () => {} })
        await expect(
            o.api.apply({ ...base, controls: base.controls.slice(1) }),
        ).rejects.toThrow(/missing/)
        expect(o.model()).toBe(base)
    })

    it('remembers an applied layout under its key', async () => {
        vi.stubGlobal('window', { localStorage: memoryStorage() })
        const first = createLayoutOverride(base, {
            key: 'pad',
            onChanged: () => {},
        })
        await first.api.apply(moved(base))
        const again = createLayoutOverride(base, {
            key: 'pad',
            onChanged: () => {},
        })
        expect(again.model().controls[0]!.name).toBe('Renamed')
        await again.api.reset()
        const fresh = createLayoutOverride(base, {
            key: 'pad',
            onChanged: () => {},
        })
        expect(fresh.api.overridden()).toBe(false)
    })
})
