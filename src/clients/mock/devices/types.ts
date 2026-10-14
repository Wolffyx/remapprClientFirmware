// pattern-check: skip — type + tiny constructors for the demo device definitions.
import type { WirelessTransport } from '@firmware/service'
import type {
    ActionId,
    ButtonBinding,
    ControlBinding,
    ControlsCatalog,
    DeviceBindings,
    DeviceModel,
} from '@firmware/devices/types'

/** Per-control changes a profile makes on top of the default profile. */
export type ProfileOverrides = Readonly<
    Record<string, Partial<ControlBinding> & { hold?: ActionId | undefined }>
>

export interface DemoDeviceDef {
    readonly id: string
    readonly model: DeviceModel
    /** The default profile's bindings. */
    readonly bindings: DeviceBindings
    /** What the device can bind; absent = the demo catalog of its form. */
    readonly catalog?: ControlsCatalog
    /** Profile names; index 0 uses `bindings` as is. */
    readonly profiles: readonly string[]
    /** Changes per profile index (index 0 is unused). */
    readonly overrides?: readonly ProfileOverrides[]
    readonly firmwareVersion: string
    readonly transport: WirelessTransport
    readonly battery?: number
    /** False: the demo stands in for a device the app can only read. */
    readonly editable: boolean
}

/** A button binding. */
export const btn = (
    a: ActionId | null,
    extra: Omit<ButtonBinding, 'a'> = {},
): ButtonBinding => ({ a, ...extra })

export const DEMO_PROFILES = ['Default', 'Gaming', 'Work'] as const
