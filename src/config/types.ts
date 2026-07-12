// Pattern check: no GoF pattern (-) — rejected — canonical post-normalize data interfaces; plain discriminated unions, no abstraction.
//
// The CANONICAL config form. `normalizeKeymap` expands every surface shorthand
// (bare-string keys, mod_tap/layer_tap presets, "Ctrl+C" combo strings) into
// these explicit nodes, so lower/raise/compile never branch on surface sugar.
// Fields prefixed `_` are serialize hints (original spelling / preset) — never
// read by the compiler, only by denormalize on re-save.

import type { CanonicalKeyId } from '../catalog/types'
import type { Modifier } from './keycodes'

// Built-in targets are the string literals; `(string & {})` keeps their
// autocompletion while admitting external/third-party firmware targets that
// register their own compiler/adapter at runtime. See registerBuiltinFirmwares.
export type BuiltinTarget = 'zmk' | 'qmk' | 'keychron'
export type Target = BuiltinTarget | (string & {})

export type Resolve = 'timeout' | 'prefer-hold' | 'prefer-tap'

/** ZMK hold-tap `flavor` (the devicetree string values). */
export type HoldTapFlavor =
    | 'hold-preferred'
    | 'balanced'
    | 'tap-preferred'
    | 'tap-unless-interrupted'

export type LightingTarget = 'underglow' | 'backlight' | 'per_key'

export type LightingAction =
    | 'toggle'
    | 'on'
    | 'off'
    | 'brightness_up'
    | 'brightness_down'
    | 'hue_up'
    | 'hue_down'
    | 'saturation_up'
    | 'saturation_down'
    | 'effect_next'
    | 'effect_previous'
    | 'speed_up'
    | 'speed_down'
    | 'cycle'
    // Value-carrying: 'color' sets an absolute HSB (underglow → RGB_COLOR_HSB);
    // 'set' sets an absolute brightness level (backlight → BL_SET).
    | 'color'
    | 'set'

export type OutputAction =
    | 'usb'
    | 'bluetooth'
    | 'bluetooth_clear'
    | 'bluetooth_next'
    | 'bluetooth_prev'
    | 'bluetooth_disconnect'
    | 'toggle'
    | 'none'

export type LayerMode = 'momentary' | 'toggle' | 'to' | 'sticky'

export type PowerAction = 'toggle' | 'on' | 'off'

export type MouseButton = 'left' | 'right' | 'middle' | 'mb4' | 'mb5'

export type Direction = 'up' | 'down' | 'left' | 'right'

/** Lock-action argument shared by gui_lock / secure / autocorrect (§5.2). */
export type LockAction = 'off' | 'on' | 'toggle'

/** Hardware-peripheral verb kind for the `peripheral` catch-all (§5.2-J). */
export type PeripheralKind =
    | 'encoder'
    | 'dipswitch'
    | 'haptic'
    | 'audio'
    | 'joystick'
    | 'midi'
    | 'steno'
    | 'sequencer'
    | 'wpm'
    | 'rawhid'

export interface CanonKeyPress {
    type: 'key_press'
    key: CanonicalKeyId
    mods?: Modifier[]
    /** Original key token, kept so serialize can preserve a canonical id / alias the user typed. */
    _keySrc?: string
}

export type CanonHoldTarget =
    | { type: 'modifier'; modifier: Modifier }
    | { type: 'layer'; layer: string }

