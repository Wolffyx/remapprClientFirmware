// pattern-check: skip — test wiring: byte-level fixtures for the layout-chunk
// parser; no GoF abstraction.
import { describe, expect, it } from 'vitest'

import {
    EVT_ROLE,
    Fn,
    HwCap,
    parseClusterDiag,
    InputClass,
    InputForm,
    InputShape,
    INPUT_NONE,
    parseInputLayoutPage,
    parseKeyLayoutChunk,
    parsePersonalityMap,
    parseClusterInfo,
    parseClusterMembers,
    parseClusterLatency,
    latencyPercentileUs,
    buildClusterLatencyArg,
    parseClusterEvent,
    parseClusterConfigRefused,
    ClusterRefuse,
    buildClusterSetIdArg,
    buildClusterSetSideArg,
    buildClusterSplitArg,
    buildClusterRelay,
    unwrapClusterRelay,
    CLUSTER_RELAY_FRAME_MAX,
    buildUniversal,
    buildRequest,
    parseUch,
    ClusterSide,
    KNOWN_NS_VERSION,
    Namespace,
    parseRoleEvent,
    parseUchEvent,
    reportsHwCap,
} from './protocol'

/** Build a GET_KEY_LAYOUT chunk: [total u16][start u16][count u8][entries×16].
 *  `bodyEntries` is how many 16-byte entries are actually present, which may be
 *  fewer than the declared `count` to model a lost middle fragment. */
function chunk(total: number, start: number, count: number, bodyEntries = count) {
    const d = new Uint8Array(5 + bodyEntries * 16)
    d[0] = total & 0xff
    d[1] = (total >> 8) & 0xff
    d[2] = start & 0xff
    d[3] = (start >> 8) & 0xff
    d[4] = count
    // a recognisable keycode per entry so a well-formed parse is verifiable
    for (let i = 0; i < bodyEntries; i++) d[5 + i * 16] = 0x04 + i
    return d
}

describe('parseKeyLayoutChunk', () => {
    it('parses a complete chunk', () => {
        const out = parseKeyLayoutChunk(chunk(15, 0, 2))
        expect(out.total).toBe(15)
        expect(out.start).toBe(0)
        expect(out.count).toBe(2)
        expect(out.positions).toHaveLength(2)
        expect(out.positions[0].keycode).toBe(0x04)
        expect(out.positions[1].keycode).toBe(0x05)
    })

    it('accepts an empty (count 0) chunk', () => {
        const out = parseKeyLayoutChunk(chunk(0, 0, 0))
        expect(out.count).toBe(0)
        expect(out.positions).toHaveLength(0)
    })

    it('rejects a truncated chunk (a lost middle FRAG fragment) instead of reading past the buffer', () => {
        // header declares 15 entries but the reassembled body carries only 13 —
        // exactly the "209 B for 15 entries" split-tier relay truncation.
        expect(() => parseKeyLayoutChunk(chunk(15, 0, 15, 13))).toThrow(/truncated/)
    })
})

describe('parseClusterDiag (§N4b-3)', () => {
    it('parses the local role and per-peer status', () => {
        // version | role=coord | flags | u16 term | count=2, then a
        // ready+seen follower and an unseen coordinator (term 5, hb 0x01).
        const d = new Uint8Array([
            1, 1, 0, 0, 0, 2,
            0x03, 0, 0, 0, 0,
            0x00, 1, 5, 0, 1,
        ])
        const out = parseClusterDiag(d)
        expect(out.coordinator).toBe(true)
        expect(out.localTerm).toBe(0)
        expect(out.peers).toHaveLength(2)
        expect(out.peers[0]).toMatchObject({
            coordinator: false,
            ready: true,
            seen: true,
        })
        expect(out.peers[1]).toMatchObject({
            coordinator: true,
            term: 5,
            hbFlags: 1,
            ready: false,
            seen: false,
        })
    })

    it('leaves modeADrops undefined when the reply has no §N4c tail', () => {
        // 2 peers, tail-less (§N4b-3 build / follower / mode-B): 6 + 2*5 = 16 B.
        const d = new Uint8Array([1, 0, 0, 0, 0, 2, 0x03, 0, 0, 0, 0, 0x03, 0, 0, 0, 0])
        expect(parseClusterDiag(d).modeADrops).toBeUndefined()
    })

    it('decodes the §N4c mode-A drop-counter tail when present', () => {
        // 1 peer, then the 8-byte tail {u32 no_node=7, u32 oob=0x0102} LE.
        const d = new Uint8Array([
            1, 1, 0, 0, 0, 1,
            0x03, 0, 0, 0, 0,
            7, 0, 0, 0, 0x02, 0x01, 0, 0,
        ])
        expect(parseClusterDiag(d).modeADrops).toEqual({ noNode: 7, oob: 0x0102 })
    })

    it('rejects an unknown reply version', () => {
        expect(() => parseClusterDiag(new Uint8Array([9, 0, 0, 0, 0, 0]))).toThrow(
            /version/,
        )
    })
})

