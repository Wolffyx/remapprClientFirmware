// Pattern check: Facade (Tier 1) — extended — buildDeviceConfigApi backs the
// `service.device` facade the way buildNodesApi backs `service.nodes`: the
// config verbs over plain universal frames, with the device document compiled
// and decoded by compilers/remappr/device.ts.
//
// The config of a device that is not a keyboard: the dongle's TBL_DONGLE, the
// mouse's TBL_MOUSE, TBL_RADIO (firmware docs/device-config-plan.md) and
// TBL_SENSOR (sensor-settings plan §4). These
// devices hold no §19 session: whoever has the device on USB configures it, so
// every verb is plaintext. They are always universal frames, which both the
// dongle (it drops legacy frames) and the mouse answer, at target 0 for the
// device itself or at a node's short-id through the dongle.
import type { ConfigDevice } from '../../config/device'
import { DeviceConfigSchema } from '../../config/device'
import {
    buildRemapprDeviceBlob,
    decodeRemapprDeviceBlob,
} from '../../config/compilers/remappr/device'
import { DecodeCode } from '../../config/compilers/remappr/decode'
import { ProtocolError } from '../../errors'
import type { SensorInfo } from '../../devices/types'
import type { DeviceConfigApi, DeviceConfigSnapshot } from '../../service'

import { readConfigBlob } from './configRead'
import {
    BLOB_ALIGN,
    Cmd,
    type DeviceInfo,
    Namespace,
    parseDeviceInfo,
    Status,
    statusName,
    UCH_LEN,
} from './protocol'
import {
    isLinkDrop,
    once,
    repeatable,
    type RemapprRpc,
    type UniversalReply,
} from './rpc'

type DevicePersonality = ConfigDevice['personality']

/** One universal request report: 64 − 0xE2 tag − UCH − 4-byte inner header
 *  leaves 51 bytes of arg, floored to the flash write block (the store writes
 *  each chunk straight to flash). */
const WRITE_CHUNK =
    Math.floor((64 - 1 - UCH_LEN - 4) / BLOB_ALIGN) * BLOB_ALIGN

/** Tries at a push to a node behind the dongle. The link can lose a request
 *  or the reply to it (a chunk then may or may not be staged, a COMMIT may or
 *  may not have landed), so a relayed push starts over from BEGIN, which drops
 *  whatever was staged. Bench: ~0.5 % of relayed calls lost on a noisy 2.4 GHz
 *  channel set, in bursts. */
const RELAY_PUSH_ATTEMPTS = 3

/** Pause before a relayed push starts over, so a burst of loss can pass. */
const RELAY_PUSH_BACKOFF_MS = 250

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

/** What a config verb gets back when the relay lost its reply: the dongle's
 *  own answer for a node that did not reply, which says nothing of whether
 *  the node acted. */
const LINK_DROPPED: UniversalReply = {
    status: Status.ERR_STATE,
    data: new Uint8Array(),
}

/** One config verb, sent once. */
type ConfigCall = (cmd: number, arg?: Uint8Array) => Promise<UniversalReply>

/** The step of a push the device refused, and how. */
interface Refusal {
    step: string
    status: number
}

/** The config verbs for the device itself (`node` 0) or a node behind the
 *  dongle; on the relay a reply that never came reads as LINK_DROPPED. */
function configCall(rpc: RemapprRpc, node: number): ConfigCall {
    return async (cmd, arg) => {
        try {
            return await rpc.callUniversalPlain(Namespace.COMMON, cmd, arg, once(node))
        } catch (e) {
            if (!node || !isLinkDrop(e)) throw e
            return LINK_DROPPED
        }
    }
}

/** One try at a push: BEGIN, every chunk, VALIDATE, COMMIT. The step the
 *  device refused, or null once the blob is active. */
async function pushOnce(
    call: ConfigCall,
    blob: Uint8Array,
): Promise<Refusal | null> {
    const begin = await call(Cmd.WRITE_CONFIG_BEGIN)
    if (begin.status !== Status.OK)
        return { step: 'WRITE_CONFIG_BEGIN', status: begin.status }
    for (let off = 0; off < blob.length; off += WRITE_CHUNK) {
        const chunk = await call(
            Cmd.WRITE_CONFIG_CHUNK,
            blob.subarray(off, Math.min(off + WRITE_CHUNK, blob.length)),
        )
        if (chunk.status !== Status.OK)
            return { step: 'WRITE_CONFIG_CHUNK', status: chunk.status }
    }
    const validate = await call(Cmd.VALIDATE_CONFIG)
    if (validate.status !== Status.OK)
        return { step: 'VALIDATE_CONFIG', status: validate.status }
    const commit = await call(Cmd.COMMIT_CONFIG)
    if (commit.status === Status.OK) return null
    return { step: 'COMMIT_CONFIG', status: commit.status }
}

/** The error a refused push ends in. A config the device found invalid is
 *  rolled back first, so nothing stays staged. */
async function refusalError(
    call: ConfigCall,
    refused: Refusal,
): Promise<ProtocolError> {
    const status = statusName(refused.status)
    if (refused.step !== 'VALIDATE_CONFIG')
        return new ProtocolError(`${refused.step} failed: ${status}`)
    await call(Cmd.ROLLBACK_CONFIG).catch(() => undefined)
    return new ProtocolError(
        `The device refused the settings (VALIDATE_CONFIG: ${status})`,
    )
}

