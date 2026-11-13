// pattern-check: skip — pure data: the stock control layouts of each device
// form, in key units.
//
// Reference geometry for the device forms. Demo devices use them whole; a
// device that reports no layout gets a subset (see defaultLayout). Coordinates
// are the control's top-left corner in key units; `r` rotates about the
// control's own centre.
import type {
    ControlKind,
    ControlShape,
    DeviceControl,
    DeviceShell,
} from './types'

type Extra = Partial<Omit<DeviceControl, 'id' | 'name' | 'kind' | 'shape'>>

/** Build one control. Arguments follow the visual order: what it is, then where. */
export function control(
    id: string,
    name: string,
    kind: ControlKind,
    shape: ControlShape,
    box: readonly [x: number, y: number, w: number, h: number],
    extra: Extra = {},
): DeviceControl {
    const [x, y, w, h] = box
    return { id, name, kind, shape, x, y, w, h, ...extra }
}

export interface StockLayout {
    readonly shell: DeviceShell
    readonly controls: readonly DeviceControl[]
}

export const STOCK_MOUSE: StockLayout = {
    shell: { type: 'mouse', pad: 0.2, tail: 1.6 },
    controls: [
        control('lmb', 'Left button', 'button', 'mouseL', [0, 0, 2.6, 4.1], {
            glyph: 'L',
        }),
        control(
            'rmb',
            'Right button',
            'button',
            'mouseR',
            [2.75, 0, 2.6, 4.1],
            { glyph: 'R' },
        ),
        control(
            'wheel',
            'Scroll wheel',
            'wheel',
            'wheel',
            [2.3, 0.7, 0.75, 1.9],
            { label: 'R' },
        ),
        control(
            'dpi',
            'DPI button',
            'button',
            'pill',
            [2.43, 2.95, 0.5, 0.75],
            { label: 'R' },
        ),
        control(
            'fwd',
            'Side · front',
            'button',
            'pill',
            [-0.5, 4.5, 0.5, 1.35],
            { edge: true },
        ),
        control(
            'back',
            'Side · rear',
            'button',
            'pill',
            [-0.5, 6.0, 0.5, 1.35],
            { edge: true },
        ),
        control(
            'sensor',
            'Sensor',
            'sensor',
            'sensor',
            [1.975, 7.6, 1.4, 1.4],
            { label: 'R' },
        ),
    ],
}

export const STOCK_GAMEPAD: StockLayout = {
    shell: { type: 'gamepad', pad: 1.0, gripW: 3.75, gripAngle: 16 },
    controls: [
        control(
            'lt',
            'Left trigger',
            'trigger',
            'trigger',
            [0.7, 0, 2.5, 0.75],
            { glyph: 'LT', zone: 'top' },
        ),
        control(
            'lb',
            'Left bumper',
            'button',
            'pill',
            [0.55, 0.9, 2.95, 0.55],
            { glyph: 'LB', zone: 'top' },
        ),
        control(
            'rt',
            'Right trigger',
            'trigger',
            'trigger',
            [7.3, 0, 2.5, 0.75],
            { glyph: 'RT', zone: 'top' },
        ),
        control(
            'rb',
            'Right bumper',
            'button',
            'pill',
            [7.0, 0.9, 2.95, 0.55],
            { glyph: 'RB', zone: 'top' },
        ),
        control('ls', 'Left stick', 'stick', 'stick', [1.15, 2.33, 1.7, 1.7], {
            glyph: 'L3',
        }),
        control('dpad', 'D-pad', 'hat', 'dpad', [2.73, 4.15, 1.8, 1.8]),
        control('view', 'View', 'button', 'pill', [4.0, 2.5, 0.75, 0.38]),
        control('home', 'Guide', 'button', 'round', [4.88, 3.45, 0.75, 0.75], {
            label: 'L',
        }),
        control('menu', 'Menu', 'button', 'pill', [5.75, 2.5, 0.75, 0.38]),
        control('y', 'Y button', 'button', 'round', [8.13, 1.98, 0.75, 0.75], {
            glyph: 'Y',
        }),
        control('x', 'X button', 'button', 'round', [7.33, 2.78, 0.75, 0.75], {
            glyph: 'X',
        }),
        control('b', 'B button', 'button', 'round', [8.93, 2.78, 0.75, 0.75], {
            glyph: 'B',
        }),
        control('a', 'A button', 'button', 'round', [8.13, 3.58, 0.75, 0.75], {
            glyph: 'A',
        }),
        control('rs', 'Right stick', 'stick', 'stick', [6.03, 4.2, 1.7, 1.7], {
            glyph: 'R3',
        }),
        control(
            'lp',
            'Back paddle L',
            'button',
            'pill',
            [1.5, 7.55, 1.15, 0.55],
            { glyph: 'P1', edge: true, back: true },
        ),
        control(
            'rp',
            'Back paddle R',
            'button',
            'pill',
            [7.85, 7.55, 1.15, 0.55],
            { glyph: 'P2', edge: true, back: true },
        ),
    ],
}