// pattern-check: skip — additive optional fields on an existing interface, no abstraction
export interface CanonTapHold {
    type: 'tap_hold'
    tap: CanonKeyPress
    hold: CanonHoldTarget
    tappingTermMs?: number
    quickTapMs?: number
    /** Require the keyboard idle this long before the hold can trigger (§28);
     *  0/absent = firmware default. Rides BEHAVIOR record r[12]. */
    requirePriorIdleMs?: number
    /** Retro-tap: emit the tap if the hold resolved but nothing was pressed
     *  during it. Rides the RETRO_TAP behavior flag. */
    retroTap?: boolean
    /** §28 positional hold-trigger: only interrupting keys at these physical
     *  positions count toward the hold decision. Rides TBL_POSHOLD — the
     *  decoder restores the list onto the inline tap-hold by behavior index. */
    holdTriggerKeyPositions?: number[]
    /** Trigger the hold on the interrupting key's *release* instead of its
     *  press. Needs firmware ≥ Phase 2 (REMAPPR_BHF_HOLD_TRIGGER_ON_RELEASE);
     *  until then the compiler warns and drops it (no wire bit yet). */
    holdTriggerOnRelease?: boolean
    resolve?: Resolve
    /** Interrupt flavor. When this or a timing is set, ZMK gets a dedicated
     *  generated hold-tap node instead of the global &mt/&lt. */
    flavor?: HoldTapFlavor
    /** How the user wrote it, so serialize can re-emit the preset form. */
    _preset?: 'mod_tap' | 'layer_tap'
}

export type CanonAction =
    | CanonKeyPress
    | CanonTapHold
    | { type: 'layer'; mode: LayerMode; layer: string }
    | { type: 'sticky_key'; key: CanonicalKeyId; _keySrc?: string }
    | { type: 'caps_word' }
    | { type: 'transparent' }
    | { type: 'none' }
    | { type: 'output'; action: OutputAction; profile?: number }
    | {
          type: 'lighting'
          target: LightingTarget
          action: LightingAction
          /** action 'color': absolute HSB (hue 0–360, saturation/brightness 0–100). */
          hue?: number
          saturation?: number
          brightness?: number
          /** action 'set': absolute brightness level 0–100. */
          level?: number
      }
    | { type: 'bootloader' }
    | { type: 'reset' }
    | { type: 'soft_off' }
    | { type: 'studio_unlock' }
    | { type: 'grave_escape' }
    | { type: 'key_repeat' }
    | { type: 'key_toggle'; key: CanonicalKeyId; _keySrc?: string }
    | { type: 'ext_power'; action: PowerAction }
    | { type: 'mouse_key'; button: MouseButton }
    | { type: 'mouse_move'; direction: Direction }
    | { type: 'mouse_scroll'; direction: Direction }
    | { type: 'macro'; ref: string; param?: CanonicalKeyId; _paramSrc?: string }
    | { type: 'tap_dance'; ref: string }
    | { type: 'mod_morph'; ref: string }
    | { type: 'hold_tap'; ref: string; holdParam: string; tapParam: string }
    // §5.2 vocabulary (firmware behavior_type 20..36) — per-key actions.
    | { type: 'auto_shift'; key: CanonicalKeyId; mods: Modifier[]; _keySrc?: string }
    | { type: 'alt_repeat' }
    | { type: 'layer_lock' }
    | { type: 'layer_mod'; layer: string; mods: Modifier[] }
    | { type: 'tap_toggle'; layer: string }
    | { type: 'set_base_saved'; layer: string }
    | { type: 'auto_layer'; layer: string }
    | { type: 'gui_lock'; action: LockAction }
    | { type: 'secure'; action: LockAction }
    | { type: 'autocorrect'; action: LockAction }
    | { type: 'tune_tap_term'; ms: number }
    | { type: 'unicode'; codepoint: number }
    | { type: 'macro_record'; slot: number }
    | { type: 'macro_play'; slot: number }
    | { type: 'leader'; windowMs?: number }
    | { type: 'peripheral'; kind: PeripheralKind; code: number }

