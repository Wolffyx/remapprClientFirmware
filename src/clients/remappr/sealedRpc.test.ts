// Host-side §19 auth against a device that seals like the firmware
// (sealedDevice.fixture.ts): the direct sealed universal form (L3.1), relayed
// replies at their real length (L3.2), trial-length opening and the
// device→host replay check (L3.5), and one re-handshake on ERR_AUTH (L3.6).
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../../config'
import { buildRemapprBlob } from '../../config/compilers/remappr'
import { establishSession } from './adapter'
import { loadOrCreateIdentity, ReplayedReplyError } from './auth'
import { FakeConfigDevice } from './fakeConfigDevice.fixture'
import { unpairRadio } from './nodes'
import { Cmd, MouseVerb, Namespace, SensorVerb, Status, UchFlag } from './protocol'
import { createRemapprRpc, type RemapprRpc } from './rpc'
import { SealedDevice, type Reply } from './sealedDevice.fixture'
import { RemapprKeyboardService } from './service'

const ok = (data: Uint8Array = new Uint8Array()): Reply => ({ status: Status.OK, data })
const APPLIED = Uint8Array.of(0x2c, 0x01, 0, 0) // i32 300

// A device whose inner verbs answer OK, SET_SETTING with the applied value.
function device(firstTxCtr?: number): { dev: SealedDevice; rpc: RemapprRpc } {
    const dev = new SealedDevice({
        serve: (_ns, cmd) => (cmd === SensorVerb.SET_SETTING ? ok(APPLIED) : ok()),
        ...(firstTxCtr !== undefined ? { firstTxCtr } : {}),
    })
    return { dev, rpc: createRemapprRpc(dev.transport) }
}

async function bound(rpc: RemapprRpc): Promise<{ renews: () => number }> {
    let renews = 0
    rpc.bindSession({
        session: await establishSession(rpc),
        renew: () => {
            renews++
            return establishSession(rpc)
        },
    })
    return { renews: () => renews }
}

describe('direct sealed universal calls (L3.1)', () => {
    it('seals a namespace mutation to the device and opens its data reply', async () => {
        const { dev, rpc } = device()
        await bound(rpc)
        const r = await rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, Uint8Array.of(0, 1, 0, 0x2c, 1, 0, 0))
        expect(r).toEqual({ status: Status.OK, data: APPLIED })
        expect(dev.served.at(-1)).toEqual({ form: 'direct-sealed', ns: Namespace.SENSOR, cmd: SensorVerb.SET_SETTING })
        await rpc.close({ abortTransport: true })
    })

    it('does not take a sealed reply for an event (byte 3 is counter, not UCH flags)', async () => {
        // Counter 0x0200: its second byte has the UCH EVENT bit set.
        const { rpc } = device(UchFlag.EVENT << 8)
        await bound(rpc)
        const r = await rpc.callMutation(Namespace.MOUSE, MouseVerb.SET_DPI, Uint8Array.of(0x20, 0x03))
        expect(r.status).toBe(Status.OK)
        await rpc.close({ abortTransport: true })
    })

    it('goes plaintext with no session, and to a node behind the dongle', async () => {
        const { dev, rpc } = device()
        await rpc.callMutation(Namespace.MOUSE, MouseVerb.SET_DPI, Uint8Array.of(0x20, 0x03))
        expect(dev.served.at(-1)?.form).toBe('universal')
        await bound(rpc)
        await rpc.callMutation(Namespace.MOUSE, MouseVerb.SET_DPI, Uint8Array.of(0x20, 0x03), { targetNode: 3 })
        expect(dev.served.at(-1)).toMatchObject({ form: 'universal', target: 3 })
        await rpc.close({ abortTransport: true })
    })

    it('skips a late sealed reply to an earlier request', async () => {
        const { dev, rpc } = device()
        await bound(rpc)
        dev.staleNext = true
        const r = await rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, Uint8Array.of(0, 1, 0, 0, 0, 0, 0))
        expect(r).toEqual({ status: Status.OK, data: APPLIED })
        await rpc.close({ abortTransport: true })
    })

    it('reads a refused seal as a plaintext ERR_AUTH', async () => {
        const { dev, rpc } = device()
        const session = await establishSession(rpc)
        dev.refuseSealed = true
        const r = await rpc.callSealedUniversal(session, Namespace.SENSOR, SensorVerb.SET_SETTING)
        expect(r).toMatchObject({ status: Status.ERR_AUTH, sealed: false })
        await rpc.close({ abortTransport: true })
    })
})

