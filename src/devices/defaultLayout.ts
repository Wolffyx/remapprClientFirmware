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
    gamepad: () => fromStock(STOCK_GAMEPAD, GAMEPAD_IDS),
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
