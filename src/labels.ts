// Pattern check: no GoF pattern (-) — rejected — pure mapper from neutral KeyAction.label + PhysicalLayout geometry to renderer-shaped per-position descriptor.
import type { HoldTapLabelData, Keymap, PhysicalLayout } from './types'

export type ResolvedHoldTapDescriptor = HoldTapLabelData

export interface ResolvedBindingPosition {
    id: string
    header: string
    actionLabel?: string
    holdTap?: HoldTapLabelData
    bindingParam1?: number
    actionTypeName?: string
    /** Short cap-legend text for a non-HID param (from KeyLabel.paramText). */
    paramText?: string
    /** Tooltip for the param legend (from KeyLabel.description). */
    paramTitle?: string
    outOfRange: boolean
    x: number
    y: number
    width: number
    height: number
    r: number
    rx: number
    ry: number
}

export function resolveBindingLabels(
    layout: PhysicalLayout,
    keymap: Keymap,
    selectedLayerIndex: number,
): ResolvedBindingPosition[] {
    if (!keymap.layers[selectedLayerIndex]) return []
    return layout.keys.map((k, i) => {
        const layerKeys = keymap.layers[selectedLayerIndex].keys
        const outOfRange = i >= layerKeys.length
        const action = outOfRange ? undefined : layerKeys[i]
        const label = action?.label
        return {
            id: `${keymap.layers[selectedLayerIndex].id}-${i}`,
            header: label?.primary ?? 'Unknown',
            actionLabel: label?.bindingPrefix,
            holdTap: label?.holdTap,
            bindingParam1: label?.primaryUsage,
            actionTypeName: label?.primary,
            paramText: label?.paramText,
            paramTitle: label?.description,
            outOfRange,
            x: k.x / 100.0,
            y: k.y / 100.0,
            width: k.w / 100,
            height: k.h / 100.0,
            r: (k.r || 0) / 100.0,
            rx: (k.rx || 0) / 100.0,
            ry: (k.ry || 0) / 100.0,
        }
    })
}
