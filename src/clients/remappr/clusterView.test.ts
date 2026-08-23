// pattern-check: skip — test wiring: a fake RemapprRpc answers GET_CLUSTER_DIAG
// and stands in for the async subscribeRole so the cluster facade (snapshot read
// + async→sync disposer bridge) is exercised without hardware. No GoF abstraction.
import { describe, expect, it } from 'vitest'

import { buildClusterApi } from './clusterView'
import { CommonVerb, Namespace, Status } from './protocol'
import type { RoleEvent } from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

/* ── wire byte helper: a version-1 GET_CLUSTER_DIAG reply ────────────────────
 * {u8 ver, u8 local_role, u8 local_flags, u16 local_term, u8 peer_count,
 *  peer_count × {u8 flags(bit0 ready, bit1 seen), u8 role, u16 term, u8 hb}} */
function clusterDiagBytes(): Uint8Array {
    const d = new Uint8Array(6 + 2 * 5)
    const dv = new DataView(d.buffer)
    d[0] = 1 // version
    d[1] = 1 // local_role = coordinator
    d[2] = 0 // local_flags (reserved until N5)
    dv.setUint16(3, 0, true) // local_term (reserved until N5)
    d[5] = 2 // peer_count
    let o = 6
    // peer 0: ready + seen follower, hb 0x01
    d[o] = 0x03
    d[o + 1] = 0
    dv.setUint16(o + 2, 0, true)
    d[o + 4] = 0x01
    o += 5
    // peer 1: seen-but-not-ready coordinator, term 5
    d[o] = 0x02
    d[o + 1] = 1
    dv.setUint16(o + 2, 5, true)
    d[o + 4] = 0x00
    return d
}

/* ── a fake RPC: answers the diag read + captures the role subscription ────── */

interface FakeRpc {
    rpc: RemapprRpc
    subscribeCalls: number
    unsubscribeCalls: number
    /** Push a role event to the live listener (the app cb, passed straight
     *  through by the facade). Null before subscribe / after unsubscribe. */
    fire: (e: RoleEvent) => void
}

function makeRpc(opts: { diag?: Uint8Array } = {}): FakeRpc {
    let roleCb: ((e: RoleEvent) => void) | null = null
    const state = {
        subscribeCalls: 0,
        unsubscribeCalls: 0,
        fire: (e: RoleEvent) => roleCb?.(e),
        rpc: undefined as unknown as RemapprRpc,
    }
    const ok = (data: Uint8Array): UniversalReply => ({ status: Status.OK, data })

    state.rpc = {
        async callUniversalPlain(
            namespace: number,
            verb: number,
        ): Promise<UniversalReply> {
            if (
                namespace === Namespace.COMMON &&
                verb === CommonVerb.GET_CLUSTER_DIAG
            ) {
                return ok(opts.diag ?? clusterDiagBytes())
            }
            return { status: Status.ERR_CMD, data: new Uint8Array() }
        },
        async subscribeRole(cb: (e: RoleEvent) => void) {
            state.subscribeCalls++
            roleCb = cb
            return async (): Promise<void> => {
                state.unsubscribeCalls++
                roleCb = null
            }
        },
    } as unknown as RemapprRpc

    return state as FakeRpc
}

/** Flush pending microtasks so the eager subscribeRole promise + its .then run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('buildClusterApi.getDiag', () => {
    it('parses the GET_CLUSTER_DIAG reply into role + peers', async () => {
        const { rpc } = makeRpc()
        const diag = await buildClusterApi(rpc).getDiag()

        expect(diag.coordinator).toBe(true)
        expect(diag.localFlags).toBe(0)
        expect(diag.localTerm).toBe(0)
        expect(diag.peers).toHaveLength(2)
        expect(diag.peers[0]).toEqual({
            coordinator: false,
            ready: true,
            seen: true,
            term: 0,
            hbFlags: 0x01,
        })
        expect(diag.peers[1]).toEqual({
            coordinator: true,
            ready: false,
            seen: true,
            term: 5,
            hbFlags: 0x00,
        })
    })

    it('throws when the firmware has no cluster-diag source (ERR_CMD)', async () => {
        const bad = {
            async callUniversalPlain(): Promise<UniversalReply> {
                return { status: Status.ERR_CMD, data: new Uint8Array() }
            },
        } as unknown as RemapprRpc
        await expect(buildClusterApi(bad).getDiag()).rejects.toThrow(
            /GET_CLUSTER_DIAG/,
        )
    })
})

describe('buildClusterApi.onRoleChanged', () => {
    it('subscribes, fans role events to the callback, unsubscribes on dispose', async () => {
        const fake = makeRpc()
        const received: RoleEvent[] = []
        const dispose = buildClusterApi(fake.rpc).onRoleChanged((e) =>
            received.push(e),
        )
        await flush() // let the eager subscribeRole resolve

        expect(fake.subscribeCalls).toBe(1)
        fake.fire({ coordinator: false, flags: 0, term: 2 })
        expect(received).toEqual([{ coordinator: false, flags: 0, term: 2 }])

        dispose()
        await flush()
        expect(fake.unsubscribeCalls).toBe(1)
    })

    it('disposing before the async subscribe resolves still tears it down', async () => {
        const fake = makeRpc()
        const dispose = buildClusterApi(fake.rpc).onRoleChanged(() => undefined)
        dispose() // sync disposer runs before subscribeRole has resolved
        await flush()

        // The resolved disposer is invoked despite the early dispose — no wire
        // subscription is left dangling.
        expect(fake.subscribeCalls).toBe(1)
        expect(fake.unsubscribeCalls).toBe(1)
    })
})
