import { readTransportIds, type Transport } from './transport'
import type { FirmwareAdapter, ProbeHint } from './adapter'

const adapters: FirmwareAdapter[] = []

// HID probe ordering. A Transport's byte streams are single-use: a failed probe
// by one adapter can lock or consume them (e.g. VIA's createHidClientFromTransport,
// ZMK's pipeThrough), leaving nothing for the adapter that actually owns the
// device. So over HID we try the owning adapter FIRST and never let a
// guaranteed-miss adapter probe at all. An adapter whose HID filter names
// vendorIds is *specific* — it only handles those VIDs (rank 0 = this device's
// VID, rank 2 = guaranteed miss → skip). One with no vendorIds (usage-page-only,
// e.g. VIA 0xFF60) is *generic* (rank 1). Remappr's filter is VID 0x1209.
function hidRank(adapter: FirmwareAdapter, vid: number): number {
    const vids = adapter.discovery?.hid?.vendorIds
    if (vids && vids.length > 0) return vids.includes(vid) ? 0 : 2
    return 1
}

export function registerAdapter(adapter: FirmwareAdapter): void {
    if (adapters.some((a) => a.id === adapter.id)) return
    adapters.push(adapter)
}

export function getAdapters(): readonly FirmwareAdapter[] {
    return adapters
}

export async function pickAdapter(
    transport: Transport,
    hint?: ProbeHint,
): Promise<FirmwareAdapter | null> {
    // Over HID, order by VID specificity and drop guaranteed-miss specific
    // adapters: otherwise a non-owning adapter's probe consumes/locks the shared
    // single-use transport before the owning adapter is ever tried (the cause of
    // "No firmware adapter handled the device" on a Remappr USB keyboard). Serial
    // /BLE keep the original order — they do not key off a USB VID.
    let candidates = adapters
    if (hint?.transportKind === 'hid') {
        const { vid } = readTransportIds(transport)
        if (vid) {
            candidates = adapters
                .filter((a) => hidRank(a, vid) < 2)
                .sort((a, b) => hidRank(a, vid) - hidRank(b, vid))
        }
    }
    for (const adapter of candidates) {
        const probe = await adapter
            .canHandle(transport, hint)
            .catch(() => ({ ok: false as const }))
        if (probe.ok) return adapter
    }
    return null
}
