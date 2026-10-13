// Pattern check: Facade (Tier 1) — extended — buildDeviceConfigApi backs the
// `service.device` facade the way buildNodesApi backs `service.nodes`: the
// config verbs over plain universal frames, with the device document compiled
// and decoded by compilers/remappr/device.ts.
//
// The config of a device that is not a keyboard: the dongle's TBL_DONGLE, the
// mouse's TBL_MOUSE and TBL_RADIO (firmware docs/device-config-plan.md). These
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
import { RELAY_READ_RETRIES, type RemapprRpc } from './rpc'

type DevicePersonality = ConfigDevice['personality']

/** One universal request report: 64 − 0xE2 tag − UCH − 4-byte inner header
 *  leaves 51 bytes of arg, floored to the flash write block (the store writes
 *  each chunk straight to flash). */
const WRITE_CHUNK =
    Math.floor((64 - 1 - UCH_LEN - 4) / BLOB_ALIGN) * BLOB_ALIGN

export interface DeviceConfigTarget {
    personality: DevicePersonality
    /** 0 = the device on this transport; a short-id = a node behind the dongle. */
    targetNode?: number
    /** The document's meta.name (the blob does not carry one). */
    name: string
    /** False for a node reached through the dongle: `write` then rejects. */
    writable: boolean
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

/** The `service.device` facade for a dongle or a mouse. */
export function buildDeviceConfigApi(
    rpc: RemapprRpc,
    target: DeviceConfigTarget,
): DeviceConfigApi {
    const node = target.targetNode ?? 0
    const relayOpts = node ? { targetNode: node } : undefined
    const readOpts = node
        ? { targetNode: node, retries: RELAY_READ_RETRIES }
        : undefined

    async function call(cmd: number, arg?: Uint8Array) {
        return rpc.callUniversalPlain(Namespace.COMMON, cmd, arg, relayOpts)
    }

    async function callOk(cmd: number, label: string, arg?: Uint8Array) {
        const r = await call(cmd, arg)
        if (r.status !== Status.OK) {
            throw new ProtocolError(`${label} failed: ${statusName(r.status)}`)
        }
    }

    async function deviceInfo(): Promise<DeviceInfo> {
        const r = await rpc.callUniversalPlain(
            Namespace.COMMON,
            Cmd.GET_DEVICE_INFO,
            undefined,
            readOpts,
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
        const { dongle, mouse, radio } = decoded
        return {
            config: {
                ...emptyDeviceConfig(target.personality, target.name),
                ...(dongle ? { dongle } : {}),
                ...(mouse ? { mouse } : {}),
                ...(radio ? { radio } : {}),
            },
            configVersion: decoded.configVersion ?? info.configVersion,
            stored: true,
        }
    }

    async function write(config: ConfigDevice): Promise<number> {
        if (!target.writable) {
            throw new ProtocolError(
                'Read-only node view: saving to a node through the dongle is not ' +
                    'supported yet. Connect the device over USB.',
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
        const blob = padToAlign(
            buildRemapprDeviceBlob(parsed.data, { configVersion: version }),
        )

        await callOk(Cmd.WRITE_CONFIG_BEGIN, 'WRITE_CONFIG_BEGIN')
        for (let off = 0; off < blob.length; off += WRITE_CHUNK) {
            await callOk(
                Cmd.WRITE_CONFIG_CHUNK,
                'WRITE_CONFIG_CHUNK',
                blob.subarray(off, Math.min(off + WRITE_CHUNK, blob.length)),
            )
        }
        const validate = await call(Cmd.VALIDATE_CONFIG)
        if (validate.status !== Status.OK) {
            await call(Cmd.ROLLBACK_CONFIG).catch(() => undefined)
            throw new ProtocolError(
                `The device refused the settings (VALIDATE_CONFIG: ${statusName(validate.status)})`,
            )
        }
        await callOk(Cmd.COMMIT_CONFIG, 'COMMIT_CONFIG')
        return version
    }

    return {
        personality: target.personality,
        writable: target.writable,
        read,
        write,
    }
}
