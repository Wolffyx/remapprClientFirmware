// pattern-check: skip — node-enumeration test fixtures against a fake rpc.
import { describe, expect, it } from 'vitest'
import {
    changeChannels,
    clearAllBonds,
    enterDongleBootloader,
    forgetNode,
    getErrorCounters,
    getLinkStats,
    getNodeInfo,
    getPipeTable,
    listNodes,
    openPairWindow,
    setDongleNkro,
} from './nodes'
import {
    CommonVerb,
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    RELAY_STATS,
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
            charging: false,
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
        // version 1, 2 channels, gen 7, pool 6, window 64 LE, fail 25%, flags:
        // a channel change rolling out.
        const reply = new Uint8Array([
            1, 2, 7, 6, 64, 0, 25, 1,
            // ch 2: last verdict 12 %, ok 300 (0x012c), fail 5
            2, 12, 0x2c, 0x01, 5, 0,
            // ch 79: no verdict yet (0xff), ok 10, fail 260 (0x0104)
            79, 0xff, 10, 0, 0x04, 0x01,
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
        expect(stats.changeInProgress).toBe(true)
        expect(stats.channels).toEqual([
            { channel: 2, ok: 300, fail: 5, lastFailPercent: 12 },
            { channel: 79, ok: 10, fail: 260, lastFailPercent: null },
        ])
    })

    it('changeChannels sends the mode and decodes the planned map', async () => {
        const calls: (Uint8Array | undefined)[] = []
        const rpc = fakeRpc(async (ns, verb, arg) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.CHANGE_CHANNELS)
            calls.push(arg)
            // version 1, 2 planned, gen 9 when done, 8 channels
            return {
                status: Status.OK,
                data: new Uint8Array([1, 2, 9, 8, 2, 62, 14, 20, 26, 50, 38, 44]),
            }
        })
        const change = await changeChannels(rpc, {
            kind: 'list',
            channels: [62, 2, 14, 20, 26, 38, 44, 50],
        })
        expect(change).toEqual({
            planned: 2,
            mapGeneration: 9,
            channels: [2, 62, 14, 20, 26, 50, 38, 44],
        })
        await changeChannels(rpc, { kind: 'bad' })
        expect(Array.from(calls[0]!)).toEqual([1, 8, 62, 2, 14, 20, 26, 38, 44, 50])
        expect(Array.from(calls[1]!)).toEqual([0])
    })

    it('changeChannels rejects a busy dongle or a short reply', async () => {
        const busy = fakeRpc(async () => ({
            status: Status.ERR_STATE,
            data: new Uint8Array(),
        }))
        await expect(changeChannels(busy, { kind: 'bad' })).rejects.toThrow(
            /CHANGE_CHANNELS → ERR_STATE/,
        )
        const truncated = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([1, 1, 3, 8, 2, 8]),
        }))
        await expect(changeChannels(truncated, { kind: 'bad' })).rejects.toThrow(
            /truncated/,
        )
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

describe('pipe-table diagnostics (DONGLE.GET_PIPE_TABLE)', () => {
    // One 8-byte pipe record for the fixture reply.
    function pipeRec(
        pipe: number,
        flags: number,
        shortId: number,
        dtype = 0,
        role = 0,
        owner = 0xff,
        hops = 0,
    ): number[] {
        return [pipe, flags, shortId & 0xff, shortId >> 8, dtype, role, owner, hops]
    }

    it('parses the header + per-pipe flags/owner', async () => {
        const data = new Uint8Array([
            1, 2, 1, 3, // version 1, 2 records, pair window OPEN, pipe 3 reserved
            // bonded+session+online+id+leased, short 0x0001, dtype 1, role 0x11, USB owner, hop 0
            ...pipeRec(1, 0x1f, 0x0001, 1, 0x11, 0, 0),
            // bonded only (incomplete bond, no id), short 0
            ...pipeRec(2, 0x01, 0x0000),
        ])
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.DONGLE)
            expect(verb).toBe(DongleVerb.GET_PIPE_TABLE)
            return { status: Status.OK, data }
        })
        const table = await getPipeTable(rpc)
        expect(table.pairWindowOpen).toBe(true)
        expect(table.pairPipe).toBe(3)
        expect(table.pipes).toHaveLength(2)
        expect(table.pipes[0]).toEqual({
            pipe: 1,
            bonded: true,
            session: true,
            online: true,
            hasId: true,
            leased: true,
            shortId: 1,
            deviceType: 1,
            nodeRole: 0x11,
            ctrlOwner: 0,
            hops: 0,
        })
        expect(table.pipes[1].bonded).toBe(true)
        expect(table.pipes[1].hasId).toBe(false)
        expect(table.pipes[1].ctrlOwner).toBeNull() // 0xff -> none
    })

    it('maps a closed pair window / no reserved pipe to null', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([1, 0, 0, 0]),
        }))
        const table = await getPipeTable(rpc)
        expect(table.pairWindowOpen).toBe(false)
        expect(table.pairPipe).toBeNull()
        expect(table.pipes).toEqual([])
    })

    it('rejects truncated / unknown-version replies and ERR_CMD', async () => {
        const truncated = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([1, 1, 0, 0, 1, 0]), // claims 1 record, carries 2 B
        }))
        await expect(getPipeTable(truncated)).rejects.toThrow(/truncated/)
        const badVersion = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([9, 0, 0, 0]),
        }))
        await expect(getPipeTable(badVersion)).rejects.toThrow(/version/)
        const notDongle = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(getPipeTable(notDongle)).rejects.toThrow(/GET_PIPE_TABLE/)
    })
})