export interface CanonGeometry {
    x: number
    y: number
    w: number
    h: number
    r: number
    rx?: number
    ry?: number
    /** Physical-layout variant id this key belongs to ("" / absent = common to
     *  all variants). Set by the builder; compilers ignore unknown variants. */
    variant?: string
    /** Per-key electrical matrix position `[row, col]` — the generalized field
     *  every firmware needs (QMK `matrix:[r,c]`, VIA/Vial KLE legend, ZMK
     *  `RC(r,c)`). Friendly + co-located authoring source; when present it is
     *  authoritative, else the compiler derives it from geometry (see
     *  `materializeMatrix`). Keyboard-specific — never default-stripped. */
    matrix?: [number, number]
    /** Optional per-key direct GPIO pin label (builder metadata, e.g. "GP29").
     *  Used for direct-pin kscan; kept separate from the matrix wiring so editing
     *  a label never corrupts the electrical transform. */
    pin?: string
    /** Input element this position represents: absent / "key" = a normal switch;
     *  "encoder" = a rotary encoder; "slider" = an analog slider. Builder
     *  metadata — compilers treat every entry as a key for now. */
    element?: 'encoder' | 'slider'
    /** VIA/Vial layout-option tag `[group, choice]`: this key exists only when
     *  layout-option `group` is set to `choice`. Indexes into
     *  `keyboard.layoutOptions`; absent = present in every variant. Emitted as the
     *  KLE index-3 legend `"group,choice"`. */
    option?: [number, number]
}

export interface CanonEncoderSlot {
    x: number
    y: number
}

export interface CanonEncoderBinding {
    cw: CanonAction
    ccw: CanonAction
    press?: CanonAction
}

/** What an analog slider's position controls. `volume`/`brightness`/`mouse_wheel`
 *  are well-known mapped outputs; `custom` defers to `action`. */
export type SliderMap = 'volume' | 'brightness' | 'mouse_wheel' | 'custom'

/** A slider's value-mapping: the ADC sweep mapped onto an output. `min`/`max`
 *  bound the output range (firmware defaults when absent); `action` is the
 *  output behavior for `map: "custom"`. Analog input has no first-class keymap
 *  behavior in ZMK/QMK, so compilers emit this as guided scaffolding, not full
 *  codegen — see emitSliderInputs (ZMK) / emitSliderStub (QMK). */
export interface CanonSliderBinding {
    map: SliderMap
    min?: number
    max?: number
    action?: CanonAction
}

export interface CanonLayer {
    name: string
    description?: string
    bindings: CanonAction[]
    /** Slot-indexed encoder bindings — index-aligned to `keyboard.encoders[]`.
     *  The original ZMK-style parallel array, kept for boards that declare
     *  encoder slots separately from keys. */
    encoders?: CanonEncoderBinding[]
    /** Per-key encoder bindings, keyed by the position's index in
     *  `keyboard.keys` (the key must have `element: "encoder"`). The builder's
     *  element model writes here; lets a single physical position carry both a
     *  base binding and rotary cw/ccw/press without a parallel slot array. */
    encoderBindings?: Record<number, CanonEncoderBinding>
    /** Per-key slider value-mappings, keyed by the position's index in
     *  `keyboard.keys` (the key must have `element: "slider"`). Parallels
     *  `encoderBindings` — one analog input element per physical position. */
    sliderBindings?: Record<number, CanonSliderBinding>
}

export interface CanonCombo {
    name: string
    keys: number[]
    action: CanonAction
    timeoutMs?: number
    layers?: string[]
}

export interface CanonTapDanceStep {
    count: number
    action: CanonAction
}

export interface CanonTapDance {
    id: string
    description?: string
    tappingTermMs?: number
    taps: CanonTapDanceStep[]
    hold?: CanonHoldTarget
}

export type CanonMacroStep =
    | { type: 'tap'; key: CanonicalKeyId; _keySrc?: string }
    | { type: 'press'; key: CanonicalKeyId; _keySrc?: string }
    | { type: 'release'; key: CanonicalKeyId; _keySrc?: string }
    | { type: 'wait'; ms: number }
    | { type: 'text'; text: string }
    /** Forward a macro argument to the next behavior (&macro_param_<from>to<to>).
     *  Defaults to 1→1 (the one-param case). */
    | { type: 'param'; from?: 1 | 2; to?: 1 | 2 }
    /** Override how long tapped behaviors are held (&macro_tap_time). */
    | { type: 'tap_time'; ms: number }
    /** Block until the triggering key is released (&macro_pause_for_release). */
    | { type: 'pause_for_release' }

export interface CanonMacro {
    id: string
    description?: string
    /** Binding-cells: 0 = plain, 1 = one-param, 2 = two-param macro. */
    params?: 0 | 1 | 2
    steps: CanonMacroStep[]
}

