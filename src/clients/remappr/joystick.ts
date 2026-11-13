// pattern-check: skip — thin async wrappers over the JOYSTICK namespace verbs
// plus their facade object, same idiom as mouse.ts; no abstraction.
//
// Input-layout plan §4: the joystick's live state, its live axis map and
// deadzones, and calibration. JOYSTICK opcodes are namespace-scoped and ride
// ONLY the 0xE2/UCH router; the namespace is provisional (ns_version 0). The
// SET_* verbs and CALIBRATE are mutating — product builds seal them (§19);
// served plaintext while the device's control auth is dev-disabled.
//
// Firmware with AXES parts (docs/part-wire-v1.md §4) keeps each input's
// shaping and calibration in the part: there the facade calibrates, sets
// deadzones, invert and radial through the PART namespace, and keeps the
// JOYSTICK verbs for what stays the joystick's (state, report axes, config).
// JOYSTICK SET_DEADZONE / CALIBRATE are only bridged for one release.

import {
    JOY_CAL_ALL,
    JoyAxisFlag,
    JoyCalStep,
    JoystickVerb,
    Namespace,
    parseAxisConfig,
    parseAxisState,
    parseCalSuggestion,
    Status,
    statusName,
    type AxisConfig,
    type AxisState,
    type CalSuggestion,
} from './protocol'
import { once, repeatable, type CallTarget, type RemapprRpc } from './rpc'
import type { DiscoveryResult } from './discovery'
import {
    AXIS_CALIBRATION,
    AXIS_SETTINGS,
    type AxesChannel,
    type AxesLayout,
} from './axesLayout'
import type {
    JoystickApi,
    JoystickAxisFlags,
    JoystickCalStep,
    SensorApi,
    SensorProcedureStep,
} from '../../service'

/** The JOYSTICK verbs as the wire has them: like JoystickApi, but calibrate
 *  resolves to what each analog input measured, and the sticks are the
 *  service's to know (it maps both onto its controls). */
export interface JoystickVerbs
    extends Omit<JoystickApi, 'calibrate' | 'sticks'> {
    calibrate(step: JoystickCalStep, input?: number): Promise<CalSuggestion[]>
}

/** Report axis "off" on the wire. */
const AXIS_OFF = 0xff

const STEPS: Readonly<Record<JoystickCalStep, number>> = {
    begin: JoyCalStep.BEGIN,
    centre: JoyCalStep.CENTRE,
    finish: JoyCalStep.FINISH,
    cancel: JoyCalStep.CANCEL,
    reset: JoyCalStep.RESET,
    undo: JoyCalStep.UNDO,
}

/** True when the device lists the JOYSTICK namespace (the verbs are
 *  provisional, so an unlisted namespace is never assumed). */
export function servesJoystick(discovery: DiscoveryResult): boolean {
    const ns = discovery.personality?.namespaces
    return !!ns?.some((n) => n.namespace === Namespace.JOYSTICK)
}

/** One JOYSTICK verb, to the device itself or (`to`) a node behind the
 *  dongle. */
async function call(
    rpc: RemapprRpc,
    verb: number,
    name: string,
    arg?: Uint8Array,
    to?: CallTarget,
): Promise<Uint8Array> {
    const reply = await rpc.callUniversalPlain(Namespace.JOYSTICK, verb, arg, to)
    if (reply.status !== Status.OK)
        throw new Error(`${name} → ${statusName(reply.status)}`)
    return reply.data
}