describe('parseUchEvent + parseRoleEvent (§N4b-3)', () => {
    it('decodes a role-transition event frame', () => {
        // [0xE2][UCH ver2, ns COMMON, flags EVENT, rid][event_id ROLE | seq |
        // u16 len 4 | payload role=coord, flags 0, term 5].
        const frame = new Uint8Array([
            0xe2, 2, 0x00, 0x02, 0xff, 0, 0, 0, 0,
            EVT_ROLE, 0, 4, 0,
            1, 0, 5, 0,
        ])
        const evt = parseUchEvent(frame)
        expect(evt.eventId).toBe(EVT_ROLE)
        expect(evt.payload).toHaveLength(4)
        const role = parseRoleEvent(evt.payload)
        expect(role.coordinator).toBe(true)
        expect(role.term).toBe(5)
    })
})

describe('HwCap', () => {
    it('matches the firmware capability bits', () => {
        // include/remappr/capabilities.h — a wire ABI, append-only.
        expect(HwCap.FLASH_STORAGE).toBe(1 << 16)
        expect(HwCap.ANALOG_AXES).toBe(1 << 17)
        expect(HwCap.HID_GAMEPAD).toBe(1 << 24)
    })

    it('treats 0 as not reported', () => {
        expect(reportsHwCap(0, HwCap.POINTER)).toBeUndefined()
        expect(reportsHwCap(undefined, HwCap.POINTER)).toBeUndefined()
        expect(reportsHwCap(HwCap.POINTER, HwCap.POINTER)).toBe(true)
        expect(reportsHwCap(HwCap.USB, HwCap.POINTER)).toBe(false)
    })
})

describe('parseInputLayoutPage (input-layout plan §2)', () => {
    // The firmware golden (tests/input_layout lmb_wire): a mouse's left button,
    // rotated -15° about (0.75, 1.5).
    const LMB = [
        0x01, 0x0d, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x96, 0x00,
        0x2c, 0x01, 0x24, 0xfa, 0x4b, 0x00, 0x96, 0x00,
    ]
    const page = (count: number, entries: number[]) =>
        Uint8Array.from([1, InputForm.MOUSE, 4, 0, 1, 0, count, ...entries])

    it('decodes the firmware golden entry', () => {
        const p = parseInputLayoutPage(page(1, LMB))
        expect(p).toMatchObject({ version: 1, form: 3, total: 4, start: 1 })
        expect(p.entries).toEqual([
            {
                cls: InputClass.BUTTON,
                shape: InputShape.MOUSE_LEFT,
                inputId: 0x0100,
                position: 0,
                x: 0,
                y: 0,
                w: 150,
                h: 300,
                rot: -1500,
                rotx: 75,
                roty: 150,
            },
        ])
    })

    it('reads an unbound position as INPUT_NONE', () => {
        const wheel = [...LMB]
        wheel[0] = InputClass.WHEEL
        wheel[4] = 0xff
        wheel[5] = 0xff
        expect(parseInputLayoutPage(page(1, wheel)).entries[0]!.position).toBe(
            INPUT_NONE,
        )
    })

    it('rejects a page shorter than its count', () => {
        expect(() => parseInputLayoutPage(page(2, LMB))).toThrow(/truncated/)
        expect(() => parseInputLayoutPage(Uint8Array.of(1, 0, 0))).toThrow(
            /too short/,
        )
    })
})

