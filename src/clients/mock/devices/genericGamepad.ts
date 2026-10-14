// pattern-check: skip — pure data: a demo gamepad that reports no layout.
import { rawGamepadProfile } from '@firmware/generic/gamepad/raw'
import type { DemoDeviceDef } from './types'

/** What a real unmapped USB pad shows: every input under its raw number, each
 *  sending what it does natively. */
const native = rawGamepadProfile('Generic USB Gamepad', {
    buttons: 12,
    axes: 6,
    hats: 1,
})

/** Stands in for a generic HID gamepad: it only reports its inputs, so the app
 *  shows a default layout and cannot write bindings to it. */
export const GENERIC_GAMEPAD: DemoDeviceDef = {
    id: 'generic-gamepad',
    model: native.model,
    bindings: native.bindings,
    catalog: native.catalog,
    profiles: ['Default'],
    firmwareVersion: 'unknown',
    transport: 'usb',
    editable: false,
}
