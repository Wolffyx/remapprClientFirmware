// Pattern check: Dispatch Map (Tier 0) — applied — registry tables keyed by wire id (and by name) instead of switch statements for labels, types and option names.
//
// The Remappr sensor registry (firmware include/dt-bindings/remappr/sensor.h,
// sensor-settings plan §5), mirrored for NAMES AND LABELS ONLY. A sensor's
// adapter lists what it has, and the device describes that (SENSOR namespace);
// nothing here says which sensor supports what. An id this table does not
// know still renders: its key is the id in hex and its label the device's
// fallback name.
//
// The registry is append-only and wire-frozen once shipped, so a name, once
// given, never changes: documents and JSON configs store settings by it.
import type {
    SensorClass,
    SensorSettingType,
    SensorSettingValue,
    SensorUnit,
} from '../../devices/types'

/** One option of an ENUM setting: its code on the wire, its name in a JSON
 *  config, its label. */
export interface RegistryOption {
    readonly code: number
    readonly name: string
    readonly label: string
}

/** A well-known setting. `macro` is its devicetree name
 *  (REMAPPR_SENSOR_<macro>). */
export interface RegistrySetting {
    readonly id: number
    readonly name: string
    readonly macro: string
    readonly label: string
    readonly type: SensorSettingType
    readonly help?: string
    readonly options?: readonly RegistryOption[]
}

export interface RegistryProcedure {
    readonly id: number
    readonly name: string
    readonly label: string
    /** One prompt per phase, in order. */
    readonly phases: readonly string[]
}

export interface RegistryMetric {
    readonly id: number
    readonly name: string
    readonly label: string
}

const REST_HELP =
    'Rest modes save power while the mouse sits still; the sensor keeps the ' +
    'nearest time its registers can hold.'

export const SENSOR_SETTINGS: readonly RegistrySetting[] = [
    {
        id: 0x01,
        name: 'resolution',
        macro: 'RESOLUTION',
        label: 'Resolution',
        type: 'int',
    },
    {
        id: 0x02,
        name: 'readPeriod',
        macro: 'READ_PERIOD',
        label: 'Read period',
        type: 'int',
    },
    {
        id: 0x10,
        name: 'liftCutoff',
        macro: 'LIFT_CUTOFF',
        label: 'Lift-off distance',
        type: 'enum',
        help: 'How high the mouse can be lifted before it stops tracking.',
        options: [
            { code: 10, name: '1mm', label: '1 mm' },
            { code: 20, name: '2mm', label: '2 mm' },
            { code: 0, name: 'calibrated', label: 'Calibrated' },
        ],
    },
    {
        id: 0x11,
        name: 'angleSnap',
        macro: 'ANGLE_SNAP',
        label: 'Angle snapping',
        type: 'bool',
        help: 'Straightens nearly straight lines.',
    },
    {
        id: 0x12,
        name: 'angleTune',
        macro: 'ANGLE_TUNE',
        label: 'Angle tune',
        type: 'int',
        help: 'Rotates the motion to match how you hold the mouse.',
    },
    {
        id: 0x13,
        name: 'performanceMode',
        macro: 'PERFORMANCE_MODE',
        label: 'Performance mode',
        type: 'enum',
        options: [
            { code: 0, name: 'high', label: 'High performance' },
            { code: 1, name: 'lowPower', label: 'Low power' },
            { code: 2, name: 'office', label: 'Office' },
            { code: 3, name: 'corded', label: 'Corded gaming' },
        ],
    },
    {
        id: 0x14,
        name: 'stayAwake',
        macro: 'STAY_AWAKE',
        label: 'Stay awake',
        type: 'bool',
        help: 'Keeps the sensor out of its rest modes: fastest wake, more power.',
    },
    {
        id: 0x15,
        name: 'motionSync',
        macro: 'MOTION_SYNC',
        label: 'Motion sync',
        type: 'bool',
        help: 'Reads the sensor in step with the host’s polling.',
    },
    {
        id: 0x20,
        name: 'runDownshiftMs',
        macro: 'RUN_DOWNSHIFT_MS',
        label: 'Run to rest 1',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x21,
        name: 'rest1PeriodMs',
        macro: 'REST1_PERIOD_MS',
        label: 'Rest 1 read period',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x22,
        name: 'rest1DownshiftMs',
        macro: 'REST1_DOWNSHIFT_MS',
        label: 'Rest 1 to rest 2',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x23,
        name: 'rest2PeriodMs',
        macro: 'REST2_PERIOD_MS',
        label: 'Rest 2 read period',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x24,
        name: 'rest2DownshiftMs',
        macro: 'REST2_DOWNSHIFT_MS',
        label: 'Rest 2 to rest 3',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x25,
        name: 'rest3PeriodMs',
        macro: 'REST3_PERIOD_MS',
        label: 'Rest 3 read period',
        type: 'int',
        help: REST_HELP,
    },
    {
        id: 0x30,
        name: 'scanPeriodMs',
        macro: 'SCAN_PERIOD_MS',
        label: 'Scan period',
        type: 'int',
        help: 'Time between full scans of the key matrix.',
    },
    {
        id: 0x31,
        name: 'debouncePressMs',
        macro: 'DEBOUNCE_PRESS_MS',
        label: 'Press debounce',
        type: 'int',
        help: 'How long a key must read pressed before the press counts.',
    },
    {
        id: 0x32,
        name: 'debounceReleaseMs',
        macro: 'DEBOUNCE_RELEASE_MS',
        label: 'Release debounce',
        type: 'int',
        help: 'How long a key must read released before the release counts.',
    },
]

