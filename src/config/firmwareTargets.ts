// pattern-check: skip static firmware-target descriptor table + no abstraction (domain data moved out of the builder UI)
// Single source of truth for the builder's selectable firmware targets — the
// string ids that land in `keyboard.firmware[]` (see schema.ts). Lives in the
// firmware layer so the id set + per-target facts (wireless capability, display
// name, one-line blurb) are authoritative and not duplicated in the UI.

/** A firmware target the builder can emit for. via/vial compile via QMK;
 *  remappr emits a Zephyr shield via the `remappr-board` compiler. */
export type BuilderFirmwareId = 'qmk' | 'via' | 'vial' | 'zmk' | 'remappr'

export interface BuilderFirmwareTarget {
    id: BuilderFirmwareId
    name: string
    blurb: string
    /** True when the target is a wireless (BLE) firmware. */
    wireless: boolean
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
        blurb: 'Wireless · devicetree keymap',
        wireless: true,
    },
    {
        id: 'remappr',
        name: 'Remappr',
        blurb: 'Wireless · Zephyr shield + config blob',
        wireless: true,
    },
]
