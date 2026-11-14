// L3.8 / L3.9: commit() checks the blob before it stages anything, rolls a
// failed staging back, and re-reads the device's config version after a failed
// commit so the next one is not refused with ERR_VERSION.
import { describe, expect, it } from 'vitest'

import { type ConfigKeymap, parseKeymap } from '../../config'
import { buildRemapprBlob } from '../../config/compilers/remappr'
import {
    BehaviorType,
    SystemAction,
    TableId,
} from '../../config/compilers/remappr/blobWriter'
import {
    assembleBlob,
    behaviorBytes,
    keymapCore,
    tableOf,
} from '../../config/__tests__/blobFixtures'

import { loadDeviceConfig } from './configRead'

import { FakeConfigDevice, type FakeConfigDeviceOpts } from './fakeConfigDevice.fixture'
import { Cmd, type Limits } from './protocol'
import { RemapprKeyboardService } from './service'

const CONFIG = parseKeymap(`{
    "version": 2, "kind": "remappr.keymap",
    "meta": { "name": "CommitTest" },
    "keyboard": { "id": "ct", "name": "CommitTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [{ "name": "base", "keys": ["A", "B", "C"] }]
}`)
const ACTIVE = buildRemapprBlob(CONFIG, { configVersion: 4 }).blob

const limits = (maxConfigBytes: number): Limits => ({
    maxUnsealedChunk: 48,
    maxSealedChunk: 16,
    transportFrameCap: 64,
    blobAlign: 16,
    maxConfigBytes,
    maxOutstandingRequests: 1,
    supportsFragmentation: true,
    featureBitmask: 0,
})

function setup(
    opts: FakeConfigDeviceOpts = {},
    extra: { limits?: Limits; config?: ConfigKeymap } = {},
): { dev: FakeConfigDevice; svc: RemapprKeyboardService } {
    const dev = new FakeConfigDevice({ active: ACTIVE, ...opts })
    const svc = new RemapprKeyboardService({
        rpc: dev.rpc,
        deviceInfo: { name: 'CommitTest', firmware: 'remappr' },
        config: extra.config ?? CONFIG,
        configVersion: dev.version,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        ...(extra.limits ? { limits: extra.limits } : {}),
    })
    return { dev, svc }
}

describe('commit after a failed COMMIT (L3.8)', () => {
    it('resyncs the version when the device kept the config it failed to activate', async () => {
        const { dev, svc } = setup({ activateFails: 'keep' })
        await expect(svc.commit()).rejects.toThrow(/ERR_ACTIVATE/)
        expect(dev.version).toBe(5) // main firmware: N+1 stays active
        await svc.commit() // without the resync this is ERR_VERSION
        expect(dev.version).toBe(6)
    })

    it('keeps working when the device reverted the failed commit', async () => {
        const { dev, svc } = setup({ activateFails: 'revert' })
        await expect(svc.commit()).rejects.toThrow(/ERR_ACTIVATE/)
        expect(dev.version).toBe(4)
        await svc.commit()
        expect(dev.version).toBe(5)
    })
})

describe('commit preflight (L3.9)', () => {
    it('refuses a padded blob over the device capacity before staging', async () => {
        // A capacity between the raw and the padded length: checking the raw
        // length would let this through and fail mid-stream.
        const raw = buildRemapprBlob(CONFIG, { configVersion: 5 }).blob.length
        expect(raw % 16).not.toBe(0)
        const { dev, svc } = setup({ capacity: raw }, { limits: limits(raw) })
        await expect(svc.commit()).rejects.toThrow(/stores at most/)
        expect(dev.log).not.toContain(Cmd.WRITE_CONFIG_BEGIN)
        expect(dev.version).toBe(4)
    })

    it('rolls the staging back when a chunk fails mid-stream', async () => {
        const { dev, svc } = setup({ capacity: 32 }) // no limits: no preflight
        await expect(svc.commit()).rejects.toThrow(/WRITE_CONFIG_CHUNK failed/)
        expect(dev.log).toContain(Cmd.ROLLBACK_CONFIG)
        expect(dev.staged).toBeNull()
    })

    it('refuses to commit when the compiler reported errors', async () => {
        const broken: ConfigKeymap = {
            ...CONFIG,
            layers: [
                {
                    name: 'base',
                    bindings: [
                        { type: 'key_press', key: 'not_a_key' },
                        { type: 'key_press', key: 'B' },
                        { type: 'key_press', key: 'C' },
                    ],
                },
            ],
        }
        const { dev, svc } = setup({}, { config: broken })
        await expect(svc.commit()).rejects.toThrow(/no HID usage for key "not_a_key"/)
        expect(dev.log).not.toContain(Cmd.WRITE_CONFIG_BEGIN)
        expect(dev.active).toEqual(ACTIVE)
    })
})

