// L3.3: a failed or short config read is an error, never the end of the blob,
// and a config the client cannot decode is never offered for saving.
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../../config'
import { buildRemapprBlob } from '../../config/compilers/remappr'

import { loadDeviceConfig, readConfigBlob } from './configRead'
import type { DiscoveryResult } from './discovery'
import { FakeConfigDevice } from './fakeConfigDevice.fixture'
import { Status } from './protocol'
import { RemapprKeyboardService } from './service'

const CONFIG = parseKeymap(`{
    "version": 2, "kind": "remappr.keymap",
    "meta": { "name": "ReadTest" },
    "keyboard": { "id": "rt", "name": "ReadTest",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}] },
    "layers": [
        { "name": "base", "keys": ["A", "B", "C"] },
        { "name": "fn", "keys": ["D", "E", "F"] }
    ]
}`)

// Long enough to need several 58-byte chunks.
const BLOB = buildRemapprBlob(CONFIG, { configVersion: 5 }).blob

const discovery = (dev: FakeConfigDevice): DiscoveryResult => ({
    protoMax: 1,
    deviceInfo: {
        protoMin: 1,
        protoMax: 1,
        schemaVersion: 1,
        fwMajor: 0,
        fwMinor: 0,
        fwPatch: 0,
        hwRev: 0,
        hasActive: dev.active !== undefined,
        configVersion: dev.version,
    },
})

describe('readConfigBlob (L3.3)', () => {
    it('reads the whole blob across chunks', async () => {
        const dev = new FakeConfigDevice({ active: BLOB })
        expect(await readConfigBlob(dev.rpc, true)).toEqual(BLOB)
    })

    it('throws on an error status instead of returning a truncated blob', async () => {
        const dev = new FakeConfigDevice({
            active: BLOB,
            readFailAt: 58,
            readFailStatus: Status.ERR_STORAGE,
        })
        await expect(readConfigBlob(dev.rpc, true)).rejects.toThrow(/ERR_STORAGE/)
    })

    it('throws when the read ends before the length the header declares', async () => {
        const dev = new FakeConfigDevice({ active: BLOB, readEofAt: 58 })
        await expect(readConfigBlob(dev.rpc, true)).rejects.toThrow(/stopped at 58/)
    })
})

describe('loadDeviceConfig over an undecodable config (L3.3)', () => {
    it('flags the placeholder config as unreadable', async () => {
        const bad = BLOB.slice()
        bad[bad.length - 1] ^= 0xff // CRC mismatch
        const dev = new FakeConfigDevice({ active: bad })
        const loaded = await loadDeviceConfig(dev.rpc, discovery(dev))
        expect(loaded.unreadable).toMatch(/could not be read/)
    })

    it('leaves a decodable config writable', async () => {
        const dev = new FakeConfigDevice({ active: BLOB })
        const loaded = await loadDeviceConfig(dev.rpc, discovery(dev))
        expect(loaded.unreadable).toBeUndefined()
        expect(loaded.config.layers).toHaveLength(2)
    })

    it('a service over an unreadable config refuses to commit', async () => {
        const bad = BLOB.slice()
        bad[bad.length - 1] ^= 0xff
        const dev = new FakeConfigDevice({ active: bad })
        const loaded = await loadDeviceConfig(dev.rpc, discovery(dev))
        const svc = new RemapprKeyboardService({
            rpc: dev.rpc,
            deviceInfo: { name: 'ReadTest', firmware: 'remappr' },
            config: loaded.config,
            configVersion: loaded.configVersion,
            layouts: loaded.layouts,
            activeLayoutId: loaded.activeLayoutId,
            maxLayers: loaded.maxLayers,
            ...(loaded.unreadable ? { readOnlyReason: loaded.unreadable } : {}),
        })
        expect(svc.capabilities.readOnly).toBe(true)
        expect(svc.capabilities.readOnlyReason).toMatch(/could not be read/)
        await expect(svc.commit()).rejects.toThrow(/could not be read/)
        expect(dev.active).toEqual(bad) // the device config is untouched
    })
})
