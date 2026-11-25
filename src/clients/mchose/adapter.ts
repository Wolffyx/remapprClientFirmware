// Pattern check: Adapter (Tier 1) — extended — implements the FirmwareAdapter contract of src/adapter.ts like src/clients/keychron/adapter.ts; probe + connect only.
import type { FirmwareAdapter, Probe } from '../../adapter'
import { readTransportIds, type Transport } from '../../transport'
import { MCHOSE_VIDS, modelFor } from './mouse'
import { MchoseLink, readConfig, readIdentity, readVersion } from './protocol'
import { MCHOSE_FIRMWARE, MchoseMouseService } from './service'

/** The receiver's vendor configuration collection. */
export const MCHOSE_USAGE_PAGE = 0xff01

const isMchoseVid = (vid: number): boolean =>
    (MCHOSE_VIDS as readonly number[]).includes(vid)

/** The transport's byte stream carries the mouse's unsolicited 0x13 pushes;
 *  drain it, so its end tells us the mouse is gone. */
function watchClosed(
    transport: Transport,
    cb: (reason?: unknown) => void,
): void {
    const reader = transport.readable.getReader()
    const drain = async (): Promise<void> => {
        while (!(await reader.read()).done) {
            /* pushes are not used yet */
        }
    }
    drain().then(
        () => cb(),
        (reason: unknown) => cb(reason),
    )
}

async function describe(transport: Transport, link: MchoseLink) {
    const ids = readTransportIds(transport)
    const identity = await readIdentity(link)
    const version = await readVersion(link)
    const model = modelFor(identity.vid, ids.pid, identity.pid)
    return {
        model,
        deviceInfo: {
            name: model.name,
            firmware: MCHOSE_FIRMWARE,
            firmwareVersion: version,
            vid: ids.vid ?? identity.vid,
            ...(ids.pid !== undefined ? { pid: ids.pid } : {}),
        },
    }
}

export const mchoseAdapter: FirmwareAdapter = {
    id: MCHOSE_FIRMWARE,
    displayName: 'MCHOSE',
    category: { id: MCHOSE_FIRMWARE, label: 'MCHOSE', order: 60 },
    discovery: {
        hid: { vendorIds: [...MCHOSE_VIDS], usagePage: MCHOSE_USAGE_PAGE },
    },

    async canHandle(transport, hint): Promise<Probe> {
        if (hint && hint.transportKind !== 'hid') return { ok: false }
        if (!transport.feature) {
            return { ok: false, reason: 'transport has no feature reports' }
        }
        const { vid } = readTransportIds(transport)
        if (vid !== undefined && !isMchoseVid(vid)) return { ok: false }
        const { deviceInfo } = await describe(
            transport,
            new MchoseLink(transport.feature),
        )
        if (!isMchoseVid(deviceInfo.vid)) return { ok: false }
        return { ok: true, deviceInfo }
    },

    async connect(transport, signal): Promise<MchoseMouseService> {
        if (!transport.feature) {
            throw new Error('This connection cannot send HID feature reports')
        }
        const link = new MchoseLink(transport.feature)
        const { model, deviceInfo } = await describe(transport, link)
        const config = await readConfig(link)
        signal.throwIfAborted()
        return new MchoseMouseService({
            link,
            model,
            deviceInfo,
            config,
            onTransportClosed: (cb) => watchClosed(transport, cb),
            closeTransport: async () => transport.abortController.abort(),
        })
    },
}
