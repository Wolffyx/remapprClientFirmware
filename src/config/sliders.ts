// Pattern check: no GoF pattern (-) — rejected — a data table of slider maps plus
// pure lookups; every map is a row, no per-map code.
//
// What a slider can do, firmware-neutral: set a level, or send keys. A level is
// the computer's (volume, screen brightness: sent as up / down steps, the
// computer never reports it back) or the keyboard's own (backlight, RGB: always
// in step). Which firmware builds which map is each target's own business.
import type { SliderMap } from './types'

export interface SliderMapInfo {
    readonly id: SliderMap
    readonly label: string
    /** `level` sets a value across the travel; `keys` sends bindings. */
    readonly kind: 'level' | 'keys'
    /** Whose value a level is: the computer's or the keyboard's own. */
    readonly owner?: 'computer' | 'keyboard'
}

export const SLIDER_MAP_INFO: readonly SliderMapInfo[] = [
    { id: 'volume', label: 'Volume', kind: 'level', owner: 'computer' },
    {
        id: 'brightness',
        label: 'Screen brightness',
        kind: 'level',
        owner: 'computer',
    },
    { id: 'backlight', label: 'Backlight', kind: 'level', owner: 'keyboard' },
    {
        id: 'rgb_brightness',
        label: 'RGB brightness',
        kind: 'level',
        owner: 'keyboard',
    },
    { id: 'rgb_hue', label: 'RGB colour', kind: 'level', owner: 'keyboard' },
    { id: 'keys', label: 'Keys you pick', kind: 'keys' },
    { id: 'mouse_wheel', label: 'Scroll', kind: 'keys' },
    { id: 'custom', label: 'Custom action', kind: 'keys' },
]

export function sliderMapInfo(id: SliderMap): SliderMapInfo {
    return SLIDER_MAP_INFO.find((m) => m.id === id) ?? SLIDER_MAP_INFO[0]!
}
