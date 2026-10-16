// Pattern check: Facade (Tier 1) — extended — buildSensorApi backs `service.sensor` the way buildJoystickApi backs `service.joystick`.
//
// Sensor-settings plan §3: a device's sensors over the SENSOR namespace —
// what each has (settings, procedures, readings), live changes, procedures
// and readings. Personality-neutral: a mouse's optical sensor and a keyboard's
// trackball use the same verbs. The namespace is provisional (ns_version 0),
// so it is used only when the personality map lists it. SET_SETTING and
// RUN_PROCEDURE are mutating — product builds seal them (§19); served
// plaintext while the device's control auth is dev-disabled.
//
// The wire speaks ids; the facade speaks the names the registry mirror gives
// them (sensorRegistry.ts), and an id it has no name for by its hex key, so
// a sensor newer than this client still works.

import type {
    SensorInfo,
    SensorMetricSpec,
    SensorProcedureSpec,
    SensorSettingInfo,
    SensorSettingValue,
} from '../../devices/types'
import type {
    SensorApi,
    SensorProcedureStatus,
    SensorProcedureStep,
    SensorReading,
} from '../../service'
import type { DiscoveryResult } from './discovery'
import {
    buildSensorSetArg,
    Namespace,
    parseSensorApplied,
    parseSensorMetrics,
    parseSensorProcedure,
    parseSensorSetting,
    parseSensorsPage,
    parseSensorStatus,
    SensorFlag,
    SensorProcFlag,
    SensorResult,
    SensorState,
    SensorStatusFlag,
    SensorStep,
    SensorTypeCode,
    SensorVerb,
    Status,
    statusName,
    type SensorMetricRecord,
    type SensorProcedureRecord,
    type SensorRecord,
    type SensorSettingRecord,
    type SensorStatusRecord,
} from './protocol'
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'
import {
    registryMetric,
    registryProcedure,
    registrySetting,
    sensorClass,
    sensorMetricKey,
    sensorProcedureId,
    sensorProcedureKey,
    sensorSettingId,
    sensorSettingKey,
    sensorUnit,
} from './sensorRegistry'

/** True when the device lists the SENSOR namespace (the verbs are
 *  provisional, so an unlisted namespace is never assumed). */
export function servesSensor(discovery: DiscoveryResult): boolean {
    const ns = discovery.personality?.namespaces
    return !!ns?.some((n) => n.namespace === Namespace.SENSOR)
}

/** One SENSOR verb. A read for a node behind the dongle (`targetNode` > 0)
 *  is relayed with retries; a change is only ever sent to the device itself. */
async function call(
    rpc: RemapprRpc,
    verb: number,
    name: string,
    arg: Uint8Array,
    targetNode = 0,
): Promise<Uint8Array> {
    const opts = targetNode
        ? { targetNode, retries: RELAY_READ_RETRIES }
        : undefined
    const reply = await rpc.callUniversalPlain(
        Namespace.SENSOR,
        verb,
        arg,
        opts,
    )
    if (reply.status !== Status.OK)
        throw new Error(`${name} → ${statusName(reply.status)}`)
    return reply.data
}

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b)

