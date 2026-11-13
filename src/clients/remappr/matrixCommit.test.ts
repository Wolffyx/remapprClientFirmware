// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// stub RPC capturing the committed blob, with a fake part list.
import { describe, expect, it, vi } from 'vitest'

import { parseKeymap } from '../../config'
import { TableId } from '../../config/compilers/remappr/blobWriter'
import { readBlobFrames } from '../../config/compilers/remappr/decode'
import { readPartEntries } from '../../config/compilers/remappr/sensor'
import type { SensorInfo } from '../../devices/types'
import type { SensorApi } from '../../service'

import { Cmd } from './protocol'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

const CONFIG = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Matrix", "target": "remappr" },
    "keyboard": { "id": "m", "name": "Matrix",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
    "defaults": { "tappingTermMs": 200 },
    "layers": [ { "name": "base", "bindings": ["A", "B"] } ]
}`)

const MATRIX: SensorInfo = {
    index: 0,
    cls: 'matrix',
    model: 'Key matrix',
    channels: 1,
    io: [],
    settings: [
        {
            name: 'debouncePressMs',
            label: 'Press debounce',
            type: 'int',
            unit: 'ms',
            min: 1,
            max: 65535,
            step: 1,
            advanced: true,
            default: 5,
            value: 5,
            personality: false,
        },
    ],
    procedures: [],
    metrics: [],
}

function make() {
    const chunks: Uint8Array[] = []
    const rpc = {
        onClosed: () => () => undefined,
        subscribeInput: () => () => undefined,
        close: async () => undefined,
        callPlain: async (cmd: number, arg?: Uint8Array) => {
            if (cmd === Cmd.WRITE_CONFIG_CHUNK && arg) chunks.push(arg)
            return { status: 0, data: new Uint8Array() }
        },
    } as unknown as RemapprRpc
    const getSensors = vi.fn(async () => [MATRIX])
    const svc = new RemapprKeyboardService({
        rpc,
        deviceInfo: { name: 'Matrix', firmware: 'remappr' },
        config: CONFIG,
        configVersion: 1,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        sensor: { getSensors } as unknown as SensorApi,
    })
    const committed = (): Uint8Array => {
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
        let off = 0
        for (const c of chunks) {
            all.set(c, off)
            off += c.length
        }
        chunks.length = 0
        return all
    }
    return { svc, getSensors, committed }
}

const partEntries = (blob: Uint8Array) => {
    const pt = readBlobFrames(blob).frames.find((f) => f.id === TableId.Sensor)
    return pt ? readPartEntries(blob, pt.start, pt.end) : undefined
}

describe('commit puts matrix timing into the MATRIX parts', () => {
    it('reads the part list once and writes TBL_PART', async () => {
        const { svc, getSensors, committed } = make()
        svc.setConfigDefaults({ matrixPressDebounceMs: 3 })
        await svc.commit()
        expect(partEntries(committed())).toEqual([
            { sensor: 0, id: 0x31, ch: 0, value: 3 },
        ])
        svc.setConfigDefaults({ matrixPressDebounceMs: 4 })
        await svc.commit()
        expect(partEntries(committed())).toEqual([
            { sensor: 0, id: 0x31, ch: 0, value: 4 },
        ])
        expect(getSensors).toHaveBeenCalledTimes(1)
    })

    it('does not read the parts when no matrix timing is set', async () => {
        const { svc, getSensors, committed } = make()
        svc.setConfigDefaults({ pressDebounceMs: 2 })
        await svc.commit()
        expect(partEntries(committed())).toBeUndefined()
        expect(getSensors).not.toHaveBeenCalled()
    })

    it('asks again after a failed read', async () => {
        const { svc, getSensors } = make()
        getSensors.mockRejectedValueOnce(new Error('link down'))
        svc.setConfigDefaults({ matrixPressDebounceMs: 3 })
        await expect(svc.commit()).rejects.toThrow('link down')
        await svc.commit()
        expect(getSensors).toHaveBeenCalledTimes(2)
    })
})
