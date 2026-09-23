// Pattern check: no GoF pattern (-) — rejected — test wiring building a fake VIA device on paired streams to drive the shared FirmwareAdapter contract suite for the QMK adapter.
import { describe, expect, it } from 'vitest'

import { runContractSuite } from '@firmware/__tests__/contract'
import type { Transport } from '@firmware'

import { createQmkAdapter } from './adapter'
import { VIA_ID, VIA_KBV, VIA_PAYLOAD_SIZE, writeU16BE } from './protocol'

const FAKE_ROWS = 2
const FAKE_COLS = 2
const FAKE_LAYERS = 2

function defaultKeymap(): number[][][] {
    const layers: number[][][] = []
    for (let l = 0; l < FAKE_LAYERS; l++) {
        const layer: number[][] = []
        for (let r = 0; r < FAKE_ROWS; r++) {
            const row: number[] = []
            for (let c = 0; c < FAKE_COLS; c++) {
                if (l === 0) {
                    // 0x04 = KC_A, 0x05 = KC_B, 0x06 = KC_C, 0x07 = KC_D
                    row.push(0x04 + r * FAKE_COLS + c)
                } else {
                    row.push(0x0001) // KC_TRNS
                }
            }
            layer.push(row)
        }
        layers.push(layer)
    }
    return layers
}

interface FakeEncoders {
    /** false = firmware without ENCODER_MAP_ENABLE (answers id_unhandled). */
    enabled: boolean
    /** `${layer}:${idx}:${clockwise}` → keycode. */
    map: Map<string, number>
}

function buildResponse(
    req: Uint8Array,
    keymap: number[][][],
    encoders: FakeEncoders = { enabled: true, map: new Map() },
): Uint8Array {
    const out = new Uint8Array(VIA_PAYLOAD_SIZE)
    const id = req[0]
    out[0] = id
    switch (id) {
        case VIA_ID.DYNAMIC_KEYMAP_GET_ENCODER:
        case VIA_ID.DYNAMIC_KEYMAP_SET_ENCODER: {
            if (!encoders.enabled) {
                out[0] = 0xff // id_unhandled
                return out
            }
            out.set(req.subarray(1, 4), 1)
            const k = `${req[1]}:${req[2]}:${req[3]}`
            if (id === VIA_ID.DYNAMIC_KEYMAP_SET_ENCODER) {
                encoders.map.set(k, ((req[4] << 8) | req[5]) & 0xffff)
            }
            writeU16BE(out, 4, encoders.map.get(k) ?? 0)
            return out
        }
        case VIA_ID.GET_PROTOCOL_VERSION:
            writeU16BE(out, 1, 0x000c)
            return out
        case VIA_ID.GET_KEYBOARD_VALUE:
            out[1] = req[1]
            if (req[1] === VIA_KBV.FIRMWARE_VERSION) {
                out[2] = 0x00
                out[3] = 0x00
                out[4] = 0x00
                out[5] = 0x01
            }
            return out
        case VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT:
            out[1] = FAKE_LAYERS
            return out
        case VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE: {
            const l = req[1] & 0xff
            const r = req[2] & 0xff
            const c = req[3] & 0xff
            out[1] = l
            out[2] = r
            out[3] = c
            const kc = keymap[l]?.[r]?.[c] ?? 0
            writeU16BE(out, 4, kc)
            return out
        }
        case VIA_ID.DYNAMIC_KEYMAP_SET_KEYCODE: {
            const l = req[1] & 0xff
            const r = req[2] & 0xff
            const c = req[3] & 0xff
            const kc = ((req[4] << 8) | req[5]) & 0xffff
            keymap[l][r][c] = kc
            out[1] = l
            out[2] = r
            out[3] = c
            writeU16BE(out, 4, kc)
            return out
        }
        case VIA_ID.DYNAMIC_KEYMAP_RESET: {
            const fresh = defaultKeymap()
            for (let l = 0; l < FAKE_LAYERS; l++) {
                for (let r = 0; r < FAKE_ROWS; r++) {
                    for (let c = 0; c < FAKE_COLS; c++) {
                        keymap[l][r][c] = fresh[l][r][c]
                    }
                }
            }
            return out
        }
        default:
            // Unknown command: echo id, all zeros — host may treat as error.
            return out
    }
}

