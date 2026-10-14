// pattern-check: skip — barrel: generic HID input sources (Gamepad API controllers, HID mice).
export type { GenericInputDevice, LiveSource, NativeProfile } from './types'
export {
    GENERIC_FIRMWARE,
    GenericHidService,
    NATIVE_PROFILE,
    type GenericHidDeps,
} from './GenericHidService'
export { genericLayoutKey, usbIds, withRememberedLayout } from './identity'
export {
    browserGamepadEnv,
    parseGamepadId,
    type GamepadEnv,
    type GamepadIdentity,
} from './gamepad/env'
export {
    frameKey,
    frameOf,
    type GamepadLike,
    type InputMap,
    type InputSource,
} from './gamepad/inputMap'
export { GamepadLiveSource } from './gamepad/liveSource'
export { rawGamepadProfile, rawInputMap } from './gamepad/raw'
export { STANDARD_MAP, standardProfile } from './gamepad/standard'
export {
    connectGamepad,
    gamepadProfile,
    gamepadsSupported,
    listGamepads,
    watchGamepads,
} from './gamepad/discovery'
export {
    connectHidMouse,
    hidMouseDevice,
    hidMouseProfile,
    type HidMouseInfo,
} from './mouse/hidMouse'
export { PointerLiveSource, type PointerTarget } from './mouse/pointerSource'
