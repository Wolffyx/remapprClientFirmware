// pattern-check: skip — lists the controllers the Gamepad API exposes and opens one as a GenericHidService; wiring over the profile builders.
//
// Every controller the browser exposes, as a generic input device. A
// "standard"-mapped one opens on the stock gamepad layout with its maker's
// button names; anything else on the generic layout built from its counts.
import type { KeyboardService } from '../../service'
import { GENERIC_FIRMWARE, GenericHidService } from '../GenericHidService'
import { genericLayoutKey, usbIds, withRememberedLayout } from '../identity'
import type { GenericInputDevice, NativeProfile } from '../types'
import { browserGamepadEnv, parseGamepadId, type GamepadEnv } from './env'
import type { GamepadLike, InputMap } from './inputMap'
import { GamepadLiveSource } from './liveSource'
import { rawGamepadProfile } from './raw'
import { standardProfile } from './standard'

type GamepadProfile = NativeProfile & { readonly map: InputMap }

/** The native profile of the controller `gp`. */
export function gamepadProfile(gp: GamepadLike): GamepadProfile {
    const { name, vendorId } = parseGamepadId(gp.id)
    if (gp.mapping === 'standard') return standardProfile(name, vendorId)
    return rawGamepadProfile(name, {
        buttons: gp.buttons.length,
        axes: gp.axes.length,
    })
}

/** Where a re-drawn layout is remembered: per model (USB ids), else name. */
function usbOf(gp: GamepadLike): string | undefined {
    const { vendorId, productId } = parseGamepadId(gp.id)
    if (vendorId === undefined || productId === undefined) return undefined
    return usbIds(vendorId, productId)
}

function layoutKey(gp: GamepadLike): string {
    const model = usbOf(gp) ?? parseGamepadId(gp.id).name
    return genericLayoutKey(`gamepad:${model}`)
}

function stillThere(env: GamepadEnv, gp: GamepadLike): boolean {
    const now = env.getGamepads()[gp.index]
    return !!now && now.connected && now.id === gp.id
}

/** Open the controller `gp` for viewing and live test. */
export function connectGamepad(
    gp: GamepadLike,
    env: GamepadEnv,
): KeyboardService {
    const profile = gamepadProfile(gp)
    const { vendorId, productId } = parseGamepadId(gp.id)
    return new GenericHidService({
        kind: 'joystick',
        deviceInfo: {
            name: profile.model.name,
            firmware: GENERIC_FIRMWARE,
            ...(vendorId !== undefined ? { vid: vendorId } : {}),
            ...(productId !== undefined ? { pid: productId } : {}),
        },
        profile,
        layoutKey: layoutKey(gp),
        live: new GamepadLiveSource(env, gp, profile.map),
        watchGone: (gone) =>
            env.onConnectionChange(() => {
                if (!stillThere(env, gp)) gone()
            }),
    })
}

function inputDevice(gp: GamepadLike, env: GamepadEnv): GenericInputDevice {
    const profile = gamepadProfile(gp)
    const preview = withRememberedLayout(profile, layoutKey(gp))
    return {
        id: `gamepad:${gp.index}:${gp.id}`,
        name: profile.model.name,
        form: profile.model.form,
        preview,
        summary: profile.model.hidSummary ?? 'Standard gamepad',
        ...(usbOf(gp) ? { usb: usbOf(gp) } : {}),
        connect: () => Promise.resolve(connectGamepad(gp, env)),
    }
}

/** Whether this window can see controllers at all. */
export const gamepadsSupported = (): boolean => browserGamepadEnv() !== null

/** The controllers this window sees right now (each needs a button pressed
 *  once before the browser lists it). */
export function listGamepads(
    env: GamepadEnv | null = browserGamepadEnv(),
): GenericInputDevice[] {
    if (!env) return []
    return env
        .getGamepads()
        .flatMap((gp) => (gp?.connected ? [inputDevice(gp, env)] : []))
}

/** Calls `cb` when a controller appears or goes away; returns a stop. */
export function watchGamepads(
    cb: () => void,
    env: GamepadEnv | null = browserGamepadEnv(),
): () => void {
    return env ? env.onConnectionChange(cb) : () => {}
}
