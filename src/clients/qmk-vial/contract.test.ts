// Pattern check: no GoF pattern (-) — rejected — fake Vial responder over paired streams driving the shared FirmwareAdapter contract suite, no abstraction warranted.
import { describe, expect, it, vi } from 'vitest'

import { runContractSuite } from '@firmware/__tests__/contract'
import { xzStore } from '@firmware/__tests__/xz'
import type { Transport } from '@firmware'
import {
    VIA_ID,
    VIA_KBV,
    VIA_PAYLOAD_SIZE,
    writeU16BE,
} from '@firmware/clients/qmk/protocol'

import keycultSource from '@firmware/kle/fixtures/aftermarket-keycult-tkl.vial.json?raw'

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

function makeDefBytes(text: string = makeDefJson()): Uint8Array {
    const enc = new TextEncoder().encode(text)
    return xzStore(enc)
}

/** One key plus one encoder (KLE label 'e' in slot 9 → parser labels[4]). */
function makeEncoderDefJson(): string {
    return JSON.stringify({
        name: 'Fake Vial Knob',
        matrix: { rows: FAKE_ROWS, cols: FAKE_COLS },
        layouts: { keymap: [['0,0', { x: 1 }, '0,0\n\n\n\n\n\n\n\n\ne']] },
        customKeycodes: [],
    })
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
    /** Encoder map as the firmware stores it: `${layer}:${idx}:${clockwise}`. */
    encoders: Map<string, number>
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
            // Mirrors vial.c: counter-clockwise (clockwise=0) first.
            case VIAL_CMD.GET_ENCODER: {
                const r = frame()
                const ccw = state.encoders.get(`${req[2]}:${req[3]}:0`) ?? 0
                const cw = state.encoders.get(`${req[2]}:${req[3]}:1`) ?? 0
                writeU16BE(r, 0, ccw)
                writeU16BE(r, 2, cw)
                return r
            }
            case VIAL_CMD.SET_ENCODER: {
                state.encoders.set(
                    `${req[2]}:${req[3]}:${req[4]}`,
                    ((req[5] << 8) | req[6]) & 0xffff,
                )
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
        encoders: new Map(),
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

    it('a broken definition is still a Vial board, and falls back to VIA mode with a notice', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const adapter = createVialAdapter()
        // Implausible size (0) → the definition fetch throws.
        const t = createFakeVialTransport({ defBytes: new Uint8Array(0) })
        const probe = await adapter.canHandle(t, { transportKind: 'hid' })
        expect(probe.ok).toBe(true)
        const svc = await adapter.connect(t, new AbortController().signal)
        expect(svc.deviceInfo.firmware).toBe('qmk-via')
        expect(svc.connectNotices?.[0]).toMatchObject({
            level: 'warning',
            title: 'Connected in VIA mode',
        })
        expect(svc.connectNotices?.[0].description).toMatch(/implausible size/)
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
        await svc.disconnect()
    })

    it('prefers the saved vial.json for this board over VIA mode', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const store = new Map<string, string>()
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => void store.set(k, v),
                removeItem: (k: string) => void store.delete(k),
            },
        })
        try {
            store.set(
                'qmk-via-layout:v1:4b50:0001',
                JSON.stringify({ v: 1, raw: JSON.parse(makeDefJson()) }),
            )
            const t = createFakeVialTransport({
                defBytes: new Uint8Array(0),
                label: 'fake-vial · 4b50:0001',
            })
            const svc = await createVialAdapter().connect(
                t,
                new AbortController().signal,
            )
            expect(svc.deviceInfo.firmware).toBe('qmk-vial')
            expect(svc.deviceInfo.name).toBe('Fake Vial')
            expect(svc.connectNotices?.[0].title).toBe(
                'Using your saved vial.json',
            )
            await svc.disconnect()
        } finally {
            vi.unstubAllGlobals()
            warn.mockRestore()
        }
    })

    it('a healthy board connects as Vial with no notices', async () => {
        const svc = await createVialAdapter().connect(
            createFakeVialTransport(),
            new AbortController().signal,
        )
        expect(svc.deviceInfo.firmware).toBe('qmk-vial')
        expect(svc.connectNotices ?? []).toHaveLength(0)
        await svc.disconnect()
    })
})

