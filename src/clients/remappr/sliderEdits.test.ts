// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// device with a fader, exercising SliderApi edits through export and discard.
import { describe, expect, it } from 'vitest'

import { parseKeymap, type ConfigKeymap } from '../../config'

import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

// As the blob decodes: the base layer's slider set, no keyboard.sliders slots.
const PARSED = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Fader" },
    "keyboard": { "id": "k", "name": "K",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "sliders": [{"x":3,"y":0}] },
    "layers": [
        { "name": "base", "bindings": ["A", "B"],
          "sliders": [{ "map": "volume", "steps": 20 }] },
        { "name": "fn", "bindings": ["A", "B"] }
    ]
}`)
const { sliders: _slots, ...board } = PARSED.keyboard
const WITH_FADER: ConfigKeymap = { ...PARSED, keyboard: board }

const PLAIN = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Plain" },
    "keyboard": { "id": "p", "name": "P", "keys": [{"x":0,"y":0}] },
    "layers": [{ "name": "base", "bindings": ["A"] }]
}`)

const stubRpc = {
    onClosed: () => () => undefined,
    subscribeInput: () => () => undefined,
    close: async () => undefined,
    callPlain: async () => ({ status: 0, data: new Uint8Array() }),
} as unknown as RemapprRpc

function makeService(
    config: ConfigKeymap,
    opts: { readOnly?: boolean; faders?: number } = {},
): RemapprKeyboardService {
    const sliders = Array.from({ length: opts.faders ?? 0 }, (_, i) => ({
        x: 650 + i * 100,
        y: 0,
        w: 50,
        h: 400,
    }))
    return new RemapprKeyboardService({
        rpc: stubRpc,
        deviceInfo: { name: 'Fader', firmware: 'remappr' },
        config,
        configVersion: 1,
        layouts: [{ id: 0, name: 'R', keys: [], sliders }],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly: opts.readOnly ?? false,
    })
}

async function exported(svc: RemapprKeyboardService): Promise<ConfigKeymap> {
    const [file] = await svc.exportConfig()
    return parseKeymap(String(file!.content))
}

describe('Remappr sliders', () => {
    it('reads the blob sliders; a layer without any follows the base', async () => {
        const km = await makeService(WITH_FADER).getKeymap()
        expect(km.layers[0]!.sliders).toEqual([{ map: 'volume', steps: 20 }])
        expect(km.layers[1]!.sliders).toEqual([null])
    })

    it('stages keys on a layer and exports them with the slot', async () => {
        const svc = makeService(WITH_FADER, { faders: 1 })
        const km = await svc.getKeymap()
        await svc.sliders!.setSlider(km.layers[1]!.id, 0, {
            map: 'keys',
            steps: 8,
            up: km.layers[0]!.keys[0]!,
            down: km.layers[0]!.keys[1]!,
        })
        expect(svc.hasPendingChanges()).toBe(true)
        const out = await exported(svc)
        expect(out.keyboard.sliders).toEqual([{ x: 6.5, y: 0 }])
        expect(out.layers[1]!.sliders![0]).toEqual({
            map: 'keys',
            steps: 8,
            up: out.layers[0]!.bindings[0],
            down: out.layers[0]!.bindings[1],
        })
        expect(out.layers[0]!.sliders).toEqual(WITH_FADER.layers[0]!.sliders)
    })

    it('null clears a layer back to the base; discard drops edits', async () => {
        const svc = makeService(WITH_FADER)
        const km = await svc.getKeymap()
        await svc.sliders!.setSlider(km.layers[0]!.id, 0, null)
        expect((await exported(svc)).layers[0]!.sliders).toBeUndefined()
        await svc.discardChanges()
        expect((await exported(svc)).layers[0]!.sliders).toEqual(
            WITH_FADER.layers[0]!.sliders,
        )
    })

    it('a fader from the input layout alone is editable; out of range throws', async () => {
        const svc = makeService(PLAIN, { faders: 1 })
        const km = await svc.getKeymap()
        await svc.sliders!.setSlider(km.layers[0]!.id, 0, { map: 'rgb_hue' })
        expect((await exported(svc)).layers[0]!.sliders).toEqual([
            { map: 'rgb_hue' },
        ])
        await expect(
            svc.sliders!.setSlider(km.layers[0]!.id, 1, null),
        ).rejects.toThrow(/out of range/)
    })

    it('no slider, or a read-only node: no slider editing', () => {
        expect(makeService(PLAIN).sliders).toBeUndefined()
        expect(
            makeService(WITH_FADER, { readOnly: true }).sliders,
        ).toBeUndefined()
    })
})
