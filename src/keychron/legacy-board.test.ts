// Pattern check: no GoF pattern (-) — rejected — fake responder + assertions for the legacy-board probe path; test-only, no abstraction.
//
// Older wired K-series boards (e.g. K5 v2) report Keychron raw-HID protocol
// v1 and leave the 0xA2 feature word empty, yet still answer 0xA3
// GET_DEFAULT_LAYER. They must still get the Keychron adapter (for the QK_KB
// keycode table) and a layerControl facade (for Mac/Win auto-select).
import { describe, expect, it } from 'vitest'

import type { Transport } from '@firmware/transport'
import { VIA_ID, VIA_KBV, VIA_PAYLOAD_SIZE, writeU16BE } from '@firmware/qmk/protocol'

import { createKeychronAdapter } from './adapter'
import { KC_ID, MISC_SUB } from './protocol'

const HW_DEFAULT_LAYER = 2

function buildResponse(req: Uint8Array): Uint8Array | null {
    const out = new Uint8Array(VIA_PAYLOAD_SIZE)
    const id = req[0]
    out[0] = id

    switch (id) {
        case KC_ID.GET_PROTOCOL_VERSION:
            out[1] = 0x01 // legacy protocol version
            return out
        case KC_ID.GET_FIRMWARE_VERSION: {
            const text = 'k5v2 fake'
            for (let i = 0; i < text.length; i++) out[1 + i] = text.charCodeAt(i)
            return out
        }
        case KC_ID.GET_SUPPORT_FEATURE:
            // Answers, but advertises nothing — the unreliable-feature-word case.
            return out
        case KC_ID.GET_DEFAULT_LAYER:
            out[1] = HW_DEFAULT_LAYER
            return out
        case KC_ID.MISC_CMD_GROUP:
            out[1] = req[1] & 0xff
            if ((req[1] & 0xff) === MISC_SUB.GET_PROTOCOL_VER) return out
            return out
        case VIA_ID.GET_PROTOCOL_VERSION:
            writeU16BE(out, 1, 0x000c)
            return out
        case VIA_ID.GET_KEYBOARD_VALUE:
            out[1] = req[1]
            if (req[1] === VIA_KBV.FIRMWARE_VERSION) out[5] = 1
            return out
        case VIA_ID.DYNAMIC_KEYMAP_GET_LAYER_COUNT:
            out[1] = 4
            return out
        case VIA_ID.DYNAMIC_KEYMAP_GET_KEYCODE:
            out[1] = req[1]
            out[2] = req[2]
            out[3] = req[3]
            writeU16BE(out, 4, 0x0004)
            return out
        default:
            return out
    }
}

function createLegacyTransport(): Transport {
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
                const resp = buildResponse(value)
                if (resp) await writer.write(resp)
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
        label: 'Keychron K5 Version 2',
        abortController: new AbortController(),
        readable: inbound.readable,
        writable: outbound.writable,
    }
}

describe('keychron legacy board (protocol v1, empty feature word)', () => {
    it('claims the transport', async () => {
        const adapter = createKeychronAdapter({ rows: 1, cols: 1 })
        const probe = await adapter.canHandle(createLegacyTransport(), {
            transportKind: 'hid',
        })
        expect(probe.ok).toBe(true)
    })

    it('attaches layerControl from a live 0xA3 probe', async () => {
        const adapter = createKeychronAdapter({ rows: 1, cols: 1 })
        const transport = createLegacyTransport()
        const service = await adapter.connect(
            transport,
            new AbortController().signal,
        )
        expect(service.layerControl).toBeDefined()
        expect(await service.layerControl!.getDefaultLayer()).toBe(
            HW_DEFAULT_LAYER,
        )
        await service.disconnect?.()
    })
})
