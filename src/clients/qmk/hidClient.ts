// Pattern check: no GoF pattern (-) — rejected — re-export shim of firmware-neutral Raw HID client; preserves @firmware/qmk/hidClient import path.
// Canonical implementation: src/firmware/hid/rawHidClient.ts.

import type { Transport } from '@firmware/transport'
import {
    createHidClientFromTransport as createRawHidClientFromTransport,
    type HidClient,
    type HidClientOpts,
} from '@firmware/hid/rawHidClient'

import { VIA_PAYLOAD_SIZE } from './protocol'

export type { HidClient, HidClientOpts }

export function createHidClientFromTransport(
    transport: Transport,
    opts: HidClientOpts = {},
): HidClient {
    return createRawHidClientFromTransport(transport, {
        payloadSize: opts.payloadSize ?? VIA_PAYLOAD_SIZE,
        defaultTimeoutMs: opts.defaultTimeoutMs,
    })
}
