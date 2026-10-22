// Pattern check: Facade (Tier 1) — extended — buildSensorApi backs `service.sensor` the way buildJoystickApi backs `service.joystick`.
//
// A device's parts over the PART namespace (0x0A, was SENSOR; firmware
// docs/part-wire-v1.md) — what each has (settings, procedures, readings, IO),
// live changes, procedures and readings, on each channel of a part that
// carries several. Personality-neutral: a mouse's optical sensor and a
// joystick's axes use the same verbs. Frozen at ns_version 1; a device at
// ns_version 0 (the provisional SENSOR layouts) still works: the GET_PARTS
// reply's version says which, and the args follow it. SET_SETTING and
// RUN_PROCEDURE are mutating — product builds seal them (§19); served
// plaintext while the device's control auth is dev-disabled.
//
// The wire speaks ids; the facade speaks the names the registry mirror gives
// them (sensorRegistry.ts), and an id it has no name for by its hex key, so
// a sensor newer than this client still works.

import type {
    SensorInfo,
    SensorIo,
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
    buildSensorRunArg,
    buildSensorSetArg,
    Namespace,
    parseSensorIoPage,
    parseSensorSuggestions,
    SENSOR_CH_ALL,
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
    type SensorIoRecord,
    type SensorProcedureRecord,
    type SensorRecord,
    type SensorSettingRecord,
    type SensorStatusRecord,
} from './protocol'
import { once, repeatable, type CallTarget, type RemapprRpc } from './rpc'
import {
    registryMetric,
    registryProcedure,
    registrySetting,
    sensorClass,
    sensorIoKind,
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

/** One SENSOR verb, to the device itself or (`to`) a node behind the dongle. */
async function call(
    rpc: RemapprRpc,
    verb: number,
    name: string,
    arg: Uint8Array,
    to?: CallTarget,
): Promise<Uint8Array> {
    const reply = await rpc.callUniversalPlain(Namespace.SENSOR, verb, arg, to)
    if (reply.status !== Status.OK)
        throw new Error(`${name} → ${statusName(reply.status)}`)
    return reply.data
}

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b)

/** What a device's PART namespace speaks: ns_version 1 (channels) or 0 (the
 *  provisional SENSOR layouts), learned from its GET_PARTS reply. */
export interface SensorWire {
    nsVersion?: number
}

/** An optional channel byte: absent for channel 0 (every ns_version reads
 *  that), else appended. */
const withCh = (arg: number[], ch?: number): Uint8Array =>
    bytes(...arg, ...(ch ? [ch] : []))

/** PART.GET_PARTS, every page. Records the device's ns_version in `wire`. */
export async function listSensors(
    rpc: RemapprRpc,
    targetNode = 0,
    wire: SensorWire = {},
): Promise<SensorRecord[]> {
    const out: SensorRecord[] = []
    for (;;) {
        const raw = await call(
            rpc,
            SensorVerb.GET_SENSORS,
            'GET_SENSORS',
            bytes(out.length),
            repeatable(targetNode),
        )
        wire.nsVersion = raw[0] >= 2 ? 1 : 0
        const page = parseSensorsPage(raw)
        out.push(...page.sensors)
        // A page that adds nothing would ask for the same page forever.
        if (out.length >= page.total || page.sensors.length === 0) return out
    }
}

/** PART.GET_SETTING: the setting at `position` in the part's list, on
 *  channel `ch`. */
export async function getSensorSetting(
    rpc: RemapprRpc,
    sensor: number,
    position: number,
    targetNode = 0,
    ch?: number,
): Promise<SensorSettingRecord> {
    return parseSensorSetting(
        await call(
            rpc,
            SensorVerb.GET_SETTING,
            'GET_SETTING',
            withCh([sensor, position], ch),
            repeatable(targetNode),
        ),
    )
}

/** PART.GET_PROCEDURE: the procedure at `position` in the part's list. */
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
            repeatable(targetNode),
        ),
    )
}

/** PART.GET_METRICS: each reading of channel `ch` and the most it reads. */
export async function getSensorMetrics(
    rpc: RemapprRpc,
    sensor: number,
    targetNode = 0,
    ch?: number,
): Promise<SensorMetricRecord[]> {
    return parseSensorMetrics(
        await call(
            rpc,
            SensorVerb.GET_METRICS,
            'GET_METRICS',
            withCh([sensor], ch),
            repeatable(targetNode),
        ),
    )
}

