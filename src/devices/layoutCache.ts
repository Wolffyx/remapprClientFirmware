// pattern-check: skip — localStorage helpers for remembered device layouts, same shape as clients/qmk/layoutSideload.ts.
//
// A device that does not report where its controls are can be given a layout
// from the Builder; the adapter remembers it per device under a key it builds
// from the device's identity, and restores it on the next connect.
import { layoutFromModel, parseDeviceLayout } from './schema'
import type { DeviceModel } from './types'

const PREFIX = 'remappr.device-layout.'

function storage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/** The remembered layout under `key`, or null (none, or no longer valid). */
export function loadLayout(key: string): DeviceModel | null {
    const text = storage()?.getItem(PREFIX + key)
    if (!text) return null
    const r = parseDeviceLayout(text)
    return r.ok ? r.model : null
}

/** Remember `model` under `key`. Storage being full or blocked only means it
 *  is not remembered; the layout still applies for this session. */
export function saveLayout(key: string, model: DeviceModel): void {
    try {
        storage()?.setItem(PREFIX + key, JSON.stringify(layoutFromModel(model)))
    } catch (e) {
        console.warn('Could not remember the device layout', e)
    }
}

export function clearLayout(key: string): void {
    try {
        storage()?.removeItem(PREFIX + key)
    } catch (e) {
        console.warn('Could not forget the device layout', e)
    }
}
