// pattern-check: skip — unit tests for the Remappr joystick as a controls device.
import { describe, expect, it, vi } from 'vitest'
import { runControlsContractSuite } from '@firmware/__tests__/controlsContract'
import type { ConfigDevice } from '../../config/device'
import type { HatBinding, StickBinding } from '../../devices/types'
import type { DeviceConfigApi, JoystickApi } from '../../service'
import type { InputLayout } from './inputLayout'
import {
    applyJoystickBinding,
    joystickBindings,
    joystickCatalog,
    joystickFrame,
    joystickInputs,
    joystickModel,
    parseActionId,
} from './joystickControls'
import {
    RemapprJoystickService,
    type JoystickServiceDeps,
} from './joystickService'
import type { AxisState, InputLayoutEntry } from './protocol'

const entry = (
    cls: number,
    shape: number,
    ordinal: number,
    position: number,
    rect: [number, number, number, number],
): InputLayoutEntry => ({
    cls,
    shape,
    inputId: (cls << 8) | ordinal,
    position,
    x: rect[0],
    y: rect[1],
    w: rect[2],
    h: rect[3],
    rot: 0,
    rotx: rect[0] + rect[2] / 2,
    roty: rect[1] + rect[3] / 2,
})

/** The nRF52840 DK joystick's GET_INPUT_LAYOUT (app/joystick overlay). */
const DK: InputLayout = {
    form: 4,
    entries: [
        entry(5, 4, 0, 4, [115, 233, 170, 170]),
        entry(7, 5, 0, 5, [273, 415, 180, 180]),
        entry(1, 2, 0, 3, [813, 198, 75, 75]),
        entry(1, 2, 1, 2, [733, 278, 75, 75]),
        entry(1, 2, 2, 1, [893, 278, 75, 75]),
        entry(1, 2, 3, 0, [813, 358, 75, 75]),
    ],
}
const INPUTS = joystickInputs(DK)

const DOC: ConfigDevice = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Bench stick' },
    personality: 'joystick',
}

function fakeDevice(doc: ConfigDevice = DOC) {
    let stored = doc
    const writes: ConfigDevice[] = []
    const api: DeviceConfigApi = {
        personality: 'joystick',
        writable: true,
        read: () =>
            Promise.resolve({
                config: structuredClone(stored),
                configVersion: 3,
                stored: true,
            }),
        write: (c) => {
            writes.push(structuredClone(c))
            stored = c
            return Promise.resolve(writes.length + 3)
        },
    }
    return { api, writes }
}

const STATE: AxisState = {
    inputs: [
        { raw: 4000, value: 32767 },
        { raw: 2048, value: 0 },
    ],
    buttons: 0b10001, // buttons 1 and 5 (A and the stick click)
    hat: 2,
}

const joystick: JoystickApi = {
    writable: true,
    getState: () => Promise.resolve(STATE),
    getConfig: () => Promise.resolve({ hatWays: 8, axes: [] }),
    calibrate: () => Promise.resolve(),
    setAxisMap: () => Promise.resolve(),
    setDeadzone: () => Promise.resolve(),
}

function make(over: Partial<JoystickServiceDeps> = {}) {
    const dev = fakeDevice()
    const svc = new RemapprJoystickService({
        deviceInfo: { name: 'Remappr Joystick', firmware: 'remappr' },
        device: dev.api,
        joystick,
        writable: true,
        layout: DK,
        ...over,
    })
    return { svc, writes: dev.writes }
}

runControlsContractSuite('Remappr joystick', { makeService: () => make().svc })
runControlsContractSuite('Remappr joystick (read-only)', {
    makeService: () => make({ writable: false }).svc,
})

