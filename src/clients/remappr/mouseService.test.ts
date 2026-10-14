// pattern-check: skip — unit tests for the Remappr mouse as a controls device.
import { describe, expect, it, vi } from 'vitest'
import { runControlsContractSuite } from '@firmware/__tests__/controlsContract'
import type { ConfigDevice } from '../../config/device'
import type { DeviceConfigApi, MouseMotionApi } from '../../service'
import { RemapprMouseService, type MouseServiceDeps } from './mouseService'
import { applyMouseBinding, mouseBindings, mouseCatalog } from './mouseControls'
import { HwCap, type MotionConfig, type RateLimits } from './protocol'

const DOC: ConfigDevice = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Test mouse' },
    personality: 'mouse',
    mouse: { cpi: 1600, invertY: true },
    radio: { autoPair: true },
} as ConfigDevice

const MOTION: MotionConfig = {
    dpiMin: 200,
    dpiMax: 12000,
    dpiStep: 50,
    dpi: 1200,
    accelProfile: 0,
    scrollMode: 0,
}

function fakeDevice(doc: ConfigDevice | null = DOC) {
    let stored = doc
    const writes: ConfigDevice[] = []
    const api: DeviceConfigApi = {
        personality: 'mouse',
        writable: true,
        read: () =>
            Promise.resolve({
                config: structuredClone(stored ?? DOC),
                configVersion: 3,
                stored: !!stored,
            }),
        write: (c) => {
            writes.push(structuredClone(c))
            stored = c
            return Promise.resolve(writes.length + 3)
        },
    }
    return { api, writes }
}

const motion: MouseMotionApi = {
    writable: true,
    getConfig: () => Promise.resolve(MOTION),
    setDpi: () => Promise.resolve(),
    setAccelProfile: () => Promise.resolve(),
    setScrollMode: () => Promise.resolve(),
}

function make(over: Partial<MouseServiceDeps> = {}) {
    const dev = fakeDevice()
    const svc = new RemapprMouseService({
        deviceInfo: { name: 'Remappr Mouse', firmware: 'remappr' },
        device: dev.api,
        motion,
        writable: true,
        ...over,
    })
    return { svc, writes: dev.writes }
}

runControlsContractSuite('Remappr mouse', { makeService: () => make().svc })
runControlsContractSuite('Remappr mouse without a pointer', {
    makeService: () => make({ hwCaps: HwCap.USB | HwCap.BUTTONS }).svc,
})
runControlsContractSuite('Remappr mouse (through the dongle)', {
    makeService: () => make({ writable: false }).svc,
})

