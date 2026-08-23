// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; translates ZMK Keymap/PhysicalLayouts → neutral Keymap.
import type {
    Keymap as ZmkKeymap,
    Layer as ZmkLayer,
    PhysicalLayout as ZmkPhysicalLayout,
    PhysicalLayouts as ZmkPhysicalLayouts,
} from '@zmkfirmware/zmk-studio-ts-client/keymap'
import type {
    Keymap,
    Layer,
    PhysicalLayout,
    PhysicalLayoutKey,
} from '@firmware/types'
import { type BehaviorMap, bindingToKeyAction } from './actions'

function zmkLayerToNeutral(
    layer: ZmkLayer,
    behaviors: BehaviorMap,
    keymap: Pick<ZmkKeymap, 'layers'>,
): Layer {
    return {
        id: layer.id,
        name: layer.name,
        keys: layer.bindings.map((b) =>
            bindingToKeyAction(b, behaviors, keymap),
        ),
    }
}

function zmkPhysicalLayoutToNeutral(
    layout: ZmkPhysicalLayout,
    index: number,
): PhysicalLayout {
    return {
        id: index,
        name: layout.name,
        keys: layout.keys.map<PhysicalLayoutKey>((k) => ({
            x: k.x,
            y: k.y,
            w: k.width,
            h: k.height,
            r: k.r,
            rx: k.rx,
            ry: k.ry,
        })),
    }
}

export function zmkKeymapToNeutral(
    keymap: ZmkKeymap,
    layouts: ZmkPhysicalLayouts,
    behaviors: BehaviorMap,
): Keymap {
    return {
        layers: keymap.layers.map((l) =>
            zmkLayerToNeutral(l, behaviors, keymap),
        ),
        availableLayers: keymap.availableLayers,
        activeLayoutId: layouts.activeLayoutIndex,
        layouts: layouts.layouts.map(zmkPhysicalLayoutToNeutral),
    }
}