describe('error counters (COMMON.GET_ERROR_COUNTERS)', () => {
    // 10-byte reply: version, flags, u32 mic, u16 chan_fail, u16 resync.
    function counters(
        flags: number,
        mic: number,
        chan: number,
        resync: number,
        version = 1,
    ): Uint8Array {
        const b = new Uint8Array(10)
        const dv = new DataView(b.buffer)
        b[0] = version
        b[1] = flags
        dv.setUint32(2, mic, true)
        dv.setUint16(6, chan, true)
        dv.setUint16(8, resync, true)
        return b
    }

    it('decodes the counters + radio-valid flag', async () => {
        const rpc = fakeRpc(async (ns, verb) => {
            expect(ns).toBe(Namespace.COMMON)
            expect(verb).toBe(CommonVerb.GET_ERROR_COUNTERS)
            return { status: Status.OK, data: counters(0x01, 70000, 12, 3) }
        })
        const ec = await getErrorCounters(rpc)
        expect(ec).toEqual({
            radioValid: true,
            micFail: 70000,
            txChanFail: 12,
            linkResync: 3,
            relay: null,
        })
    })

    it('decodes the relay tail in firmware enum order', async () => {
        const body = counters(0x03, 1, 2, 3)
        const tail = new Uint8Array(2 * RELAY_STATS.length)
        const tdv = new DataView(tail.buffer)
        RELAY_STATS.forEach((_, i) => tdv.setUint16(2 * i, 0x100 + i, true))
        const rpc = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([...body, ...tail]),
        }))
        const ec = await getErrorCounters(rpc)
        expect(ec.relay?.rxOk).toBe(0x100)
        expect(ec.relay?.rxAuth).toBe(0x103)
        expect(ec.relay?.txAcked).toBe(0x10b)
        expect(ec.relay?.txLinkLost).toBe(0x10f)
        expect(Object.keys(ec.relay ?? {})).toHaveLength(16)
    })

    it('ignores a relay tail that is unflagged or cut short', async () => {
        const tail = new Uint8Array(2 * RELAY_STATS.length).fill(1)
        const unflagged = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([...counters(0x01, 0, 0, 0), ...tail]),
        }))
        expect((await getErrorCounters(unflagged)).relay).toBeNull()
        const short = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([...counters(0x03, 0, 0, 0), 1, 0]),
        }))
        expect((await getErrorCounters(short)).relay).toBeNull()
    })

    it('relays with targetNode + retries and reports radio-invalid', async () => {
        let seenOpts: unknown
        const rpc = {
            callUniversalPlain: async (
                _ns: number,
                _verb: number,
                _arg?: Uint8Array,
                opts?: unknown,
            ) => {
                seenOpts = opts
                return { status: Status.OK, data: counters(0, 0, 0, 0) }
            },
        } as unknown as RemapprRpc
        const ec = await getErrorCounters(rpc, 7)
        expect(seenOpts).toMatchObject({ targetNode: 7 })
        expect(ec.radioValid).toBe(false)
    })

    it('rejects short / unknown-version replies and ERR_CMD', async () => {
        const short = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([1, 0, 0]),
        }))
        await expect(getErrorCounters(short)).rejects.toThrow(/short/)
        const badVersion = fakeRpc(async () => ({
            status: Status.OK,
            data: new Uint8Array([9, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        }))
        await expect(getErrorCounters(badVersion)).rejects.toThrow(/version/)
        const noSource = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(getErrorCounters(noSource)).rejects.toThrow(
            /GET_ERROR_COUNTERS/,
        )
    })
})

describe('enter bootloader (DONGLE.ENTER_BOOTLOADER)', () => {
    it('sends the "DFU!" confirmation on the DONGLE namespace', async () => {
        let seen: { ns: number; verb: number; arg?: Uint8Array } | undefined
        const rpc = fakeRpc(async (ns, verb, arg) => {
            seen = { ns, verb, arg }
            return { status: Status.OK, data: new Uint8Array() }
        })
        await enterDongleBootloader(rpc)
        expect(seen?.ns).toBe(Namespace.DONGLE)
        expect(seen?.verb).toBe(DongleVerb.ENTER_BOOTLOADER)
        expect(new TextDecoder().decode(seen?.arg)).toBe('DFU!')
    })

    it('throws when the board has no way into its bootloader', async () => {
        const rpc = fakeRpc(async () => ({
            status: Status.ERR_CMD,
            data: new Uint8Array(),
        }))
        await expect(enterDongleBootloader(rpc)).rejects.toThrow(
            /ENTER_BOOTLOADER/,
        )
    })
})
