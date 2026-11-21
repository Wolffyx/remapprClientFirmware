// pattern-check: skip — catalog constructors for native HID outputs; data helpers, no abstraction.
//
// A generic device cannot be re-bound, so its catalog lists only what its
// controls send natively ("Button 3", "Left stick", "Back"). The inspector
// shows those read-only; the fields table keeps to the fields that name them.
import type {
    ControlFieldSupport,
    ControlOption,
    ControlsCatalog,
    DeviceAction,
    DeviceActionGroup,
} from '../devices/types'

type NativeGroup = 'mouse' | 'pad'

const GROUPS: Readonly<Record<NativeGroup, DeviceActionGroup>> = {
    mouse: { id: 'mouse', label: 'Mouse buttons', category: 'mouse' },
    pad: { id: 'pad', label: 'Controller', category: 'pad' },
}

/** Fields that show what a control sends; tuning fields (deadzone, curve …)
 *  belong to the device's own software and are left out. */
const NATIVE_FIELDS: ControlFieldSupport = {
    button: ['a'],
    wheel: ['up', 'down', 'click'],
    stick: ['out', 'click'],
    trigger: ['out'],
    hat: ['up', 'down', 'left', 'right'],
    axis: ['out'],
}

/** A native action id. */
export const nativeId = (id: string): string => `hid:${id}`

export const nativeAction = (
    group: NativeGroup,
    id: string,
    label: string,
): DeviceAction => ({
    id: nativeId(id),
    label,
    group,
    category: GROUPS[group].category,
})

export const nativeOutput = (id: string, label: string): ControlOption => ({
    id: nativeId(id),
    label,
    category: 'pad',
})

/** A catalog of `actions` and `outputs`, grouped by the groups it uses. */
export function nativeCatalog(
    actions: readonly DeviceAction[],
    outputs: ControlsCatalog['outputs'] = {},
): ControlsCatalog {
    const used = new Set(actions.map((a) => a.group))
    return {
        groups: Object.values(GROUPS).filter((g) => used.has(g.id)),
        actions,
        outputs,
        fields: NATIVE_FIELDS,
    }
}
