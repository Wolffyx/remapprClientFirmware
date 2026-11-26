// pattern-check: skip static firmware-target descriptor table + no abstraction (domain data moved out of the builder UI)
// Single source of truth for the builder's selectable firmware targets — the
// string ids that land in `keyboard.firmware[]` (see schema.ts). Lives in the
// firmware layer so the id set + per-target facts (wireless capability, display
// name, one-line blurb) are authoritative and not duplicated in the UI.

/** A firmware target the builder can emit for. via/vial compile via QMK;
 *  remappr emits a Zephyr shield via the `remappr-board` compiler. */
import type { DeviceForm } from '../devices/types'

export type BuilderFirmwareId = 'qmk' | 'via' | 'vial' | 'zmk' | 'remappr'

export interface BuilderFirmwareTarget {
    id: BuilderFirmwareId
    name: string
    blurb: string
    /** True when the target is a wireless (BLE) firmware. */
    wireless: boolean
    /** Device forms other than a keyboard this target builds (a mouse, a
     *  gamepad, …); absent = keyboards only. Each target declares its own. */
    deviceForms?: readonly DeviceForm[]
}

export const BUILDER_FIRMWARE_TARGETS: BuilderFirmwareTarget[] = [
    {
        id: 'qmk',
        name: 'QMK',
        blurb: 'C firmware · info.json + keymap',
        wireless: false,
    },
    {
        id: 'via',
        name: 'VIA',
        blurb: 'Live remap · v3 definition',
        wireless: false,
    },
    {
        id: 'vial',
        name: 'Vial',
        blurb: 'On-device · VIA + vial.json',
        wireless: false,
    },
    {
        id: 'zmk',
        name: 'ZMK',
        blurb: 'Wireless · keymap file',
        wireless: true,
    },
    {
        id: 'remappr',
        name: 'Remappr',
        blurb: 'Wireless · board files and a settings file',
        wireless: true,
        deviceForms: ['mouse', 'gamepad', 'flightstick'],
    },
]

/** True when @p target builds a device of @p form (keyboards: every target). */
export function targetBuildsForm(
    target: BuilderFirmwareTarget,
    form: DeviceForm,
): boolean {
    if (form === 'keyboard' || form === 'macropad') return true
    return target.deviceForms?.includes(form) ?? false
}
