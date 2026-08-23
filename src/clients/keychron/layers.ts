// pattern-check: skip — facade wires HidClient send + default-layer push frames into LayersApi; data marshalling only
//
// Keychron reports a hardware default layer (the Mac/Win DIP switch position) via
// 0xA3 and pushes a `default-layer` state-notify frame when it toggles. This facade
// exposes both behind the neutral LayersApi so the editor can auto-select the layer.
import type { HidClient } from '@firmware/hid/rawHidClient'
import type { LayersApi } from '@firmware/service'

import type { KeychronNotification } from './protocol'
import { getDefaultLayerCmd, parseDefaultLayer } from './protocol'

export interface LayersFacade {
    api: LayersApi
    onNotification: (n: KeychronNotification) => void
}

export function createLayersFacade(client: HidClient): LayersFacade {
    const listeners = new Set<(layer: number) => void>()

    const api: LayersApi = {
        async getDefaultLayer(): Promise<number> {
            const resp = await client.send(getDefaultLayerCmd())
            return parseDefaultLayer(resp)
        },
        onDefaultLayerChanged(cb: (layer: number) => void): () => void {
            listeners.add(cb)
            return () => listeners.delete(cb)
        },
    }

    return {
        api,
        onNotification(n) {
            if (n.kind !== 'default-layer') return
            for (const cb of listeners) {
                try {
                    cb(n.layer)
                } catch {
                    /* ignore */
                }
            }
        },
    }
}
