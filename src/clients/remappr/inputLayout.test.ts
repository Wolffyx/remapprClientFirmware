// pattern-check: skip — GET_INPUT_LAYOUT fixtures against a fake rpc + model mapping assertions.
import { describe, expect, it } from 'vitest'

import {
    fetchInputLayout,
    inputLayoutModel,
    readInputLayout,
    servesInputLayout,
    type InputLayout,
} from './inputLayout'
import { mouseInputNaming, mouseModel } from './mouseControls'
import {
    INPUT_NONE,
    InputClass,
    InputForm,
    InputShape,
    InputVerb,
    Namespace,
    Status,
    type InputLayoutEntry,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

const entry = (e: Partial<InputLayoutEntry>): InputLayoutEntry => ({
    cls: InputClass.BUTTON,
    shape: InputShape.AUTO,
    inputId: 0x0100,
    position: INPUT_NONE,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rot: 0,
    rotx: 50,
    roty: 50,
    ...e,
})

/** The nRF52840 DK mouse's remappr,input-layout node, as it comes off the wire. */
const DK_MOUSE: InputLayout = {
    form: InputForm.MOUSE,
    entries: [
        entry({
            shape: InputShape.MOUSE_LEFT,
            inputId: 0x0100,
            position: 0,
            w: 260,
            h: 410,
        }),
        entry({
            shape: InputShape.MOUSE_RIGHT,
            inputId: 0x0101,
            position: 1,
            x: 275,
            w: 260,
            h: 410,
        }),
        entry({
            cls: InputClass.WHEEL,
            shape: InputShape.WHEEL,
            inputId: 0x0300,
            position: 2,
            x: 230,
            y: 70,
            w: 75,
            h: 190,
        }),
        entry({
            shape: InputShape.PILL,
            inputId: 0x0102,
            position: 3,
            x: 243,
            y: 295,
            w: 50,
            h: 75,
        }),
        entry({
            cls: InputClass.SENSOR,
            shape: InputShape.SENSOR,
            inputId: 0x0400,
            x: 198,
            y: 760,
            w: 140,
            h: 140,
        }),
    ],
}

/** Serialise entries as GET_INPUT_LAYOUT pages of `per` entries. */
function pages(layout: InputLayout, per: number): Uint8Array[] {
    const out: Uint8Array[] = []
    const total = layout.entries.length
    for (let start = 0; start <= total; start += per) {
        const slice = layout.entries.slice(start, start + per)
        const d = new Uint8Array(7 + slice.length * 20)
        const dv = new DataView(d.buffer)
        d[0] = 1
        d[1] = layout.form
        dv.setUint16(2, total, true)
        dv.setUint16(4, start, true)
        d[6] = slice.length
        slice.forEach((e, i) => {
            const o = 7 + i * 20
            d[o] = e.cls
            d[o + 1] = e.shape
            dv.setUint16(o + 2, e.inputId, true)
            dv.setUint16(o + 4, e.position, true)
            dv.setUint16(o + 6, e.x, true)
            dv.setUint16(o + 8, e.y, true)
            dv.setUint16(o + 10, e.w, true)
            dv.setUint16(o + 12, e.h, true)
            dv.setInt16(o + 14, e.rot, true)
            dv.setUint16(o + 16, e.rotx, true)
            dv.setUint16(o + 18, e.roty, true)
        })
        out.push(d)
        if (start + per >= total) break
    }
    return out
}

function fakeRpc(
    handler: (
        ns: number,
        verb: number,
        arg?: Uint8Array,
        opts?: { targetNode?: number },
    ) => Promise<UniversalReply>,
): RemapprRpc {
    return { callUniversalPlain: handler } as unknown as RemapprRpc
}

describe('fetchInputLayout', () => {
    it('reads every page, asking from where the last one ended', async () => {
        const replies = pages(DK_MOUSE, 2)
        const starts: number[] = []
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.INPUT)
            expect(verb).toBe(InputVerb.GET_INPUT_LAYOUT)
            const start = arg![0]! | (arg![1]! << 8)
            starts.push(start)
            return { status: Status.OK, data: replies[start / 2]! }
        })
        const layout = await fetchInputLayout(rpc)
        expect(starts).toEqual([0, 2, 4])
        expect(layout).toEqual(DK_MOUSE)
    })

    it('re-reads a relayed page that lost a fragment', async () => {
        const [whole] = pages(DK_MOUSE, 5)
        let calls = 0
        const rpc = fakeRpc(async (_ns, _verb, _arg, opts) => {
            expect(opts?.targetNode).toBe(7)
            calls++
            return {
                status: Status.OK,
                data: calls === 1 ? whole!.slice(0, 40) : whole!,
            }
        })
        expect((await fetchInputLayout(rpc, 7)).entries).toHaveLength(5)
        expect(calls).toBe(2)
    })

    it('throws when the device refuses the verb', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(fetchInputLayout(rpc)).rejects.toThrow(/GET_INPUT_LAYOUT/)
    })
})

