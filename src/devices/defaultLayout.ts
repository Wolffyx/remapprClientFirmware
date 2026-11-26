// Pattern check: Dispatch Map (Tier 0) — applied — one layout builder per device
// form, keyed by form; adding a form adds an entry, not a branch.
//
// A layout for a device that reports its inputs but not where they are (a
// generic HID mouse, a DInput gamepad, a VIA board with no layout). Built per
// form from what the device DID report; positions are a sensible generic
// arrangement that a layout from the Builder can replace later.
import {
    control,
    pickControls,
    STOCK_FLIGHTSTICK,
    STOCK_GAMEPAD,
    STOCK_MOUSE,
    type StockLayout,
} from './stockLayouts'
import type {
    ControlShape,
    DeviceControl,
    DeviceForm,
    DeviceKind,
    DeviceModel,
    DeviceShell,
} from './types'

/** What a device reported about its inputs (HID descriptor, matrix size …). */
export interface HidCounts {
    readonly buttons?: number
    readonly axes?: number
    readonly hats?: number
    readonly wheel?: boolean
    /** Has a motion sensor whose DPI the device exposes. */
    readonly sensor?: boolean
    readonly rows?: number
    readonly cols?: number
}

/** The personality each form belongs to. */
export const FORM_KIND: Readonly<Record<DeviceForm, DeviceKind>> = {
    keyboard: 'keyboard',
    macropad: 'keyboard',
    mouse: 'mouse',
    gamepad: 'joystick',
    flightstick: 'joystick',
}

const plural = (n: number, one: string, many: string): string =>
    `${n} ${n === 1 ? one : many}`

/** "12 buttons · 6 axes · 1 hat", "5 buttons · wheel", "Matrix 4 × 12". */
export function formatHidSummary(counts: HidCounts): string {
    const parts: string[] = []
    if (counts.rows && counts.cols)
        parts.push(`Matrix ${counts.rows} × ${counts.cols}`)
    if (counts.buttons) parts.push(plural(counts.buttons, 'button', 'buttons'))
    if (counts.wheel) parts.push('wheel')
    if (counts.axes) parts.push(plural(counts.axes, 'axis', 'axes'))
    if (counts.hats) parts.push(plural(counts.hats, 'hat', 'hats'))
    return parts.join(' · ')
}

type Built = { shell: DeviceShell; controls: DeviceControl[] }

/** Pills down the mouse's centre line for buttons beyond the stock five. */
function extraMouseButtons(
    first: number,
    count: number,
    top: number,
): DeviceControl[] {
    return Array.from({ length: count }, (_, i) =>
        control(
            `btn${first + i}`,
            `Button ${first + i + 1}`,
            'button',
            'pill',
            [2.43, top + i * 0.95, 0.5, 0.75],
            { label: 'R' },
        ),
    )
}

function mouseLayout(counts: HidCounts): Built {
    const buttons = counts.buttons ?? 5
    const wheel = counts.wheel ?? true
    const ids = [
        'lmb',
        'rmb',
        ...(wheel ? ['wheel'] : []),
        ...(buttons >= 4 ? ['back'] : []),
        ...(buttons >= 5 ? ['fwd'] : []),
    ]
    const controls = pickControls(
        STOCK_MOUSE,
        buttons >= 2 ? ids : ['lmb', ...ids.slice(2)],
    )
    // Without a wheel the third button is its own control; with one it is the wheel click.
    const middle =
        !wheel && buttons >= 3
            ? [
                  control(
                      'mid',
                      'Middle button',
                      'button',
                      'pill',
                      [2.43, 0.9, 0.5, 1.2],
                      { label: 'R' },
                  ),
              ]
            : []
    const extras = extraMouseButtons(5, Math.max(0, buttons - 5), 2.95)
    const sensor = counts.sensor ? pickControls(STOCK_MOUSE, ['sensor']) : []
    return {
        shell: STOCK_MOUSE.shell,
        controls: [...controls, ...middle, ...extras, ...sensor],
    }
}

const fromStock = (layout: StockLayout, ids: readonly string[]): Built => ({
    shell: layout.shell,
    controls: pickControls(layout, ids),
})

const GAMEPAD_IDS = [
    'lt',
    'lb',
    'rt',
    'rb',
    'ls',
    'rs',
    'dpad',
    'view',
    'menu',
    'home',
    'y',
    'x',
    'b',
    'a',
] as const
const FLIGHTSTICK_IDS = [
    'hat',
    'fire2',
    'trig',
    'thumb',
    'xy',
    'twist',
    'b5',
    'b6',
    'b7',
] as const

type Box = readonly [x: number, y: number, w: number, h: number]

/** How the raw axes of a controller with no known mapping are drawn: the
 *  first two pairs as sticks, every other axis on its own. */
export function splitGamepadAxes(axes: number): {
    sticks: (readonly [x: number, y: number])[]
    singles: number[]
} {
    const pairs = Math.min(2, Math.floor(axes / 2))
    const sticks = Array.from(
        { length: pairs },
        (_, k) => [2 * k, 2 * k + 1] as const,
    )
    const singles = Array.from(
        { length: axes - 2 * pairs },
        (_, i) => 2 * pairs + i,
    )
    return { sticks, singles }
}

const STICK_SEATS: readonly Box[] = [
    [1.15, 2.33, 1.7, 1.7],
    [6.03, 4.2, 1.7, 1.7],
]
/** The first two single axes sit where the triggers are. */
const AXIS_SEATS: readonly Box[] = [
    [0.7, 0, 2.5, 0.75],
    [7.3, 0, 2.5, 0.75],
]
/** Seats for numbered buttons in index order: the face diamond (bottom, right,
 *  left, top — how most pads number them), the bumpers, the centre cluster. */
