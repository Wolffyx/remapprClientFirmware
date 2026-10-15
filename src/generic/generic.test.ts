// pattern-check: skip — unit + contract tests for the generic HID input sources.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runControlsContractSuite } from '../__tests__/controlsContract'
import type { ControlInputFrame } from '../devices/types'
import { parseGamepadId, type GamepadEnv } from './gamepad/env'
import { connectGamepad, listGamepads } from './gamepad/discovery'
import { frameKey, frameOf, type GamepadLike } from './gamepad/inputMap'
import { GamepadLiveSource } from './gamepad/liveSource'
import { rawGamepadProfile } from './gamepad/raw'
import { STANDARD_MAP, standardProfile } from './gamepad/standard'
import { connectHidMouse, hidMouseDevice } from './mouse/hidMouse'
import { PointerLiveSource, type PointerTarget } from './mouse/pointerSource'

const XBOX_ID =
    'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'

function pad(over: Partial<GamepadLike> = {}): GamepadLike {
    return {
        id: XBOX_ID,
        index: 0,
        mapping: 'standard',
        connected: true,
        buttons: Array.from({ length: 17 }, () => ({
            pressed: false,
            value: 0,
        })),
        axes: [0, 0, 0, 0],
        ...over,
    }
}

function press(gp: GamepadLike, ...indices: number[]): GamepadLike {
    return {
        ...gp,
        buttons: gp.buttons.map((b, i) =>
            indices.includes(i) ? { pressed: true, value: 1 } : b,
        ),
    }
}

/** A Gamepad API whose controllers the test swaps in and out. */
function fakeEnv(pads: (GamepadLike | null)[]) {
    const listeners = new Set<() => void>()
    const env: GamepadEnv = {
        getGamepads: () => pads,
        nextFrame: (cb) => {
            const t = setTimeout(cb, 16)
            return () => clearTimeout(t)
        },
        onConnectionChange: (cb) => {
            listeners.add(cb)
            return () => listeners.delete(cb)
        },
    }
    return { env, pads, fire: () => listeners.forEach((cb) => cb()) }
}