describe('commit keeps the tables the config does not model (L3.7)', () => {
    it('a save of a device config keeps its sensor and display tables', async () => {
        const sensor = {
            id: TableId.Sensor,
            version: 1,
            payload: [1, 0, 0, 0x21, 3, 0, 0x10, 0, 0, 0],
        }
        const display = { id: TableId.Display, version: 1, payload: [0, 0, 0, 0, 0, 0, 0, 0] }
        const device = assembleBlob([...keymapCore(), sensor, display], { configVersion: 7 })
        const dev = new FakeConfigDevice({ active: device })
        const loaded = await loadDeviceConfig(dev.rpc, {
            protoMax: 1,
            deviceInfo: {
                protoMin: 1,
                protoMax: 1,
                schemaVersion: 1,
                fwMajor: 0,
                fwMinor: 0,
                fwPatch: 0,
                hwRev: 0,
                hasActive: true,
                configVersion: 7,
            },
        })
        const svc = new RemapprKeyboardService({
            rpc: dev.rpc,
            deviceInfo: { name: 'CommitTest', firmware: 'remappr' },
            config: loaded.config,
            configVersion: loaded.configVersion,
            layouts: loaded.layouts,
            activeLayoutId: loaded.activeLayoutId,
            maxLayers: loaded.maxLayers,
            ...(loaded.deviceBlob ? { deviceBlob: loaded.deviceBlob } : {}),
        })
        await svc.commit()
        expect(dev.version).toBe(8)
        expect(tableOf(dev.active!, TableId.Sensor)).toEqual(sensor)
        expect(tableOf(dev.active!, TableId.Display)).toEqual(display)
        // and a second save still has them (carried from the blob it wrote)
        await svc.commit()
        expect(tableOf(dev.active!, TableId.Sensor)).toEqual(sensor)
    })
})

describe('commit keeps bindings the config cannot express (L3.7)', () => {
    it('a save keeps an untouched clear_storage key as read', async () => {
        const clear = behaviorBytes({
            type: BehaviorType.System,
            tap: SystemAction.clear_storage,
        })
        const device = assembleBlob(keymapCore([behaviorBytes({ type: BehaviorType.Key, tap: 0x04 }), clear]))
        const dev = new FakeConfigDevice({ active: device })
        const loaded = await loadDeviceConfig(dev.rpc, {
            protoMax: 1,
            deviceInfo: {
                protoMin: 1,
                protoMax: 1,
                schemaVersion: 1,
                fwMajor: 0,
                fwMinor: 0,
                fwPatch: 0,
                hwRev: 0,
                hasActive: true,
                configVersion: 1,
            },
        })
        const svc = new RemapprKeyboardService({
            rpc: dev.rpc,
            deviceInfo: { name: 'CommitTest', firmware: 'remappr' },
            config: loaded.config,
            configVersion: loaded.configVersion,
            layouts: loaded.layouts,
            activeLayoutId: loaded.activeLayoutId,
            maxLayers: loaded.maxLayers,
        })
        await svc.commit()
        expect(tableOf(dev.active!, TableId.Behavior)).toEqual(tableOf(device, TableId.Behavior))
    })
})