export interface DeviceConfigTarget {
    personality: DevicePersonality
    /** 0 = the device on this transport; a short-id = a node behind the dongle. */
    targetNode?: number
    /** The document's meta.name (the blob does not carry one). */
    name: string
    /** False for a read-only view: `write` then rejects. */
    writable: boolean
    /** The device's sensors as it describes them (SENSOR namespace), when it
     *  serves them: `write` leaves out a sensor setting the device would
     *  refuse (it validates TBL_SENSOR strictly). */
    sensors?: () => Promise<readonly SensorInfo[]>
}

/** A document with no settings: every field on the device's default. */
export function emptyDeviceConfig(
    personality: DevicePersonality,
    name: string,
): ConfigDevice {
    return { schemaVersion: 1, kind: 'remappr.device', meta: { name }, personality }
}

/** Round `b` up to a multiple of BLOB_ALIGN with zero padding. */
function padToAlign(b: Uint8Array): Uint8Array {
    const n = Math.ceil(b.length / BLOB_ALIGN) * BLOB_ALIGN
    if (n === b.length) return b
    const out = new Uint8Array(n)
    out.set(b)
    return out
}

function issueText(err: {
    issues: { path: PropertyKey[]; message: string }[]
}): string {
    return err.issues
        .map((i) =>
            i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message,
        )
        .join('; ')
}

/** The `service.device` facade for a dongle, a mouse or a joystick. */
export function buildDeviceConfigApi(
    rpc: RemapprRpc,
    target: DeviceConfigTarget,
): DeviceConfigApi {
    const node = target.targetNode ?? 0
    const call = configCall(rpc, node)

    async function deviceInfo(): Promise<DeviceInfo> {
        const r = await rpc.callUniversalPlain(
            Namespace.COMMON,
            Cmd.GET_DEVICE_INFO,
            undefined,
            repeatable(node),
        )
        if (r.status !== Status.OK) {
            throw new ProtocolError(`GET_DEVICE_INFO failed: ${statusName(r.status)}`)
        }
        return parseDeviceInfo(r.data)
    }

    async function read(): Promise<DeviceConfigSnapshot> {
        const info = await deviceInfo()
        const blob = await readConfigBlob(rpc, info.hasActive, {
            targetNode: node,
            universal: true,
        })
        if (blob.length === 0) {
            return {
                config: emptyDeviceConfig(target.personality, target.name),
                configVersion: info.hasActive ? info.configVersion : 0,
                stored: false,
            }
        }
        const decoded = decodeRemapprDeviceBlob(blob)
        // A stored config this client cannot read is refused rather than shown
        // as defaults: saving over it would drop settings nobody saw.
        if (decoded.code !== DecodeCode.OK) {
            throw new ProtocolError(
                `the device's config could not be read (decode code ${decoded.code})`,
            )
        }
        if (decoded.personality !== target.personality) {
            throw new ProtocolError(
                `the device holds a ${decoded.personality} config, not a ${target.personality} one`,
            )
        }
        const { dongle, mouse, radio, joystick, sensor } = decoded
        return {
            config: {
                ...emptyDeviceConfig(target.personality, target.name),
                ...(dongle ? { dongle } : {}),
                ...(mouse ? { mouse } : {}),
                ...(radio ? { radio } : {}),
                ...(joystick ? { joystick } : {}),
                ...(sensor ? { sensor } : {}),
            },
            configVersion: decoded.configVersion ?? info.configVersion,
            stored: true,
        }
    }

    /** Whether `version` is active: a COMMIT that did not answer OK may still
     *  have landed (through the dongle, its reply lost; or a late first COMMIT
     *  beat a resent one). */
    async function committed(version: number): Promise<boolean> {
        const now = await deviceInfo()
        return now.hasActive && now.configVersion === version
    }

    /** Push `blob` as `version`. Through the dongle, while ERR_STATE comes back
     *  (a lost request or reply) and tries are left, start over from BEGIN. */
    async function push(blob: Uint8Array, version: number): Promise<void> {
        const attempts = node ? RELAY_PUSH_ATTEMPTS : 1
        for (let attempt = 1; ; attempt++) {
            const refused = await pushOnce(call, blob)
            if (refused === null) return
            if (refused.step === 'COMMIT_CONFIG' && (await committed(version))) return
            if (refused.status !== Status.ERR_STATE || attempt >= attempts)
                throw await refusalError(call, refused)
            await delay(RELAY_PUSH_BACKOFF_MS)
        }
    }

    async function write(config: ConfigDevice): Promise<number> {
        if (!target.writable) {
            throw new ProtocolError(
                'Read-only view: connect the device over USB to change it.',
            )
        }
        const parsed = DeviceConfigSchema.safeParse(config)
        if (!parsed.success) {
            throw new ProtocolError(`Invalid settings: ${issueText(parsed.error)}`)
        }
        if (parsed.data.personality !== target.personality) {
            throw new ProtocolError(
                `a ${parsed.data.personality} config cannot go to a ${target.personality}`,
            )
        }
        // Read the version right before the push: the device refuses a commit
        // that does not move it forward, and another tool may have pushed since.
        const info = await deviceInfo()
        const version = (info.hasActive ? info.configVersion : 0) + 1
        const sensors = parsed.data.sensor ? await target.sensors?.() : undefined
        const blob = padToAlign(
            buildRemapprDeviceBlob(parsed.data, { configVersion: version, sensors }),
        )

        await push(blob, version)
        return version
    }

    return {
        personality: target.personality,
        writable: target.writable,
        read,
        write,
    }
}
