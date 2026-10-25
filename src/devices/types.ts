// pattern-check: skip — pure type vocabulary for the device-controls model
// (ControlsApi), no behaviour.
//
// Every device that is not driven through a keymap — a mouse, a gamepad, a
// flight stick, an unknown HID device — is described as a set of CONTROLS placed
// in key units, each with a per-kind binding. Keyboards keep the keymap model;
// a keyboard can still be projected into this vocabulary (fromPhysicalLayout)
// for previews.
//
// Firmware alignment (Remappr firmware is the reference):
// - `DeviceKind` is the `remappr_personality` vocabulary (role.h): KEYBOARD_NODE
//   → 'keyboard', MOUSE_NODE → 'mouse', the reserved JOYSTICK_NODE → 'joystick',
//   DONGLE → 'dongle'. The same strings as `ConfigNode.personality`. A gamepad
//   is a joystick personality with a gamepad form (HID usages 0x04 and 0x05).
// - `ControlKind` refines `remappr_ui_kind` (ui_input.h): button → KEY,
//   encoder → ENCODER, sensor / wheel → POINTER, stick / trigger / hat / axis →
//   JOYSTICK. An adapter maps its wire kinds onto these.
// - Geometry is in key units (1U = 19.05 mm), like the config's CanonGeometry.
//   Firmware layouts arrive in centi-units and are converted at the adapter
//   boundary (see fromPhysicalLayout).

/** What the device is — the firmware personality vocabulary. */
export type DeviceKind = 'keyboard' | 'mouse' | 'joystick' | 'dongle'

/** What the device looks like: picks the shell, icon and wording. Independent of
 *  the personality (a gamepad and a flight stick are both joysticks). */
export type DeviceForm =
    | 'keyboard'
    | 'macropad'
    | 'mouse'
    | 'gamepad'
    | 'flightstick'

/** What a control does; decides its binding shape and inspector. */
export type ControlKind =
    | 'button'
    | 'wheel'
    | 'stick'
    | 'trigger'
    | 'hat'
    | 'sensor'
    | 'encoder'
    | 'axis'

/** How a control is drawn. Independent of the kind (a button can be a key, a
 *  round face button, a pill or a mouse half). */
export type ControlShape =
    | 'key'
    | 'round'
    | 'pill'
    | 'stick'
    | 'dpad'
    | 'hat'
    | 'trigger'
    | 'triggerSide'
    | 'wheel'
    | 'ring'
    | 'knob'
    | 'sensor'
    | 'mouseL'
    | 'mouseR'

/** Which side a control's callout label sits on (absent = nearest side). */
export type CalloutSide = 'L' | 'R'

export interface DeviceControl {
    /** Stable within the device; bindings are keyed by it. */
    readonly id: string
    readonly name: string
    readonly kind: ControlKind
    readonly shape: ControlShape
    /** Top-left corner and size in key units. */
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
    /** Clockwise rotation in degrees about the control's own centre. */
    readonly r?: number
    /** Short printed marking (L3, RB, A …). */
    readonly glyph?: string
    /** Which shell part the control sits on (see the shell types). */
    readonly zone?: string
    /** On the side or back of the body: drawn, but excluded from the shell fit. */
    readonly edge?: boolean
    /** On the underside (paddles): drawn dashed. */
    readonly back?: boolean
    readonly label?: CalloutSide
    /** The layout variant this control belongs to (an id from
     *  `DeviceModel.layouts`); absent = in every variant. */
    readonly variant?: string
}

/** A named layout variant: one possible arrangement of the device, e.g. with
 *  or without back paddles. A variant is the controls with no `variant` plus
 *  the ones tagged into it — the same as one ZMK physical layout or one QMK
 *  `LAYOUT_*`. Controls keep their id across variants, so a shared control
 *  keeps its binding when the variant changes. */
export interface DeviceVariant {
    readonly id: string
    readonly name: string
}

/** The body is not drawn by hand: it is fitted around the controls, so moving a
 *  control reshapes the device. Each type carries its own fitting parameters
 *  (all in key units, angles in degrees). */
