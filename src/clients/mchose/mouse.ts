// Pattern check: no GoF pattern (-) — rejected — a model table and two pure mappings between the device's config block and the neutral SensorBinding; no polymorphism needed.
//
// What the protocol does not carry (the model's DPI ceiling, its lift-off
// options, its rates), and the mapping between the mouse's config block and
// the device editor's sensor binding.
import type {
    SensorBinding,
    SensorOption,
    SensorSettingSpec,
    SensorSettingValue,
    SensorSpec,
} from '../../devices/types'
import { DPI_STAGES, type MouseConfig } from './protocol'

export interface MchoseModel {
    readonly name: string
    readonly dpiMax: number
    /** Lift-off options; `value` is the 0x42 LOD index. */
    readonly lods: readonly SensorOption[]
    /** Report rates, Hz, by the mouse's rate index. */
    readonly rates: readonly number[]
}

const RATES_8K = [125, 500, 1000, 2000, 4000, 8000] as const
const LODS_3 = [
    { value: 0, label: '0.7 mm' },
    { value: 1, label: '1 mm' },
    { value: 2, label: '2 mm' },
] as const

const K7_ULTRA: MchoseModel = {
    name: 'MCHOSE K7 Ultra',
    dpiMax: 42000,
    lods: LODS_3,
    rates: RATES_8K,
}

const A7X_ULTRA: MchoseModel = {
    name: 'MCHOSE A7X Ultra',
    dpiMax: 42000,
    lods: LODS_3,
    rates: RATES_8K,
}

/** Receiver PIDs and mouse PIDs (0x11 0x06 reports the latter). */
const MODELS: Readonly<Record<number, MchoseModel>> = {
    0x1001: K7_ULTRA,
    0x4150: K7_ULTRA,
    0x1009: A7X_ULTRA,
    0x4011: A7X_ULTRA,
}

const GENERIC_42K: MchoseModel = {
    name: 'MCHOSE mouse',
    dpiMax: 42000,
    lods: LODS_3,
    rates: RATES_8K,
}

const GENERIC_26K: MchoseModel = {
    name: 'MCHOSE mouse',
    dpiMax: 26000,
    lods: [
        { value: 0, label: '1 mm' },
        { value: 1, label: '2 mm' },
    ],
    rates: RATES_8K,
}

export const MCHOSE_VIDS = [0x3837, 0x5253] as const

/** The model by receiver PID, else by the mouse's own PID, else a generic
 *  one by vendor (0x3837 parts are the 42000-DPI generation). */
export function modelFor(
    vid: number,
    receiverPid?: number,
    mousePid?: number,
): MchoseModel {
    const known =
        (receiverPid !== undefined && MODELS[receiverPid]) ||
        (mousePid !== undefined && MODELS[mousePid])
    if (known) return known
    return vid === 0x5253 ? GENERIC_26K : GENERIC_42K
}

// --- the sensor binding --------------------------------------------------

export const DPI_MIN = 50
export const DPI_STEP = 50
export const DEBOUNCE_MAX_MS = 30
export const SLEEP_MAX_MIN = 60
export const ROTATION_MAX_DEG = 30

const S = {
    lod: 'liftCutoff',
    motionSync: 'motionSync',
    angleSnap: 'angleSnap',
    ripple: 'rippleControl',
    debounce: 'debounceMs',
    sleep: 'sleepMinutes',
    performance: 'performanceMode',
    rotation: 'rotation',
} as const

// shortcut: defaults are what stock K7 / A7X units read, not a vendor
// table; replace them if a factory-reset dump turns up.
function settingSpecs(model: MchoseModel): SensorSettingSpec[] {
    const bool = (name: string, label: string, help: string) => ({
        name,
        label,
        type: 'bool' as const,
        unit: '' as const,
        advanced: false,
        default: false,
        help,
    })
    return [
        {
            name: S.lod,
            label: 'Lift-off distance',
            type: 'enum',
            unit: '',
            options: model.lods,
            advanced: false,
            default: model.lods[Math.min(1, model.lods.length - 1)].value,
        },
        bool(
            S.motionSync,
            'Motion sync',
            'Aligns sensor frames with USB polling.',
        ),
        bool(
            S.angleSnap,
            'Angle snapping',
            'Straightens near-horizontal lines.',
        ),
        bool(S.ripple, 'Ripple control', 'Smooths jitter at high DPI.'),
        {
            name: S.rotation,
            label: 'Sensor rotation',
            type: 'int',
            unit: 'deg',
            min: -ROTATION_MAX_DEG,
            max: ROTATION_MAX_DEG,
            step: 1,
            advanced: false,
            default: 0,
            help: 'Turns the sensor angle to match your grip.',
        },
        {
            name: S.debounce,
            label: 'Button debounce',
            type: 'int',
            unit: 'ms',
            min: 0,
            max: DEBOUNCE_MAX_MS,
            step: 1,
            advanced: false,
            default: 8,
        },
        {
            name: S.sleep,
            label: 'Sleep after (min)',
            type: 'int',
            unit: '',
            min: 0,
            max: SLEEP_MAX_MIN,
            step: 1,
            advanced: false,
            default: 2,
            help: '0 = never sleeps.',
        },
        {
            name: S.performance,
            label: 'Performance mode',
            type: 'enum',
            unit: '',
            // Order as the vendor app lists them; mode 1-3 on the wire.
            options: [
                { value: 1, label: 'Performance' },
                { value: 2, label: 'Gaming' },
                { value: 3, label: 'Extreme' },
            ],
            advanced: true,
            default: 2,
        },
    ]
}

