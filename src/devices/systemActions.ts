// Pattern check: Dispatch Map (Tier 0) — applied — system action name → catalog entry; one table instead of a helper per action.
//
// The system actions a device's buttons can run (show the charge, forget the
// dongle), as catalog entries in one "Device" group. Firmware-neutral: the
// adapter decides which its device offers, nothing here names a firmware.
import { BATTERY_SHOW_ACTION } from './battery'
import type { ControlsCatalog } from './types'

/** The catalog id of "forget the dongle and pair afresh". */
export const UNPAIR_ACTION = 'sys:unpair'

export const SYSTEM_ACTIONS = {
    batteryShow: { id: BATTERY_SHOW_ACTION, label: 'Show battery' },
    unpair: { id: UNPAIR_ACTION, label: 'Unpair (forget dongle)' },
} as const

export type SystemActionName = keyof typeof SYSTEM_ACTIONS

const DEVICE_GROUP = { id: 'device', label: 'Device', category: 'system' } as const

/** The system action a catalog id names, or undefined. */
export function systemActionOf(id: string | null | undefined): SystemActionName | undefined {
    return (Object.keys(SYSTEM_ACTIONS) as SystemActionName[]).find(
        (n) => SYSTEM_ACTIONS[n].id === id,
    )
}

export const isSystemAction = (action: string): action is SystemActionName =>
    action in SYSTEM_ACTIONS

/** `catalog` with the system actions `names`, in a "Device" group. */
export function withSystemActions(
    catalog: ControlsCatalog,
    names: readonly SystemActionName[],
): ControlsCatalog {
    if (names.length === 0) return catalog
    const hasGroup = catalog.groups.some((g) => g.id === DEVICE_GROUP.id)
    return {
        ...catalog,
        groups: hasGroup ? catalog.groups : [...catalog.groups, DEVICE_GROUP],
        actions: [
            ...catalog.actions,
            ...names.map((n) => ({
                ...SYSTEM_ACTIONS[n],
                group: DEVICE_GROUP.id,
                category: 'system' as const,
            })),
        ],
    }
}