describe('joystick controls mapping', () => {
    it('draws the reported gamepad with its ids', () => {
        const m = joystickModel('Stick', DK)
        expect(m.kind).toBe('joystick')
        expect(m.form).toBe('gamepad')
        expect(m.controls.map((c) => c.id)).toEqual([
            'stick:0',
            'hat:0',
            'btn:3',
            'btn:2',
            'btn:1',
            'btn:0',
        ])
        expect(m.controls[0]!.name).toBe('Left stick')
        expect(m.controls[1]!.name).toBe('D-pad')
        expect(m.controls[5]!.name).toBe('Button 1')
    })

    it('reads no settings as the firmware defaults', () => {
        const b = joystickBindings(undefined, INPUTS)
        expect(b['btn:0']).toEqual({ a: 'pad:btn:1' })
        expect(b['stick:0']).toEqual({
            out: 'x:y',
            inner: 0,
            outer: 100,
            curve: 'linear',
            invY: false,
            click: 'pad:btn:5',
        } satisfies StickBinding)
        const hat = b['hat:0'] as HatBinding
        expect([hat.up, hat.down, hat.left, hat.right]).toEqual([
            'pad:hat:0',
            'pad:hat:4',
            'pad:hat:6',
            'pad:hat:2',
        ])
        expect(hat.ways).toBe(8)
    })

    it('stores only what differs from the default', () => {
        let doc = applyJoystickBinding(DOC, INPUTS, 'btn:0', { a: 'pad:btn:1' })
        expect(doc.joystick).toBeUndefined()
        doc = applyJoystickBinding(doc, INPUTS, 'btn:1', {
            a: 'pad:axis:z:32767',
        })
        expect(doc.joystick?.buttonActions).toEqual([
            null,
            { action: 'axis', axis: 'z', value: 32767 },
        ])
        doc = applyJoystickBinding(doc, INPUTS, 'btn:1', { a: 'pad:btn:2' })
        expect(doc.joystick).toBeUndefined()
        doc = applyJoystickBinding(doc, INPUTS, 'btn:2', { a: null })
        expect(doc.joystick?.buttonActions?.[2]).toEqual({ action: 'none' })
    })

    it('writes a stick to both of its inputs', () => {
        const doc = applyJoystickBinding(DOC, INPUTS, 'stick:0', {
            out: 'rx:ry',
            inner: 8,
            outer: 95,
            curve: 'aggressive',
            invY: true,
            click: 'pad:btn:10',
        } satisfies StickBinding)
        expect(doc.joystick).toEqual({
            axes: [
                {
                    input: 0,
                    out: 'rx',
                    curve: 'aggressive',
                    inner: 8,
                    outer: 5,
                },
                {
                    input: 1,
                    out: 'ry',
                    invert: true,
                    curve: 'aggressive',
                    inner: 8,
                    outer: 5,
                },
            ],
            buttonActions: [
                null,
                null,
                null,
                null,
                { action: 'button', button: 10 },
            ],
        })
        const back = joystickBindings(doc.joystick, INPUTS)[
            'stick:0'
        ] as StickBinding
        expect(back.out).toBe('rx:ry')
        expect(back.invY).toBe(true)
        expect(back.click).toBe('pad:btn:10')
        // The inspector's outer is a saturation radius; the firmware's outer is
        // the deadzone off the edge: 95% of travel ⇄ a 5% outer deadzone.
        expect(back.outer).toBe(95)
    })

    it('writes a hat to its four positions and its ways', () => {
        const hat: HatBinding = {
            up: 'pad:hat:0',
            down: 'pad:hat:4',
            left: 'pad:btn:12',
            right: 'pad:hat:2',
            ul: null,
            ur: null,
            dl: null,
            dr: null,
            ways: 4,
        }
        const doc = applyJoystickBinding(DOC, INPUTS, 'hat:0', hat)
        expect(doc.joystick?.hatWays).toBe(4)
        expect(doc.joystick?.buttonActions?.[7]).toEqual({
            action: 'button',
            button: 12,
        })
        expect(doc.joystick?.buttonActions?.slice(5, 7)).toEqual([null, null])
    })

    it('offers the outputs it binds', () => {
        const doc = applyJoystickBinding(DOC, INPUTS, 'stick:0', {
            out: 'y:x',
            inner: 0,
            outer: 100,
            curve: 'linear',
            invY: false,
            click: 'pad:btn:5',
        } satisfies StickBinding)
        const outs = joystickCatalog(doc.joystick, INPUTS).outputs.stick!.map(
            (o) => o.id,
        )
        expect(outs).toContain('y:x')
        expect(outs).toContain('x:y')
    })

    it('round-trips every catalog action id', () => {
        for (const a of joystickCatalog(undefined, INPUTS).actions) {
            expect(parseActionId(a.id)).toBeDefined()
        }
        expect(parseActionId('kbd:a')).toBeUndefined()
    })

    it('turns a reading into a frame', () => {
        const f = joystickFrame(STATE, joystickBindings(undefined, INPUTS))
        expect([...f.pressed].sort()).toEqual(['btn:0', 'stick:0'])
        expect(f.analog['stick:0']).toEqual({ x: 1, y: 0 })
        expect(f.analog['hat:0']).toEqual({ x: 1, y: 0 })
    })
})