/** JOYSTICK.GET_AXIS_STATE: each input's raw count and value, buttons, hat. */
export async function getAxisState(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<AxisState> {
    return parseAxisState(
        await call(
            rpc,
            JoystickVerb.GET_AXIS_STATE,
            'GET_AXIS_STATE',
            undefined,
            repeatable(targetNode),
        ),
    )
}

/** JOYSTICK.GET_AXIS_CONFIG: each input's mapping, curve, deadzones and
 *  calibration. */
export async function getAxisConfig(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<AxisConfig> {
    return parseAxisConfig(
        await call(
            rpc,
            JoystickVerb.GET_AXIS_CONFIG,
            'GET_AXIS_CONFIG',
            undefined,
            repeatable(targetNode),
        ),
    )
}

/** JOYSTICK.CALIBRATE one step on `input` (omitted = every input). Finish
 *  resolves to what each input measured; the other steps to []. A step must
 *  not run twice (a second finish or undo is not the first), so through the
 *  dongle it is sent once. */
export async function calibrate(
    rpc: RemapprRpc,
    step: JoystickCalStep,
    input?: number,
    targetNode = 0,
): Promise<CalSuggestion[]> {
    const data = await call(
        rpc,
        JoystickVerb.CALIBRATE,
        'CALIBRATE',
        new Uint8Array([input ?? JOY_CAL_ALL, STEPS[step]]),
        once(targetNode),
    )
    return parseCalSuggestion(data)
}

/** JOYSTICK.SET_AXIS_MAP (live): `input` onto report axis `out` (null off).
 *  Absolute, so through the dongle it rides the relay retries. */
export async function setAxisMap(
    rpc: RemapprRpc,
    input: number,
    out: number | null,
    flags: JoystickAxisFlags,
    targetNode = 0,
): Promise<void> {
    const bits =
        (flags.invert ? JoyAxisFlag.INVERT : 0) |
        (flags.radial ? JoyAxisFlag.RADIAL : 0)
    await call(
        rpc,
        JoystickVerb.SET_AXIS_MAP,
        'SET_AXIS_MAP',
        new Uint8Array([input, out ?? AXIS_OFF, bits]),
        repeatable(targetNode),
    )
}

/** JOYSTICK.SET_DEADZONE (live). Absolute, like SET_AXIS_MAP. */
export async function setDeadzone(
    rpc: RemapprRpc,
    input: number,
    zones: { inner: number; outer: number },
    targetNode = 0,
): Promise<void> {
    await call(
        rpc,
        JoystickVerb.SET_DEADZONE,
        'SET_DEADZONE',
        new Uint8Array([input, zones.inner, zones.outer]),
        repeatable(targetNode),
    )
}

/** The AXES parts that hold a joystick's shaping and calibration. */
export interface AxesPartAccess {
    /** Where the inputs are; undefined when the device has no AXES part. */
    layout(): Promise<AxesLayout | undefined>
    sensor: SensorApi
}

const PART_STEPS: Readonly<Record<JoystickCalStep, SensorProcedureStep>> = {
    begin: 'begin',
    centre: 'next',
    finish: 'next',
    cancel: 'cancel',
    reset: 'reset',
    undo: 'undo',
}

function locate(layout: AxesLayout, input: number): AxesChannel {
    const at = layout.locate(input)
    if (!at) throw new Error(`The joystick has no analog input ${input}.`)
    return at
}

/** What a finished calibration suggests for each input of `layout`, by input
 *  (null where it measured nothing, or for an input it did not cover). */
async function partSuggestions(
    layout: AxesLayout,
    sensor: SensorApi,
    covered: (input: number) => boolean,
): Promise<CalSuggestion[]> {
    const out: CalSuggestion[] = []
    for (let input = 0; input < layout.count; input++) {
        const at = locate(layout, input)
        const got = covered(input)
            ? await sensor.getSuggestions(at.part, AXIS_CALIBRATION, at.ch)
            : []
        const pct = (name: string): number | null =>
            got.find((g) => g.name === name)?.value ?? null
        out.push({
            inner: pct(AXIS_SETTINGS.inner),
            outer: pct(AXIS_SETTINGS.outer),
        })
    }
    return out
}

/** One calibration step through the AXES parts: on `input`'s channel, or on
 *  every channel of every part. Finish resolves to the suggestions. */
async function partCalibrate(
    layout: AxesLayout,
    sensor: SensorApi,
    step: JoystickCalStep,
    input?: number,
): Promise<CalSuggestion[]> {
    const targets =
        input === undefined
            ? layout.parts.map((p) => ({ part: p.part, ch: 'all' as const }))
            : [locate(layout, input)]
    for (const t of targets) {
        await sensor.runProcedure(t.part, AXIS_CALIBRATION, PART_STEPS[step], t.ch)
    }
    if (step !== 'finish') return []
    return partSuggestions(
        layout,
        sensor,
        (i) => input === undefined || i === input,
    )
}

/** Both deadzones of one channel. The part refuses a pair that reaches 100 %
 *  at any moment, so if the first write is refused the other goes first. */
async function partDeadzone(
    sensor: SensorApi,
    at: AxesChannel,
    inner: number,
    outer: number,
): Promise<void> {
    const set = (name: string, v: number) =>
        sensor.setSetting(at.part, name, v, at.ch)
    try {
        await set(AXIS_SETTINGS.inner, inner)
    } catch {
        await set(AXIS_SETTINGS.outer, outer)
        await set(AXIS_SETTINGS.inner, inner)
        return
    }
    await set(AXIS_SETTINGS.outer, outer)
}

/** Invert and (when given) radial of one channel. */
async function partFlags(
    sensor: SensorApi,
    at: AxesChannel,
    flags: JoystickAxisFlags,
): Promise<void> {
    await sensor.setSetting(at.part, AXIS_SETTINGS.invert, flags.invert, at.ch)
    if (flags.radial !== undefined) {
        await sensor.setSetting(at.part, AXIS_SETTINGS.radial, flags.radial, at.ch)
    }
}

/** The `service.joystick` facade. `writable` false keeps the reads and
 *  rejects every change. `targetNode` addresses a node behind the dongle.
 *  With `axes`, calibration and shaping go through the AXES parts when the
 *  device has them. */
export function buildJoystickApi(
    rpc: RemapprRpc,
    opts: { targetNode?: number; writable: boolean; axes?: AxesPartAccess },
): JoystickVerbs {
    const node = opts.targetNode ?? 0
    const guard = (): void => {
        if (!opts.writable) {
            throw new Error(
                'Read-only view: connect the joystick over USB to change it.',
            )
        }
    }
    return {
        writable: opts.writable,
        getState: () => getAxisState(rpc, node),
        getConfig: () => getAxisConfig(rpc, node),
        async calibrate(step, input) {
            guard()
            const layout = await opts.axes?.layout()
            if (!layout || !opts.axes) return calibrate(rpc, step, input, node)
            return partCalibrate(layout, opts.axes.sensor, step, input)
        },
        async setAxisMap(input, out, flags) {
            guard()
            await setAxisMap(rpc, input, out, flags, node)
            const layout = await opts.axes?.layout()
            if (!layout || !opts.axes) return
            await partFlags(opts.axes.sensor, locate(layout, input), flags)
        },
        async setDeadzone(input, inner, outer) {
            guard()
            const layout = await opts.axes?.layout()
            if (!layout || !opts.axes) {
                await setDeadzone(rpc, input, { inner, outer }, node)
                return
            }
            await partDeadzone(opts.axes.sensor, locate(layout, input), inner, outer)
        },
    }
}