describe('device→host replay check (L3.5)', () => {
    it('refuses a replayed sealed reply on the direct path', async () => {
        const { dev, rpc } = device()
        await bound(rpc)
        await rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, Uint8Array.of(0, 1, 0, 0, 0, 0, 0))
        dev.replayNext = true
        await expect(
            rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, Uint8Array.of(0, 1, 0, 0, 0, 0, 0)),
        ).rejects.toThrow(ReplayedReplyError)
        await rpc.close({ abortTransport: true })
    })

    it('refuses a replayed COMMIT "OK" on the legacy path', async () => {
        const { dev, rpc } = device()
        await bound(rpc)
        expect((await rpc.callWrite(Cmd.COMMIT_CONFIG)).status).toBe(Status.OK)
        dev.replayNext = true
        await expect(rpc.callWrite(Cmd.COMMIT_CONFIG)).rejects.toThrow(/replayed/)
        await rpc.close({ abortTransport: true })
    })
})

describe('relayed sealed replies at their real length (L3.2)', () => {
    it('unpairs a node: its 14-byte sealed ack opens', async () => {
        const { dev, rpc } = device()
        await unpairRadio(rpc, 7, loadOrCreateIdentity())
        expect(dev.served.at(-1)).toEqual({ form: 'relay-sealed', ns: Namespace.COMMON, cmd: Cmd.UNPAIR_RADIO, target: 7 })
        await rpc.close({ abortTransport: true })
    })
})

describe('session recovery on ERR_AUTH (L3.6)', () => {
    it('re-handshakes once and resends a namespace mutation', async () => {
        const { dev, rpc } = device()
        const { renews } = await bound(rpc)
        dev.dropSession()
        const r = await rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, Uint8Array.of(0, 1, 0, 0, 0, 0, 0))
        expect(r.status).toBe(Status.OK)
        expect(renews()).toBe(1)
        expect(dev.handshakes).toBe(2)
        await rpc.close({ abortTransport: true })
    })

    it('stops after one re-handshake when the device keeps refusing', async () => {
        const { dev, rpc } = device()
        const { renews } = await bound(rpc)
        dev.refuseSealed = true
        const r = await rpc.callWrite(Cmd.COMMIT_CONFIG)
        expect(r.status).toBe(Status.ERR_AUTH)
        expect(renews()).toBe(1)
        await rpc.close({ abortTransport: true })
    })

    it('shares one re-handshake between calls that saw the session drop', async () => {
        const { dev, rpc } = device()
        const { renews } = await bound(rpc)
        dev.dropSession()
        const arg = Uint8Array.of(0, 1, 0, 0, 0, 0, 0)
        const rs = await Promise.all([
            rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, arg),
            rpc.callMutation(Namespace.SENSOR, SensorVerb.SET_SETTING, arg),
        ])
        expect(rs.map((r) => r.status)).toEqual([Status.OK, Status.OK])
        expect(renews()).toBe(1)
        await rpc.close({ abortTransport: true })
    })

    it('commits after the device dropped the session (it used to need a reconnect)', async () => {
        const CONFIG = parseKeymap(`{
            "version": 2, "kind": "remappr.keymap",
            "meta": { "name": "AuthTest" },
            "keyboard": { "id": "at", "name": "AuthTest", "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
            "layers": [{ "name": "base", "keys": ["A", "B"] }]
        }`)
        const store = new FakeConfigDevice({ active: buildRemapprBlob(CONFIG, { configVersion: 4 }).blob })
        const dev = new SealedDevice({ serve: (_ns, cmd, arg) => store.handle(cmd, arg) })
        const rpc = createRemapprRpc(dev.transport)
        await bound(rpc)
        const svc = new RemapprKeyboardService({
            rpc,
            deviceInfo: { name: 'AuthTest', firmware: 'remappr' },
            config: CONFIG,
            configVersion: store.version,
            layouts: [],
            activeLayoutId: 0,
            maxLayers: 8,
        })
        dev.dropSession()
        await svc.commit()
        expect(store.version).toBe(5)
        expect(dev.handshakes).toBe(2)
        expect(dev.served.filter((s) => s.cmd === Cmd.COMMIT_CONFIG)).toEqual([
            { form: 'legacy-sealed', cmd: Cmd.COMMIT_CONFIG },
        ])
        await rpc.close({ abortTransport: true })
    })
})