describe('mouse controls mapping', () => {
    it('reads an unset button map as every button reporting itself', () => {
        const b = mouseBindings(undefined, MOTION, null)
        expect(b.lmb).toEqual({ a: 'btn:0' })
        expect(b.btn7).toEqual({ a: 'btn:7' })
        expect(b.wheel).toMatchObject({ click: 'btn:2' })
        expect(b.sensor).toMatchObject({ stages: [1200], active: 0 })
    })

    it('writes a remap into the button map and drops it when back to identity', () => {
        const swapped = applyMouseBinding(DOC, 'back', { a: 'btn:4' })
        expect(swapped.mouse?.buttonMap).toEqual([0, 1, 2, 4, 4, 5, 6, 7])
        const off = applyMouseBinding(swapped, 'wheel', {
            ...mouseBindings(swapped.mouse, MOTION, null).wheel!,
            click: null,
        } as never)
        expect(off.mouse?.buttonMap?.[2]).toBeNull()
        const back = applyMouseBinding(swapped, 'back', { a: 'btn:3' })
        expect(back.mouse?.buttonMap).toBeUndefined()
        expect(back.mouse).toEqual({ cpi: 1600, invertY: true })
    })

    const SENSOR = { poll: 1000, lod: '', snap: false, motionSync: false }

    it('binds a DPI action instead of the button map, and gives it back', () => {
        const cyc = applyMouseBinding(DOC, 'back', { a: 'dev:dpiCycle' })
        expect(cyc.mouse?.buttonActions?.[3]).toEqual({ action: 'dpiCycle' })
        expect(cyc.mouse?.buttonMap).toBeUndefined()
        expect(mouseBindings(cyc.mouse, MOTION, null).back).toEqual({
            a: 'dev:dpiCycle',
        })

        const snipe = applyMouseBinding(cyc, 'wheel', {
            ...mouseBindings(cyc.mouse, MOTION, null).wheel!,
            click: 'dev:sniper:400',
        } as never)
        expect(snipe.mouse?.buttonActions?.[2]).toEqual({
            action: 'sniper',
            dpi: 400,
        })

        const back = applyMouseBinding(snipe, 'back', { a: 'btn:4' })
        expect(back.mouse?.buttonActions?.[3]).toBeNull()
        expect(back.mouse?.buttonMap?.[3]).toBe(4)
        const plain = applyMouseBinding(
            applyMouseBinding(back, 'back', { a: 'btn:3' }),
            'wheel',
            {
                ...mouseBindings(back.mouse, MOTION, null).wheel!,
                click: 'btn:2',
            } as never,
        )
        expect(plain.mouse).toEqual({ cpi: 1600, invertY: true })
    })

    it('writes more than one stage as DPI stages', () => {
        const doc = applyMouseBinding(DOC, 'sensor', {
            ...SENSOR,
            stages: [400, 800, 1600],
            active: 2,
        })
        expect(doc.mouse).toEqual({
            invertY: true,
            dpiStages: [400, 800, 1600],
            dpiStage: 2,
        })
        expect(mouseBindings(doc.mouse, MOTION, null).sensor).toMatchObject({
            stages: [400, 800, 1600],
            active: 2,
        })
        const one = applyMouseBinding(doc, 'sensor', {
            ...SENSOR,
            stages: [900],
            active: 0,
        })
        expect(one.mouse).toEqual({ invertY: true, cpi: 900 })
    })

    it('offers the DPI actions the sensor can do', () => {
        const c = mouseCatalog(MOTION, null, {
            buttonActions: [
                null,
                null,
                null,
                { action: 'sniper', dpi: 1234 },
                null,
                null,
                null,
                null,
            ],
        })
        const dpi = c.actions.filter((a) => a.group === 'dpi').map((a) => a.id)
        expect(dpi).toEqual([
            'dev:dpiCycle',
            'dev:dpiUp',
            'dev:dpiDown',
            'dev:sniper:200',
            'dev:sniper:400',
            'dev:sniper:800',
            'dev:sniper:1234',
        ])
        expect(c.sensor?.maxStages).toBe(5)
        const narrow = mouseCatalog({ ...MOTION, dpiMin: 400 }, null)
        expect(narrow.actions.map((a) => a.id)).not.toContain('dev:sniper:200')
    })

    it('writes the sensor stage as the CPI', () => {
        const doc = applyMouseBinding(DOC, 'sensor', {
            stages: [3200],
            active: 0,
            poll: 1000,
            lod: '',
            snap: false,
            motionSync: false,
        })
        expect(doc.mouse?.cpi).toBe(3200)
        expect(doc.radio).toEqual(DOC.radio)
    })
})

