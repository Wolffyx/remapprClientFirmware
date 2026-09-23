// Pattern check: no GoF pattern (-) — rejected — fake Vial responder over paired streams driving the shared FirmwareAdapter contract suite, no abstraction warranted.
import { compress as lzmaCompress } from 'lzma1'
import { describe, expect, it, vi } from 'vitest'

import { runContractSuite } from '@firmware/__tests__/contract'
import type { Transport } from '@firmware'
import {
    VIA_ID,
    VIA_KBV,
    VIA_PAYLOAD_SIZE,
    writeU16BE,
} from '@firmware/clients/qmk/protocol'

import { createVialAdapter } from './adapter'
import { DYNAMIC_OP, VIAL_CMD, VIAL_PREFIX } from './protocol'

const FAKE_ROWS = 1
const FAKE_COLS = 1
const FAKE_LAYERS = 2
const VIAL_PROTOCOL = 6
const KEYBOARD_ID = 0x1122334455667788n

function makeDefJson(): string {
    return JSON.stringify({
        name: 'Fake Vial',
        matrix: { rows: FAKE_ROWS, cols: FAKE_COLS },
        layouts: { keymap: [['0,0']] },
        customKeycodes: [],
    })
}

function makeDefBytes(): Uint8Array {
    const text = makeDefJson()
    const enc = new TextEncoder().encode(text)
    return lzmaCompress(enc)
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

interface FakeState {
    keymap: number[][][]
    defBytes: Uint8Array
    locked: boolean
    unlockInProgress: boolean
    /** Count of GET_SIZE / GET_DEFINITION requests seen. */
    defReads: number
}

interface FakeOptions {
    /** Replace the on-device (LZMA) definition bytes, e.g. with garbage. */
    defBytes?: Uint8Array
    label?: string
}

function frame(): Uint8Array {
    return new Uint8Array(VIA_PAYLOAD_SIZE)
}

function buildResponse(req: Uint8Array, state: FakeState): Uint8Array {
    const out = frame()
    const id = req[0]
    out[0] = id

    if (id === VIAL_PREFIX) {
        const sub = req[1]
        out[1] = sub
        switch (sub) {
            case VIAL_CMD.GET_KEYBOARD_ID: {
                // u32 LE protocol + u64 LE id (12 bytes total).
                out[0] = VIAL_PROTOCOL & 0xff
                out[1] = (VIAL_PROTOCOL >> 8) & 0xff
                out[2] = 0
                out[3] = 0
                let id64 = KEYBOARD_ID
                for (let i = 0; i < 8; i++) {
                    out[4 + i] = Number(id64 & 0xffn)
                    id64 >>= 8n
                }
                return out
            }
            case VIAL_CMD.GET_SIZE: {
                state.defReads++
                const size = state.defBytes.length
                out[0] = size & 0xff
                out[1] = (size >> 8) & 0xff
                out[2] = (size >> 16) & 0xff
                out[3] = (size >> 24) & 0xff
                return out
            }
            case VIAL_CMD.GET_DEFINITION: {
                state.defReads++
                const block =
                    (req[2] |
                        (req[3] << 8) |
                        (req[4] << 16) |
                        (req[5] << 24)) >>>
                    0
                const start = block * VIA_PAYLOAD_SIZE
                const end = Math.min(
                    start + VIA_PAYLOAD_SIZE,
                    state.defBytes.length,
                )
                if (start < state.defBytes.length) {
                    out.set(state.defBytes.subarray(start, end), 0)
                }
                return out
            }
            case VIAL_CMD.GET_UNLOCK_STATUS: {
                // 32-byte response: status byte (1 = unlocked, 0 = locked),
                // inProgress byte, then 15 (row,col) pairs (0xff,0xff = unused).
                const r = frame()
                r[0] = state.locked ? 0 : 1
                r[1] = state.unlockInProgress ? 1 : 0
                for (let i = 0; i < 15; i++) {
                    r[2 + i * 2] = 0xff
                    r[3 + i * 2] = 0xff
                }
                return r
            }
            case VIAL_CMD.UNLOCK_START:
                state.unlockInProgress = true
                return out
            case VIAL_CMD.UNLOCK_POLL:
                // After one poll, treat unlock as complete.
                state.locked = false
                state.unlockInProgress = false
                return out
            case VIAL_CMD.LOCK:
                state.locked = true
                return out
            case VIAL_CMD.DYNAMIC_ENTRY_OP: {
                const op = req[2]
                if (op === DYNAMIC_OP.GET_NUMBER_OF_ENTRIES) {
                    out[0] = 0
                    out[1] = 0
                    out[2] = 0
                    return out
                }
                return out
            }
            default:
                return out
        }
    }

    switch (id) {
        case VIA_ID.GET_PROTOCOL_VERSION:
            writeU16BE(out, 1, 0x000c)
            return out
        case VIA_ID.GET_KEYBOARD_VALUE:
            out[1] = req[1]
            if (req[1] === VIA_KBV.FIRMWARE_VERSION) {
                out[2] = 0
                out[3] = 0
                out[4] = 0
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

function createFakeVialTransport(
    opts: FakeOptions = {},
    stateOut?: (state: FakeState) => void,
): Transport {
    const inbound = new TransformStream<Uint8Array, Uint8Array>()
    const outbound = new TransformStream<Uint8Array, Uint8Array>()
    const state: FakeState = {
        keymap: defaultKeymap(),
        defBytes: opts.defBytes ?? makeDefBytes(),
        locked: true,
        unlockInProgress: false,
        defReads: 0,
    }
    stateOut?.(state)
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
        label: opts.label ?? 'fake-vial',
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
        label: 'fake-not-vial',
        abortController: new AbortController(),
        readable,
        writable,
    }
}

const adapter = createVialAdapter()

runContractSuite('qmk-vial', {
    makeAdapter: () => adapter,
    makeMatchingTransport: () => createFakeVialTransport(),
    makeMismatchingTransport: createMismatchTransport,
    transportKind: 'hid',
    autoUnlock: true,
})

describe('qmk-vial — identification vs loading (#187)', () => {
    it('canHandle identifies the board without reading its definition', async () => {
        let state: FakeState | undefined
        const t = createFakeVialTransport({}, (s) => (state = s))
        const probe = await createVialAdapter().canHandle(t, {
            transportKind: 'hid',
        })
        expect(probe.ok).toBe(true)
        expect(state!.defReads).toBe(0)
    })

    it('a broken definition is still a Vial board, and connect fails loudly', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const adapter = createVialAdapter()
        // Implausible size (0) → the definition fetch throws.
        const t = createFakeVialTransport({ defBytes: new Uint8Array(0) })
        const probe = await adapter.canHandle(t, { transportKind: 'hid' })
        expect(probe.ok).toBe(true)
        await expect(
            adapter.connect(t, new AbortController().signal),
        ).rejects.toThrow(/Vial keyboard detected/)
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})