/** A custom `zmk,behavior-hold-tap`. `bindings` are the two inner behavior
 *  tokens (e.g. "&kp", "&mo") invoked for hold and tap; a `hold_tap` action
 *  reference passes the hold/tap params. */
export interface CanonHoldTapDef {
    id: string
    description?: string
    flavor?: HoldTapFlavor
    tappingTermMs?: number
    quickTapMs?: number
    requirePriorIdleMs?: number
    holdTriggerKeyPositions?: number[]
    holdTriggerOnRelease?: boolean
    retroTap?: boolean
    bindings: [string, string]
}

/** A `zmk,behavior-mod-morph`: `bindings[0]` normally, `bindings[1]` while any
 *  `mods` modifier is held. `keepMods` passes those modifiers through. */
export interface CanonModMorph {
    id: string
    description?: string
    mods: Modifier[]
    keepMods?: Modifier[]
    bindings: [CanonAction, CanonAction]
}

export interface ConfigMeta {
    name: string
    author?: string
    version?: string
    description?: string
    target: Target | null
    /** USB vendor id, hex string e.g. "0xFEED" (builder identity). */
    vendorId?: string
    /** USB product id, hex string e.g. "0x0001" (builder identity). */
    productId?: string
}

export interface ConfigDefaults {
    tappingTermMs?: number
    quickTapMs?: number
    comboTimeoutMs?: number
    /** Engine release debounce (LAYER table byte 6); 0/absent = firmware
     *  default. */
    releaseDebounceMs?: number
    /** Engine eager-press debounce (LAYER timing tail); 0/absent = keep the
     *  devicetree value. */
    pressDebounceMs?: number
    /** Matrix-scan press debounce (LAYER timing tail); 0/absent = keep the
     *  devicetree value. */
    matrixPressDebounceMs?: number
    /** Matrix-scan release debounce (LAYER timing tail); 0/absent = keep the
     *  devicetree value. */
    matrixReleaseDebounceMs?: number
    /** Caps-word auto-exit idle timeout (LAYER v3 tail); 0/absent = no idle
     *  auto-exit (firmware default). */
    capsWordIdleMs?: number
    /** Default sticky one-shot release-after lifetime (LAYER v3 tail); 0/absent
     *  = firmware default (persist until the next key). */
    stickyReleaseDefaultMs?: number
    /** Default macro inter-step wait (LAYER v3 tail); 0/absent = firmware
     *  default. */
    macroDefaultWaitMs?: number
    /** Default macro tap hold-time (LAYER v3 tail); 0/absent = firmware
     *  default. */
    macroDefaultTapMs?: number
    /** Matrix scan poll period (LAYER v3 tail); 0/absent = keep the devicetree
     *  value. */
    matrixPollPeriodMs?: number
}

/** ZMK matrix `diode-direction`. */
export type DiodeDirection = 'row2col' | 'col2row'

/** A raw devicetree GPIO phandle+specifier, e.g.
 *  `"&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)"`. Stored verbatim — remappr
 *  does not model SoC pin-mux; the builder UI composes these strings and the
 *  compiler emits them unchanged into the kscan node. */
export type GpioSpec = string

/** A `zmk,kscan-gpio-matrix` definition. */
export interface CanonMatrixKscan {
    type: 'matrix'
    diodeDirection: DiodeDirection
    rowGpios: GpioSpec[]
    colGpios: GpioSpec[]
    debouncePressMs?: number
    debounceReleaseMs?: number
}

/** A `zmk,kscan-gpio-direct` definition (one GPIO per key, no matrix). */
export interface CanonDirectKscan {
    type: 'direct'
    inputGpios: GpioSpec[]
    debouncePressMs?: number
    debounceReleaseMs?: number
}

export type CanonKscan = CanonMatrixKscan | CanonDirectKscan

/** The REAL electrical `zmk,matrix-transform`: one [row, col] per physical key,
 *  in physical-layout / keymap-binding order. When present it REPLACES the
 *  geometry-derived scaffold the compiler otherwise emits. */
export interface CanonMatrixTransform {
    rows: number
    columns: number
    /** [row, col] per key, in binding order. */
    map: [number, number][]
}