describe('RemapprMouseService', () => {
    it('stages edits until Save writes the whole document once', async () => {
        const { svc, writes } = make()
        const pending: boolean[] = []
        svc.onPendingChangesChanged((p) => pending.push(p))
        await svc.controls.setBinding!('p0', 'lmb', { a: 'btn:1' })
        await svc.controls.setBinding!('p0', 'rmb', { a: 'btn:0' })
        expect(writes).toHaveLength(0)
        expect(svc.hasPendingChanges()).toBe(true)
        await svc.commit()
        expect(writes).toHaveLength(1)
        expect(writes[0]!.mouse?.buttonMap?.slice(0, 2)).toEqual([1, 0])
        expect(writes[0]!.radio).toEqual(DOC.radio)
        expect(pending).toEqual([true, false])
    })

    it('shares one draft with the settings panel', async () => {
        const { svc, writes } = make()
        const changes = vi.fn()
        svc.controls.onChanged(changes)
        await svc.controls.getBindings('p0')
        await svc.controls.setBinding!('p0', 'sensor', {
            stages: [800],
            active: 0,
            poll: 1000,
            lod: '',
            snap: false,
            motionSync: false,
        })
        expect(changes).not.toHaveBeenCalled()
        const draft = svc.device!.draft!
        draft.set({
            ...draft.get()!,
            mouse: { ...draft.get()!.mouse, invertX: true },
        })
        expect(changes).toHaveBeenCalledWith({
            type: 'bindings',
            profileId: 'p0',
        })
        await svc.commit()
        expect(writes[0]!.mouse).toMatchObject({
            cpi: 800,
            invertX: true,
            invertY: true,
        })
    })

    it('discards back to what the device holds', async () => {
        const { svc } = make()
        await svc.controls.setBinding!('p0', 'fwd', { a: null })
        await svc.discardChanges()
        expect(svc.hasPendingChanges()).toBe(false)
        expect((await svc.controls.getBindings('p0')).fwd).toEqual({
            a: 'btn:4',
        })
    })

    it('offers the report rate only when the firmware answers for it', async () => {
        const rates: RateLimits = {
            supported: [125, 500, 1000],
            usbCapHz: 1000,
            radioCapHz: 1000,
            currentHz: 500,
        }
        const set = vi.fn((hz: number) => Promise.resolve(hz))
        const { svc } = make({
            rate: { get: () => Promise.resolve(rates), set },
        })
        expect((await svc.controls.getCatalog()).fields.sensor).toContain(
            'poll',
        )
        const sensor = (await svc.controls.getBindings('p0')).sensor!
        await svc.controls.setBinding!('p0', 'sensor', {
            ...sensor,
            poll: 1000,
        } as never)
        expect(svc.hasPendingChanges()).toBe(true)
        await svc.commit()
        expect(set).toHaveBeenCalledWith(1000)

        const noRate = make({
            rate: { get: () => Promise.reject(new Error('ERR_CMD')), set },
        }).svc
        expect((await noRate.controls.getCatalog()).fields.sensor).toEqual([
            'stages',
        ])
    })

    it('restores firmware defaults by writing a document without settings', async () => {
        const { svc, writes } = make()
        await svc.resetSettings()
        expect(writes).toHaveLength(1)
        expect(writes[0]!.mouse).toBeUndefined()
        expect(writes[0]!.radio).toBeUndefined()
        expect(writes[0]!.personality).toBe('mouse')
    })

    it('draws a sensor only when the mouse reports a pointer', async () => {
        const ids = async (hwCaps?: number) => {
            const { svc } = make({ hwCaps })
            const model = await svc.controls.getModel()
            const bindings = await svc.controls.getBindings('p0')
            return {
                model: model.controls.some((c) => c.id === 'sensor'),
                bound: 'sensor' in bindings,
            }
        }
        // 0 / absent: older firmware that does not report its hardware.
        expect(await ids(undefined)).toEqual({ model: true, bound: true })
        expect(await ids(0)).toEqual({ model: true, bound: true })
        expect(await ids(HwCap.USB | HwCap.POINTER)).toEqual({
            model: true,
            bound: true,
        })
        expect(await ids(HwCap.USB | HwCap.BUTTONS)).toEqual({
            model: false,
            bound: false,
        })
    })

    it('is read-only through the dongle', () => {
        const { svc } = make({ writable: false })
        expect(svc.capabilities.readOnly).toBe(true)
        expect(svc.controls.setBinding).toBeUndefined()
        expect(svc.device?.draft).toBeUndefined()
    })

    it('reports a lost transport and closes an owned one on disconnect', async () => {
        let lost: ((r?: unknown) => void) | undefined
        const closeTransport = vi.fn(() => Promise.resolve())
        const { svc } = make({
            onTransportClosed: (cb) => {
                lost = cb
            },
            closeTransport,
        })
        const closed = vi.fn()
        svc.onClosed(closed)
        lost?.('unplugged')
        expect(closed).toHaveBeenCalledWith('unplugged')
        await svc.disconnect()
        expect(closeTransport).not.toHaveBeenCalled()
    })
})
