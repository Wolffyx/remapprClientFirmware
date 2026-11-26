// pattern-check: skip neutral type re-export — bytes-stream Transport contract shared by every FirmwareAdapter.
import type { RpcTransport } from '@zmkfirmware/zmk-studio-ts-client/transport/index'

// pattern-check: skip — optional capability field on the existing Transport DTO, plain interface.
/** HID feature reports (HIDIOCSFEATURE / HIDIOCGFEATURE), for vendor protocols
 *  that configure the device through them instead of input/output reports.
 *  Payloads never carry the report id: the transport adds and strips it. */
export interface FeatureReports {
    send(reportId: number, payload: Uint8Array): Promise<void>
    /** Read `length` payload bytes of feature report `reportId`. */
    receive(reportId: number, length: number): Promise<Uint8Array>
}

export type Transport = RpcTransport & {
    /** Optional VID/PID surfaced by HID transports (used by VIA registry lookup). */
    vid?: number
    pid?: number
    /** Present on HID transports that can exchange feature reports. */
    feature?: FeatureReports
}

// pattern-check: skip mechanical move of existing pure helpers from qmk/adapter.ts (dedupe)
/** Parse a `vvvv:pppp` hex VID:PID pair out of a transport label, if present. */
export function parseVidPidFromLabel(
    label: string,
): { vid: number; pid: number } | null {
    const m = label.match(/\b([0-9a-f]{4}):([0-9a-f]{4})\b/i)
    if (!m) return null
    const vid = Number.parseInt(m[1], 16)
    const pid = Number.parseInt(m[2], 16)
    if (!Number.isFinite(vid) || !Number.isFinite(pid)) return null
    return { vid, pid }
}

/** Resolve VID/PID from explicit transport fields, falling back to the label. */
export function readTransportIds(transport: Transport): {
    vid?: number
    pid?: number
} {
    if (
        typeof transport.vid === 'number' &&
        typeof transport.pid === 'number'
    ) {
        return { vid: transport.vid, pid: transport.pid }
    }
    return parseVidPidFromLabel(transport.label || '') ?? {}
}
