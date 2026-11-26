// Pattern check: no GoF pattern (-) — rejected — pure lookup helper mapping joystick inputs to AXES part channels, one data shape.
//
// Where a joystick's analog inputs live among the device's parts (firmware
// docs/part-wire-v1.md §4, <remappr/part_axes.h>): every analog-axis node is
// one AXES part (class ANALOG), its children the part's channels, and the
// inputs are numbered across every AXES part in part order (input = the
// part's first input + channel). Each input's shaping (invert, radial, curve,
// deadzones) is that part's per-channel settings; what an input means (its
// report axis) stays the joystick's own (TBL_JOYSTICK v2).
import { sensorSettingId } from './sensorRegistry'

/** Registry class code of an AXES part (ANALOG). */
export const ANALOG_CLASS = 4

/** What a part list entry needs to say for the layout (GET_PARTS). */
export interface AxesPartRecord {
    index: number
    /** Registry class code (4 = ANALOG). */
    cls: number
    channels: number
}

export interface AxesChannel {
    part: number
    ch: number
}

export interface AxesLayout {
    /** Inputs every AXES part has together. */
    readonly count: number
    /** The parts in input order, with the first input each carries. */
    readonly parts: readonly { part: number; first: number; channels: number }[]
    /** The part and channel of `input`, or undefined past the last. */
    locate(input: number): AxesChannel | undefined
    /** The input that channel `ch` of part `part` is, or undefined. */
    inputOf(part: number, ch: number): number | undefined
}

/** An input's shaping field ↔ the AXES part setting that holds it. */
export const AXIS_SETTINGS = {
    invert: 'axisInvert',
    radial: 'axisRadial',
    curve: 'axisCurve',
    inner: 'deadzoneInner',
    outer: 'deadzoneOuter',
} as const

export type AxisField = keyof typeof AXIS_SETTINGS

/** The registry id of each shaping field's setting. */
export const AXIS_SETTING_IDS: Readonly<Record<AxisField, number>> =
    Object.fromEntries(
        Object.entries(AXIS_SETTINGS).map(([field, name]) => {
            const id = sensorSettingId(name)
            if (id === undefined) throw new Error(`no registry id for ${name}`)
            return [field, id]
        }),
    ) as Record<AxisField, number>

/** The calibration procedure an AXES part runs per channel. */
export const AXIS_CALIBRATION = 'axisCalibration'

/** The layout of `parts`' AXES parts, or undefined when there are none. */
export function axesLayout(
    parts: readonly AxesPartRecord[],
): AxesLayout | undefined {
    let first = 0
    const order = parts
        .filter((p) => p.cls === ANALOG_CLASS && p.channels > 0)
        .sort((a, b) => a.index - b.index)
        .map((p) => {
            const entry = { part: p.index, first, channels: p.channels }
            first += p.channels
            return entry
        })
    if (order.length === 0) return undefined
    return {
        count: first,
        parts: order,
        locate(input) {
            const p = order.find(
                (x) => input >= x.first && input < x.first + x.channels,
            )
            return p ? { part: p.part, ch: input - p.first } : undefined
        },
        inputOf(part, ch) {
            const p = order.find((x) => x.part === part)
            return p && ch < p.channels ? p.first + ch : undefined
        },
    }
}
