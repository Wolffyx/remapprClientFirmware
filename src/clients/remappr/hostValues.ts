// Pattern check: Facade (Tier 1) — applied — HostValuesApi hides HOST-namespace framing, key ids and text chunking behind name-based calls, as SensorApi does for PART.
//
// The HOST namespace (firmware include/remappr/host_values.h, display part
// design §4): the keys a device's screens show, and the values this computer
// pushes for them.
import type { HostValuesApi } from '../../service'
import type { DiscoveryResult } from './discovery'
import { Namespace, Status, statusName } from './protocol'
import { type RemapprRpc } from './rpc'
import { type HostValueType, hostKeyById, hostKeyOf } from './screenRegistry'

export const HostVerb = { GET_KEYS: 0x01, SET_VALUE: 0x02, CLEAR: 0x03 } as const

const TYPE_CODE: Record<HostValueType, number> = { int: 0, text: 1, time: 2 }

/** Bytes of value one SET carries; the longest text. */
export const HOST_DATA_MAX = 20
export const HOST_TEXT_MAX = 64

/** True when the device lists the HOST namespace. */
export function servesHost(discovery: DiscoveryResult): boolean {
    return !!discovery.personality?.namespaces?.some((n) => n.namespace === Namespace.HOST)
}

/** GET_HOST_KEYS reply -> key ids. */
export function parseHostKeys(data: Uint8Array): number[] {
    if (data.length < 2) throw new Error('GET_HOST_KEYS reply too short')
    return Array.from(data.subarray(2, 2 + data[1]))
}

const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

/** Local seconds since 1970 (the device shows what it gets, no zone). */
export const localSeconds = (d: Date): number =>
    Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60

/** The SET_HOST_VALUE args for one value: one for a number or a time, one per
 *  20-byte piece of a text (an empty text is one empty piece). */
export function buildHostSetArgs(
    key: number,
    type: HostValueType,
    value: number | string | Date,
): Uint8Array[] {
    const code = TYPE_CODE[type]
    if (type !== 'text') {
        const num = value instanceof Date ? localSeconds(value) : Number(value)
        return [new Uint8Array([key, code, 0, 4, ...le32(num)])]
    }
    const text = new TextEncoder().encode(String(value)).subarray(0, HOST_TEXT_MAX)
    const pieces: Uint8Array[] = []
    for (let off = 0; off === 0 || off < text.length; off += HOST_DATA_MAX) {
        const piece = text.subarray(off, off + HOST_DATA_MAX)
        pieces.push(new Uint8Array([key, code, off, text.length, ...piece]))
    }
    return pieces
}

/** The HOST facade over @p rpc, to the device itself or (`targetNode`) a
 *  node behind the dongle. */
export function buildHostValuesApi(rpc: RemapprRpc, opts: { targetNode?: number } = {}): HostValuesApi {
    const targetNode = opts.targetNode ?? 0
    const call = async (verb: number, name: string, arg?: Uint8Array): Promise<Uint8Array> => {
        const reply = await rpc.callUniversalPlain(Namespace.HOST, verb, arg, { targetNode })
        if (reply.status !== Status.OK) throw new Error(`${name} → ${statusName(reply.status)}`)
        return reply.data
    }
    return {
        async keys() {
            return parseHostKeys(await call(HostVerb.GET_KEYS, 'GET_HOST_KEYS')).map(
                (k) => hostKeyById(k).name,
            )
        },
        async set(name, value) {
            const key = hostKeyOf(name)
            if (!key) throw new Error(`"${name}" is not a host value`)
            for (const arg of buildHostSetArgs(key.key, key.type, value)) {
                await call(HostVerb.SET_VALUE, 'SET_HOST_VALUE', arg)
            }
        },
        async clear() {
            await call(HostVerb.CLEAR, 'CLEAR_HOST_VALUES')
        },
    }
}
