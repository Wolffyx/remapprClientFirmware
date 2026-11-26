// pattern-check: skip — builds the native profile of an unmapped controller from its counts; data assembly over defaultLayout, no abstraction.
//
// A controller with no known mapping reports only how many buttons and axes it
// has. It opens on the generic gamepad layout (defaultLayout), every input
// under its raw number, and each control is read from that same number.
import { defaultBinding } from '../../devices/defaults'
import {
    defaultLayout,
    splitGamepadAxes,
    type HidCounts,
} from '../../devices/defaultLayout'
import type {
    ControlBinding,
    DeviceAction,
    HatBinding,
} from '../../devices/types'
import {
    nativeAction,
    nativeCatalog,
    nativeId,
    nativeOutput,
} from '../nativeCatalog'
import type { NativeProfile } from '../types'
import type { InputMap, InputSource } from './inputMap'

const HAT_DIRS = [
    ['up', '↑'],
    ['down', '↓'],
    ['left', '←'],
    ['right', '→'],
] as const

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** Control id → raw input, by the ids defaultLayout gives raw controls. */
export function rawInputMap(counts: HidCounts): InputMap {
    const { sticks, singles } = splitGamepadAxes(counts.axes ?? 0)
    const entries: [string, InputSource][] = [
        ...range(counts.buttons ?? 0).map((i): [string, InputSource] => [
            `btn${i}`,
            { type: 'button', index: i },
        ]),
        ...sticks.map(([x, y], k): [string, InputSource] => [
            `stick${k}`,
            { type: 'stick', x, y },
        ]),
        ...singles.map((a): [string, InputSource] => [
            `axis${a}`,
            { type: 'axis', index: a },
        ]),
    ]
    return Object.fromEntries(entries)
}

function rawActions(counts: HidCounts): DeviceAction[] {
    const hatActions =
        (counts.hats ?? 0) > 0
            ? HAT_DIRS.map(([d, arrow]) =>
                  nativeAction('pad', `hat:${d}`, `Hat ${arrow}`),
              )
            : []
    return [
        ...range(counts.buttons ?? 0).map((i) =>
            nativeAction('pad', `btn${i}`, `Button ${i + 1}`),
        ),
        ...hatActions,
    ]
}

/** The native profile of an unmapped controller named `name`. */
export function rawGamepadProfile(
    name: string,
    counts: HidCounts,
): NativeProfile & { readonly map: InputMap } {
    const model = defaultLayout('gamepad', name, counts)
    const { sticks, singles } = splitGamepadAxes(counts.axes ?? 0)
    const catalog = nativeCatalog(rawActions(counts), {
        stick: sticks.map(([x, y]) =>
            nativeOutput(`axes${x}`, `Axes ${x + 1} + ${y + 1}`),
        ),
        axis: singles.map((a) => nativeOutput(`axis${a}`, `Axis ${a + 1}`)),
    })
    const hat: HatBinding = {
        ...defaultBinding('hat', catalog),
        ...Object.fromEntries(HAT_DIRS.map(([d]) => [d, nativeId(`hat:${d}`)])),
    }
    const bindings: Record<string, ControlBinding> = {}
    for (const c of model.controls) {
        if (c.kind === 'button') bindings[c.id] = { a: nativeId(c.id) }
        if (c.kind === 'hat') bindings[c.id] = hat
    }
    sticks.forEach(([x], k) => {
        bindings[`stick${k}`] = {
            ...defaultBinding('stick', catalog),
            out: nativeId(`axes${x}`),
        }
    })
    for (const a of singles) {
        bindings[`axis${a}`] = {
            ...defaultBinding('axis', catalog),
            out: nativeId(`axis${a}`),
            dz: 0,
        }
    }
    return { model, catalog, bindings, map: rawInputMap(counts) }
}
