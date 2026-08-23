// Pattern check: no GoF pattern (-) — rejected — fake Keychron responder over paired streams driving the shared FirmwareAdapter contract suite, no abstraction warranted.
import { runContractSuite } from '@firmware/__tests__/contract'
import type { Transport } from '@firmware'
import {
    VIA_ID,
    VIA_KBV,
    VIA_PAYLOAD_SIZE,
    writeU16BE,
} from '@firmware/clients/qmk/protocol'

import { createKeychronAdapter } from './adapter'
import { FEATURE_BIT, KC_ID, MISC_FEATURE_BIT, MISC_SUB } from './protocol'

const FAKE_ROWS = 1
const FAKE_COLS = 1
const FAKE_LAYERS = 2

interface FakeState {
    keymap: number[][][]
}

function defaultKeymap(): number[][][] {
    const layers: number[][][] = []
    for (let l = 0; l < FAKE_LAYERS; l++) {
        const layer: number[][] = []
        for (let r = 0; r < FAKE_ROWS; r++) {
            const row: number[] = []
            for (let c = 0; c < FAKE_COLS; c++) {
                row.push(l === 0 ? 0x04 : 0x0001)
            }
            layer.push(row)
        }
        layers.push(layer)
    }
    return layers
}

function frame(): Uint8Array {
    return new Uint8Array(VIA_PAYLOAD_SIZE)
}

function buildResponse(req: Uint8Array, state: FakeState): Uint8Array {
    const out = frame()
    const id = req[0]
    out[0] = id

    switch (id) {
        case KC_ID.GET_PROTOCOL_VERSION:
            out[1] = 0x02
            out[2] = 0
            out[3] = 0x02
            return out
        case KC_ID.GET_FIRMWARE_VERSION: {
            const text = 'v1.0.0 fake'
            for (let i = 0; i < text.length; i++)
                out[1 + i] = text.charCodeAt(i)
            return out
        }
        case KC_ID.GET_SUPPORT_FEATURE:
            // Bluetooth | P24G | DEFAULT_LAYER | STATE_NOTIFY
            out[1] =
                FEATURE_BIT.DEFAULT_LAYER |
                FEATURE_BIT.BLUETOOTH |
                FEATURE_BIT.P24G |
                FEATURE_BIT.STATE_NOTIFY
            out[2] = 0
            return out
        case KC_ID.GET_DEFAULT_LAYER:
            out[1] = 0
            return out
        case KC_ID.MISC_CMD_GROUP: {
            const sub = req[1] & 0xff
            out[1] = sub
            if (sub === MISC_SUB.GET_PROTOCOL_VER) {
                out[3] = 0x02
                out[4] = 0
                out[5] = MISC_FEATURE_BIT.WIRELESS_LPM | MISC_FEATURE_BIT.NKRO
                return out
            }
            return out
        }
        case VIA_ID.GET_PROTOCOL_VERSION:
            writeU16BE(out, 1, 0x000c)
            return out
        case VIA_ID.GET_KEYBOARD_VALUE:
            out[1] = req[1]
            if (req[1] === VIA_KBV.FIRMWARE_VERSION) {
                out[5] = 1
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
            const kc = state.keymap[l]?.[r]?.[c] ?? 0
            writeU16BE(out, 4, kc)
            return out
        }
        case VIA_ID.DYNAMIC_KEYMAP_SET_KEYCODE: {
            const l = req[1] & 0xff
            const r = req[2] & 0xff
            const c = req[3] & 0xff
            const kc = ((req[4] << 8) | req[5]) & 0xffff
            state.keymap[l][r][c] = kc
            out[1] = l
            out[2] = r
            out[3] = c
            writeU16BE(out, 4, kc)
            return out
        }
        case VIA_ID.DYNAMIC_KEYMAP_RESET: {
            const fresh = defaultKeymap()
            for (let l = 0; l < FAKE_LAYERS; l++)
                for (let r = 0; r < FAKE_ROWS; r++)
                    for (let c = 0; c < FAKE_COLS; c++)
                        state.keymap[l][r][c] = fresh[l][r][c]
            return out
        }
        default:
            return out
    }
}

function createFakeKeychronTransport(): Transport {
    const inbound = new TransformStream<Uint8Array, Uint8Array>()
    const outbound = new TransformStream<Uint8Array, Uint8Array>()
    const state: FakeState = { keymap: defaultKeymap() }
    const writer = inbound.writable.getWriter()
    const reader = outbound.readable.getReader()

    void (async () => {
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (!value || value.length === 0) continue
                const resp = buildResponse(value, state)
                await writer.write(resp)
            }
        } catch {
            /* torn down */
        } finally {
            try {
                await writer.close()
            } catch {
                /* already closed */
            }
        }
    })()

    return {
        label: 'fake-keychron',
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
        label: 'fake-not-keychron',
        abortController: new AbortController(),
        readable,
        writable,
    }
}

const adapter = createKeychronAdapter({ rows: FAKE_ROWS, cols: FAKE_COLS })

runContractSuite('keychron-qmk', {
    makeAdapter: () => adapter,
    makeMatchingTransport: createFakeKeychronTransport,
    makeMismatchingTransport: createMismatchTransport,
    transportKind: 'hid',
})