export type DeviceShell =
    | { readonly type: 'plate'; readonly pad: number }
    | { readonly type: 'mouse'; readonly pad: number; readonly tail: number }
    | {
          readonly type: 'gamepad'
          readonly pad: number
          readonly gripW: number
          readonly gripAngle: number
      }
    | {
          readonly type: 'flightstick'
          readonly pad: number
          readonly basePad: number
          readonly shaftW: number
      }

export type ShellType = DeviceShell['type']

export interface DeviceModel {
    readonly kind: DeviceKind
    readonly form: DeviceForm
    readonly name: string
    readonly shell: DeviceShell
    readonly controls: readonly DeviceControl[]
    /** Layout variants; controls tag in with `variant`. The first one is the
     *  default (ZMK's `chosen` physical layout, QMK's default `LAYOUT`).
     *  Absent = one fixed layout. */
    readonly layouts?: readonly DeviceVariant[]
    /** The device did not report a layout: positions are a generic arrangement
     *  built from what it did report (see defaultLayout). */
    readonly defaulted?: boolean
    /** What the device reported about itself when its layout is defaulted, e.g.
     *  "12 buttons · 6 axes · 1 hat". */
    readonly hidSummary?: string
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/** An action from the adapter's own catalog. Opaque to the app: the adapter maps
 *  it to its wire encoding. `null` in a binding slot means Disabled. */
export type ActionId = string

export type ResponseCurve = 'linear' | 'aggressive' | 'relaxed' | 'precise'

export type TriggerMode = 'analog' | 'hair' | 'digital'

export interface ButtonBinding {
    readonly a: ActionId | null
    /** Second action when held; absent = none. */
    readonly hold?: ActionId
    readonly turbo?: boolean
    readonly toggle?: boolean
}

export interface WheelBinding {
    readonly up: ActionId | null
    readonly down: ActionId | null
    readonly click: ActionId | null
    readonly tl: ActionId | null
    readonly tr: ActionId | null
    readonly lines: number
    readonly smooth: boolean
    readonly freeSpin: boolean
}

export interface StickBinding {
    /** An output id from the catalog's stick outputs. */
    readonly out: string
    /** Inner (dead) and outer (saturation) radius, percent. */
    readonly inner: number
    readonly outer: number
    /** The deadzones act on the stick's distance from centre (a round dead
     *  area, full at the same push every way), not on each axis alone.
     *  Absent where the device has no such choice. */
    readonly round?: boolean
    readonly curve: ResponseCurve
    readonly invY: boolean
    readonly click: ActionId | null
}

export interface TriggerBinding {
    /** An output id from the catalog's trigger outputs. */
    readonly out: string
    /** Actuation start and full-press point, percent of travel. */
    readonly start: number
    readonly end: number
    readonly mode: TriggerMode
    readonly rumble: boolean
}

export interface HatBinding {
    readonly up: ActionId | null
    readonly down: ActionId | null
    readonly left: ActionId | null
    readonly right: ActionId | null
    readonly ul: ActionId | null
    readonly ur: ActionId | null
    readonly dl: ActionId | null
    readonly dr: ActionId | null
    readonly ways: 4 | 8
}

/** A sensor setting's value: a BOOL as a boolean, an INT as its number, an
 *  ENUM as its option's value. */
export type SensorSettingValue = number | boolean

export interface SensorBinding {
    /** DPI per stage; the DPI button cycles them. */
    readonly stages: readonly number[]
    readonly active: number
    /** Polling rate, Hz. */
    readonly poll: number
    /** The sensor's own settings the user set, keyed by
     *  {@link SensorSettingSpec.name}. One left out is at its default; dropping
     *  a key resets it. */
    readonly settings: Readonly<Record<string, SensorSettingValue>>
}

export interface EncoderBinding {
    readonly cw: ActionId | null
    readonly ccw: ActionId | null
    readonly press: ActionId | null
    /** Detents per action. */
    readonly sens: number
}

export interface AxisBinding {
    /** An output id from the catalog's axis outputs. */
    readonly out: string
    /** Centre deadzone, percent. */
    readonly dz: number
    readonly curve: ResponseCurve
    readonly inv: boolean
}

export interface BindingByKind {
    button: ButtonBinding
    wheel: WheelBinding
    stick: StickBinding
    trigger: TriggerBinding
    hat: HatBinding
    sensor: SensorBinding
    encoder: EncoderBinding
    axis: AxisBinding
}

export type ControlBinding = BindingByKind[ControlKind]

/** Bindings of one profile, keyed by control id. A control with no entry uses
 *  its kind's default. */
export type DeviceBindings = Readonly<Record<string, ControlBinding>>

// ---------------------------------------------------------------------------
// Catalog — what THIS adapter can bind and honour
// ---------------------------------------------------------------------------

/** Neutral semantic tag for colouring and grouping an action. Not a statement
 *  about any firmware: each adapter tags its own actions. */
export type DeviceActionCategory =
    | 'mouse'
    | 'key'
    | 'media'
    | 'pad'
    | 'system'
    | 'macro'
    | 'profile'
    | 'none'

export interface DeviceActionGroup {
    readonly id: string
    readonly label: string
    readonly category: DeviceActionCategory
}

export interface DeviceAction {
    readonly id: ActionId
    readonly label: string
    /** A group id from the catalog's groups. */
    readonly group: string
    readonly category: DeviceActionCategory
    /** The HID usage this action sends, packed `(page << 16) | id`, when it is
     *  a plain key (keyboard, consumer/media). The editor then offers it in
     *  the keycode grid; an action without one is picked from its group's
     *  list. Must be unique within a catalog. */
    readonly usage?: number
}

/** One choice of an analog output, a lift-off distance, … */
export interface ControlOption {
    readonly id: string
    readonly label: string
    readonly category?: DeviceActionCategory
}

/** Per kind, the binding fields this adapter honours. A field it leaves out is
 *  not shown — the adapter's table IS its capability. */
export type ControlFieldSupport = {
    readonly [K in ControlKind]?: readonly (keyof BindingByKind[K])[]
}

// ---------------------------------------------------------------------------
// Sensor descriptor — what THIS sensor has, as the device describes it
// ---------------------------------------------------------------------------

export type SensorSettingType = 'bool' | 'int' | 'enum'

export type SensorUnit = '' | 'ms' | 'us' | 'deg' | 'cpi' | '%'

/** One choice of an ENUM sensor setting. */
export interface SensorOption {
    readonly value: number
    readonly label: string
    /** The procedure (by name) whose stored result this option needs first,
     *  e.g. a calibrated lift-off distance needs a lift calibration. */
    readonly needs?: string
}

/** One setting a sensor has. Listed only when the sensor has it: the
 *  device's description IS the capability. */
export interface SensorSettingSpec {
    /** Stable key that bindings and documents use: the registry name
     *  (`liftCutoff`), or the id in hex (`0x16`) for one this client has no
     *  name for. */
    readonly name: string
    readonly label: string
    readonly type: SensorSettingType
    readonly unit: SensorUnit
    /** INT: the range and its step (values are min + k × step). */
    readonly min?: number
    readonly max?: number
    readonly step?: number
    /** ENUM: the options, in the device's order. */
    readonly options?: readonly SensorOption[]
    /** Folded away in the inspector. */
    readonly advanced: boolean
    /** What a reset goes back to: the device's default for the product. */
    readonly default: SensorSettingValue
    readonly help?: string
}

/** A guided multi-step job on the sensor, such as a lift calibration. */
export interface SensorProcedureSpec {
    readonly name: string
    readonly label: string
    /** One prompt per phase, in order. */
    readonly phases: readonly string[]
    /** A finished run leaves a result the unit keeps (never in a config). */
    readonly hasResult: boolean
    /** It runs on one channel (or every one) of a part that carries several. */
    readonly perChannel?: boolean
}

/** A live reading, for a meter. */
export interface SensorMetricSpec {
    readonly name: string
    readonly label: string
    /** The most it reads. */
    readonly max: number
}

export type SensorClass =
    | 'pointer'
    | 'touch'
    | 'imu'
    | 'analog'
    | 'matrix'
    | 'encoder'
    | 'buttons'
    | 'ledStrip'
    | 'led'
    | 'haptic'
    | 'display'
    | 'slider'
    | 'battery'
    | 'other'

/** A setting as the device holds it now. */
export interface SensorSettingInfo extends SensorSettingSpec {
    /** The value in force: a live change, the config's, or the default. */
    readonly value: SensorSettingValue
    /** Driven by the personality's own feature (a mouse's DPI or report
     *  rate), not set as a sensor setting. */
    readonly personality: boolean
    /** One value per channel (an axis's deadzone): `value` / `default` are
     *  channel 0's, `channels` every channel's, by index. */
    readonly perChannel?: boolean
    readonly channels?: readonly {
        readonly value: SensorSettingValue
        readonly default: SensorSettingValue
    }[]
}

/** One run of channels a part emits or accepts (GET_IO): `kind` by registry
 *  name (`abs`, `display`, …; a hex key for one this client does not know). */
export interface SensorIo {
    readonly kind: string
    readonly output: boolean
    readonly firstChannel: number
    readonly count: number
    /** Kind-specific: a display's width / height, an ABS axis's resolution. */
    readonly a: number
    readonly b: number
    /** These input channels wake the device from sleep (flags bit 7, WAKE),
     *  within `wakeLatencyMs` at worst (`b` of a WAKE input). */
    readonly wake?: { readonly latencyMs: number }
}

/** One sensor of a device and everything it describes. */
export interface SensorInfo {
    /** Its index among the device's sensors (the wire and the config name it
     *  by this). */
    readonly index: number
    readonly cls: SensorClass
    /** The part, e.g. "PAW3395". */
    readonly model: string
    /** Same units it carries (6 analog axes); 1 for a single unit. */
    readonly channels: number
    /** What it emits and accepts; empty from firmware that does not say. */
    readonly io: readonly SensorIo[]
    readonly settings: readonly SensorSettingInfo[]
    readonly procedures: readonly SensorProcedureSpec[]
    readonly metrics: readonly SensorMetricSpec[]
}

export interface SensorSpec {
    readonly dpiMin: number
    readonly dpiMax: number
    readonly dpiStep: number
    readonly maxStages: number
    readonly pollRates: readonly number[]
    /** The sensor's own settings (not the DPI or the rate), as it describes
     *  them; empty when it describes none. */
    readonly settings: readonly SensorSettingSpec[]
    /** Procedures and readings, for the device settings (they belong to the
     *  unit, not to a binding). */
    readonly procedures: readonly SensorProcedureSpec[]
    readonly metrics: readonly SensorMetricSpec[]
    /** Which of the device's sensors this describes (the index its SENSOR
     *  verbs take, e.g. to ask whether a procedure's result is stored);
     *  absent when the catalog was not read from one. */
    readonly index?: number
}

export interface ControlsCatalog {
    readonly groups: readonly DeviceActionGroup[]
    readonly actions: readonly DeviceAction[]
    readonly outputs: {
        readonly stick?: readonly ControlOption[]
        readonly trigger?: readonly ControlOption[]
        readonly axis?: readonly ControlOption[]
    }
    readonly fields: ControlFieldSupport
    readonly sensor?: SensorSpec
}

// ---------------------------------------------------------------------------
// Profiles, change and live input
// ---------------------------------------------------------------------------

/** A set of bindings the device can switch between. A device without profiles
 *  reports exactly one. The accent colour is the app's, by index. */
export interface DeviceProfile {
    readonly id: string
    readonly name: string
}

/** A change NOT made through this client's own setBinding call — a discard, a
 *  stock reset, a profile switched on the device. */
export type ControlsChange =
    | { readonly type: 'bindings'; readonly profileId: string }
    | { readonly type: 'profiles' }
    | { readonly type: 'model' }

/** A stick or hat position (-1..1 per axis), or a trigger / axis value (0..1 or
 *  -1..1). */
export type AnalogValue = number | { readonly x: number; readonly y: number }

export interface ControlInputFrame {
    /** Ids of the controls held down right now. */
    readonly pressed: ReadonlySet<string>
    readonly analog: Readonly<Record<string, AnalogValue>>
}
