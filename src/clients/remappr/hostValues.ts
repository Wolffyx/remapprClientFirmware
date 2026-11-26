// Pattern check: Facade (Tier 1) — applied — HostValuesApi hides HOST-namespace framing, key ids and text chunking behind name-based calls, as SensorApi does for PART.
//
// The HOST namespace (firmware include/remappr/host_values.h, display part
// design §4): the keys a device's screens show, and the values this computer
// pushes for them. SET_VALUE and CLEAR are mutating: they ride `callMutation`,
// sealed (§19) when the RPC holds a session. A value expires on the device
// unless it is pushed again (INT and TEXT after 5 s by default, TIME after
// 24 h), so a host refreshes what GET_KEYS lists.
import type { HostValuesApi } from '../../service'
import { type DiscoveryResult, servesNamespace } from './discovery'
import { Namespace, Status, statusName } from './protocol'
import { type CallTarget, once, type RemapprRpc, repeatable } from './rpc'
import { type HostValueType, hostKeyById, hostKeyOf } from './screenRegistry'

export const HostVerb = { GET_KEYS: 0x01, SET_VALUE: 0x02, CLEAR: 0x03 } as const

const TYPE_CODE: Record<HostValueType, number> = { int: 0, text: 1, time: 2 }

/** Bytes of value one SET carries; the longest text. */
export const HOST_DATA_MAX = 20
export const HOST_TEXT_MAX = 64
/** Highest key the device stores (REMAPPR_HOST_KEY_MAX). */
export const HOST_KEY_MAX = 0x3f

/** True when the device serves the HOST namespace in a version this client
 *  decodes (its manifest ns_version, where it sends one). */
export function servesHost(discovery: DiscoveryResult): boolean {
    return servesNamespace(discovery, Namespace.HOST)
}

/** GET_HOST_KEYS reply (`u8 ver = 1, u8 n, n x u8 key`) -> key ids. */
export function parseHostKeys(data: Uint8Array): number[] {
    if (data.length < 2) throw new Error(`GET_HOST_KEYS reply too short (${data.length} B)`)
    if (data[0] !== 1) throw new Error(`GET_HOST_KEYS reply version ${data[0]} not supported`)
    if (data.length < 2 + data[1]) {
        throw new Error(`GET_HOST_KEYS reply lists ${data[1]} keys in ${data.length} B`)
    }
    return Array.from(data.subarray(2, 2 + data[1]))
}

/** UTF-8 of @p text cut to HOST_TEXT_MAX bytes, never inside a character. */
function hostText(text: string): Uint8Array {
    const raw = new TextEncoder().encode(text)
    if (raw.length <= HOST_TEXT_MAX) return raw
    let end = HOST_TEXT_MAX
    while (end > 0 && (raw[end] & 0xc0) === 0x80) end-- // a continuation byte
    return raw.subarray(0, end)
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
    const text = hostText(String(value))
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
    const check = (name: string, status: number): void => {
        if (status !== Status.OK) throw new Error(`${name} → ${statusName(status)}`)
    }
    // A mutating verb: sealed when the RPC holds a session.
    const mutate = async (verb: number, name: string, arg: Uint8Array | undefined, to?: CallTarget) =>
        check(name, (await rpc.callMutation(Namespace.HOST, verb, arg, to)).status)
    return {
        async keys() {
            const reply = await rpc.callUniversalPlain(
                Namespace.HOST,
                HostVerb.GET_KEYS,
                undefined,
                repeatable(targetNode),
            )
            check('GET_HOST_KEYS', reply.status)
            return parseHostKeys(reply.data).map((k) => hostKeyById(k).name)
        },
        async set(name, value) {
            const key = hostKeyOf(name)
            if (!key) throw new Error(`"${name}" is not a host value`)
            if (key.key < 1 || key.key > HOST_KEY_MAX) {
                throw new Error(`host value key ${key.key} out of range (1..${HOST_KEY_MAX})`)
            }
            const args = buildHostSetArgs(key.key, key.type, value)
            // A number is absolute: through the dongle it may ride the relay
            // retries. Text pieces go once each: the device takes them only in
            // order, so a resent piece would be out of order.
            const to = key.type === 'text' ? once(targetNode) : repeatable(targetNode)
            for (const arg of args) await mutate(HostVerb.SET_VALUE, `SET_HOST_VALUE ${name}`, arg, to)
        },
        async clear() {
            await mutate(HostVerb.CLEAR, 'CLEAR_HOST_VALUES', undefined, repeatable(targetNode))
        },
    }
}