/** Board hardware definition (kscan wiring + electrical transform + target).
 *  Supplied by the Keyboard Builder; lets the ZMK compiler emit a flashable
 *  config instead of the geometry-derived scaffold + "NOT GENERATED" checklist.
 *  Everything is optional so a keymap-only config stays valid. */
// pattern-check: skip pure config DTO additions — data shapes, no behavior/abstraction
export interface ConfigHardware {
    /** @deprecated Use `keyboard.controller.board`. Read as a back-compat
     *  fallback by `resolveController`. Zephyr board target (e.g. "nice_nano_v2"). */
    board?: string
    /** @deprecated Use `keyboard.controller.shield`. Read as a back-compat
     *  fallback by `resolveController`. ZMK shield on a controller board. */
    shield?: string
    kscan?: CanonKscan
    transform?: CanonMatrixTransform
    /** Backlight PWM peripheral — drives the ZMK `zmk,backlight` node. */
    backlightPwm?: CanonBacklightPwm
    /** WS2812 underglow strip on an SPI peripheral — drives `zmk,underglow`. */
    ws2812?: CanonWs2812
    /** External-power control GPIO — drives the `zmk,ext-power` node. */
    extPowerCtrl?: CanonExtPowerCtrl
    /** Emit the `&zephyr_udc0 studio_acm` CDC-ACM endpoint (Studio over USB). */
    studioAcm?: boolean
}

/** Backlight PWM hardware: which PWM instance/channel + pin + polarity. Emits a
 *  `pwm-leds` node + a `&pwm<n>` override + the `&pinctrl` psels for the LED pin. */
export interface CanonBacklightPwm {
    /** PWM controller phandle label, e.g. "pwm0" (no leading &). */
    instance: string
    /** PWM channel index, e.g. 0. */
    channel: number
    /** LED pin: friendly nRF label "P0.13" (parsed to NRF_PSEL) or a verbatim
     *  `NRF_PSEL(...)` / psels string emitted unchanged. */
    pin: string
    /** Active-low LED (anode to VDD) → PWM_POLARITY_INVERTED. */
    inverted?: boolean
    /** PWM period in ms (PWM_MSEC). Default 10. */
    periodMs?: number
}

/** WS2812 addressable RGB strip on an SPI peripheral. Emits a `&spi<n>` block
 *  with a `worldsemi,ws2812-spi` led_strip child + the `&pinctrl` MOSI psels. */
export interface CanonWs2812 {
    /** SPI controller phandle label, e.g. "spi3" (no leading &). */
    spi: string
    /** Data (MOSI) pin: friendly nRF label "P1.13" or verbatim psels string. */
    dataPin: string
    /** Number of LEDs in the chain. */
    chainLength: number
    /** Wire color order. Default "GRB". */
    colorOrder?: 'GRB' | 'RGB' | 'BGR' | 'RGBW' | 'GRBW'
    /** SPI bit clock in Hz. Default 4_000_000. */
    spiMaxFrequency?: number
}

/** `zmk,ext-power-generic` control node — a GPIO that gates peripheral power. */
export interface CanonExtPowerCtrl {
    /** Control GPIO: friendly nRF label "P0.14" or verbatim `&gpio0 14` core. */
    controlGpio: string
    /** GPIO_ACTIVE_LOW vs GPIO_ACTIVE_HIGH. */
    activeLow?: boolean
    /** init-delay-ms (settle time after enable). Default 0. */
    initDelayMs?: number
}

/** Firmware-level feature config — the modeled toggles that derive `.conf` (ZMK
 *  Kconfig) / `config.h` + `rules.mk` (QMK family) flags, plus free-text overrides
 *  for anything unmodeled. **Tri-state booleans**: `undefined` = auto-derive from
 *  used behaviors + hardware; explicit `true`/`false` = user override. */