describe('RemapprJoystickService', () => {
    it('stages a binding and writes it on commit', async () => {
        const { svc, writes } = make()
        await svc.controls.setBinding!('p0', 'btn:0', { a: 'pad:btn:9' })
        expect(writes).toHaveLength(0)
        await svc.commit()
        expect(writes[0]?.joystick?.buttonActions?.[0]).toEqual({
            action: 'button',
            button: 9,
        })
        await svc.disconnect()
    })

    it('discards back to the stored document', async () => {
        const { svc } = make()
        await svc.controls.setBinding!('p0', 'btn:0', { a: 'pad:btn:9' })
        await svc.discardChanges()
        expect((await svc.controls.getBindings('p0'))['btn:0']).toEqual({
            a: 'pad:btn:1',
        })
        await svc.disconnect()
    })

    it('polls the live state only while listened to', async () => {
        vi.useFakeTimers()
        const getState = vi.fn(() => Promise.resolve(STATE))
        const { svc } = make({
            joystick: { ...joystick, getState },
            pollMs: 20,
        })
        const off = svc.controls.onInput!(() => undefined)
        await vi.advanceTimersByTimeAsync(100)
        expect(getState).toHaveBeenCalled()
        off()
        getState.mockClear()
        await vi.advanceTimersByTimeAsync(100)
        expect(getState).not.toHaveBeenCalled()
        vi.useRealTimers()
        await svc.disconnect()
    })

    it('keeps the live readout through a failed read', async () => {
        vi.useFakeTimers()
        const getState = vi
            .fn<() => Promise<typeof STATE>>()
            .mockRejectedValueOnce(new Error('busy'))
            .mockResolvedValue(STATE)
        const { svc } = make({
            joystick: { ...joystick, getState },
            pollMs: 20,
        })
        const frames = vi.fn()
        const off = svc.controls.onInput!(frames)
        await vi.advanceTimersByTimeAsync(100)
        expect(frames).toHaveBeenCalled()
        off()
        vi.useRealTimers()
        await svc.disconnect()
    })

    it('ends the live readout after a run of failed reads', async () => {
        vi.useFakeTimers()
        const getState = vi.fn(() => Promise.reject(new Error('gone')))
        const { svc } = make({
            joystick: { ...joystick, getState },
            pollMs: 20,
        })
        const off = svc.controls.onInput!(() => undefined)
        await vi.advanceTimersByTimeAsync(500)
        expect(getState).toHaveBeenCalledTimes(5)
        off()
        vi.useRealTimers()
        await svc.disconnect()
    })

    it('has no live readout without the JOYSTICK verbs', async () => {
        const { svc } = make({ joystick: undefined })
        expect(svc.controls.onInput).toBeUndefined()
        await svc.disconnect()
    })
})