function createFakeViaTransport(encoders?: FakeEncoders): Transport {
    const inbound = new TransformStream<Uint8Array, Uint8Array>()
    const outbound = new TransformStream<Uint8Array, Uint8Array>()
    const keymap = defaultKeymap()
    const writer = inbound.writable.getWriter()
    const reader = outbound.readable.getReader()

    void (async () => {
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (!value || value.length === 0) continue
                const resp = buildResponse(value, keymap, encoders)
                await writer.write(resp)
            }
        } catch {
            /* stream torn down */
        } finally {
            try {
                await writer.close()
            } catch {
                /* already closed */
            }
        }
    })()

    return {
        label: 'fake-via',
        abortController: new AbortController(),
        readable: inbound.readable,
        writable: outbound.writable,
    }
}

function createMismatchTransport(): Transport {
    const readable = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.close()
        },
    })
    const writable = new WritableStream<Uint8Array>({
        write() {
            /* discard */
        },
    })
    return {
        label: 'fake-not-via',
        abortController: new AbortController(),
        readable,
        writable,
    }
}

const adapter = createQmkAdapter({ rows: FAKE_ROWS, cols: FAKE_COLS })

runContractSuite('qmk-via', {
    makeAdapter: () => adapter,
    makeMatchingTransport: () => createFakeViaTransport(),
    makeMismatchingTransport: createMismatchTransport,
    transportKind: 'hid',
    autoUnlock: false,
})

describe('qmk-via — encoder map (#188)', () => {
    // 2×2 matrix + one encoder (KLE label 'e').
    const defWithKnob = JSON.stringify({
        name: 'Fake Knob',
        matrix: { rows: FAKE_ROWS, cols: FAKE_COLS },
        layouts: {
            keymap: [
                ['0,0', '0,1', { x: 1 }, '0,0\n\n\n\n\n\n\n\n\ne'],
                ['1,0', '1,1'],
            ],
        },
    })

    async function connect(encoders: FakeEncoders) {
        return adapter.connect(
            createFakeViaTransport(encoders),
            new AbortController().signal,
        )
    }

    it('reads and writes encoders once a def names them', async () => {
        const encoders: FakeEncoders = {
            enabled: true,
            map: new Map([
                ['0:0:1', 0x06], // cw  = KC_C
                ['0:0:0', 0x05], // ccw = KC_B
            ]),
        }
        const svc = await connect(encoders)
        expect(svc.encoders).toBeDefined()
        await svc.sideload!.importFile('via-layout-json', defWithKnob)
        expect(svc.capabilities.encoders).toBe(1)

        const km = await svc.getKeymap()
        expect(km.layouts[0].encoders).toHaveLength(1)
        const enc = km.layers[0].encoders![0]
        expect(enc.cw.params).toEqual([0x06])
        expect(enc.ccw.params).toEqual([0x05])

        const kcD = svc.buildKeyAction(enc.cw.kind, [0x07])
        await svc.encoders!.setEncoder(km.layers[0].id, 0, 1, kcD) // 1 = ccw
        expect(encoders.map.get('0:0:0')).toBe(0x07)
        expect(encoders.map.get('0:0:1')).toBe(0x06)
        const after = await svc.getKeymap()
        expect(after.layers[0].encoders![0].ccw.params).toEqual([0x07])
        await svc.disconnect()
    })

    it('exposes no encoder facade on firmware without an encoder map', async () => {
        const svc = await connect({ enabled: false, map: new Map() })
        expect(svc.encoders).toBeUndefined()
        await svc.sideload!.importFile('via-layout-json', defWithKnob)
        expect(svc.capabilities.encoders).toBeUndefined()
        const km = await svc.getKeymap()
        expect(km.layers[0].encoders).toBeUndefined()
        await svc.disconnect()
    })
})
