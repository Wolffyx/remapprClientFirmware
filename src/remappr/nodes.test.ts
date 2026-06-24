// pattern-check: skip — node-enumeration test fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import { getNodeInfo, listNodes } from './nodes'
import {
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    Status,
    type NodeRecord,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

// One 13-byte §5.9 node record.
function rec(
    shortId: number,
    personality: number,
    pipe: number,
    flags: number,
    hop: number,
    rssi: number,
    tail: number[],
): Uint8Array {
    const b = new Uint8Array(NODE_RECORD_LEN)
    const dv = new DataView(b.buffer)
    dv.setUint16(0, shortId, true)
    b[2] = personality
    b[3] = pipe
    b[4] = flags
    b[5] = hop
    b[6] = rssi & 0xff // i8 two's-complement
    b.set(tail, 7)
    return b
}

// A RemapprRpc whose only live method is callUniversalPlain.
function fakeRpc(
    handler: (
        ns: number,
        verb: number,
        arg?: Uint8Array,
    ) => Promise<UniversalReply>,
): RemapprRpc {
    return {
        callUniversalPlain: (ns: number, verb: number, arg?: Uint8Array) =>
            handler(ns, verb, arg),
    } as unknown as RemapprRpc
}

describe('node enumeration (DONGLE namespace)', () => {
    it('parses a packed LIST_NODES reply (signed rssi, flags, id tail)', async () => {
        const data = new Uint8Array([
            ...rec(7, 0x10, 3, 0x03, 1, -40, [1, 2, 3, 4, 5, 6]),
            ...rec(9, 0x11, 4, 0x01, 2, -70, [0xaa, 0xbb, 0, 0, 0, 0]),
        ])
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.LIST_NODES)
            return { status: Status.OK, data }
        })
        const nodes = await listNodes(rpc)
        expect(nodes).toHaveLength(2)
        expect(nodes[0]).toEqual<NodeRecord>({
            shortId: 7,
            personality: 0x10,
            pipe: 3,
            online: true,
            bonded: true,
            hopCount: 1,
            rssi: -40,
            deviceIdTail: '010203040506',
        })
        expect(nodes[1].bonded).toBe(false)
        expect(nodes[1].online).toBe(true)
        expect(nodes[1].rssi).toBe(-70)
        expect(nodes[1].deviceIdTail).toBe('aabb00000000')
    })

    it('returns [] when the device is not a dongle (ERR_CMD)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        expect(await listNodes(rpc)).toEqual([])
    })

    it('ignores a trailing partial record', async () => {
        const data = new Uint8Array([
            ...rec(1, 0, 0, 0, 0, 0, [0, 0, 0, 0, 0, 0]),
            0xff,
            0xff, // 2 stray bytes < one record
        ])
        const rpc = fakeRpc(async () => ({ status: Status.OK, data }))
        expect(await listNodes(rpc)).toHaveLength(1)
    })

    it('getNodeInfo sends the short-id arg and returns the record or null', async () => {
        const r = rec(7, 0x10, 3, 0x03, 1, -40, [1, 2, 3, 4, 5, 6])
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(verb).toBe(DongleVerb.GET_NODE_INFO)
            expect(new DataView(arg!.buffer).getUint16(0, true)).toBe(7)
            return { status: Status.OK, data: r }
        })
        expect((await getNodeInfo(rpc, 7))?.shortId).toBe(7)

        const miss = fakeRpc(async () => ({
            status: Status.ERR_ARG,
            data: new Uint8Array(),
        }))
        expect(await getNodeInfo(miss, 99)).toBeNull()
    })
})