describe('GET_PERSONALITY_MAP tails (§3.4)', () => {
    // role, personality, proto 2, one namespace record, then u32 hw_caps.
    const head = [0, 1, 2, 1, 0x00, 0xff, 0xff, 0x02, 0, 0, 0]

    it('reads the u32 after hw_caps', () => {
        const pm = parsePersonalityMap(Uint8Array.from([...head, 0x07, 0, 0, 0]))
        expect(pm.hwCaps).toBe(0x02)
        expect(pm.functionBits).toBe(Fn.KBD | Fn.CONSUMER | Fn.SYSCTRL)
    })

    it('leaves it undefined on firmware from before the tail', () => {
        const pm = parsePersonalityMap(Uint8Array.from(head))
        expect(pm.hwCaps).toBe(0x02)
        expect(pm.functionBits).toBeUndefined()
    })

    it('reads the cluster_id and uid after function_bits', () => {
        const fns = [...head, 0x07, 0, 0, 0]
        const id = [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]
        const uid = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7]
        const pm = parsePersonalityMap(Uint8Array.from([...fns, ...id, 8, ...uid]))
        expect(pm.functionBits).toBe(0x07)
        expect(pm.clusterId).toBe(0x1122334455667788n)
        expect(Array.from(pm.uid!)).toEqual(uid)

        const none = parsePersonalityMap(Uint8Array.from([...fns, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
        expect(none.clusterId).toBe(0n)
        expect(none.uid!.length).toBe(0)

        // Firmware from before the tail, or a uid cut short: no identity.
        expect(parsePersonalityMap(Uint8Array.from(fns)).clusterId).toBeUndefined()
        const cut = parsePersonalityMap(Uint8Array.from([...fns, ...id, 8, 0xa0]))
        expect(cut.clusterId).toBeUndefined()
        expect(cut.uid).toBeUndefined()
    })

    it('keeps the firmware bit values (include/remappr/function.h)', () => {
        expect(Fn).toEqual({ KBD: 0x01, CONSUMER: 0x02, SYSCTRL: 0x04, POINTER: 0x08, GAMEPAD: 0x10 })
    })
})

describe('CLUSTER namespace (§7.1)', () => {
    it('is known at ns_version 1', () => {
        expect(Namespace.CLUSTER).toBe(0x0c)
        expect(KNOWN_NS_VERSION[Namespace.CLUSTER]).toBe(1)
    })

    it('parses GET_CLUSTER_INFO', () => {
        const d = Uint8Array.from([
            0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 3, 0, 1, 0x02, 0x01, 3, 2, 1, 0x01,
        ])
        const i = parseClusterInfo(d)
        expect(i.id).toBe(0x1122334455667788n)
        expect(i.idSource).toBe(3)
        expect(i.coordinated).toBe(true)
        expect(i.physical).toBe(true)
        expect(i.coordinator).toBe(0x0102)
        expect(i.mySide).toBe(ClusterSide.RIGHT)
        expect(i.locked).toBe(true)
        expect(i.skew).toBe(false)
        expect(() => parseClusterInfo(d.slice(0, 16))).toThrow(/needs 17/)
    })

    it('parses a GET_LATENCY reply and its percentiles (§11.1)', () => {
        const counts = [0, 0, 98, 0, 1, 0, 0, 0, 0, 0, 0, 1]
        const d = Uint8Array.from([1, 2, 0, 1, 12, 7, ...counts.flatMap((c) => [c, 0])])
        const r = parseClusterLatency(d)
        expect(r.shortId).toBe(2)
        expect(r.link).toBe(1)
        expect(r.buckets[0]).toEqual({ belowUs: 128, count: 0 })
        expect(r.buckets[11]).toEqual({ belowUs: null, count: 1 })
        expect(latencyPercentileUs(r.buckets, 50)).toBe(512)
        expect(latencyPercentileUs(r.buckets, 99)).toBe(2048)
        expect(latencyPercentileUs(r.buckets, 100)).toBeNull()
        expect(Array.from(buildClusterLatencyArg(0x0102, true))).toEqual([2, 1, 1])
        expect(() => parseClusterLatency(d.slice(0, 20))).toThrow(/truncated/)
    })

    it('parses a GET_MEMBERS page', () => {
        const rec = [0x05, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 1, 0x0f, 0, 0, 0, 1, 4, 0xff, 1, 2, 3, 0xff, 0xff]
        const p = parseClusterMembers(Uint8Array.from([3, 1, ...rec]))
        expect(p.total).toBe(3)
        expect(p.members).toHaveLength(1)
        const m = p.members[0]
        expect(m.shortId).toBe(5)
        expect(Array.from(m.uid)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(m.functionBits).toBe(0x0f)
        expect(m.battery).toBeNull()
        expect(m.fw).toEqual([1, 2, 3])
        expect(m.positionBase).toBeNull()
        expect(() => parseClusterMembers(Uint8Array.from([3, 1, ...rec.slice(0, 22)]))).toThrow(/truncated/)
    })

    it('builds the identity verb args', () => {
        expect(Array.from(buildClusterSetIdArg(0x0102030405060708n))).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
        expect(Array.from(buildClusterSetSideArg(ClusterSide.NONE))).toEqual([0, 0, 0xff])
        expect(Array.from(buildClusterSplitArg())).toEqual([0, 0])
        expect(() => buildClusterSetSideArg(256)).toThrow(/out of range/)
    })

    it('parses a membership event', () => {
        const e = parseClusterEvent(Uint8Array.from([0x05, 0x00, 2, 0xaa, 0xbb]))
        expect(e.shortId).toBe(5)
        expect(Array.from(e.uid)).toEqual([0xaa, 0xbb])
        expect(() => parseClusterEvent(Uint8Array.from([5, 0, 2, 0xaa]))).toThrow(/truncated/)
        const r = parseClusterConfigRefused(
            Uint8Array.from([2, 0, 9, 0x96, 0, 0, 0, 0xd4, 0xc3, 0xb2, 0xa1, ClusterRefuse.TABLE]),
        )
        expect(r).toEqual({ shortId: 2, version: 0x96, crc: 0xa1b2c3d4, reason: ClusterRefuse.TABLE })
        expect(() => parseClusterConfigRefused(Uint8Array.from([2, 0, 9, 1]))).toThrow(/truncated/)
    })
})

describe('CLUSTER.RELAY nesting (§7.3, §7.4)', () => {
    it('nests a member frame for the attached node', () => {
        const member = buildUniversal(0x0c, 7, buildRequest(0x01, 9, new Uint8Array()), 2)
        const outer = buildClusterRelay(5, 3, member, 1)
        const uch = parseUch(outer, 1)
        expect(uch.namespace).toBe(0x0c)
        expect(uch.requestId).toBe(5)
        expect(uch.targetNode).toBe(1) // the dongle pipe of the attached node
        expect(outer[9]).toBe(0x07) // RELAY
        expect(outer[11] | (outer[12] << 8)).toBe(member.length)
        expect(Array.from(outer.subarray(13))).toEqual(Array.from(member))
        expect(parseUch(outer, 14).targetNode).toBe(2) // the member's short-id
        expect(outer.length).toBe(member.length + 13)
    })

    it('refuses a frame too big for one report', () => {
        expect(() => buildClusterRelay(1, 1, new Uint8Array(CLUSTER_RELAY_FRAME_MAX + 1))).toThrow(/too big/)
    })

    it('unwraps the member reply by its request id', () => {
        const reply = buildUniversal(0x0c, 7, Uint8Array.of(0x01, 9, 0, 0, 0, 0))
        expect(unwrapClusterRelay(reply, 7)).toBe(reply)
        expect(() => unwrapClusterRelay(reply, 8)).toThrow(/another member request/)
        expect(() => unwrapClusterRelay(Uint8Array.of(0, 1), 7)).toThrow(/no member frame/)
    })
})
