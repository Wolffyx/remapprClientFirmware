// Pattern check: no GoF pattern (-) — rejected — integration test for adapter probe race; constructs adapter instances directly and asserts pickAdapter ordering, no abstraction.
import { describe, it, expect } from 'vitest'

import type { Transport } from '@firmware'
import { writeU16BE, VIA_ID, VIA_PAYLOAD_SIZE } from '@firmware/clients/qmk/protocol'
import { createQmkAdapter } from '@firmware/clients/qmk/adapter'
import type { FirmwareAdapter } from '@firmware/adapter'

import { createKeychronAdapter } from './adapter'
import { FEATURE_BIT, KC_ID, MISC_SUB } from './protocol'

function frame(): Uint8Array {
    return new Uint8Array(VIA_PAYLOAD_SIZE)
}

function makeKeychronTransport(): Transport {
    const inbound = new TransformStream<Uint8Array, Uint8Array>()
    const outbound = new TransformStream<Uint8Array, Uint8Array>()
    const writer = inbound.writable.getWriter()
    const reader = outbound.readable.getReader()
    void (async () => {
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (!value || value.length === 0) continue
                const out = frame()
                out[0] = value[0]
                if (value[0] === KC_ID.GET_PROTOCOL_VERSION) {
                    out[1] = 0x02
                    out[3] = 0x02
                } else if (value[0] === KC_ID.GET_FIRMWARE_VERSION) {
                    'v1.0.0 fake'
                        .split('')
                        .forEach((c, i) => (out[1 + i] = c.charCodeAt(0)))
                } else if (value[0] === KC_ID.GET_SUPPORT_FEATURE) {
                    out[1] = FEATURE_BIT.DEFAULT_LAYER | FEATURE_BIT.BLUETOOTH
                } else if (value[0] === KC_ID.MISC_CMD_GROUP) {
                    out[1] = value[1]
                    if (value[1] === MISC_SUB.GET_PROTOCOL_VER) {
                        out[3] = 0x02
                    }
                } else if (value[0] === VIA_ID.GET_PROTOCOL_VERSION) {
                    writeU16BE(out, 1, 0x000c)
                } else if (value[0] === VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT) {
                    out[1] = 1
                } else if (value[0] === VIA_ID.GET_KEYBOARD_VALUE) {
                    out[1] = value[1]
                }
                await writer.write(out)
            }
        } catch {
            /* torn down */
        }
    })()
    return {
        label: 'fake-keychron-race',
        abortController: new AbortController(),
        readable: inbound.readable,
        writable: outbound.writable,
    }
}

function makeVanillaViaTransport(): Transport {
    // Responds to standard VIA but NOT to 0xA0 — simulates a non-Keychron
    // QMK board so keychron probe must reject and qmk-via must claim.
    const inbound = new TransformStream<Uint8Array, Uint8Array>()
    const outbound = new TransformStream<Uint8Array, Uint8Array>()
    const writer = inbound.writable.getWriter()
    const reader = outbound.readable.getReader()
    void (async () => {
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (!value || value.length === 0) continue
                const out = frame()
                out[0] = value[0]
                if (value[0] === KC_ID.GET_PROTOCOL_VERSION) {
                    // Reject: respond with 0xFF/0x00 error.
                    out[0] = 0xff
                    out[1] = 0x00
                } else if (value[0] === VIA_ID.GET_PROTOCOL_VERSION) {
                    writeU16BE(out, 1, 0x000c)
                } else if (value[0] === VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT) {
                    out[1] = 1
                } else if (value[0] === VIA_ID.GET_KEYBOARD_VALUE) {
                    out[1] = value[1]
                }
                await writer.write(out)
            }
        } catch {
            /* torn down */
        }
    })()
    return {
        label: 'fake-vanilla-via',
        abortController: new AbortController(),
        readable: inbound.readable,
        writable: outbound.writable,
    }
}

async function pickFirstHandler(
    adapters: FirmwareAdapter[],
    transport: Transport,
): Promise<FirmwareAdapter | null> {
    for (const a of adapters) {
        const p = await a
            .canHandle(transport, { transportKind: 'hid' })
            .catch(() => ({ ok: false as const }))
        if (p.ok) return a
    }
    return null
}

describe('probe race: keychron-qmk vs qmk-via', () => {
    it('keychron-qmk claims a Keychron-protocol device ahead of qmk-via', async () => {
        const keychron = createKeychronAdapter({ rows: 1, cols: 1 })
        const qmk = createQmkAdapter({ rows: 1, cols: 1 })
        const transport = makeKeychronTransport()
        const winner = await pickFirstHandler([keychron, qmk], transport)
        expect(winner?.id).toBe('keychron-qmk')
    })

    it('qmk-via still claims a vanilla VIA device when keychron probe fails', async () => {
        const keychron = createKeychronAdapter({ rows: 1, cols: 1 })
        const qmk = createQmkAdapter({ rows: 1, cols: 1 })
        const transport = makeVanillaViaTransport()
        const winner = await pickFirstHandler([keychron, qmk], transport)
        expect(winner?.id).toBe('qmk-via')
    })
})
