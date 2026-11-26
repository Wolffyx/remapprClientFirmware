// Pattern check: no GoF pattern (-) — rejected — declarative field tables and
// one pure helper for the device-document editors, the same idiom as
// editorFields.ts; nothing to abstract.
//
// Editor metadata for the device config document (device.ts): the dongle's
// settings, a mouse's pointer settings, a node's radio settings and its
// power timeouts. The ranges
// mirror the zod schemas (and so the firmware decoders); the defaults are the
// firmware's, shown for a field the document leaves out. UI-agnostic: the app
// and the builder render their own inputs from these tables.
import type { DongleSettings } from './device'
import type { ConfigMouse, ConfigPowerSettings, ConfigRadioSettings } from './types'

/** One numeric setting: its range, unit and the firmware default. */
export interface DeviceNumberField<K extends string> {
    key: K
    label: string
    description: string
    min: number
    max: number
    /** The firmware's value while the document leaves the field out. */
    defaultValue: number
    unit: 'ms' | ''
}

export type DongleNumberKey = Exclude<keyof DongleSettings, 'nkro'>

export const DONGLE_FIELDS: DeviceNumberField<DongleNumberKey>[] = [
    {
        key: 'pairWindowMs',
        label: 'Pairing window',
        description: 'How long the pairing window stays open.',
        min: 5000,
        max: 600000,
        defaultValue: 30000,
        unit: 'ms',
    },
    {
        key: 'failsafeMs',
        label: 'Failsafe',
        description:
            'A node silent this long gets every key and button released.',
        min: 50,
        max: 2000,
        defaultValue: 100,
        unit: 'ms',
    },
    {
        key: 'rosterLiveMs',
        label: 'Offline after',
        description:
            'A node silent this long is listed offline. Not below the failsafe.',
        min: 100,
        max: 60000,
        defaultValue: 1500,
        unit: 'ms',
    },
    {
        key: 'pairDoneReplayMs',
        label: 'Pair-done replay',
        description:
            'After a bond, how long a lost pair-done message is re-sent to the node.',
        min: 0,
        max: 30000,
        defaultValue: 2000,
        unit: 'ms',
    },
    {
        key: 'hidSubmitTimeoutMs',
        label: 'USB report wait',
        description:
            'How long a report waits for the host to read the previous one before it is held for later.',
        min: 0,
        max: 50,
        defaultValue: 2,
        unit: 'ms',
    },
]

export type RadioNumberKey = Exclude<keyof ConfigRadioSettings, 'autoPair'>

export const RADIO_FIELDS: DeviceNumberField<RadioNumberKey>[] = [
    {
        key: 'keepaliveMs',
        label: 'Keepalive',
        description:
            "Idle re-send period. Keep it below the dongle's failsafe with room for one lost frame.",
        min: 20,
        max: 1000,
        defaultValue: 40,
        unit: 'ms',
    },
    {
        key: 'beaconLossMs',
        label: 'Beacon loss',
        description: 'No dongle beacon for this long means the link is lost.',
        min: 200,
        max: 10000,
        defaultValue: 600,
        unit: 'ms',
    },
    {
        key: 'inputRepeats',
        label: 'Input repeats',
        description: 'How many times each input change is sent.',
        min: 1,
        max: 8,
        defaultValue: 3,
        unit: '',
    },
]

/** One idle timeout of TBL_POWER: picked from a few durations (0 = never),
 *  inside the firmware's range. */
export interface PowerField {
    key: keyof ConfigPowerSettings
    label: string
    description: string
    /** The firmware's build default while the document leaves it out. */
    defaultValue: number
    /** The durations offered, ms, 0 = never, in order. */
    choices: readonly number[]
}

const S = 1000
const MIN = 60 * S
const HOUR = 60 * MIN

export const POWER_FIELDS: readonly PowerField[] = [
    {
        key: 'idleMs',
        label: 'Dim after',
        description: 'No input this long: lights dim and the sensors rest.',
        defaultValue: 5 * S,
        choices: [0, 2 * S, 5 * S, 10 * S, 30 * S, MIN, 5 * MIN],
    },
    {
        key: 'sleepMs',
        label: 'Sleep after',
        description: 'No input this long: the device sleeps; the next key or move wakes it at once.',
        defaultValue: 5 * MIN,
        choices: [0, 30 * S, MIN, 2 * MIN, 5 * MIN, 10 * MIN, 30 * MIN, HOUR],
    },
    {
        key: 'offMs',
        label: 'Power off after',
        description: 'No input this long: the device powers off; a key or a move restarts it (about a second).',
        defaultValue: 0,
        choices: [0, 30 * MIN, HOUR, 2 * HOUR, 8 * HOUR, 24 * HOUR],
    },
]

/** A timeout for people: "Never", "30 s", "5 min", "2 h", "1 day". */
export function powerTimeoutLabel(ms: number): string {
    if (ms === 0) return 'Never'
    if (ms % (24 * HOUR) === 0) return ms === 24 * HOUR ? '1 day' : `${ms / (24 * HOUR)} days`
    if (ms % HOUR === 0) return `${ms / HOUR} h`
    if (ms % MIN === 0) return `${ms / MIN} min`
    return `${ms / S} s`
}

/** Radio auto-pair: on unless a config turns it off. */
export const RADIO_AUTO_PAIR_DEFAULT = true

export const MOUSE_SCROLL_DIVISOR_FIELD: DeviceNumberField<'scrollDivisor'> = {
    key: 'scrollDivisor',
    label: 'Scroll divisor',
    description: 'Wheel counts per reported scroll step.',
    min: 1,
    max: 16,
    defaultValue: 1,
    unit: '',
}

/** Curve points the mouse firmware holds; it refuses a config with more. */
export const MOUSE_ACCEL_POINTS_MAX = 8

/** Button i of a mouse button map (bit i of the HID button report). */
export const MOUSE_BUTTON_NAMES = [
    'Left',
    'Right',
    'Middle',
    'Back',
    'Forward',
    'Button 6',
    'Button 7',
    'Button 8',
] as const

/** The identity button map: every button reports as itself. */
export const MOUSE_BUTTON_MAP_IDENTITY: NonNullable<ConfigMouse['buttonMap']> = [
    0, 1, 2, 3, 4, 5, 6, 7,
]

/** `section` with its undefined fields dropped, or undefined when none is left —
 *  so a document carries only the settings the user chose. */
export function compactSection<T extends object>(section: T): T | undefined {
    const entries = Object.entries(section).filter(([, v]) => v !== undefined)
    return entries.length ? (Object.fromEntries(entries) as T) : undefined
}