export interface CanonFirmwareConfig {
    /** CONFIG_ZMK_USB. Default on. */
    usb?: boolean
    /** CONFIG_ZMK_BLE. Default off (opt-in for wireless boards). */
    ble?: boolean
    /** CONFIG_ZMK_STUDIO. Default on. */
    studio?: boolean
    /** CONFIG_ZMK_STUDIO_LOCKING. Default on (emits explicit `=n` when off). */
    studioLocking?: boolean
    /** Studio-over-USB CDC block (SERIAL/USB_DEVICE_STACK/CDC_ACM/TRANSPORT_UART).
     *  Default follows `studio`. */
    studioUsbCdc?: boolean
    /** CONFIG_ZMK_PM_SOFT_OFF. Default = a `soft_off` behavior is used. */
    softOff?: boolean
    /** CONFIG_ZMK_EXT_POWER. Default = `ext_power` used or `hardware.extPowerCtrl` set. */
    extPower?: boolean
    /** CONFIG_ZMK_POINTING. Default = a mouse behavior is used. */
    pointing?: boolean
    /** CONFIG_ZMK_BACKLIGHT (+ CONFIG_PWM). Default = backlight used or `hardware.backlightPwm` set. */
    backlight?: boolean
    /** CONFIG_ZMK_RGB_UNDERGLOW. Default = underglow used or `hardware.ws2812` set. */
    underglow?: boolean
    /** CONFIG_ZMK_USB_LOGGING. Default off (commented hint). */
    usbLogging?: boolean
    /** Extra Kconfig lines appended verbatim after the derived ZMK `.conf` block. */
    kconfig?: string
    /** Extra `#define` lines appended to the QMK keymap `config.h`. */
    configH?: string
    /** Extra make assignments appended to the QMK `rules.mk`. */
    rulesMk?: string
}

/** RGB underglow board-level config (builder metadata; export-only for now). */
export interface CanonUnderglow {
    /** Effect name (e.g. "solid", "breathe", "rainbow") — firmware-specific. */
    effect?: string
    /** Hue 0–360. */
    hue?: number
    /** Brightness 0–100. */
    brightness?: number
}

/** Per-key backlight board-level config (builder metadata; export-only for now). */
export interface CanonBacklight {
    /** Brightness 0–100. */
    brightness?: number
    breathing?: boolean
}

/** Board lighting metadata supplied by the builder. Compilers emit lighting
 *  *actions*; this board-level config is additive (export-only) for now. */
export interface CanonLighting {
    underglow?: CanonUnderglow
    backlight?: CanonBacklight
    /** Per-key RGB colors decoded from TBL_RGB (id 7): physical position →
     *  "#rrggbb" (black/off omitted). Decode-only until Phase 4c wires the emit
     *  path; a per-layer table collapses to layer 0 with a diagnostic. */
    perKey?: Record<number, string>
}

/** A named physical-layout variant (keys tag into it via `CanonGeometry.variant`). */
export interface CanonLayout {
    id: string
    name: string
}

/** A VIA/Vial layout option (one selectable variation of the physical layout).
 *  `label` names the option; `choices` (≥2) makes it a multi-choice dropdown
 *  (else it is a boolean toggle). Keys reference it by index via
 *  `CanonGeometry.option [group, choice]`. */
export interface CanonLayoutOption {
    label: string
    choices?: string[]
}

/** Friendly per-row / per-column GPIO pin labels shown in the builder (e.g.
 *  "GP4"). Builder metadata, kept separate from `hardware.kscan` (the real
 *  devicetree GpioSpec wiring) so editing a label here never corrupts ZMK
 *  export; compilers map these to their firmware's pin syntax. `rows`/`cols`
 *  are index-aligned to the electrical transform's rows/columns. */
export interface ConfigPins {
    rows: string[]
    cols: string[]
}

/** Board-level matrix descriptor: dimensions + diode direction + scan mode.
 *  The friendly summary of the wiring (the per-key `[row,col]` lives on each
 *  key). `mode` picks matrix (row/col GPIOs) vs direct (one GPIO per key). */
export interface CanonKeyboardMatrix {
    rows: number
    cols: number
    diodeDirection?: DiodeDirection
    mode?: 'matrix' | 'direct'
}