export const SENSOR_PROCEDURES: readonly RegistryProcedure[] = [
    {
        id: 0x01,
        name: 'liftCalibration',
        label: 'Lift-off calibration',
        phases: [
            'Move the mouse slowly over the whole surface you use, then press Next.',
            'Keep moving the mouse while it measures.',
        ],
    },
]

export const SENSOR_METRICS: readonly RegistryMetric[] = [
    { id: 0x01, name: 'surfaceQuality', label: 'Surface quality' },
    { id: 0x02, name: 'lifted', label: 'Lifted' },
    { id: 0x03, name: 'shutter', label: 'Shutter' },
    { id: 0x04, name: 'brightness', label: 'Brightness' },
]

const CLASSES: Readonly<Record<number, SensorClass>> = {
    1: 'pointer',
    2: 'touch',
    3: 'imu',
    4: 'analog',
    5: 'matrix',
}

const UNITS: Readonly<Record<number, SensorUnit>> = {
    0: '',
    1: 'ms',
    2: 'us',
    3: 'deg',
    4: 'cpi',
    5: '%',
}

/** The key of an id no table names: the id in hex (`0x16`). */
const hexKey = (id: number): string => `0x${id.toString(16).padStart(2, '0')}`

/** The id a hex key names, or undefined. */
function hexId(key: string): number | undefined {
    if (!/^0x[0-9a-f]{1,2}$/i.test(key)) return undefined
    return Number.parseInt(key.slice(2), 16)
}

const byId = <T extends { id: number }>(
    list: readonly T[],
): ReadonlyMap<number, T> => new Map(list.map((e) => [e.id, e]))
const byName = <T extends { name: string }>(
    list: readonly T[],
): ReadonlyMap<string, T> => new Map(list.map((e) => [e.name, e]))

const SETTING_BY_ID = byId(SENSOR_SETTINGS)
const SETTING_BY_NAME = byName(SENSOR_SETTINGS)
const PROCEDURE_BY_ID = byId(SENSOR_PROCEDURES)
const PROCEDURE_BY_NAME = byName(SENSOR_PROCEDURES)
const METRIC_BY_ID = byId(SENSOR_METRICS)

/** The registry's setting for a wire id or a key, if it has one. */
export function registrySetting(
    idOrKey: number | string,
): RegistrySetting | undefined {
    if (typeof idOrKey === 'number') return SETTING_BY_ID.get(idOrKey)
    return (
        SETTING_BY_NAME.get(idOrKey) ?? SETTING_BY_ID.get(hexId(idOrKey) ?? -1)
    )
}

/** A setting's key in bindings and documents: its registry name, else hex. */
export const sensorSettingKey = (id: number): string =>
    SETTING_BY_ID.get(id)?.name ?? hexKey(id)

/** The wire id of a setting key, or undefined for a name nobody registered. */
export const sensorSettingId = (key: string): number | undefined =>
    SETTING_BY_NAME.get(key)?.id ?? hexId(key)

export const registryProcedure = (id: number): RegistryProcedure | undefined =>
    PROCEDURE_BY_ID.get(id)

export const sensorProcedureKey = (id: number): string =>
    PROCEDURE_BY_ID.get(id)?.name ?? hexKey(id)

export const sensorProcedureId = (key: string): number | undefined =>
    PROCEDURE_BY_NAME.get(key)?.id ?? hexId(key)

export const registryMetric = (id: number): RegistryMetric | undefined =>
    METRIC_BY_ID.get(id)

export const sensorMetricKey = (id: number): string =>
    METRIC_BY_ID.get(id)?.name ?? hexKey(id)

export const sensorClass = (code: number): SensorClass =>
    CLASSES[code] ?? 'other'

export const sensorUnit = (code: number): SensorUnit => UNITS[code] ?? ''

/**
 * A JSON value for setting `key` → its number on the wire: a boolean is
 * 0 / 1, an option name its code, a number itself. Undefined for an option
 * name the setting does not have (or a string for a setting with no options).
 */
export function sensorWireValue(
    key: string,
    value: SensorSettingValue | string,
): number | undefined {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number') return value
    return registrySetting(key)?.options?.find((o) => o.name === value)?.code
}
