// pattern-check: skip — test wiring: a fake RemapprRpc routes the relayed
// discovery + config reads (§6.2 COMMON relay) to a real buildRemapprBlob fixture,
// so the node-view path is exercised end-to-end (roster → relayed read → decode →
// read-only service) without hardware. No GoF abstraction.
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../config'
import { buildRemapprBlob } from '../config/compilers/remappr'

import { buildNodesApi } from './nodeView'
import {
    Cmd,
    DongleVerb,
    Namespace,
    NODE_RECORD_LEN,
    Status,
} from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

/* ── seed config + active blob (the node's "active" config) ──────────────── */

const SEED_VERSION = 5

const SEED_CONFIG = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Node Test", "target": "zmk" },
    "keyboard": { "id": "nt", "name": "Node Test",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
    "layers": [
        { "name": "base", "bindings": ["A", "B", {"type":"transparent"}, "D"] },
        { "name": "fn", "bindings": [
            {"type":"transparent"}, {"type":"transparent"},
            {"type":"transparent"}, {"type":"transparent"}] }
    ]
}`)

const SEED_BLOB = buildRemapprBlob(SEED_CONFIG, {
    configVersion: SEED_VERSION,
}).blob

/* ── wire byte helpers ──────────────────────────────────────────────────── */

/** A 16-byte GET_DEVICE_INFO record: proto-v2, hasActive, fw 1.2.3. */
function deviceInfoBytes(): Uint8Array {
    const d = new Uint8Array(16)
    const dv = new DataView(d.buffer)
    dv.setUint16(0, 1, true) // protoMin
    dv.setUint16(2, 2, true) // protoMax = 2 (universal)
    dv.setUint16(4, 1, true) // schemaVersion
    d[6] = 1 // fwMajor
    d[7] = 2 // fwMinor
    d[8] = 3 // fwPatch
    dv.setUint16(9, 0, true) // hwRev
    d[11] = 1 // hasActive
    dv.setUint32(12, SEED_VERSION, true) // configVersion
    return d
}

/** Pack one DONGLE.LIST_NODES record (§5.9, 13 bytes). */
function nodeRecordBytes(
    shortId: number,
    personality: number,
    flags: number,
    hop: number,
    rssi: number,
    tail: number[],
): Uint8Array {
    const d = new Uint8Array(NODE_RECORD_LEN)
    const dv = new DataView(d.buffer)
    dv.setUint16(0, shortId, true)
    d[2] = personality
    d[3] = 1 // pipe
    d[4] = flags // bit0 online, bit1 bonded
    d[5] = hop
    d[6] = rssi & 0xff // i8
    for (let i = 0; i < 6; i++) d[7 + i] = tail[i] ?? 0
    return d
}

const ROSTER = new Uint8Array([
    ...nodeRecordBytes(0x0007, 2, 0x03, 0, -40, [1, 2, 3, 4, 5, 6]),
    ...nodeRecordBytes(0x0009, 4, 0x01, 1, -72, [9, 9, 9, 9, 9, 9]),
])

/* ── a fake RPC that answers the relayed reads ──────────────────────────── */

interface FakeRpc {
    rpc: RemapprRpc
    targets: number[] // targetNode of every relayed read seen
    closed: boolean
    closeCalls: number
}

function makeRpc(opts: { roster?: Uint8Array } = {}): FakeRpc {
    const state: FakeRpc = {
        targets: [],
        closed: false,
        closeCalls: 0,
        rpc: undefined as unknown as RemapprRpc,
    }
    const ok = (data: Uint8Array): UniversalReply => ({ status: Status.OK, data })
    const errCmd: UniversalReply = {
        status: Status.ERR_CMD,
        data: new Uint8Array(),
    }

    state.rpc = {
        async callUniversalPlain(
            namespace: number,
            verb: number,
            arg: Uint8Array = new Uint8Array(),
            o: { targetNode?: number } = {},
        ): Promise<UniversalReply> {
            const target = o.targetNode ?? 0
            if (namespace === Namespace.DONGLE && verb === DongleVerb.LIST_NODES) {
                return opts.roster ? ok(opts.roster) : errCmd
            }
            // Everything else is a relayed read addressed to a node.
            state.targets.push(target)
            if (namespace === Namespace.COMMON && verb === Cmd.GET_DEVICE_INFO) {
                return ok(deviceInfoBytes())
            }
            if (namespace === Namespace.COMMON && verb === Cmd.READ_CONFIG_CHUNK) {
                const dv = new DataView(arg.buffer, arg.byteOffset, arg.byteLength)
                const offset = dv.getUint32(0, true)
                if (offset >= SEED_BLOB.length) return ok(new Uint8Array())
                return ok(SEED_BLOB.subarray(offset, offset + 58))
            }
            // Personality / limits / keyboard geometry absent → forces the
            // synthetic-layout + 8-layer-default fallbacks. Read still succeeds.
            return errCmd
        },
        async callPlain() {
            return { cmd: 0, seq: 0, status: Status.ERR_CMD, data: new Uint8Array() }
        },
        async callSealed() {
            return { cmd: 0, seq: 0, status: Status.ERR_AUTH, data: new Uint8Array() }
        },
        async callSealedRelay() {
            return { cmd: 0, seq: 0, status: Status.ERR_AUTH, data: new Uint8Array() }
        },
        subscribeInput() {
            return () => undefined
        },
        onClosed() {
            return () => undefined
        },
        async close() {
            state.closeCalls++
            state.closed = true
        },
    } as unknown as RemapprRpc

    return state
}

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('buildNodesApi.list', () => {
    it('maps the DONGLE roster to firmware-neutral NodeViews', async () => {
        const { rpc } = makeRpc({ roster: ROSTER })
        const nodes = await buildNodesApi(rpc).list()

        expect(nodes).toHaveLength(2)
        expect(nodes[0]).toEqual({
            id: 0x0007,
            label: 'Node 0x0007',
            personality: 2,
            online: true,
            bonded: true,
            rssi: -40,
            hopCount: 0,
        })
        expect(nodes[1]).toMatchObject({
            id: 0x0009,
            label: 'Node 0x0009',
            online: true,
            bonded: false,
            rssi: -72,
            hopCount: 1,
        })
    })

    it('returns [] for a directly-attached (non-dongle) device', async () => {
        const { rpc } = makeRpc() // LIST_NODES → ERR_CMD
        expect(await buildNodesApi(rpc).list()).toEqual([])
    })
})

describe('buildNodesApi.open (read-only node view)', () => {
    it('assembles a relayed read into a read-only service', async () => {
        const { rpc, targets } = makeRpc({ roster: ROSTER })
        const svc = await buildNodesApi(rpc).open(0x0007)

        // Every relayed read addressed the node, not the dongle.
        expect(targets.length).toBeGreaterThan(0)
        expect(targets.every((t) => t === 0x0007)).toBe(true)

        // Read-only contract.
        expect(svc.capabilities.readOnly).toBe(true)
        expect(svc.capabilities.rename).toBe(false)
        expect(svc.capabilities.reorderLayers).toBe(false)
        expect(svc.capabilities.variableLayerCount).toBe(false)
        expect(svc.keyTest).toBeUndefined()
        expect(svc.nodes).toBeUndefined() // no nesting

        // Device identity comes from the relayed device-info.
        expect(svc.deviceInfo.name).toBe('Remappr Node 0x0007')
        expect(svc.deviceInfo.firmwareVersion).toBe('1.2.3')
        expect(svc.deviceInfo.vid).toBe(0)

        // The decoded config is the node's active keymap.
        const keymap = await svc.getKeymap()
        expect(keymap.layers).toHaveLength(2)
        expect(keymap.layers[0].keys).toHaveLength(4)
        const geom = await svc.getPhysicalLayouts()
        expect(geom.layouts[0].keys).toHaveLength(4) // synthetic grid fallback
    })

    it('rejects every edit', async () => {
        const { rpc } = makeRpc({ roster: ROSTER })
        const svc = await buildNodesApi(rpc).open(0x0007)

        await expect(
            svc.setKey(0, 0, { kind: 'transparent', params: [] } as never),
        ).rejects.toThrow(/read-only/i)
        await expect(svc.addLayer()).rejects.toThrow(/read-only/i)
        await expect(svc.removeLayer(0)).rejects.toThrow(/read-only/i)
        await expect(svc.renameLayer(0, 'x')).rejects.toThrow(/read-only/i)
        await expect(svc.commit()).rejects.toThrow(/read-only/i)
    })

    it('disconnect leaves the shared dongle RPC intact', async () => {
        const fake = makeRpc({ roster: ROSTER })
        const svc = await buildNodesApi(fake.rpc).open(0x0007)

        await svc.disconnect()
        expect(fake.closeCalls).toBe(0) // never tears down the shared transport
        expect(fake.closed).toBe(false)
    })
})