/** Controller / MCU identity for a flashable build. ZMK uses `board` (a Zephyr
 *  board, e.g. "nice_nano_v2") + optional `shield`; QMK uses `processor` +
 *  `bootloader` (+ a `board` support file), or the `developmentBoard` shortcut
 *  (e.g. "promicro", "blackpill_f401") which sets all three, plus `deviceVersion`
 *  (USB bcdDevice, e.g. "1.0.0"). All optional so a keymap-only config stays
 *  valid. Supersedes `hardware.board` / `hardware.shield` (kept for back-compat). */
export interface CanonController {
    /** ZMK Zephyr board, or QMK `board` support-file name. */
    board?: string
    /** ZMK shield, when the keymap is a shield on a controller board. */
    shield?: string
    /** QMK MCU family, e.g. "atmega32u4", "STM32F103", "RP2040". */
    processor?: string
    /** QMK bootloader, e.g. "atmel-dfu", "rp2040", "uf2boot". */
    bootloader?: string
    /** QMK `development_board` shortcut (sets processor+bootloader+board),
     *  e.g. "promicro", "blackpill_f401". */
    developmentBoard?: string
    /** USB device version (bcdDevice), e.g. "0.0.1" / "1.0.0". */
    deviceVersion?: string
}

/** Vial security identity. Vial firmware refuses to expose its keymap to the GUI
 *  until unlocked; the `uid` ties a flashed board to its definition, and holding
 *  the `unlockKeys` (matrix positions) performs the unlock. Emitted to the vial
 *  keymap's `config.h` (VIAL_KEYBOARD_UID + VIAL_UNLOCK_COMBO_ROWS/COLS). All
 *  optional so a keymap-only config stays valid; `insecure` skips the lock. */
export interface CanonVial {
    /** 8-byte keyboard UID, e.g. [0xFE, 0x06, …] (each 0–255). */
    uid?: number[]
    /** Matrix positions [row, col] of the unlock combo (held together to unlock). */
    unlockKeys?: [number, number][]
    /** Build with `VIAL_INSECURE` — no unlock required (dev/testing only). */
    insecure?: boolean
}

export interface ConfigKeyboard {
    id: string
    name: string
    keys: CanonGeometry[]
    encoders?: CanonEncoderSlot[]
    /** Board-level matrix descriptor (dims + diode + scan mode). */
    matrix?: CanonKeyboardMatrix
    /** Controller / MCU identity (board/shield/processor/bootloader/…). */
    controller?: CanonController
    /** Vial security identity (UID + unlock combo); emitted to vial config.h. */
    vial?: CanonVial
    hardware?: ConfigHardware
    /** Friendly row/column GPIO labels (builder metadata). */
    pins?: ConfigPins
    /** Raw multi-select firmware targets from the builder (qmk/via/vial/zmk).
     *  Looser than `meta.target`; via/vial compile through the QMK family. */
    firmware?: string[]
    /** Board-level lighting config (builder). */
    lighting?: CanonLighting
    /** Firmware-level feature config — modeled .conf/config.h toggles + overrides. */
    firmwareConfig?: CanonFirmwareConfig
    /** Physical-layout variants (builder); keys tag in via `variant`. */
    layouts?: CanonLayout[]
    /** VIA/Vial layout options; keys tag in via `option [group, choice]`. The
     *  index in this array is the option's `group` number. */
    layoutOptions?: CanonLayoutOption[]
    /** Two-piece / split keyboard (builder capability flag; export metadata). */
    split?: boolean
}

/** Auto-activate `thenLayer` while every layer in `ifLayers` is active. */
export interface CanonConditionalLayer {
    ifLayers: string[]
    thenLayer: string
}

// pattern-check: skip — pure authoring DTOs mirroring the firmware key_override /
// leader_seq wire structs; data shapes with no behavior or abstraction.
/** A key override (§43.5; QMK key_overrides): while `trigger` is held with every
 *  modifier in `triggerMods` and none in `negativeMods`, and an enabled layer is
 *  active, the keyboard emits `replacement` + `replacementMods` instead of the
 *  trigger, masking `suppressedMods` from the report. `replacement` absent = emit
 *  nothing (pure mod-suppression / mod-swap). `layers` absent/empty = any layer. */