/** An event target that records listeners and lets the test dispatch. */
function fakeTarget() {
    const handlers = new Map<string, Set<(e: Event) => void>>()
    const target: PointerTarget = {
        addEventListener: (type, cb) => {
            if (!handlers.has(type)) handlers.set(type, new Set())
            handlers.get(type)!.add(cb)
        },
        removeEventListener: (type, cb) => {
            handlers.get(type)?.delete(cb)
        },
    }
    const dispatch = (type: string, init: Record<string, unknown> = {}) => {
        const e = { type, preventDefault: vi.fn(), ...init }
        for (const cb of handlers.get(type) ?? []) cb(e as unknown as Event)
        return e
    }
    const count = () =>
        [...handlers.values()].reduce((n, set) => n + set.size, 0)
    return { target, dispatch, count }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('parseGamepadId', () => {
    it('reads the Chromium form', () => {
        expect(parseGamepadId(XBOX_ID)).toEqual({
            name: 'Xbox Wireless Controller',
            vendorId: 0x045e,
            productId: 0x0b13,
        })
    })

    it('reads the Firefox form', () => {
        expect(parseGamepadId('54c-ce6-DualSense Wireless Controller')).toEqual(
            {
                name: 'DualSense Wireless Controller',
                vendorId: 0x054c,
                productId: 0x0ce6,
            },
        )
    })

    it('collapses the spaces drivers pad names with', () => {
        expect(
            parseGamepadId('USB   Gamepad     (Vendor: 0079 Product: 0011)')
                .name,
        ).toBe('USB Gamepad')
    })

    it('keeps the name of an id without USB ids', () => {
        expect(
            parseGamepadId('Xbox 360 Controller (XInput STANDARD GAMEPAD)'),
        ).toEqual({ name: 'Xbox 360 Controller' })
    })
})

describe('frameOf (standard mapping)', () => {
    it('reads buttons, triggers, sticks and the d-pad', () => {
        const gp = press(pad({ axes: [0.5, -1, 0, 0] }), 0, 10, 12, 15)
        const withTrigger: GamepadLike = {
            ...gp,
            buttons: gp.buttons.map((b, i) =>
                i === 7 ? { pressed: false, value: 0.4 } : b,
            ),
        }
        const f = frameOf(withTrigger, STANDARD_MAP)
        expect([...f.pressed].sort()).toEqual(['a', 'dpad', 'ls'])
        expect(f.analog.ls).toEqual({ x: 0.5, y: -1 })
        expect(f.analog.rt).toBe(0.4)
        expect(f.analog.dpad).toEqual({ x: 1, y: -1 })
    })

    it('keys frames by what is visible', () => {
        const a = frameOf(pad({ axes: [0.001, 0, 0, 0] }), STANDARD_MAP)
        const b = frameOf(pad({ axes: [0.002, 0, 0, 0] }), STANDARD_MAP)
        const c = frameOf(press(pad(), 1), STANDARD_MAP)
        expect(frameKey(a)).toBe(frameKey(b))
        expect(frameKey(a)).not.toBe(frameKey(c))
    })
})

describe('standardProfile', () => {
    const names = (vendor?: number) =>
        new Map(
            standardProfile('Pad', vendor).model.controls.map((c) => [
                c.id,
                c.name,
            ]),
        )

    it('names the buttons the way the maker prints them', () => {
        expect(names().get('a')).toBe('A button')
        expect(names(0x054c).get('a')).toBe('Cross')
        expect(names(0x054c).get('lt')).toBe('L2')
        // Nintendo pads are mapped by position: the bottom button is B.
        expect(names(0x057e).get('a')).toBe('B button')
    })

    it('opens ready, with no back paddles', () => {
        const { model } = standardProfile('Pad')
        expect(model.defaulted).toBeUndefined()
        expect(model.controls.map((c) => c.id)).not.toContain('lp')
        expect(Object.keys(STANDARD_MAP).sort()).toEqual(
            model.controls.map((c) => c.id).sort(),
        )
    })
})

describe('rawGamepadProfile', () => {
    it('reads every drawn input from its raw number', () => {
        const p = rawGamepadProfile('Pad', { buttons: 10, axes: 5 })
        expect(Object.keys(p.map).sort()).toEqual(
            p.model.controls.map((c) => c.id).sort(),
        )
        expect(p.map.stick1).toEqual({ type: 'stick', x: 2, y: 3 })
        expect(p.map.axis4).toEqual({ type: 'axis', index: 4 })
        expect(p.model.hidSummary).toBe('10 buttons · 5 axes')
    })
})

describe('GamepadLiveSource', () => {
    it('emits changed frames only, and stops polling when left', async () => {
        vi.useFakeTimers()
        const { env, pads } = fakeEnv([pad()])
        const source = new GamepadLiveSource(env, pads[0]!, STANDARD_MAP)
        const frames: ControlInputFrame[] = []
        const off = source.subscribe((f) => frames.push(f))
        await vi.advanceTimersByTimeAsync(100)
        expect(frames).toHaveLength(1)
        pads[0] = press(pads[0]!, 3)
        await vi.advanceTimersByTimeAsync(20)
        expect(frames).toHaveLength(2)
        expect(frames[1]!.pressed.has('y')).toBe(true)
        off()
        pads[0] = pad()
        await vi.advanceTimersByTimeAsync(100)
        expect(frames).toHaveLength(2)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ignores another controller in the same slot', async () => {
        vi.useFakeTimers()
        const { env, pads } = fakeEnv([pad()])
        const source = new GamepadLiveSource(env, pads[0]!, STANDARD_MAP)
        pads[0] = pad({ id: 'Something else' })
        const cb = vi.fn()
        const off = source.subscribe(cb)
        await vi.advanceTimersByTimeAsync(100)
        expect(cb).not.toHaveBeenCalled()
        off()
    })
})

describe('listGamepads', () => {
    it('lists connected controllers with a preview and a summary', () => {
        const raw = pad({
            index: 1,
            id: '79-6-Generic USB Joystick',
            mapping: '',
            buttons: Array.from({ length: 12 }, () => ({
                pressed: false,
                value: 0,
            })),
            axes: [0, 0, 0, 0, 0],
        })
        const { env } = fakeEnv([pad(), raw, null, pad({ connected: false })])
        const found = listGamepads(env)
        expect(found.map((d) => d.summary)).toEqual([
            'Standard gamepad',
            '12 buttons · 5 axes',
        ])
        expect(found[1]).toMatchObject({
            id: `gamepad:1:${raw.id}`,
            name: 'Generic USB Joystick',
            usb: '0079:0006',
            form: 'gamepad',
        })
        expect(found[1]!.preview.model.defaulted).toBe(true)
    })

    it("leaves out a Remappr joystick's or dongle's own gamepad", () => {
        const dongle = pad({
            index: 1,
            id: 'Remappr Remappr Dongle (Vendor: 1209 Product: 0002)',
            mapping: '',
        })
        const otherPidCodes = pad({
            index: 2,
            id: 'Open Stick (Vendor: 1209 Product: 2302)',
            mapping: '',
        })
        const { env } = fakeEnv([dongle, otherPidCodes])
        expect(listGamepads(env).map((d) => d.name)).toEqual(['Open Stick'])
    })

    it('is empty without a Gamepad API', () => {
        expect(listGamepads(null)).toEqual([])
    })
})

describe('a connected controller', () => {
    it('is read-only and closes once unplugged', async () => {
        const { env, pads, fire } = fakeEnv([pad()])
        const service = connectGamepad(pads[0]!, env)
        expect(service.kind).toBe('joystick')
        expect(service.capabilities.readOnly).toBe(true)
        expect(service.controls?.setBinding).toBeUndefined()
        expect(service.deviceInfo).toMatchObject({ vid: 0x045e, pid: 0x0b13 })
        const closed = vi.fn()
        service.onClosed(closed)
        fire()
        expect(closed).not.toHaveBeenCalled()
        pads[0] = null
        fire()
        expect(closed).toHaveBeenCalledTimes(1)
    })
})

describe('PointerLiveSource', () => {
    it('reports held buttons, chords and wheel turns', () => {
        const t = fakeTarget()
        const source = new PointerLiveSource(t.target)
        const frames: ControlInputFrame[] = []
        const off = source.subscribe((f) => frames.push(f))
        t.dispatch('pointerdown', { pointerType: 'mouse', buttons: 1 })
        t.dispatch('pointermove', { pointerType: 'mouse', buttons: 3 })
        t.dispatch('pointermove', { pointerType: 'mouse', buttons: 3 })
        t.dispatch('wheel', { deltaY: 120 })
        const last = frames.at(-1)!
        expect([...last.pressed].sort()).toEqual(['lmb', 'rmb'])
        expect(last.analog.wheel).toBe(0.25)
        // first frame on start, then one per change
        expect(frames).toHaveLength(4)
        off()
    })

    it('blocks the menu and history buttons only while listening', () => {
        const t = fakeTarget()
        const off = new PointerLiveSource(t.target).subscribe(() => {})
        expect(t.dispatch('contextmenu').preventDefault).toHaveBeenCalled()
        expect(
            t.dispatch('mouseup', { button: 3 }).preventDefault,
        ).toHaveBeenCalled()
        expect(
            t.dispatch('mouseup', { button: 0 }).preventDefault,
        ).not.toHaveBeenCalled()
        off()
        expect(t.count()).toBe(0)
    })

    it('ignores pen and touch', () => {
        const t = fakeTarget()
        const cb = vi.fn()
        const off = new PointerLiveSource(t.target).subscribe(cb)
        t.dispatch('pointerdown', { pointerType: 'touch', buttons: 1 })
        expect(cb).toHaveBeenCalledTimes(1)
        off()
    })
})

describe('hidMouseDevice', () => {
    it('lists a HID mouse by its USB ids', () => {
        const d = hidMouseDevice({
            name: 'G305',
            vendorId: 0x046d,
            productId: 0xc53f,
            serialNumber: 'ABC',
        })
        expect(d).toMatchObject({
            id: 'mouse:046D:C53F:ABC',
            form: 'mouse',
            usb: '046D:C53F',
            summary: 'Mouse · 046D:C53F',
        })
        expect(d.preview.model.hidSummary).toBe('HID mouse · 046D:C53F')
    })
})

runControlsContractSuite('generic standard gamepad', {
    makeService: () => connectGamepad(pad(), fakeEnv([pad()]).env),
})

runControlsContractSuite('generic raw gamepad', {
    makeService: () => {
        const raw = pad({ mapping: '', axes: [0, 0, 0, 0, 0, 0, 0] })
        return connectGamepad(raw, fakeEnv([raw]).env)
    },
})

runControlsContractSuite('generic HID mouse', {
    makeService: () =>
        connectHidMouse(
            { name: 'Mouse', vendorId: 1, productId: 2 },
            fakeTarget().target,
        ),
})
