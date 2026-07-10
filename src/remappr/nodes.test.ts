// pattern-check: skip — node-enumeration test fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import {
    clearAllBonds,
    forgetNode,
    getLinkStats,
    getNodeInfo,
    listNodes,
    openPairWindow,
    setDongleNkro,
} from './nodes'
import {
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    Status,
    type NodeRecord,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

// One 15-byte §5.9 node record. `batt` defaults to 0xff (unknown -> null);
// `role` (§5 election-role low byte) defaults to 0 (unknown, non-master).
function rec(
    shortId: number,
    personality: number,
    pipe: number,
    flags: number,
    hop: number,
    rssi: number,
    tail: number[],
    batt = 0xff,
    role = 0,
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
    b[13] = batt
    b[14] = role
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
            ...rec(7, 0x10, 3, 0x07, 1, -40, [1, 2, 3, 4, 5, 6], 85), // online+bonded+secured
            ...rec(9, 0x11, 4, 0x01, 2, -70, [0xaa, 0xbb, 0, 0, 0, 0]), // online only
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
            secured: true,
            hopCount: 1,
            rssi: -40,
            deviceIdTail: '010203040506',
            battery: 85,
            master: false,
            nodeRole: 0,
        })
        expect(nodes[1].bonded).toBe(false)
        expect(nodes[1].online).toBe(true)
        expect(nodes[1].secured).toBe(false) // online but no crypto session
        expect(nodes[1].rssi).toBe(-70)
        expect(nodes[1].deviceIdTail).toBe('aabb00000000')
        expect(nodes[1].battery).toBeNull() // 0xff -> unknown
        expect(nodes[1].master).toBe(false)
        expect(nodes[1].nodeRole).toBe(0)
    })

    it('decodes the §5 master flag + node_role byte', async () => {
        const data = new Uint8Array([
            // flags 0x0b = online+bonded+master; role 0x02 = CLUSTER_MAIN
            ...rec(7, 0x10, 3, 0x0b, 0, -40, [1, 2, 3, 4, 5, 6], 90, 0x02),
            // online only, no master bit, role 0
            ...rec(9, 0x11, 4, 0x01, 1, -70, [0, 0, 0, 0, 0, 0]),
        ])
        const rpc = fakeRpc(async () => ({ status: Status.OK, data }))
        const nodes = await listNodes(rpc)
        expect(nodes[0].master).toBe(true)
        expect(nodes[0].nodeRole).toBe(0x02)
        expect(nodes[1].master).toBe(false)
        expect(nodes[1].nodeRole).toBe(0)
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
        const rpc = fakeRpc(async (_ns, verb, arg) => {
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

describe('dongle pairing control (DONGLE namespace)', () => {
    it('openPairWindow sends the open flag and returns the window state', async () => {
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.OPEN_PAIR_WINDOW)
            expect(arg).toEqual(new Uint8Array([1]))
            return { status: Status.OK, data: new Uint8Array([1]) }
        })
        expect(await openPairWindow(rpc)).toBe(true)

        const close = fakeRpc(async (_ns, _verb, arg) => {
            expect(arg).toEqual(new Uint8Array([0]))
            return { status: Status.OK, data: new Uint8Array([0]) }
        })
        expect(await openPairWindow(close, false)).toBe(false)
    })

    it('openPairWindow throws when the roster is full (ERR_STATE)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_STATE,
            data: new Uint8Array(),
        }))
        await expect(openPairWindow(rpc)).rejects.toThrow(/OPEN_PAIR_WINDOW/)
    })

    it('forgetNode sends the short-id and resolves on OK', async () => {
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.FORGET_NODE)
            expect(new DataView(arg!.buffer).getUint16(0, true)).toBe(0x1234)
            return { status: Status.OK, data: new Uint8Array() }
        })
        await expect(forgetNode(rpc, 0x1234)).resolves.toBeUndefined()
    })

    it('forgetNode throws on an unknown short-id (ERR_ARG)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_ARG,
            data: new Uint8Array(),
        }))
        await expect(forgetNode(rpc, 99)).rejects.toThrow(/FORGET_NODE/)
    })

    it('clearAllBonds sends the verb (no arg) and returns the cleared count', async () => {
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.CLEAR_ALL_BONDS)
            expect(arg).toBeUndefined()
            return { status: Status.OK, data: new Uint8Array([5]) }
        })
        await expect(clearAllBonds(rpc)).resolves.toBe(5)
    })

    it('clearAllBonds defaults to 0 when the reply omits the count', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array(),
        }))
        await expect(clearAllBonds(rpc)).resolves.toBe(0)
    })

    it('clearAllBonds throws on a non-dongle device (ERR_CMD)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(clearAllBonds(rpc)).rejects.toThrow(/CLEAR_ALL_BONDS/)
    })

    it('setDongleNkro(true) sends arg [1] and returns the new state', async () => {
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.SET_NKRO)
            expect(arg).toEqual(new Uint8Array([1]))
            return { status: Status.OK, data: new Uint8Array([1]) }
        })
        await expect(setDongleNkro(rpc, true)).resolves.toBe(true)
    })

    it('setDongleNkro() with no arg queries without mutating', async () => {
        const rpc = fakeRpc(async (_ns, verb, arg) => {
            expect(verb).toBe(DongleVerb.SET_NKRO)
            expect(arg).toBeUndefined()
            return { status: Status.OK, data: new Uint8Array([0]) }
        })
        await expect(setDongleNkro(rpc)).resolves.toBe(false)
    })

    it('setDongleNkro throws on a non-dongle device (ERR_CMD)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(setDongleNkro(rpc, false)).rejects.toThrow(/SET_NKRO/)
    })

    it('getLinkStats decodes the header and per-channel records', async () => {
        // version 1, 2 channels, gen 7, pool 6, window 64 LE, fail 25%, rsvd.
        const reply = new Uint8Array([
            1, 2, 7, 6, 64, 0, 25, 0,
            // ch 2: ok 300 (0x012c), fail 5
            2, 0, 0x2c, 0x01, 5, 0,
            // ch 79: ok 10, fail 260 (0x0104)
            79, 0, 10, 0, 0x04, 0x01,
        ])
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.GET_LINK_STATS)
            expect(arg).toBeUndefined()
            return { status: Status.OK, data: reply }
        })
        const stats = await getLinkStats(rpc)
        expect(stats.mapGeneration).toBe(7)
        expect(stats.poolCount).toBe(6)
        expect(stats.window).toBe(64)
        expect(stats.failPercent).toBe(25)
        expect(stats.channels).toEqual([
            { channel: 2, ok: 300, fail: 5 },
            { channel: 79, ok: 10, fail: 260 },
        ])
    })

    it('getLinkStats rejects a truncated or unknown-version reply', async () => {
        const truncated = fakeRpc(async () => ({
            status: Status.OK,
            // header claims 2 channels but carries only one record
            data: new Uint8Array([1, 2, 0, 0, 64, 0, 25, 0, 2, 0, 1, 0, 0, 0]),
        }))
        await expect(getLinkStats(truncated)).rejects.toThrow(/truncated/)

        const badVersion = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([9, 0, 0, 0, 64, 0, 25, 0]),
        }))
        await expect(getLinkStats(badVersion)).rejects.toThrow(/version/)
    })

    it('getLinkStats throws on a non-dongle device (ERR_CMD)', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(getLinkStats(rpc)).rejects.toThrow(/GET_LINK_STATS/)
    })
})
