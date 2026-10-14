// Pattern check: Dispatch Map (Tier 0) — applied — one default-binding factory
// per control kind, keyed by kind; a typed map instead of a switch.
//
// The binding a control has before anything is assigned to it. Actions start
// Disabled (null); outputs and sensor values come from the adapter's catalog, so
// a default never names something the device cannot do.
import type {
    BindingByKind,
    ControlBinding,
    ControlKind,
    ControlsCatalog,
    DeviceBindings,
    DeviceControl,
    SensorBinding,
} from './types'

const firstOutput = (
    catalog: ControlsCatalog,
    kind: 'stick' | 'trigger' | 'axis',
): string => catalog.outputs[kind]?.[0]?.id ?? ''

/** Common DPI steps a fresh sensor offers, clipped to the device's range. */
const DPI_LADDER = [400, 800, 1600, 3200, 6400, 12800] as const

function defaultSensor(catalog: ControlsCatalog): SensorBinding {
    const spec = catalog.sensor
    if (!spec) {
        return {
            stages: [800],
            active: 0,
            poll: 1000,
            lod: '',
            snap: false,
            motionSync: false,
        }
    }
    const inRange = DPI_LADDER.filter(
        (d) => d >= spec.dpiMin && d <= spec.dpiMax,
    )
    const stages = (inRange.length ? inRange : [spec.dpiMin]).slice(
        0,
        Math.max(1, spec.maxStages),
    )
    const poll = spec.pollRates.includes(1000)
        ? 1000
        : (spec.pollRates.at(-1) ?? 1000)
    return {
        stages,
        active: Math.min(1, stages.length - 1),
        poll,
        lod: spec.lods[0]?.id ?? '',
        snap: false,
        motionSync: true,
    }
}

type DefaultFactories = {
    readonly [K in ControlKind]: (catalog: ControlsCatalog) => BindingByKind[K]
}

const DEFAULTS: DefaultFactories = {
    button: () => ({ a: null }),
    wheel: () => ({
        up: null,
        down: null,
        click: null,
        tl: null,
        tr: null,
        lines: 3,
        smooth: true,
        freeSpin: false,
    }),
    stick: (c) => ({
        out: firstOutput(c, 'stick'),
        inner: 8,
        outer: 95,
        curve: 'linear',
        invY: false,
        click: null,
    }),
    trigger: (c) => ({
        out: firstOutput(c, 'trigger'),
        start: 5,
        end: 95,
        mode: 'analog',
        rumble: false,
    }),
    hat: () => ({
        up: null,
        down: null,
        left: null,
        right: null,
        ul: null,
        ur: null,
        dl: null,
        dr: null,
        ways: 4,
    }),
    sensor: defaultSensor,
    encoder: () => ({ cw: null, ccw: null, press: null, sens: 2 }),
    axis: (c) => ({
        out: firstOutput(c, 'axis'),
        dz: 2,
        curve: 'linear',
        inv: false,
    }),
}

/** The binding a control of `kind` has before anything is assigned. */
export function defaultBinding<K extends ControlKind>(
    kind: K,
    catalog: ControlsCatalog,
): BindingByKind[K] {
    return DEFAULTS[kind](catalog)
}

/** `control`'s binding in `bindings`, or its kind's default. */
export function bindingOf(
    control: DeviceControl,
    bindings: DeviceBindings,
    catalog: ControlsCatalog,
): ControlBinding {
    return bindings[control.id] ?? defaultBinding(control.kind, catalog)
}
