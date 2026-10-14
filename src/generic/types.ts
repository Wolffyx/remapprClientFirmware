// pattern-check: skip — type vocabulary of the generic HID input sources, no behaviour.
//
// A generic device is one the app has no vendor protocol for: a plain USB
// gamepad, a mouse. It can be viewed and live-tested, never written. Each
// source (Gamepad API, the OS pointer) describes such a device as a NATIVE
// profile: its controls, what each one sends on its own, and a catalog naming
// those native outputs.
import type {
    ControlInputFrame,
    ControlsCatalog,
    DeviceBindings,
    DeviceForm,
    DeviceModel,
} from '../devices/types'
import type { KeyboardService } from '../service'

/** What a generic device is and does out of the box. */
export interface NativeProfile {
    readonly model: DeviceModel
    readonly catalog: ControlsCatalog
    /** What each control sends natively (the only profile it has). */
    readonly bindings: DeviceBindings
}

/** Where a generic device's live input comes from. Subscribing starts the
 *  source and the last unsubscribe stops it. */
export interface LiveSource {
    subscribe(cb: (frame: ControlInputFrame) => void): () => void
}

/** A device a generic source found, before it is opened. */
export interface GenericInputDevice {
    /** Stable while the device stays plugged in. */
    readonly id: string
    readonly name: string
    readonly form: DeviceForm
    /** What the start page draws: the native profile, with a layout the user
     *  re-drew for this device applied. */
    readonly preview: NativeProfile
    /** One line about it: "Standard gamepad", "12 buttons · 6 axes". */
    readonly summary: string
    connect(): Promise<KeyboardService>
}