/** PART.GET_IO, every page (ns_version 1). */
export async function getSensorIo(
    rpc: RemapprRpc,
    sensor: number,
    targetNode = 0,
): Promise<SensorIoRecord[]> {
    const out: SensorIoRecord[] = []
    for (;;) {
        const page = parseSensorIoPage(
            await call(
                rpc,
                SensorVerb.GET_IO,
                'GET_IO',
                bytes(sensor, out.length),
                repeatable(targetNode),
            ),
        )
        out.push(...page.io)
        if (out.length >= page.total || page.io.length === 0) return out
    }
}

/** PART.GET_PROCEDURE_STATUS (of channel `ch`; 0xFF every channel). */
export async function getSensorProcedureStatus(
    rpc: RemapprRpc,
    sensor: number,
    procedure: number,
    targetNode = 0,
    ch?: number,
): Promise<SensorStatusRecord> {
    return parseSensorStatus(
        await call(
            rpc,
            SensorVerb.GET_PROCEDURE_STATUS,
            'GET_PROCEDURE_STATUS',
            withCh([sensor, procedure], ch),
            repeatable(targetNode),
        ),
    )
}

/** PART.GET_PROCEDURE_RESULT: what procedure `procedure`'s last result on
 *  channel `ch` suggests for the part's own settings (ns_version 1). */
export async function getSensorSuggestions(
    rpc: RemapprRpc,
    sensor: number,
    procedure: number,
    ch: number,
    targetNode = 0,
) {
    return parseSensorSuggestions(
        await call(
            rpc,
            SensorVerb.GET_PROCEDURE_RESULT,
            'GET_PROCEDURE_RESULT',
            bytes(sensor, procedure, ch),
            repeatable(targetNode),
        ),
    )
}

/** Channel and ns_version of a SET / RUN: the device's layout. */
export interface SensorCallOpts {
    ch?: number
    nsVersion?: number
}

/** PART.SET_SETTING (live until the next COMMIT): the value applied. An
 *  absolute value, so through the dongle it rides the relay retries. */
export async function setSensorSetting(
    rpc: RemapprRpc,
    sensor: number,
    id: number,
    value: number,
    targetNode = 0,
    opts: SensorCallOpts = {},
): Promise<number> {
    return parseSensorApplied(
        await call(
            rpc,
            SensorVerb.SET_SETTING,
            'SET_SETTING',
            buildSensorSetArg(sensor, id, value, opts.ch, opts.nsVersion),
            repeatable(targetNode),
        ),
    )
}

/** PART.RUN_PROCEDURE one step: the status after it. A step must not run
 *  twice (a second capture or finish is not the first), so it is never
 *  retried; after a lost reply, read the procedure's status instead. */
