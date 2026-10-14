// pattern-check: skip — unit tests for the device-controls helpers.
import { describe, expect, it } from 'vitest'
import { bindingOf, defaultBinding } from './defaults'
import { defaultLayout, formatHidSummary } from './defaultLayout'
import { fromPhysicalLayout } from './fromPhysicalLayout'
import { STOCK_GAMEPAD } from './stockLayouts'
import type { ControlsCatalog, SensorBinding } from './types'

const CATALOG: ControlsCatalog = {
    groups: [],
    actions: [],
    outputs: {
        stick: [{ id: 'ls', label: 'Left stick' }],
        trigger: [{ id: 'lt', label: 'LT analog' }],
    },
    fields: {},
    sensor: {
        dpiMin: 400,
        dpiMax: 3200,
        dpiStep: 100,
        maxStages: 3,
        pollRates: [125, 500, 1000],
        lods: [{ id: 'low', label: 'Low' }],
    },
}

const ids = (m: { controls: readonly { id: string }[] }) =>
    m.controls.map((c) => c.id)

describe('formatHidSummary', () => {
    it('reads like the device reported it', () => {
        expect(formatHidSummary({ buttons: 12, axes: 6, hats: 1 })).toBe(
            '12 buttons · 6 axes · 1 hat',
        )
        expect(formatHidSummary({ buttons: 5, wheel: true })).toBe(
            '5 buttons · wheel',
        )
        expect(formatHidSummary({ rows: 4, cols: 12 })).toBe('Matrix 4 × 12')
        expect(formatHidSummary({ axes: 1 })).toBe('1 axis')
    })
})

describe('defaultLayout', () => {
    it('marks the model defaulted and maps form to personality', () => {
        const m = defaultLayout('gamepad', 'Generic pad', {
            buttons: 12,
            axes: 6,
            hats: 1,
        })
        expect(m).toMatchObject({
            kind: 'joystick',
            form: 'gamepad',
            defaulted: true,
            hidSummary: '12 buttons · 6 axes · 1 hat',
        })
        expect(m.shell).toEqual(STOCK_GAMEPAD.shell)
        expect(ids(m)).toHaveLength(14)
        expect(ids(m)).not.toContain('lp')
    })

    it('builds a five-button mouse with a wheel by default', () => {
        const m = defaultLayout('mouse', 'Mouse')
        expect(m.kind).toBe('mouse')
        expect(ids(m)).toEqual(['lmb', 'rmb', 'wheel', 'back', 'fwd'])
    })

    it('adds extra buttons and the sensor an 8-button mouse reports', () => {
        const m = defaultLayout('mouse', 'Mouse', {
            buttons: 8,
            wheel: true,
            sensor: true,
        })
        expect(ids(m)).toEqual([
            'lmb',
            'rmb',
            'wheel',
            'back',
            'fwd',
            'btn5',
            'btn6',
            'btn7',
            'sensor',
        ])
    })

    it('gives a wheel-less mouse its own middle button', () => {
        const m = defaultLayout('mouse', 'Mouse', { buttons: 3, wheel: false })
        expect(ids(m)).toEqual(['lmb', 'rmb', 'mid'])
    })

    it('lays a keyboard out as a grid of the reported matrix', () => {
        const m = defaultLayout('keyboard', 'VIA board', { rows: 2, cols: 3 })
        expect(m.kind).toBe('keyboard')
        expect(ids(m)).toEqual(['k0_0', 'k0_1', 'k0_2', 'k1_0', 'k1_1', 'k1_2'])
        expect(m.controls[4]).toMatchObject({ x: 1.1, y: 1.1, w: 1, h: 1 })
    })

    it('maps a flight stick to the joystick personality', () => {
        expect(defaultLayout('flightstick', 'Stick').kind).toBe('joystick')
    })
})

describe('defaultBinding', () => {
    it('starts actions disabled and outputs on the first catalog entry', () => {
        expect(defaultBinding('button', CATALOG)).toEqual({ a: null })
        expect(defaultBinding('stick', CATALOG)).toMatchObject({
            out: 'ls',
            click: null,
        })
        expect(defaultBinding('trigger', CATALOG).out).toBe('lt')
        expect(defaultBinding('axis', CATALOG).out).toBe('')
    })

    it('fits sensor stages to the reported DPI range and stage count', () => {
        const s: SensorBinding = defaultBinding('sensor', CATALOG)
        expect(s.stages).toEqual([400, 800, 1600])
        expect(s.active).toBe(1)
        expect(s.poll).toBe(1000)
        expect(s.lod).toBe('low')
    })

    it('falls back to the kind default for an unbound control', () => {
        const m = defaultLayout('mouse', 'Mouse')
        const wheel = m.controls.find((c) => c.id === 'wheel')!
        expect(bindingOf(wheel, {}, CATALOG)).toMatchObject({ lines: 3 })
        const bound = {
            wheel: { ...defaultBinding('wheel', CATALOG), lines: 7 },
        }
        expect(bindingOf(wheel, bound, CATALOG)).toMatchObject({ lines: 7 })
    })
})

describe('fromPhysicalLayout', () => {
    it('converts centi-units to key units and encoders to knobs', () => {
        const m = fromPhysicalLayout(
            {
                id: 0,
                name: 'Pad',
                keys: [{ x: 0, y: 150, w: 100, h: 100 }],
                encoders: [{ x: 10, y: 0 }],
            },
            { name: 'Deck', form: 'macropad' },
        )
        expect(m).toMatchObject({ kind: 'keyboard', form: 'macropad' })
        expect(m.controls).toEqual([
            expect.objectContaining({ id: 'e0', kind: 'encoder', x: 0.1 }),
            expect.objectContaining({ id: 'k0', shape: 'key', y: 1.5, w: 1 }),
        ])
    })

    it('re-expresses pivot rotation as rotation about the key centre', () => {
        // 1U key at (2,0) rotated 90° about (1,0): its centre (2.5, 0.5)
        // lands at (0.5, 1.5).
        const m = fromPhysicalLayout(
            {
                id: 0,
                name: 'Rot',
                keys: [{ x: 200, y: 0, w: 100, h: 100, r: 9000, rx: 100 }],
            },
            { name: 'Rot' },
        )
        expect(m.controls[0]).toMatchObject({ x: 0, y: 1, r: 90 })
    })

    it('rotates about the key top-left when no pivot is given', () => {
        const m = fromPhysicalLayout(
            {
                id: 0,
                name: 'R',
                keys: [{ x: 0, y: 0, w: 100, h: 100, r: 18000 }],
            },
            { name: 'R' },
        )
        expect(m.controls[0]).toMatchObject({ x: -1, y: -1, r: 180 })
    })
})
