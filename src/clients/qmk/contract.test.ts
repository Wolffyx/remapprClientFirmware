// Pattern check: no GoF pattern (-) — rejected — test wiring building a fake VIA device on paired streams to drive the shared FirmwareAdapter contract suite for the QMK adapter.
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

function buildResponse(req: Uint8Array, keymap: number[][][]): Uint8Array {
    const out = new Uint8Array(VIA_PAYLOAD_SIZE)
    const id = req[0]
    out[0] = id
    switch (id) {
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

function createFakeViaTransport(): Transport {
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
                const resp = buildResponse(value, keymap)
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
    makeMatchingTransport: createFakeViaTransport,
    makeMismatchingTransport: createMismatchTransport,
    transportKind: 'hid',
    autoUnlock: false,
})