describe('qmk-vial — vial.json sideload (#189)', () => {
    async function connectFake(label?: string) {
        const adapter = createVialAdapter()
        const t = createFakeVialTransport({ label })
        const svc = await adapter.connect(t, new AbortController().signal)
        return svc
    }

    it('offers a vial.json format and no registry lookup', async () => {
        const svc = await connectFake()
        expect(svc.sideload?.formats.map((f) => f.id)).toEqual([
            'vial-layout-json',
        ])
        expect(svc.sideload?.resolveAuto).toBeUndefined()
        expect(svc.capabilities.layoutSideloadable).toBe(true)
        await svc.disconnect()
    })

    it('importFile swaps the layout and reads encoders under the new def', async () => {
        const svc = await connectFake()
        const seen: string[] = []
        svc.subscribe((n) => seen.push(n.topic))
        const override = JSON.stringify({
            name: 'Override',
            matrix: { rows: FAKE_ROWS, cols: FAKE_COLS },
            layouts: {
                keymap: [['0,0', { x: 1 }, '0,0\n\n\n\n\n\n\n\n\ne']],
            },
            customKeycodes: [],
        })
        const result = await svc.sideload!.importFile(
            'vial-layout-json',
            override,
        )
        expect(result.keymapChanged).toBe(true)
        const km = await svc.getKeymap()
        expect(km.layouts[0].name).toBe('Override')
        expect(km.layouts[0].encoders?.length).toBe(1)
        expect(km.layers[0].encoders?.length).toBe(1)
        expect(svc.capabilities.encoders).toBe(1)
        expect(seen).toContain('layout-changed')
        await svc.disconnect()
    })
})

describe('qmk-vial — encoder direction', () => {
    it('reads counter-clockwise first, and writes clockwise with the firmware flag set', async () => {
        let state: FakeState | undefined
        const t = createFakeVialTransport(
            { defBytes: makeDefBytes(makeEncoderDefJson()) },
            (st) => {
                state = st
                st.encoders.set('0:0:0', 0x05) // ccw = KC_B
                st.encoders.set('0:0:1', 0x06) // cw  = KC_C
            },
        )
        const svc = await createVialAdapter().connect(
            t,
            new AbortController().signal,
        )
        const km = await svc.getKeymap()
        const enc = km.layers[0].encoders![0]
        expect(enc.ccw.params).toEqual([0x05])
        expect(enc.cw.params).toEqual([0x06])

        const kcD = svc.buildKeyAction(enc.cw.kind, [0x07])
        await svc.encoders!.setEncoder(km.layers[0].id, 0, 0, kcD) // 0 = cw
        expect(state!.encoders.get('0:0:1')).toBe(0x07)
        expect(state!.encoders.get('0:0:0')).toBe(0x05)
        await svc.disconnect()
    })
})

describe('qmk-vial — real vial.json upload (Keycult TKL)', () => {
    it('loads 87 keys and the knob, reading its actions from the board', async () => {
        const t = createFakeVialTransport({}, (st) => {
            st.encoders.set('0:0:0', 0xaa) // ccw = KC_VOLD
            st.encoders.set('0:0:1', 0xa9) // cw  = KC_VOLU
        })
        const svc = await createVialAdapter().connect(
            t,
            new AbortController().signal,
        )
        await svc.sideload!.importFile('vial-layout-json', keycultSource)
        const km = await svc.getKeymap()
        expect(km.layouts[0].keys).toHaveLength(87)
        expect(km.layouts[0].encoders).toEqual([{ x: 1850, y: 0 }])
        const knob = km.layers[0].encoders![0]
        expect(knob.cw.canonicalId).toBe('media.volume_increment')
        expect(knob.ccw.canonicalId).toBe('media.volume_decrement')
        await svc.disconnect()
    })
})
