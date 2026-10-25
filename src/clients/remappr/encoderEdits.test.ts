// pattern-check: skip — test wiring: a writable RemapprKeyboardService over a
// config with a knob, exercising EncoderApi edits through export and discard.
import { describe, expect, it } from 'vitest'

import { parseKeymap, type ConfigKeymap } from '../../config'

import { REMAPPR_KIND_KEYPRESS, REMAPPR_KIND_TRANSPARENT } from './actions'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService } from './service'

// As the blob decodes: turns on the layers, no keyboard.encoders slots.
const PARSED = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Enc" },
    "keyboard": { "id": "k", "name": "K",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "encoders": [{"x":3,"y":0}] },
    "layers": [
        { "name": "base", "bindings": ["A", "B"],
          "encoders": [{ "cw": "C", "ccw": "D", "press": "E" }] },
        { "name": "fn", "bindings": ["A", "B"] }
    ]
}`)
const { encoders: _slots, ...board } = PARSED.keyboard
const WITH_KNOB: ConfigKeymap = { ...PARSED, keyboard: board }

const NO_KNOB = parseKeymap(`{
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
    opts: { readOnly?: boolean; knobs?: number } = {},
): RemapprKeyboardService {
    const encoders = Array.from({ length: opts.knobs ?? 0 }, (_, i) => ({
        x: 300 + i * 100,
        y: 0,
    }))
    return new RemapprKeyboardService({
        rpc: stubRpc,
        deviceInfo: { name: 'Enc', firmware: 'remappr' },
        config,
        configVersion: 1,
        layouts: [{ id: 0, name: 'R', keys: [], encoders }],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly: opts.readOnly ?? false,
    })
}

async function exported(svc: RemapprKeyboardService): Promise<ConfigKeymap> {
    const [file] = await svc.exportConfig()
    return parseKeymap(String(file!.content))
}

describe('Remappr knob turns', () => {
    it('reads the blob turns, unbound on a layer without any', async () => {
        const km = await makeService(WITH_KNOB).getKeymap()
        expect(km.layers[0]!.encoders?.[0]!.cw.kind).toBe(REMAPPR_KIND_KEYPRESS)
        expect(km.layers[1]!.encoders?.[0]!.cw.kind).toBe(
            REMAPPR_KIND_TRANSPARENT,
        )
    })

    it('stages a turn and keeps the other direction and the press', async () => {
        const svc = makeService(WITH_KNOB)
        const km = await svc.getKeymap()
        await svc.encoders!.setEncoder(
            km.layers[0]!.id,
            0,
            0,
            km.layers[0]!.keys[1]!,
        )
        expect(svc.hasPendingChanges()).toBe(true)

        const out = await exported(svc)
        const enc = out.layers[0]!.encoders![0]!
        expect(enc.cw).toEqual(out.layers[0]!.bindings[1])
        expect(enc.ccw).toEqual(WITH_KNOB.layers[0]!.encoders![0]!.ccw)
        expect(enc.press).toEqual(WITH_KNOB.layers[0]!.encoders![0]!.press)
    })

    it('discard drops the staged turn', async () => {
        const svc = makeService(WITH_KNOB)
        const km = await svc.getKeymap()
        await svc.encoders!.setEncoder(
            km.layers[0]!.id,
            0,
            1,
            km.layers[0]!.keys[0]!,
        )
        await svc.discardChanges()
        const after = await exported(svc)
        expect(after.layers[0]!.encoders).toEqual(WITH_KNOB.layers[0]!.encoders)
    })

    it('a knob from the input layout alone is editable', async () => {
        const svc = makeService(NO_KNOB, { knobs: 1 })
        const km = await svc.getKeymap()
        expect(km.layers[0]!.encoders).toHaveLength(1)
        await svc.encoders!.setEncoder(
            km.layers[0]!.id,
            0,
            0,
            km.layers[0]!.keys[0]!,
        )
        const out = await exported(svc)
        expect(out.layers[0]!.encoders![0]!.cw).toEqual(
            out.layers[0]!.bindings[0],
        )
        await expect(
            svc.encoders!.setEncoder(
                km.layers[0]!.id,
                1,
                0,
                km.layers[0]!.keys[0]!,
            ),
        ).rejects.toThrow(/out of range/)
    })

    it('no knob, or a read-only node: no encoder editing', () => {
        expect(makeService(NO_KNOB).encoders).toBeUndefined()
        expect(
            makeService(WITH_KNOB, { readOnly: true }).encoders,
        ).toBeUndefined()
    })
})