describe('readInputLayout', () => {
    const listed = [
        { namespace: Namespace.COMMON },
        { namespace: Namespace.INPUT },
    ]

    it('asks only a device that lists the INPUT namespace', async () => {
        const rpc = fakeRpc(async () => {
            throw new Error('not asked')
        })
        expect(servesInputLayout(undefined)).toBe(false)
        expect(servesInputLayout([{ namespace: Namespace.MOUSE }])).toBe(false)
        expect(
            await readInputLayout(rpc, [{ namespace: Namespace.MOUSE }]),
        ).toBeUndefined()
    })

    it('falls back to no layout when the read fails', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_ARG,
            data: new Uint8Array(),
        }))
        expect(servesInputLayout(listed)).toBe(true)
        expect(await readInputLayout(rpc, listed)).toBeUndefined()
    })
})

describe('inputLayoutModel', () => {
    it('places controls in key units with their class kind and shape', () => {
        const m = inputLayoutModel(DK_MOUSE, {
            name: 'DK',
            fallbackForm: 'gamepad',
        })
        expect(m).toMatchObject({ kind: 'mouse', form: 'mouse', name: 'DK' })
        expect(m.defaulted).toBeUndefined()
        expect(m.shell.type).toBe('mouse')
        expect(m.controls[1]).toMatchObject({
            id: 'in:257',
            name: 'Button 2',
            kind: 'button',
            shape: 'mouseR',
            x: 2.75,
            y: 0,
            w: 2.6,
            h: 4.1,
        })
        expect(m.controls[2]).toMatchObject({
            id: 'in:768',
            name: 'Wheel',
            kind: 'wheel',
        })
        expect(m.controls[4]).toMatchObject({ kind: 'sensor', shape: 'sensor' })
    })

    it('uses the class shape when the device leaves it to the class', () => {
        const m = inputLayoutModel(
            {
                form: InputForm.GAMEPAD,
                entries: [entry({ cls: InputClass.STICK, inputId: 0x0500 })],
            },
            { name: 'Pad', fallbackForm: 'mouse' },
        )
        expect(m).toMatchObject({ kind: 'joystick', form: 'gamepad' })
        expect(m.controls[0]).toMatchObject({
            kind: 'stick',
            shape: 'stick',
            name: 'Stick',
        })
    })

    it('takes the form from the personality when the device sends 0', () => {
        const m = inputLayoutModel(
            { form: InputForm.PERSONALITY, entries: [entry({})] },
            { name: 'x', fallbackForm: 'flightstick' },
        )
        expect(m.form).toBe('flightstick')
    })

    it('turns a control about its pivot as a turn about its own centre', () => {
        // A 1u square at the origin, 90° clockwise about its top-left corner:
        // its centre (0.5, 0.5) lands at (-0.5, 0.5).
        const m = inputLayoutModel(
            {
                form: InputForm.KEYBOARD,
                entries: [entry({ rot: 9000, rotx: 0, roty: 0 })],
            },
            { name: 'k', fallbackForm: 'keyboard' },
        )
        expect(m.controls[0]).toMatchObject({ x: -1, y: 0, w: 1, h: 1, r: 90 })
    })

    it('skips classes it does not know and ids past the 256th by position', () => {
        const m = inputLayoutModel(
            {
                form: InputForm.MACROPAD,
                entries: [
                    entry({ cls: 42 }),
                    entry({
                        cls: InputClass.KEY,
                        inputId: INPUT_NONE,
                        position: 300,
                    }),
                    entry({ cls: InputClass.KEY, inputId: INPUT_NONE }),
                ],
            },
            { name: 'm', fallbackForm: 'keyboard' },
        )
        expect(m.controls.map((c) => c.id)).toEqual(['pos:300', 'idx:1'])
        expect(m.controls.map((c) => c.name)).toEqual(['Key 1', 'Key 2'])
        expect(m.controls[0]!.shape).toBe('key')
    })
})

describe('the Remappr mouse from its own layout', () => {
    it('keeps the ids its bindings use', () => {
        const m = mouseModel('DK', undefined, DK_MOUSE)
        expect(m.defaulted).toBeUndefined()
        expect(m.controls.map((c) => c.id)).toEqual([
            'lmb',
            'rmb',
            'wheel',
            'back',
            'sensor',
        ])
        expect(m.controls[0]).toMatchObject({ name: 'Left button', glyph: 'L' })
        expect(m.controls[3]).toMatchObject({
            name: 'Back button',
            shape: 'pill',
            x: 2.43,
        })
    })

    it('gives a bare middle button and a second wheel generic ids', () => {
        expect(mouseInputNaming(entry({ position: 2 }))).toBeUndefined()
        const m = mouseModel('two wheels', undefined, {
            form: InputForm.MOUSE,
            entries: [
                entry({ cls: InputClass.WHEEL, inputId: 0x0300 }),
                entry({ cls: InputClass.WHEEL, inputId: 0x0301 }),
            ],
        })
        expect(m.controls.map((c) => c.id)).toEqual(['wheel', 'in:769'])
    })

    it('is the generic mouse without a layout', () => {
        expect(mouseModel('Generic').defaulted).toBe(true)
        expect(
            mouseModel('Empty', undefined, { form: 3, entries: [] }).defaulted,
        ).toBe(true)
    })
})