export const STOCK_FLIGHTSTICK: StockLayout = {
    shell: { type: 'flightstick', pad: 0.55, basePad: 0.8, shaftW: 0.95 },
    controls: [
        control('hat', 'Hat switch', 'hat', 'hat', [2.8, 0.75, 1.15, 1.15], {
            zone: 'head',
        }),
        control('fire2', 'Fire 2', 'button', 'round', [4.4, 0.9, 0.75, 0.75], {
            glyph: '2',
            zone: 'head',
        }),
        control(
            'trig',
            'Trigger',
            'button',
            'triggerSide',
            [1.95, 1.95, 0.6, 1.5],
            { zone: 'head', edge: true },
        ),
        control(
            'thumb',
            'Thumb button',
            'button',
            'pill',
            [4.95, 2.2, 0.55, 1.0],
            { glyph: '3', zone: 'head' },
        ),
        control(
            'pinky',
            'Pinky lever',
            'button',
            'pill',
            [2.7, 4.6, 1.1, 0.45],
            { zone: 'head' },
        ),
        control('twist', 'Twist (Z)', 'axis', 'ring', [2.7, 5.5, 2.6, 0.55], {
            zone: 'shaft',
            label: 'R',
        }),
        control('xy', 'Stick X / Y', 'stick', 'ring', [2.4, 7.15, 3.2, 0.8], {
            zone: 'shaft',
            label: 'R',
        }),
        control('b5', 'Base 5', 'button', 'round', [1.0, 10.35, 0.7, 0.7], {
            glyph: '5',
            zone: 'base',
        }),
        control('b6', 'Base 6', 'button', 'round', [1.95, 10.35, 0.7, 0.7], {
            glyph: '6',
            zone: 'base',
        }),
        control('b7', 'Base 7', 'button', 'round', [2.9, 10.35, 0.7, 0.7], {
            glyph: '7',
            zone: 'base',
        }),
        control(
            'thr',
            'Throttle wheel',
            'axis',
            'wheel',
            [5.75, 10.2, 1.45, 0.95],
            { zone: 'base' },
        ),
    ],
}

/** The shell zones a control can sit on, per shell type. */
export const SHELL_ZONES: Readonly<
    Record<DeviceShell['type'], readonly string[]>
> = {
    mouse: ['body'],
    gamepad: ['body', 'top'],
    flightstick: ['head', 'shaft', 'base'],
    plate: ['body', 'left', 'right'],
}

/** Shape and size of a control added by hand, per kind. */
export const NEW_CONTROL: Readonly<
    Record<ControlKind, { shape: ControlShape; w: number; h: number }>
> = {
    button: { shape: 'round', w: 0.75, h: 0.75 },
    wheel: { shape: 'wheel', w: 0.75, h: 1.6 },
    stick: { shape: 'stick', w: 1.7, h: 1.7 },
    trigger: { shape: 'trigger', w: 2.2, h: 0.7 },
    hat: { shape: 'hat', w: 1.15, h: 1.15 },
    sensor: { shape: 'sensor', w: 1.4, h: 1.4 },
    encoder: { shape: 'knob', w: 1.4, h: 1.4 },
    axis: { shape: 'wheel', w: 1.4, h: 0.9 },
}

/** The controls of `layout` whose id is in `ids`, in `ids` order. */
export function pickControls(
    layout: StockLayout,
    ids: readonly string[],
): DeviceControl[] {
    const byId = new Map(layout.controls.map((c) => [c.id, c]))
    return ids.flatMap((id) => {
        const c = byId.get(id)
        return c ? [c] : []
    })
}
