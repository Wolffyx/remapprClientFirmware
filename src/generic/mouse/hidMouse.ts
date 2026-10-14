// pattern-check: skip — native profile of an enumerated HID mouse and its connect wiring; data assembly over defaultLayout, no abstraction.
//
// A mouse the OS lists as a HID pointer (usage page 0x01, usage 0x02) with no
// vendor protocol the app speaks. The listing does not say how many buttons it
// has, so it opens on the generic five-button mouse with a wheel.
import { defaultBinding } from '../../devices/defaults'
import { defaultLayout } from '../../devices/defaultLayout'
import type { ControlBinding } from '../../devices/types'
import type { KeyboardService } from '../../service'
import { GENERIC_FIRMWARE, GenericHidService } from '../GenericHidService'
import { genericLayoutKey, usbIds, withRememberedLayout } from '../identity'
import { nativeAction, nativeCatalog, nativeId } from '../nativeCatalog'
import type { GenericInputDevice, NativeProfile } from '../types'
import { PointerLiveSource, type PointerTarget } from './pointerSource'

/** What the OS reports about a HID mouse. */
export interface HidMouseInfo {
    readonly name: string
    readonly vendorId: number
    readonly productId: number
    readonly serialNumber?: string
}

const ACTIONS = [
    ['left', 'Left click'],
    ['right', 'Right click'],
    ['middle', 'Middle click'],
    ['back', 'Back'],
    ['forward', 'Forward'],
    ['scroll-up', 'Scroll up'],
    ['scroll-down', 'Scroll down'],
] as const

/** Stock mouse control → the button it is natively. */
const BUTTONS: Readonly<Record<string, string>> = {
    lmb: 'left',
    rmb: 'right',
    back: 'back',
    fwd: 'forward',
}

const act = (id: string): string => nativeId(`mouse:${id}`)

/** The native profile of the HID mouse `info`. */
export function hidMouseProfile(info: HidMouseInfo): NativeProfile {
    const base = defaultLayout('mouse', info.name, { buttons: 5, wheel: true })
    const model = {
        ...base,
        hidSummary: `HID mouse · ${usbIds(info.vendorId, info.productId)}`,
    }
    const catalog = nativeCatalog(
        ACTIONS.map(([id, label]) =>
            nativeAction('mouse', `mouse:${id}`, label),
        ),
    )
    const bindings: Record<string, ControlBinding> = {
        wheel: {
            ...defaultBinding('wheel', catalog),
            up: act('scroll-up'),
            down: act('scroll-down'),
            click: act('middle'),
        },
    }
    for (const [control, button] of Object.entries(BUTTONS))
        bindings[control] = { a: act(button) }
    return { model, catalog, bindings }
}

const layoutKey = (info: HidMouseInfo): string =>
    genericLayoutKey(`mouse:${usbIds(info.vendorId, info.productId)}`)

/** Open the HID mouse `info`; its live test reads the system pointer. */
export function connectHidMouse(
    info: HidMouseInfo,
    target?: PointerTarget | null,
): KeyboardService {
    return new GenericHidService({
        kind: 'mouse',
        deviceInfo: {
            name: info.name,
            firmware: GENERIC_FIRMWARE,
            vid: info.vendorId,
            pid: info.productId,
            ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
        },
        profile: hidMouseProfile(info),
        layoutKey: layoutKey(info),
        live: new PointerLiveSource(target),
    })
}

/** The HID mouse `info` as a device the start page can list. */
export function hidMouseDevice(info: HidMouseInfo): GenericInputDevice {
    const profile = hidMouseProfile(info)
    const ids = usbIds(info.vendorId, info.productId)
    return {
        id: `mouse:${ids}${info.serialNumber ? `:${info.serialNumber}` : ''}`,
        name: info.name,
        form: 'mouse',
        preview: withRememberedLayout(profile, layoutKey(info)),
        summary: `Mouse · ${ids}`,
        connect: () => Promise.resolve(connectHidMouse(info)),
    }
}
