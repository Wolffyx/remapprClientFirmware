// Pattern check: no GoF pattern (-) — rejected — registry data tables mirroring firmware ids plus name<->id lookups, like sensorRegistry.ts.
//
// The Remappr screen registry (firmware include/remappr/screen.h and
// include/remappr/host_values.h, display part design §3-§4): widget kinds,
// the values a screen can show, and the keys a host pushes. Append-only on
// both sides: an id this client does not know reads as its hex name.

/** TBL_DISPLAY widget kinds. */
export const SCREEN_KINDS = {
    text: 1,
    value: 2,
    bar: 3,
    image: 4,
    clock: 5,
    rect: 6,
} as const

export type ScreenWidgetKind = keyof typeof SCREEN_KINDS

export const SCREEN_ALIGN = { left: 0, centre: 1, right: 2 } as const
export type ScreenAlign = keyof typeof SCREEN_ALIGN

export const SCREEN_FONTS = { small: 0, large: 1 } as const
export type ScreenFont = keyof typeof SCREEN_FONTS

export const CLOCK_FORMATS = { hm: 0, hms: 1, date: 2 } as const
export type ClockFormat = keyof typeof CLOCK_FORMATS

/** Widget flag bits. */
export const W_INVERT = 1 << 0
export const W_ALIGN_SHIFT = 1
export const W_ALIGN_MASK = 3 << W_ALIGN_SHIFT
export const W_FRAME = 1 << 3
/** Page flag: shown first on its display. */
export const PAGE_DEFAULT = 1 << 0

/** Source ids at and above this are host value keys (source = base + key). */
export const SOURCE_HOST_BASE = 0x40

export type HostValueType = 'int' | 'text' | 'time'

export interface HostKey {
    key: number
    name: string
    label: string
    type: HostValueType
}

/** The keys a host pushes (firmware REMAPPR_HOST_KEY_*). */
export const HOST_KEYS: readonly HostKey[] = [
    { key: 0x01, name: 'time', label: 'Time', type: 'time' },
    { key: 0x02, name: 'cpu', label: 'CPU %', type: 'int' },
    { key: 0x03, name: 'ram', label: 'RAM %', type: 'int' },
    { key: 0x04, name: 'mediaTitle', label: 'Media title', type: 'text' },
    { key: 0x05, name: 'mediaArtist', label: 'Media artist', type: 'text' },
    { key: 0x06, name: 'volume', label: 'Volume %', type: 'int' },
    { key: 0x07, name: 'notification', label: 'Notification', type: 'text' },
    ...Array.from({ length: 16 }, (_, i) => ({
        key: 0x10 + i,
        name: `user${i}`,
        label: `Text ${i + 1}`,
        type: 'text' as const,
    })),
]

export interface ScreenSource {
    id: number
    /** Document name: a device value, or `host.<key name>`. */
    name: string
    label: string
}

const DEVICE_SOURCES: readonly ScreenSource[] = [
    { id: 0x01, name: 'activeLayer', label: 'Active layer' },
    { id: 0x02, name: 'battery', label: 'Battery %' },
    { id: 0x03, name: 'charging', label: 'Charging' },
    { id: 0x04, name: 'connection', label: 'Connection' },
    { id: 0x05, name: 'capsLock', label: 'Caps Lock' },
    { id: 0x06, name: 'numLock', label: 'Num Lock' },
    { id: 0x07, name: 'wpm', label: 'Words per minute' },
    { id: 0x08, name: 'deviceName', label: 'Device name' },
]

/** Every value a widget can show: the device's, then the host's. */
export const SCREEN_SOURCES: readonly ScreenSource[] = [
    ...DEVICE_SOURCES,
    ...HOST_KEYS.map((k) => ({
        id: SOURCE_HOST_BASE + k.key,
        name: `host.${k.name}`,
        label: k.label,
    })),
]

const SOURCE_BY_NAME = new Map(SCREEN_SOURCES.map((s) => [s.name, s]))
const SOURCE_BY_ID = new Map(SCREEN_SOURCES.map((s) => [s.id, s]))
const HOST_BY_NAME = new Map(HOST_KEYS.map((k) => [k.name, k]))
const HOST_BY_KEY = new Map(HOST_KEYS.map((k) => [k.key, k]))

const hexName = (id: number): string => `0x${id.toString(16).padStart(2, '0')}`

/** The id of a source name (or its hex), or undefined. */
export function screenSourceId(name: string): number | undefined {
    const known = SOURCE_BY_NAME.get(name)?.id
    if (known !== undefined) return known
    return /^0x[0-9a-f]{1,2}$/i.test(name) ? parseInt(name, 16) : undefined
}

/** The document name of source @p id (its hex when unknown). */
export const screenSourceName = (id: number): string =>
    SOURCE_BY_ID.get(id)?.name ?? hexName(id)

/** The host key of a key name (or its hex), or undefined. */
export function hostKeyOf(name: string): HostKey | undefined {
    const known = HOST_BY_NAME.get(name)
    if (known) return known
    if (!/^0x[0-9a-f]{1,2}$/i.test(name)) return undefined
    const key = parseInt(name, 16)
    return HOST_BY_KEY.get(key) ?? { key, name, label: name, type: 'text' }
}

/** The registry entry of host key @p key (a text key named by its hex when
 *  unknown). */
export const hostKeyById = (key: number): HostKey =>
    HOST_BY_KEY.get(key) ?? { key, name: hexName(key), label: hexName(key), type: 'text' }