export interface CanonKeyOverride {
    trigger: CanonicalKeyId
    triggerMods: Modifier[]
    negativeMods?: Modifier[]
    suppressedMods?: Modifier[]
    replacement?: CanonicalKeyId
    replacementMods?: Modifier[]
    layers?: string[]
}

/** A leader sequence (§43.5; QMK/ZMK leader key): after a `leader` key opens
 *  capture, this exact `sequence` of key usages fires `action`. 1..5 keys. */
export interface CanonLeaderSequence {
    sequence: CanonicalKeyId[]
    action: CanonAction
}

// pattern-check: skip — plain data interfaces for new open config sections, no abstraction
/** A known Zephyr board id, or a custom board on any Zephyr-supported SoC. */
export type ConfigBoardController =
    | string
    | { custom: true; soc: string; name: string; [k: string]: unknown }

/** Build-time board definition (v2) — consumed by the DT/Kconfig generator, never
 *  in the blob. Open shape: extra builder fields are preserved verbatim. */
/** A rotary encoder's HARDWARE wiring for the board generator: the two quadrature
 *  phase GPIOs (a friendly board label or a verbatim `&gpioN pin FLAGS` spec), the
 *  detent resolution, and the Zephyr relative axis the `gpio-qdec` driver emits.
 *  Emitted as a stock `gpio-qdec` node; binding rotation into the behavior engine
 *  is firmware-side and HIL-deferred. */
export interface BoardEncoder {
    /** Phase-A GPIO (friendly label or verbatim `&`-spec). */
    a: string
    /** Phase-B GPIO (friendly label or verbatim `&`-spec). */
    b: string
    /** Quadrature steps per detent period. Default 4. */
    steps?: number
    /** Zephyr relative axis code the qdec emits, e.g. "INPUT_REL_WHEEL" (default). */
    axis?: string
}

export interface ConfigBoard {
    controller?: ConfigBoardController
    matrix?: {
        diode?: DiodeDirection
        rows?: string[]
        cols?: string[]
        pollMs?: number
        [k: string]: unknown
    }
    split?: boolean
    storage?: 'zms' | 'nvs'
    /** Rotary encoder hardware for the board generator (opt-in; emits gpio-qdec). */
    encoders?: BoardEncoder[]
    [k: string]: unknown
}

/** Pointer/mouse-node settings compiled to TBL_MOUSE (§4b). */
export interface ConfigMouse {
    /** Sensor resolution, counts/inch. Omit to keep the firmware default. */
    cpi?: number
    /** Auto-layer hold after pointer activity, ms. Omit / 0 = disabled. */
    autoLayerTimeoutMs?: number
    /** Acceleration curve: each point is [speedIn, multX100], the multiplier
     *  scaled ×100 (so 100 = 1.0×). */
    accel?: Array<[number, number]>
}

/** Per-personality node configuration (v2). Open shape; `personality` and the
 *  `mouse` pointer block are well-known, the rest is preserved for later phases. */
export interface ConfigNode {
    personality?: 'keyboard' | 'mouse' | 'joystick' | 'dongle'
    /** Pointer settings (§4b, TBL_MOUSE) — present on mouse / hybrid nodes. */
    mouse?: ConfigMouse
    [k: string]: unknown
}

export interface ConfigKeymap {
    schemaVersion: 1
    kind: 'remappr.keymap'
    meta: ConfigMeta
    defaults?: ConfigDefaults
    keyboard: ConfigKeyboard
    layers: CanonLayer[]
    combos?: CanonCombo[]
    tapDances?: CanonTapDance[]
    macros?: CanonMacro[]
    modMorphs?: CanonModMorph[]
    holdTaps?: CanonHoldTapDef[]
    conditionalLayers?: CanonConditionalLayer[]
    keyOverrides?: CanonKeyOverride[]
    leaderSequences?: CanonLeaderSequence[]
    // Whole-node config sections (v2) — preserved verbatim, consumed later.
    node?: ConfigNode
    firmware?: Record<string, Record<string, unknown>>
    board?: ConfigBoard
}