const BUTTON_SEATS: readonly { shape: ControlShape; box: Box; top?: true }[] = [
    { shape: 'round', box: [8.13, 3.58, 0.75, 0.75] },
    { shape: 'round', box: [8.93, 2.78, 0.75, 0.75] },
    { shape: 'round', box: [7.33, 2.78, 0.75, 0.75] },
    { shape: 'round', box: [8.13, 1.98, 0.75, 0.75] },
    { shape: 'pill', box: [0.55, 0.9, 2.95, 0.55], top: true },
    { shape: 'pill', box: [7.0, 0.9, 2.95, 0.55], top: true },
    { shape: 'pill', box: [4.0, 2.5, 0.75, 0.38] },
    { shape: 'pill', box: [5.75, 2.5, 0.75, 0.38] },
    { shape: 'round', box: [4.88, 3.45, 0.75, 0.75] },
]
/** Buttons past the seats line up in rows under the body. */
const ROW = { x: 2.4, y: 6.4, step: 0.85, perRow: 6, size: 0.7 } as const
const HAT_BOX: Box = [2.73, 4.15, 1.8, 1.8]

function rawButtons(count: number): DeviceControl[] {
    return Array.from({ length: count }, (_, i) => {
        const seat = BUTTON_SEATS[i]
        const j = i - BUTTON_SEATS.length
        const box: Box = seat
            ? seat.box
            : [
                  ROW.x + (j % ROW.perRow) * ROW.step,
                  ROW.y + Math.floor(j / ROW.perRow) * ROW.step,
                  ROW.size,
                  ROW.size,
              ]
        return control(
            `btn${i}`,
            `Button ${i + 1}`,
            'button',
            seat?.shape ?? 'round',
            box,
            { glyph: String(i + 1), ...(seat?.top ? { zone: 'top' } : {}) },
        )
    })
}

/** Single axes and extra hats, stacked under the button rows from `top`. */
function rawExtras(
    singles: readonly number[],
    hats: number,
    top: number,
): DeviceControl[] {
    const axes = singles.map((a, i) => {
        const seat = AXIS_SEATS[i]
        const box: Box = seat ?? [
            3.0,
            top + (i - AXIS_SEATS.length) * 0.65,
            3.0,
            0.45,
        ]
        return control(
            `axis${a}`,
            `Axis ${a + 1}`,
            'axis',
            seat ? 'trigger' : 'ring',
            box,
            { glyph: `A${a + 1}`, ...(seat ? { zone: 'top' } : {}) },
        )
    })
    const below = top + Math.max(0, singles.length - AXIS_SEATS.length) * 0.65
    const hatList = Array.from({ length: hats }, (_, h) =>
        control(
            `hat${h}`,
            hats > 1 ? `Hat ${h + 1}` : 'Hat',
            'hat',
            'dpad',
            h === 0 ? HAT_BOX : [3.0 + (h - 1) * 1.4, below, 1.15, 1.15],
        ),
    )
    return [...axes, ...hatList]
}

/** A controller whose mapping is unknown: every reported button, axis and hat
 *  under its raw number, seated on the gamepad body. */
function rawGamepadLayout(counts: HidCounts): Built {
    const buttons = counts.buttons ?? 0
    const { sticks, singles } = splitGamepadAxes(counts.axes ?? 0)
    const drawnSticks = sticks.map(([x], k) =>
        control(
            `stick${k}`,
            `Stick ${k + 1}`,
            'stick',
            'stick',
            STICK_SEATS[k]!,
            {
                glyph: `A${x + 1}`,
            },
        ),
    )
    const extraRows = Math.ceil(
        Math.max(0, buttons - BUTTON_SEATS.length) / ROW.perRow,
    )
    const top = ROW.y + extraRows * ROW.step + 0.2
    return {
        shell: STOCK_GAMEPAD.shell,
        controls: [
            ...rawButtons(buttons),
            ...drawnSticks,
            ...rawExtras(singles, counts.hats ?? 0, top),
        ],
    }
}

/** Without any counts, the stock pad; with them, the raw controls. */
function gamepadLayout(counts: HidCounts): Built {
    if (counts.buttons === undefined && counts.axes === undefined)
        return fromStock(STOCK_GAMEPAD, GAMEPAD_IDS)
    return rawGamepadLayout(counts)
}

/** A plain ortholinear grid sized from the reported matrix. */
function gridLayout(rows: number, cols: number): Built {
    const controls: DeviceControl[] = []
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            controls.push(
                control(`k${r}_${c}`, `R${r + 1} C${c + 1}`, 'button', 'key', [
                    c * 1.1,
                    r * 1.1,
                    1,
                    1,
                ]),
            )
        }
    }
    return { shell: { type: 'plate', pad: 0.3 }, controls }
}

const BUILDERS: Readonly<Record<DeviceForm, (counts: HidCounts) => Built>> = {
    mouse: mouseLayout,
    gamepad: gamepadLayout,
    flightstick: () => fromStock(STOCK_FLIGHTSTICK, FLIGHTSTICK_IDS),
    keyboard: (c) => gridLayout(c.rows ?? 4, c.cols ?? 12),
    macropad: (c) => gridLayout(c.rows ?? 3, c.cols ?? 3),
}

/** The generic layout of a `form` device that reported `counts` but no layout. */
export function defaultLayout(
    form: DeviceForm,
    name: string,
    counts: HidCounts = {},
): DeviceModel {
    const { shell, controls } = BUILDERS[form](counts)
    const hidSummary = formatHidSummary(counts)
    return {
        kind: FORM_KIND[form],
        form,
        name,
        shell,
        controls,
        defaulted: true,
        ...(hidSummary ? { hidSummary } : {}),
    }
}
