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
    JoyCalStep,
    JoystickVerb,
    Namespace,
    parseAxisConfig,
    parseAxisState,
    Status,
    statusName,
    type AxisConfig,
    type AxisState,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'
import type { DiscoveryResult } from './discovery'
import type { JoystickApi, JoystickCalStep } from '../../service'

/** Report axis "off" on the wire. */
const AXIS_OFF = 0xff

const STEPS: Readonly<Record<JoystickCalStep, number>> = {
    begin: JoyCalStep.BEGIN,
    centre: JoyCalStep.CENTRE,
    finish: JoyCalStep.FINISH,
    cancel: JoyCalStep.CANCEL,
    reset: JoyCalStep.RESET,
}

/** True when the device lists the JOYSTICK namespace (the verbs are
 *  provisional, so an unlisted namespace is never assumed). */
export function servesJoystick(discovery: DiscoveryResult): boolean {
    const ns = discovery.personality?.namespaces
    return !!ns?.some((n) => n.namespace === Namespace.JOYSTICK)
}

async function call(
    rpc: RemapprRpc,
    verb: number,
    name: string,
    arg?: Uint8Array,
): Promise<Uint8Array> {
    const reply = await rpc.callUniversalPlain(Namespace.JOYSTICK, verb, arg)
    if (reply.status !== Status.OK)
        throw new Error(`${name} → ${statusName(reply.status)}`)
    return reply.data
}

/** A read, relayed with retries when `targetNode` names a node behind the
 *  dongle (0 = the device itself). */
async function read(
    rpc: RemapprRpc,
    verb: number,
    name: string,
    targetNode: number,
): Promise<Uint8Array> {
    if (!targetNode) return call(rpc, verb, name)
    const reply = await rpc.callUniversalPlain(
        Namespace.JOYSTICK,
        verb,
        undefined,
        {
            targetNode,
            retries: RELAY_READ_RETRIES,
        },
    )
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
        await read(
            rpc,
            JoystickVerb.GET_AXIS_STATE,
            'GET_AXIS_STATE',
            targetNode,
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
        await read(
            rpc,
            JoystickVerb.GET_AXIS_CONFIG,
            'GET_AXIS_CONFIG',
            targetNode,
        ),
    )
}

/** JOYSTICK.CALIBRATE one step on `input` (omitted = every input). */
export async function calibrate(
    rpc: RemapprRpc,
    step: JoystickCalStep,
    input?: number,
): Promise<void> {
    await call(
        rpc,
        JoystickVerb.CALIBRATE,
        'CALIBRATE',
        new Uint8Array([input ?? JOY_CAL_ALL, STEPS[step]]),
    )
}

/** JOYSTICK.SET_AXIS_MAP (live): `input` onto report axis `out` (null off). */
export async function setAxisMap(
    rpc: RemapprRpc,
    input: number,
    out: number | null,
    invert: boolean,
): Promise<void> {
    await call(
        rpc,
        JoystickVerb.SET_AXIS_MAP,
        'SET_AXIS_MAP',
        new Uint8Array([input, out ?? AXIS_OFF, invert ? 1 : 0]),
    )
}

/** JOYSTICK.SET_DEADZONE (live). */
export async function setDeadzone(
    rpc: RemapprRpc,
    input: number,
    inner: number,
    outer: number,
): Promise<void> {
    await call(
        rpc,
        JoystickVerb.SET_DEADZONE,
        'SET_DEADZONE',
        new Uint8Array([input, inner, outer]),
    )
}

/** The `service.joystick` facade. `writable` false keeps the reads and
 *  rejects every change. `targetNode` relays the reads to a node behind the
 *  dongle; changes there are not supported, so such a view is read-only. */
export function buildJoystickApi(
    rpc: RemapprRpc,
    opts: { targetNode?: number; writable: boolean },
): JoystickApi {
    const node = opts.targetNode ?? 0
    if (node && opts.writable) {
        throw new Error('A joystick behind the dongle can only be read.')
    }
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
            await calibrate(rpc, step, input)
        },
        async setAxisMap(input, out, invert) {
            guard()
            await setAxisMap(rpc, input, out, invert)
        },
        async setDeadzone(input, inner, outer) {
            guard()
            await setDeadzone(rpc, input, inner, outer)
        },
    }
}
