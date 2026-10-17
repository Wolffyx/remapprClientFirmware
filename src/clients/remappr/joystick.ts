// pattern-check: skip — thin async wrappers over the JOYSTICK namespace verbs
// plus their facade object, same idiom as mouse.ts; no abstraction.
//
// Input-layout plan §4: the joystick's live state, its live axis map and
// deadzones, and calibration. JOYSTICK opcodes are namespace-scoped and ride
// ONLY the 0xE2/UCH router; the namespace is provisional (ns_version 0). The
// SET_* verbs and CALIBRATE are mutating — product builds seal them (§19);
// served plaintext while the device's control auth is dev-disabled.

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
import type {
    JoystickApi,
    JoystickAxisFlags,
    JoystickCalStep,
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

/** The `service.joystick` facade. `writable` false keeps the reads and
 *  rejects every change. `targetNode` addresses a node behind the dongle. */
export function buildJoystickApi(
    rpc: RemapprRpc,
    opts: { targetNode?: number; writable: boolean },
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
            return calibrate(rpc, step, input, node)
        },
        async setAxisMap(input, out, flags) {
            guard()
            await setAxisMap(rpc, input, out, flags, node)
        },
        async setDeadzone(input, inner, outer) {
            guard()
            await setDeadzone(rpc, input, { inner, outer }, node)
        },
    }
}
