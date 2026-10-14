// Pattern check: Adapter (Tier 1) — applied — translates the Remappr mouse's device document (TBL_MOUSE button map, CPI) and live MOUSE / rate state into the neutral device-controls model, and edits back.
//
// What the Remappr mouse firmware lets the app change, as controls:
// - eight HID buttons, each re-mappable to report as another button or
//   nothing (TBL_MOUSE `button_map`); button 3 (Middle) is the wheel click;
// - the sensor resolution (TBL_MOUSE `cpi`), one stage — the firmware has no
//   DPI stages;
// - the report rate, only when the firmware answers GET_RATE_LIMITS.
// Positions are not reported by the firmware, so the layout is the generic
// mouse layout.
import type { ConfigDevice } from '../../config/device'
import type { ConfigMouse } from '../../config/types'
import { MOUSE_BUTTON_NAMES } from '../../config/deviceFields'
import { defaultLayout } from '../../devices/defaultLayout'
import type {
    ButtonBinding,
    ControlBinding,
    ControlsCatalog,
    DeviceBindings,
    DeviceModel,
    SensorBinding,
    WheelBinding,
} from '../../devices/types'
import {
    HwCap,
    reportsHwCap,
    type MotionConfig,
    type RateLimits,
} from './protocol'

/** Control id → HID button index (bit of the button report). */
export const BUTTON_INDEX: Readonly<Record<string, number>> = {
    lmb: 0,
    rmb: 1,
    wheel: 2,
    back: 3,
    fwd: 4,
    btn5: 5,
    btn6: 6,
    btn7: 7,
}

const ACTION_PREFIX = 'btn:'
const actionOf = (i: number | null | undefined): string | null =>
    i == null ? null : `${ACTION_PREFIX}${i}`
const indexOf = (a: string | null | undefined): number | null =>
    a?.startsWith(ACTION_PREFIX) ? Number(a.slice(ACTION_PREFIX.length)) : null

const ACTION_LABELS = [
    'Left click',
    'Right click',
    'Middle click',
    ...MOUSE_BUTTON_NAMES.slice(3),
]

/** The mouse as controls: eight buttons (the middle one is the wheel), and the
 *  sensor unless the device reports it has no pointer (`hwCaps`, GET_PERSONALITY_MAP;
 *  0 / absent = not reported, keep it). */
export function mouseModel(name: string, hwCaps?: number): DeviceModel {
    return defaultLayout('mouse', name, {
        buttons: 8,
        wheel: true,
        sensor: reportsHwCap(hwCaps, HwCap.POINTER) ?? true,
    })
}

/** What the mouse can be set to: report-as-button actions and the CPI range. */
export function mouseCatalog(
    motion: MotionConfig | null,
    rates: RateLimits | null,
): ControlsCatalog {
    const poll = rates && rates.supported.length > 0
    return {
        groups: [{ id: 'mouse', label: 'Mouse buttons', category: 'mouse' }],
        actions: ACTION_LABELS.map((label, i) => ({
            id: `${ACTION_PREFIX}${i}`,
            label,
            group: 'mouse',
            category: 'mouse',
        })),
        outputs: {},
        fields: {
            button: ['a'],
            wheel: ['click'],
            sensor: poll ? ['stages', 'poll'] : ['stages'],
        },
        sensor: {
            dpiMin: motion?.dpiMin || 100,
            dpiMax: motion?.dpiMax || 26000,
            dpiStep: motion?.dpiStep || 100,
            maxStages: 1,
            pollRates: poll ? rates.supported : [],
            lods: [],
        },
    }
}

/** What physical button `i` reports as (identity when the map is unset). */
function mappedTo(mouse: ConfigMouse | undefined, i: number): number | null {
    const map = mouse?.buttonMap
    if (!map) return i
    const v = map[i]
    return v === undefined ? i : v
}

/** The document's mouse section as control bindings. */
export function mouseBindings(
    mouse: ConfigMouse | undefined,
    motion: MotionConfig | null,
    rates: RateLimits | null,
): DeviceBindings {
    const out: Record<string, ControlBinding> = {}
    for (const [id, i] of Object.entries(BUTTON_INDEX)) {
        if (id === 'wheel') continue
        out[id] = { a: actionOf(mappedTo(mouse, i)) } satisfies ButtonBinding
    }
    out.wheel = {
        up: null,
        down: null,
        click: actionOf(mappedTo(mouse, BUTTON_INDEX.wheel!)),
        tl: null,
        tr: null,
        lines: mouse?.scrollDivisor ?? 1,
        smooth: false,
        freeSpin: false,
    } satisfies WheelBinding
    out.sensor = {
        stages: [mouse?.cpi ?? motion?.dpi ?? 800],
        active: 0,
        poll: rates?.currentHz ?? 1000,
        lod: '',
        snap: false,
        motionSync: false,
    } satisfies SensorBinding
    return out
}

const IDENTITY = [0, 1, 2, 3, 4, 5, 6, 7]

/** `map` with button `i` reporting as `to`; dropped when it is the identity. */
function remap(
    map: ConfigMouse['buttonMap'],
    i: number,
    to: number | null,
): ConfigMouse['buttonMap'] {
    const next = [...(map ?? IDENTITY)]
    next[i] = to
    return next.every((v, j) => v === IDENTITY[j]) ? undefined : next
}

/** `mouse` without its undefined fields (the document stays minimal). */
function compact(mouse: ConfigMouse): ConfigMouse | undefined {
    const out = Object.fromEntries(
        Object.entries(mouse).filter(([, v]) => v !== undefined),
    ) as ConfigMouse
    return Object.keys(out).length ? out : undefined
}

/** `doc` with control `id` bound to `binding`. Unknown controls are ignored. */
export function applyMouseBinding(
    doc: ConfigDevice,
    id: string,
    binding: ControlBinding,
): ConfigDevice {
    const withMouse = (mouse: ConfigMouse): ConfigDevice => ({
        ...doc,
        mouse: compact(mouse),
    })
    if (id === 'sensor') {
        return withMouse({
            ...doc.mouse,
            cpi: (binding as SensorBinding).stages[0],
        })
    }
    const i = BUTTON_INDEX[id]
    if (i === undefined) return doc
    const a =
        id === 'wheel'
            ? (binding as WheelBinding).click
            : (binding as ButtonBinding).a
    return withMouse({
        ...doc.mouse,
        buttonMap: remap(doc.mouse?.buttonMap, i, indexOf(a)),
    })
}
