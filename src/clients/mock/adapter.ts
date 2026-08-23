/* eslint-disable @typescript-eslint/no-unused-vars */
// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; sentinel-label probe + connect returning MockKeyboardService.
import type { Discovery, FirmwareAdapter, Probe } from '@firmware/adapter'
import type { KeyboardService } from '@firmware/service'
import type { Transport } from '@firmware/transport'
import type { ConfigKeymap } from '@firmware/config'

import { MockKeyboardService } from './service'

export const MOCK_TRANSPORT_LABEL = 'mock://demo'

const MOCK_DISCOVERY: Discovery = {}

export const mockAdapter: FirmwareAdapter = {
    id: 'mock',
    displayName: 'Mock (Demo)',
    discovery: MOCK_DISCOVERY,

    async canHandle(transport: Transport): Promise<Probe> {
        if (transport.label !== MOCK_TRANSPORT_LABEL) {
            return { ok: false, reason: 'not a mock transport' }
        }
        return {
            ok: true,
            deviceInfo: {
                name: 'Mock Corne',
                firmware: 'mock',
                firmwareVersion: '0.0.0',
                serialNumber: 'MOCK-0001',
            },
        }
    },

    async connect(
        _transport: Transport,
        _signal: AbortSignal,
    ): Promise<KeyboardService> {
        return new MockKeyboardService()
    },
}

/**
 * Build a no-op transport carrying the mock sentinel label. Streams are inert
 * (closed/discarded) — MockKeyboardService never reads or writes them. Used by
 * the demo flow and by the contract suite to drive `pickAdapter` end-to-end.
 */
export function createMockTransport(): Transport {
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
        label: MOCK_TRANSPORT_LABEL,
        abortController: new AbortController(),
        readable,
        writable,
    }
}

/**
 * Demo / dev / storybook entry point: skips transport selection and hands back
 * a ready KeyboardService. Bypasses pickAdapter on purpose so the demo button
 * never depends on probe ordering.
 */
export async function connectMock(): Promise<KeyboardService> {
    const transport = createMockTransport()
    const ctrl = new AbortController()
    return mockAdapter.connect(transport, ctrl.signal)
}

// Pattern check: Factory Method (Tier 1) — extended — sibling of connectMock
// above; a thin factory producing a seeded MockKeyboardService for the handoff.
/**
 * Builder "Open in editor" handoff: a demo KeyboardService seeded from a
 * specific board config rather than the static Corne demo, so the editor opens
 * on exactly the keyboard the user just designed. The service's getConfigSource
 * serializes this config, which (re)seeds configStore as the source of truth.
 */
export function connectMockWithConfig(config: ConfigKeymap): KeyboardService {
    return new MockKeyboardService({ seedConfig: config })
}
