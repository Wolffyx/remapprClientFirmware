// Pattern check: Dispatch Map (Tier 0) — applied — one reader per input-source type (button, trigger, stick, axis, d-pad), keyed by type, instead of a switch.
//
// Reads a Gamepad API snapshot into a live input frame. Each control names
// where its state lives in the snapshot (an InputSource); a profile's map holds
// one per control.
import type { AnalogValue, ControlInputFrame } from '../../devices/types'

/** The part of the Gamepad API's `Gamepad` this module reads. */
export interface GamepadLike {
    readonly id: string
    readonly index: number
    readonly mapping: string
    readonly connected: boolean
    readonly buttons: readonly {
        readonly pressed: boolean
        readonly value: number
    }[]
    readonly axes: readonly number[]
}

export type InputSource =
    | { readonly type: 'button'; readonly index: number }
    /** An analog button: its value is the travel. */
    | { readonly type: 'trigger'; readonly index: number }
    | {
          readonly type: 'stick'
          readonly x: number
          readonly y: number
          /** The button the stick clicks. */
          readonly press?: number
      }
    | { readonly type: 'axis'; readonly index: number }
    /** Four buttons read as one pad. */
    | {
          readonly type: 'dpad'
          readonly up: number
          readonly down: number
          readonly left: number
          readonly right: number
      }

/** Control id → where it is read from. */
export type InputMap = Readonly<Record<string, InputSource>>

interface Reading {
    readonly pressed: boolean
    readonly analog?: AnalogValue
}

const down = (gp: GamepadLike, i: number | undefined): boolean =>
    i !== undefined && !!gp.buttons[i]?.pressed

const axis = (gp: GamepadLike, i: number): number => gp.axes[i] ?? 0

type Readers = {
    readonly [T in InputSource['type']]: (
        gp: GamepadLike,
        src: Extract<InputSource, { type: T }>,
    ) => Reading
}

const READERS: Readers = {
    button: (gp, s) => ({ pressed: down(gp, s.index) }),
    trigger: (gp, s) => ({
        pressed: down(gp, s.index),
        analog: gp.buttons[s.index]?.value ?? 0,
    }),
    stick: (gp, s) => ({
        pressed: down(gp, s.press),
        analog: { x: axis(gp, s.x), y: axis(gp, s.y) },
    }),
    axis: (gp, s) => ({ pressed: false, analog: axis(gp, s.index) }),
    dpad: (gp, s) => {
        const x = Number(down(gp, s.right)) - Number(down(gp, s.left))
        const y = Number(down(gp, s.down)) - Number(down(gp, s.up))
        return { pressed: x !== 0 || y !== 0, analog: { x, y } }
    },
}

function read(gp: GamepadLike, src: InputSource): Reading {
    const reader = READERS[src.type] as (
        g: GamepadLike,
        s: InputSource,
    ) => Reading
    return reader(gp, src)
}

/** The live frame `gp` shows for the controls in `map`. */
export function frameOf(gp: GamepadLike, map: InputMap): ControlInputFrame {
    const pressed = new Set<string>()
    const analog: Record<string, AnalogValue> = {}
    for (const [id, src] of Object.entries(map)) {
        const r = read(gp, src)
        if (r.pressed) pressed.add(id)
        if (r.analog !== undefined) analog[id] = r.analog
    }
    return { pressed, analog }
}

const round = (v: number): string => v.toFixed(2)

/** A frame as a short string, to skip frames that change nothing visible. */
export function frameKey(frame: ControlInputFrame): string {
    const values = Object.entries(frame.analog).map(([id, v]) =>
        typeof v === 'number'
            ? `${id}=${round(v)}`
            : `${id}=${round(v.x)},${round(v.y)}`,
    )
    return `${[...frame.pressed].sort().join(' ')}|${values.join(' ')}`
}
