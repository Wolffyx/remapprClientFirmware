// pattern-check: skip — test wiring: a fake device (config store + COMMON config
// verbs) behind a fake RemapprRpc, so read / write run against the real device
// compiler and decoder. No GoF abstraction.
import { describe, expect, it } from 'vitest'

import type { ConfigDevice } from '../../config/device'
import { buildRemapprDeviceBlob } from '../../config/compilers/remappr/device'

import { buildDeviceConfigApi, emptyDeviceConfig } from './deviceConfig'
import { Cmd, Namespace, Status } from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'

interface Call {
    cmd: number
    arg: Uint8Array
    targetNode?: number
    retries?: number
}

interface FakeDevice {
    rpc: RemapprRpc
    calls: Call[]
    /** The active blob (null = no config stored). */
    active: Uint8Array | null
    version: number
}

/** A device that stores what it is sent, like the firmware's config store: the
 *  staged bytes become active on COMMIT. `refuse` makes VALIDATE fail. */
function fakeDevice(
    opts: { active?: Uint8Array; version?: number; refuse?: boolean } = {},
): FakeDevice {
    const dev: FakeDevice = {
        rpc: undefined as unknown as RemapprRpc,
        calls: [],
        active: opts.active ?? null,
        version: opts.version ?? 0,
    }
    let staged: number[] = []
    const ok = (data: Uint8Array = new Uint8Array()): UniversalReply => ({
        status: Status.OK,
        data,
    })

    const info = (): Uint8Array => {
        const d = new Uint8Array(16)
        const dv = new DataView(d.buffer)
        dv.setUint16(2, 2, true)
        d[11] = dev.active ? 1 : 0
        dv.setUint32(12, dev.version, true)
        return d
    }

    const handlers: Record<number, (arg: Uint8Array) => UniversalReply> = {
        [Cmd.GET_DEVICE_INFO]: () => ok(info()),
        [Cmd.READ_CONFIG_CHUNK]: (arg) => {
            const dv = new DataView(arg.buffer, arg.byteOffset, arg.byteLength)
            const off = dv.getUint32(0, true)
            const want = dv.getUint16(4, true)
            if (!dev.active) return { status: Status.ERR_STATE, data: new Uint8Array() }
            return ok(dev.active.subarray(off, off + want))
        },
        [Cmd.WRITE_CONFIG_BEGIN]: () => {
            staged = []
            return ok()
        },
        [Cmd.WRITE_CONFIG_CHUNK]: (arg) => {
            staged.push(...arg)
            return ok()
        },
        [Cmd.VALIDATE_CONFIG]: () =>
            opts.refuse ? { status: Status.ERR_ARG, data: new Uint8Array() } : ok(),
        [Cmd.ROLLBACK_CONFIG]: () => {
            staged = []
            return ok()
        },
        [Cmd.COMMIT_CONFIG]: () => {
            const blob = new Uint8Array(staged)
            dev.active = blob
            dev.version = new DataView(blob.buffer).getUint32(8, true)
            return ok()
        },
    }

    dev.rpc = {
        async callUniversalPlain(
            ns: number,
            cmd: number,
            arg: Uint8Array = new Uint8Array(),
            o: { targetNode?: number; retries?: number } = {},
        ): Promise<UniversalReply> {
            expect(ns).toBe(Namespace.COMMON)
            dev.calls.push({ cmd, arg, targetNode: o.targetNode, retries: o.retries })
            const h = handlers[cmd]
            return h ? h(arg) : { status: Status.ERR_CMD, data: new Uint8Array() }
        },
    } as unknown as RemapprRpc
    return dev
}

const DONGLE_DOC: ConfigDevice = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Desk dongle' },
    personality: 'dongle',
    dongle: { nkro: true, pairWindowMs: 60000, failsafeMs: 150 },
}

const MOUSE_DOC: ConfigDevice = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Travel mouse' },
    personality: 'mouse',
    mouse: {
        cpi: 1600,
        accel: [
            [0, 100],
            [10, 150],
        ],
        invertWheel: true,
        swapXY: true,
        scrollDivisor: 2,
        buttonMap: [1, 0, 2, 3, null, 5, 6, 7],
    },
    radio: { keepaliveMs: 60, autoPair: false },
}

const JOYSTICK_DOC: ConfigDevice = {
    schemaVersion: 1,
    kind: 'remappr.device',
    meta: { name: 'Bench stick' },
    personality: 'joystick',
    joystick: {
        hatWays: 4,
        axes: [
            { input: 0, out: 'x', curve: 'aggressive', inner: 8, outer: 5 },
            { input: 1, out: 'y', invert: true, inner: 8, outer: 5 },
        ],
        buttonActions: [null, { action: 'button', button: 10 }],
    },
}

const dongleApi = (dev: FakeDevice) =>
    buildDeviceConfigApi(dev.rpc, {
        personality: 'dongle',
        name: 'Desk dongle',
        writable: true,
    })