export async function runSensorProcedure(
    rpc: RemapprRpc,
    sensor: number,
    procedure: number,
    step: number,
    targetNode = 0,
    opts: SensorCallOpts = {},
): Promise<SensorStatusRecord> {
    return parseSensorStatus(
        await call(
            rpc,
            SensorVerb.RUN_PROCEDURE,
            'RUN_PROCEDURE',
            buildSensorRunArg(sensor, procedure, step, opts.ch, opts.nsVersion),
            once(targetNode),
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
        ...((rec.flags & SensorFlag.PER_CHANNEL) !== 0 ? { perChannel: true } : {}),
    }
}

/** A per-channel setting: channel 0's record as the info, every channel's
 *  value and default beside it. */
export function sensorChannelSettingInfo(
    recs: readonly SensorSettingRecord[],
): SensorSettingInfo {
    return {
        ...sensorSettingInfo(recs[0]),
        channels: recs.map((r) => ({
            value: valueOf(r.type, r.value),
            default: valueOf(r.type, r.dflt),
        })),
    }
}

export function sensorIo(rec: SensorIoRecord): SensorIo {
    return {
        kind: sensorIoKind(rec.kind),
        output: (rec.kind & 0x80) !== 0,
        firstChannel: rec.firstCh,
        count: rec.count,
        a: rec.a,
        b: rec.b,
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
        ...((rec.flags & SensorProcFlag.PER_CHANNEL) !== 0 ? { perChannel: true } : {}),
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

/** A setting on every channel: channel 0's record first (it says whether
 *  the setting is per channel at all). */
async function settingInfo(
    rpc: RemapprRpc,
    rec: SensorRecord,
    position: number,
    targetNode: number,
): Promise<SensorSettingInfo> {
    const first = await getSensorSetting(rpc, rec.index, position, targetNode)
    if ((first.flags & SensorFlag.PER_CHANNEL) === 0 || rec.channels < 2)
        return sensorSettingInfo(first)
    const recs = [first]
    for (let ch = 1; ch < rec.channels; ch++) {
        recs.push(await getSensorSetting(rpc, rec.index, position, targetNode, ch))
    }
    return sensorChannelSettingInfo(recs)
}

/** One part in full: one GET per setting (and channel) and procedure (the
 *  wire carries one per reply: a setting fills most of the 48-byte unsealed
 *  chunk). */
async function describeSensor(
    rpc: RemapprRpc,
    rec: SensorRecord,
    targetNode: number,
): Promise<SensorInfo> {
    const settings: SensorSettingInfo[] = []
    for (let i = 0; i < rec.settings; i++) {
        settings.push(await settingInfo(rpc, rec, i, targetNode))
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
    const io = rec.io
        ? (await getSensorIo(rpc, rec.index, targetNode)).map(sensorIo)
        : []
    return {
        index: rec.index,
        cls: sensorClass(rec.cls),
        model: rec.name,
        channels: rec.channels,
        io,
        settings,
        procedures,
        metrics,
    }
}

/** Every part of the device, described. Records its ns_version in `wire`. */
export async function describeSensors(
    rpc: RemapprRpc,
    targetNode = 0,
    wire: SensorWire = {},
): Promise<SensorInfo[]> {
    const out: SensorInfo[] = []
    for (const rec of await listSensors(rpc, targetNode, wire)) {
        out.push(await describeSensor(rpc, rec, targetNode))
    }
    return out
}

const STEPS: Readonly<Record<SensorProcedureStep, number>> = {
    begin: SensorStep.BEGIN,
    next: SensorStep.NEXT,
    cancel: SensorStep.CANCEL,
    reset: SensorStep.RESET,
    undo: SensorStep.UNDO,
}

const chOf = (channel?: number | 'all'): number | undefined =>
    channel === 'all' ? SENSOR_CH_ALL : channel

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
 *  every change. `targetNode` addresses a node behind the dongle. */
export function buildSensorApi(
    rpc: RemapprRpc,
    opts: { targetNode?: number; writable: boolean },
): SensorApi {
    const node = opts.targetNode ?? 0
    const guard = (): void => {
        if (!opts.writable) {
            throw new Error(
                'Read-only view: connect the device over USB to change its sensor.',
            )
        }
    }
    const procedureId = (name: string): number =>
        idOf(name, sensorProcedureId, 'procedure')
    // The layout a SET / RUN takes: learned from GET_PARTS (once, if no
    // describe ran first).
    const wire: SensorWire = {}
    const nsVersion = async (): Promise<number> => {
        if (wire.nsVersion === undefined) await listSensors(rpc, node, wire)
        return wire.nsVersion ?? 0
    }
    return {
        writable: opts.writable,
        getSensors: () => describeSensors(rpc, node, wire),
        async setSetting(sensor, name, value, channel) {
            guard()
            const wireValue = typeof value === 'boolean' ? Number(value) : value
            const id = idOf(name, sensorSettingId, 'setting')
            const applied = await setSensorSetting(rpc, sensor, id, wireValue, node, {
                ch: channel,
                nsVersion: await nsVersion(),
            })
            return typeof value === 'boolean' ? applied !== 0 : applied
        },
        async runProcedure(sensor, name, step, channel) {
            guard()
            return sensorProcedureStatus(
                await runSensorProcedure(
                    rpc,
                    sensor,
                    procedureId(name),
                    STEPS[step],
                    node,
                    { ch: chOf(channel), nsVersion: await nsVersion() },
                ),
            )
        },
        async getProcedureStatus(sensor, name, channel) {
            return sensorProcedureStatus(
                await getSensorProcedureStatus(
                    rpc,
                    sensor,
                    procedureId(name),
                    node,
                    chOf(channel),
                ),
            )
        },
        async getMetrics(sensor, channel): Promise<readonly SensorReading[]> {
            return (await getSensorMetrics(rpc, sensor, node, channel)).map((m) => ({
                name: sensorMetricKey(m.id),
                value: m.value,
                max: m.max,
            }))
        },
        async getSuggestions(sensor, name, channel) {
            if ((await nsVersion()) < 1) return []
            const recs = await getSensorSuggestions(
                rpc,
                sensor,
                procedureId(name),
                channel ?? 0,
                node,
            )
            return recs.map((r) => ({ name: sensorSettingKey(r.id), value: r.value }))
        },
    }
}
