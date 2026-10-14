// pattern-check: skip — pure data: a demo gamepad that reports no layout.
import { defaultLayout } from '@firmware/devices/defaultLayout'
import type { DeviceBindings } from '@firmware/devices/types'
import type { DemoDeviceDef } from './types'
import { VECTOR_PAD_BINDINGS } from './vectorPad'

const model = defaultLayout('gamepad', 'Generic USB Gamepad', {
    buttons: 12,
    axes: 6,
    hats: 1,
})

/** What a plain HID gamepad does out of the box: the stock gamepad mapping
 *  for the controls it has. */
const bindings: DeviceBindings = Object.fromEntries(
    model.controls.flatMap((c) => {
        const b = VECTOR_PAD_BINDINGS[c.id]
        return b ? [[c.id, b]] : []
    }),
)

/** Stands in for a generic HID gamepad: it only reports its inputs, so the app
 *  shows a default layout and cannot write bindings to it. */
export const GENERIC_GAMEPAD: DemoDeviceDef = {
    id: 'generic-gamepad',
    model,
    bindings,
    profiles: ['Default'],
    firmwareVersion: 'unknown',
    transport: 'usb',
    editable: false,
}