/** SENSOR.GET_SENSORS, every page. */
export async function listSensors(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<SensorRecord[]> {
    const out: SensorRecord[] = []
    for (;;) {
        const page = parseSensorsPage(
            await call(
                rpc,
                SensorVerb.GET_SENSORS,
                'GET_SENSORS',
                bytes(out.length),
                targetNode,
            ),
        )
        out.push(...page.sensors)
        // A page that adds nothing would ask for the same page forever.
        if (out.length >= page.total || page.sensors.length === 0) return out
    }
}

/** SENSOR.GET_SETTING: the setting at `position` in the sensor's list. */
export async function getSensorSetting(
    rpc: RemapprRpc,
    sensor: number,
    position: number,
    targetNode = 0,
): Promise<SensorSettingRecord> {
    return parseSensorSetting(
        await call(
            rpc,
            SensorVerb.GET_SETTING,
            'GET_SETTING',
            bytes(sensor, position),
            targetNode,
        ),
    )
}

/** SENSOR.GET_PROCEDURE: the procedure at `position` in the sensor's list. */
export async function getSensorProcedure(
    rpc: RemapprRpc,
    sensor: number,
    position: number,
    targetNode = 0,
): Promise<SensorProcedureRecord> {
    return parseSensorProcedure(
        await call(
            rpc,
            SensorVerb.GET_PROCEDURE,
            'GET_PROCEDURE',
            bytes(sensor, position),
            targetNode,
        ),
    )
}

/** SENSOR.GET_METRICS: each reading and the most it reads. */
export async function getSensorMetrics(
    rpc: RemapprRpc,
    sensor: number,
    targetNode = 0,
): Promise<SensorMetricRecord[]> {
    return parseSensorMetrics(
        await call(
            rpc,
            SensorVerb.GET_METRICS,
            'GET_METRICS',
            bytes(sensor),
            targetNode,
        ),
    )
}

/** SENSOR.GET_PROCEDURE_STATUS. */
export async function getSensorProcedureStatus(
    rpc: RemapprRpc,
    sensor: number,
    procedure: number,
    targetNode = 0,
): Promise<SensorStatusRecord> {
    return parseSensorStatus(
        await call(
            rpc,
            SensorVerb.GET_PROCEDURE_STATUS,
            'GET_PROCEDURE_STATUS',
            bytes(sensor, procedure),
            targetNode,
        ),
    )
}

/** SENSOR.SET_SETTING (live until the next COMMIT): the value applied. */
export async function setSensorSetting(
    rpc: RemapprRpc,
    sensor: number,
    id: number,
    value: number,
): Promise<number> {
    return parseSensorApplied(
        await call(
            rpc,
            SensorVerb.SET_SETTING,
            'SET_SETTING',
            buildSensorSetArg(sensor, id, value),
        ),
    )
}

/** SENSOR.RUN_PROCEDURE one step: the status after it. */
export async function runSensorProcedure(
    rpc: RemapprRpc,
    sensor: number,
    procedure: number,
    step: number,
): Promise<SensorStatusRecord> {
    return parseSensorStatus(
        await call(
            rpc,
            SensorVerb.RUN_PROCEDURE,
            'RUN_PROCEDURE',
            bytes(sensor, procedure, step),
        ),
    )
}

// ---------------------------------------------------------------------------
// Wire records → the neutral descriptor
// ---------------------------------------------------------------------------

const TYPES: Readonly<Record<number, SensorSettingInfo['type']>> = {
    [SensorTypeCode.BOOL]: 'bool',
    [SensorTypeCode.INT]: 'int',
    [SensorTypeCode.ENUM]: 'enum',
}

const valueOf = (type: number, v: number): SensorSettingValue =>
    type === SensorTypeCode.BOOL ? v !== 0 : v

/** A setting as the device describes it, named and labelled by the registry
 *  (the device's fallback name when the registry has none). */
export function sensorSettingInfo(rec: SensorSettingRecord): SensorSettingInfo {
    const reg = registrySetting(rec.id)
    const needs =
        rec.procedure !== undefined
            ? sensorProcedureKey(rec.procedure)
            : undefined
    const options = rec.options?.map((code, i) => {
        const label =
            reg?.options?.find((o) => o.code === code)?.label ?? String(code)
        const gated = ((rec.gatedMask ?? 0) >> i) & 1
        return gated && needs
            ? { value: code, label, needs }
            : { value: code, label }
    })
    return {
        name: sensorSettingKey(rec.id),
        label: reg?.label ?? rec.name,
        // An unknown type is drawn as a number the device range-checks.
        type: TYPES[rec.type] ?? 'int',
        unit: sensorUnit(rec.unit),
        ...(rec.type === SensorTypeCode.INT
            ? { min: rec.min, max: rec.max, step: rec.step }
            : {}),
        ...(options ? { options } : {}),
        advanced: (rec.flags & SensorFlag.ADVANCED) !== 0,
        default: valueOf(rec.type, rec.dflt),
        ...(reg?.help ? { help: reg.help } : {}),
        value: valueOf(rec.type, rec.value),
        personality: (rec.flags & SensorFlag.PERSONALITY) !== 0,
    }
}

/** A procedure as the device describes it, with the registry's prompts (a
 *  generic one per phase for a procedure the registry does not know). */
export function sensorProcedureSpec(
    rec: SensorProcedureRecord,
): SensorProcedureSpec {
    const reg = registryProcedure(rec.id)
    const phases = Array.from(
        { length: rec.phases },
        (_, i) => reg?.phases[i] ?? `Phase ${i + 1} of ${rec.phases}`,
    )
    return {
        name: sensorProcedureKey(rec.id),
        label: reg?.label ?? rec.name,
        phases,
        hasResult: (rec.flags & SensorProcFlag.HAS_RESULT) !== 0,
    }
}

export function sensorMetricSpec(rec: SensorMetricRecord): SensorMetricSpec {
    return {
        name: sensorMetricKey(rec.id),
        label: registryMetric(rec.id)?.label ?? sensorMetricKey(rec.id),
        max: rec.max,
    }
}

const STATES: Readonly<Record<number, SensorProcedureStatus['state']>> = {
    [SensorState.IDLE]: 'idle',
    [SensorState.RUNNING]: 'running',
    [SensorState.DONE]: 'done',
    [SensorState.FAILED]: 'failed',
}

export function sensorProcedureStatus(
    st: SensorStatusRecord,
): SensorProcedureStatus {
    return {
        state: STATES[st.state] ?? 'idle',
        phase: st.phase,
        progress: st.progress,
        total: st.total,
        ok: st.result === SensorResult.OK,
        ...(st.flags === undefined
            ? {}
            : { hasResult: (st.flags & SensorStatusFlag.HAS_RESULT) !== 0 }),
    }
}

/** Readings while a procedure holds the sensor are refused; the describe
 *  path then lists none rather than failing. */
async function metricsOrNone(
    rpc: RemapprRpc,
    sensor: number,
    targetNode: number,
): Promise<SensorMetricRecord[]> {
    try {
        return await getSensorMetrics(rpc, sensor, targetNode)
    } catch {
        return []
    }
}

/** One sensor in full: one GET per setting and procedure (the wire carries
 *  one per reply: a setting fills most of the 48-byte unsealed chunk). */
async function describeSensor(
    rpc: RemapprRpc,
    rec: SensorRecord,
    targetNode: number,
): Promise<SensorInfo> {
    const settings: SensorSettingInfo[] = []
    for (let i = 0; i < rec.settings; i++) {
        settings.push(
            sensorSettingInfo(
                await getSensorSetting(rpc, rec.index, i, targetNode),
            ),
        )
    }
    const procedures: SensorProcedureSpec[] = []
    for (let i = 0; i < rec.procedures; i++) {
        procedures.push(
            sensorProcedureSpec(
                await getSensorProcedure(rpc, rec.index, i, targetNode),
            ),
        )
    }
    const metrics = rec.metrics
        ? (await metricsOrNone(rpc, rec.index, targetNode)).map(
              sensorMetricSpec,
          )
        : []
    return {
        index: rec.index,
        cls: sensorClass(rec.cls),
        model: rec.name,
        settings,
        procedures,
        metrics,
    }
}

/** Every sensor of the device, described. */
export async function describeSensors(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<SensorInfo[]> {
    const out: SensorInfo[] = []
    for (const rec of await listSensors(rpc, targetNode)) {
        out.push(await describeSensor(rpc, rec, targetNode))
    }
    return out
}

const STEPS: Readonly<Record<SensorProcedureStep, number>> = {
    begin: SensorStep.BEGIN,
    next: SensorStep.NEXT,
    cancel: SensorStep.CANCEL,
    reset: SensorStep.RESET,
}

function idOf(
    key: string,
    find: (k: string) => number | undefined,
    what: string,
): number {
    const id = find(key)
    if (id === undefined) throw new Error(`Unknown sensor ${what} "${key}"`)
    return id
}

/** The `service.sensor` facade. `writable` false keeps the reads and rejects
 *  every change. `targetNode` relays the reads to a node behind the dongle;
 *  changes there are not supported, so such a view is read-only. */
export function buildSensorApi(
    rpc: RemapprRpc,
    opts: { targetNode?: number; writable: boolean },
): SensorApi {
    const node = opts.targetNode ?? 0
    if (node && opts.writable) {
        throw new Error('A sensor behind the dongle can only be read.')
    }
    const guard = (): void => {
        if (!opts.writable) {
            throw new Error(
                'Read-only view: connect the device over USB to change its sensor.',
            )
        }
    }
    const procedureId = (name: string): number =>
        idOf(name, sensorProcedureId, 'procedure')
    return {
        writable: opts.writable,
        getSensors: () => describeSensors(rpc, node),
        async setSetting(sensor, name, value) {
            guard()
            const wire = typeof value === 'boolean' ? Number(value) : value
            const id = idOf(name, sensorSettingId, 'setting')
            const applied = await setSensorSetting(rpc, sensor, id, wire)
            return typeof value === 'boolean' ? applied !== 0 : applied
        },
        async runProcedure(sensor, name, step) {
            guard()
            return sensorProcedureStatus(
                await runSensorProcedure(
                    rpc,
                    sensor,
                    procedureId(name),
                    STEPS[step],
                ),
            )
        },
        async getProcedureStatus(sensor, name) {
            return sensorProcedureStatus(
                await getSensorProcedureStatus(
                    rpc,
                    sensor,
                    procedureId(name),
                    node,
                ),
            )
        },
        async getMetrics(sensor): Promise<readonly SensorReading[]> {
            return (await getSensorMetrics(rpc, sensor, node)).map((m) => ({
                name: sensorMetricKey(m.id),
                value: m.value,
                max: m.max,
            }))
        },
    }
}