export function sensorSpec(model: MchoseModel): SensorSpec {
    return {
        dpiMin: DPI_MIN,
        dpiMax: model.dpiMax,
        dpiStep: DPI_STEP,
        maxStages: DPI_STAGES,
        separateXY: true,
        pollRates: model.rates,
        settings: settingSpecs(model),
        procedures: [],
        metrics: [],
    }
}

export function bindingOf(model: MchoseModel, c: MouseConfig): SensorBinding {
    const s = c.sensor
    const stages = c.dpi.slice(0, c.enabledStages)
    const stagesY = c.dpiY.slice(0, c.enabledStages)
    const apart = stagesY.some((v, i) => v !== stages[i])
    return {
        stages,
        ...(apart ? { stagesY } : {}),
        active: c.stage,
        poll: model.rates[c.rateIndex] ?? model.rates[0],
        settings: {
            [S.lod]: s.lod,
            [S.motionSync]: s.motionSync,
            [S.angleSnap]: s.angleSnap,
            [S.ripple]: s.ripple,
            [S.rotation]: s.rotation,
            [S.debounce]: c.debounceMs,
            [S.sleep]: c.sleepMinutes,
            ...(s.performance ? { [S.performance]: s.performance } : {}),
        },
    }
}

function intIn(
    label: string,
    v: SensorSettingValue,
    min: number,
    max: number,
): number {
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new RangeError(`${label} must be ${min}-${max}, not ${String(v)}`)
    }
    return n
}

function dpiIn(model: MchoseModel, v: number): number {
    const n = Math.round(v / DPI_STEP) * DPI_STEP
    if (n < DPI_MIN || n > model.dpiMax) {
        throw new RangeError(`DPI must be ${DPI_MIN}-${model.dpiMax}, not ${v}`)
    }
    return n
}

/** `c` with `b` applied: what the mouse should read after the writes.
 *  Rejects a value the mouse cannot take; a setting `b` leaves out goes
 *  back to its default. */
export function configWith(
    model: MchoseModel,
    c: MouseConfig,
    b: SensorBinding,
): MouseConfig {
    const enabled = b.stages.length
    if (enabled < 1 || enabled > DPI_STAGES) {
        throw new RangeError(`The mouse takes 1-${DPI_STAGES} DPI stages`)
    }
    const rateIndex = model.rates.indexOf(b.poll)
    if (rateIndex < 0) {
        throw new RangeError(`The mouse has no ${b.poll} Hz report rate`)
    }
    const defaults = Object.fromEntries(
        settingSpecs(model).map((s) => [s.name, s.default]),
    )
    const v = { ...defaults, ...b.settings }
    const lod = Number(v[S.lod])
    if (!model.lods.some((o) => o.value === lod)) {
        throw new RangeError(`Unknown lift-off option ${String(v[S.lod])}`)
    }
    const performance = intIn('Performance mode', v[S.performance], 1, 3)
    // Stages past the enabled ones keep what the mouse holds; Y takes X
    // unless the binding sets the axes apart.
    const dpi = c.dpi.map((old, i) =>
        i < enabled ? dpiIn(model, b.stages[i]) : old,
    )
    const ys = b.stagesY
    return {
        ...c,
        dpi,
        dpiY: c.dpiY.map((old, i) => {
            if (i >= enabled) return old
            return ys ? dpiIn(model, ys[i] ?? b.stages[i]) : dpi[i]
        }),
        enabledStages: enabled,
        stage: Math.min(Math.max(b.active, 0), enabled - 1),
        rateIndex,
        sensor: {
            lod,
            motionSync: v[S.motionSync] === true,
            angleSnap: v[S.angleSnap] === true,
            ripple: v[S.ripple] === true,
            performance,
            rotation: intIn(
                'Sensor rotation',
                v[S.rotation],
                -ROTATION_MAX_DEG,
                ROTATION_MAX_DEG,
            ),
        },
        debounceMs: intIn('Button debounce', v[S.debounce], 0, DEBOUNCE_MAX_MS),
        sleepMinutes: intIn('Sleep', v[S.sleep], 0, SLEEP_MAX_MIN),
    }
}