describe('buildDeviceConfigApi.read', () => {
    it('reads a device with no stored config as an empty document', async () => {
        const dev = fakeDevice()
        const snap = await dongleApi(dev).read()
        expect(snap).toEqual({
            config: emptyDeviceConfig('dongle', 'Desk dongle'),
            configVersion: 0,
            stored: false,
        })
        // No active config: only the device info was read.
        expect(dev.calls.map((c) => c.cmd)).toEqual([Cmd.GET_DEVICE_INFO])
    })

    it('decodes the stored config back into the document', async () => {
        const blob = buildRemapprDeviceBlob(MOUSE_DOC, { configVersion: 7 })
        const dev = fakeDevice({ active: blob, version: 7 })
        const api = buildDeviceConfigApi(dev.rpc, {
            personality: 'mouse',
            name: 'Travel mouse',
            writable: true,
        })
        const snap = await api.read()
        expect(snap.stored).toBe(true)
        expect(snap.configVersion).toBe(7)
        expect(snap.config).toEqual(MOUSE_DOC)
        // Universal frames at target 0, each reply small enough for one frame.
        const reads = dev.calls.filter((c) => c.cmd === Cmd.READ_CONFIG_CHUNK)
        expect(reads.length).toBeGreaterThan(1)
        for (const r of reads) expect(r.targetNode).toBeUndefined()
        const want = new DataView(reads[0].arg.buffer).getUint16(4, true)
        expect(want).toBe(48)
    })

    it('decodes a stored joystick config back into the document', async () => {
        const blob = buildRemapprDeviceBlob(JOYSTICK_DOC, { configVersion: 4 })
        const dev = fakeDevice({ active: blob, version: 4 })
        const api = buildDeviceConfigApi(dev.rpc, {
            personality: 'joystick',
            name: 'Bench stick',
            writable: true,
        })
        const snap = await api.read()
        expect(snap.stored).toBe(true)
        expect(snap.config).toEqual(JOYSTICK_DOC)
    })

    it('refuses a stored config for another device', async () => {
        const blob = buildRemapprDeviceBlob(MOUSE_DOC, { configVersion: 3 })
        const dev = fakeDevice({ active: blob, version: 3 })
        await expect(dongleApi(dev).read()).rejects.toThrow(/mouse config/)
    })

    it('reads a node through the dongle with the relay retries', async () => {
        const blob = buildRemapprDeviceBlob(MOUSE_DOC, { configVersion: 2 })
        const dev = fakeDevice({ active: blob, version: 2 })
        const api = buildDeviceConfigApi(dev.rpc, {
            personality: 'mouse',
            targetNode: 2,
            name: 'Mouse',
            writable: false,
        })
        expect((await api.read()).config.mouse).toEqual(MOUSE_DOC.mouse)
        for (const c of dev.calls) {
            expect(c.targetNode).toBe(2)
            expect(c.retries).toBeGreaterThan(0)
        }
    })
})

describe('buildDeviceConfigApi.write', () => {
    it('pushes the next version and reads back the same document', async () => {
        const dev = fakeDevice({
            active: buildRemapprDeviceBlob(DONGLE_DOC, { configVersion: 6 }),
            version: 6,
        })
        const api = dongleApi(dev)
        const next: ConfigDevice = {
            ...DONGLE_DOC,
            dongle: { nkro: false, rosterLiveMs: 3000 },
        }
        expect(await api.write(next)).toBe(7)
        expect(dev.version).toBe(7)
        expect((await api.read()).config).toEqual(next)
    })

    it('sends 16-byte-aligned chunks that fit one universal frame', async () => {
        const dev = fakeDevice()
        const api = buildDeviceConfigApi(dev.rpc, {
            personality: 'mouse',
            name: 'Travel mouse',
            writable: true,
        })
        expect(await api.write(MOUSE_DOC)).toBe(1)
        const chunks = dev.calls.filter((c) => c.cmd === Cmd.WRITE_CONFIG_CHUNK)
        expect(chunks.length).toBeGreaterThan(1)
        for (const c of chunks) {
            expect(c.arg.length).toBeLessThanOrEqual(48)
            expect(c.arg.length % 16).toBe(0)
        }
        expect(dev.calls.map((c) => c.cmd).slice(-2)).toEqual([
            Cmd.VALIDATE_CONFIG,
            Cmd.COMMIT_CONFIG,
        ])
    })

    it('rolls back and rejects when the device refuses the config', async () => {
        const dev = fakeDevice({ refuse: true })
        await expect(dongleApi(dev).write(DONGLE_DOC)).rejects.toThrow(
            /refused the settings/,
        )
        expect(dev.calls.at(-1)?.cmd).toBe(Cmd.ROLLBACK_CONFIG)
        expect(dev.active).toBeNull()
    })

    it('rejects an out-of-range setting before sending anything', async () => {
        const dev = fakeDevice()
        const bad: ConfigDevice = { ...DONGLE_DOC, dongle: { failsafeMs: 10 } }
        await expect(dongleApi(dev).write(bad)).rejects.toThrow(/dongle.failsafeMs/)
        expect(dev.calls).toEqual([])
    })

    it('rejects a document for another device', async () => {
        const dev = fakeDevice()
        await expect(dongleApi(dev).write(MOUSE_DOC)).rejects.toThrow(
            /mouse config cannot go to a dongle/,
        )
        expect(dev.calls).toEqual([])
    })

    it('rejects on a read-only node view', async () => {
        const dev = fakeDevice()
        const api = buildDeviceConfigApi(dev.rpc, {
            personality: 'mouse',
            targetNode: 2,
            name: 'Mouse',
            writable: false,
        })
        expect(api.writable).toBe(false)
        await expect(api.write(MOUSE_DOC)).rejects.toThrow(/Read-only node view/)
        expect(dev.calls).toEqual([])
    })
})
