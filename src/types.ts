import type { LegendPart } from './paramLabel'

export interface KeyAction {
    kind: string
    params: number[]
    label: KeyLabel
    /** Resolved canonical catalog id when codec.decode recognized the keycode.
     *  Picker uses this to re-highlight the originating entry without rerunning
     *  decode every render. Optional — adapters populate when known. */
    canonicalId?: string
}

export interface HoldTapLabelData {
    actionTypeName: string
    actionLabel: string
    tapParam: number
    tapDesc: string
    holdNodeKind: 'layer' | 'usage'
    holdParam: number
    holdLayerLabel?: string
    holdLayerMomentary?: string
    holdLayerName?: string
    holdUsageDesc?: string
    tooltip: string
}

// pattern-check: skip — additive optional field on existing plain data interface
export interface KeyLabel {
    primary: string
    primaryUsage?: number
    secondary?: string
    modifiers?: string
    description?: string
    bindingPrefix?: string
    holdTap?: HoldTapLabelData
    /** Short cap-legend text for a non-HID primary param (e.g. "FN1", "BT 0",
     *  "Hue+"). Rendered as the main glyph when {@link primaryUsage} is absent.
     *  Produced firmware-agnostically by buildParamLabel from the neutral slots. */
    paramText?: string
    /** Composite icon+text legend parts (behavior icon [+ command / value]).
     *  When present and at least one part resolves to an icon, the renderer
     *  prefers it over {@link paramText}; `paramText` stays the text join for
     *  tooltips and non-icon renderers. See LegendPart in paramLabel.ts. */
    paramParts?: LegendPart[]
    /** Full, untruncated value name for the tooltip (e.g. "Select Profile 1",
     *  "Toggle On/Off") when {@link paramText} is an abbreviated cap glyph
     *  ("Sel 1", "Tog"). Unprefixed by the behavior name (that is {@link primary}). */
    valueLong?: string
}

// Pattern check: no GoF pattern (-) — rejected — additive optional fields on plain data interfaces; no abstraction.
export interface EncoderAction {
    cw: KeyAction
    ccw: KeyAction
}

export interface Layer {
    id: number
    name: string
    keys: KeyAction[]
    encoders?: EncoderAction[]
}

export interface PhysicalLayoutKey {
    x: number
    y: number
    w: number
    h: number
    r?: number
    rx?: number
    ry?: number
}

export interface EncoderSlot {
    x: number
    y: number
}

export interface PhysicalLayout {
    id: number
    name: string
    keys: PhysicalLayoutKey[]
    encoders?: EncoderSlot[]
}

export interface Keymap {
    layers: Layer[]
    availableLayers: number
    activeLayoutId: number
    layouts: PhysicalLayout[]
}

export interface ActionType {
    id: string
    displayName: string
    description?: string
    /** Neutral icon id for the behavior itself (e.g. "bluetooth"), shown next to
     *  the name in the action dropdown. Resolved by the renderer's registry. */
    icon?: string
    slots: ActionSlot[]
    /** Behavior ids this composite type replaces — hidden from the action
     *  dropdown so each behavior keeps one pick path. Covers behaviors folded in
     *  as commands (also reachable via a slot value's {@link BehaviorRef}) AND
     *  ones suppressed without a command because this firmware can't set them
     *  (e.g. ZMK &mmv / &msc expose no param metadata). */
    subsumes?: string[]
    /** False when the firmware cannot bind this behavior over its protocol —
     *  e.g. a ZMK parameterized macro (macro-one/two-param) whose device-side
     *  metadata derivation yields zero sets: the device then rejects EVERY
     *  setLayerBinding for it (INVALID_PARAMETERS). Undefined = settable. */
    settable?: boolean
}

// Pattern check: no GoF pattern (-) — rejected — plain data ref {kind, params}
// shared by CatalogEntry and composite slot values; no abstraction.
/** A pointer to a firmware behavior to emit directly — its id (`kind`) and raw
 *  params — bypassing the normal keycode/slot flow. Used by catalog tiles and by
 *  composite ActionType slot values (see {@link ActionSlot}). */
export interface BehaviorRef {
    kind: string
    params?: number[]
}

export type ActionSlotKind =
    | 'hid'
    | 'modifier'
    | 'layer'
    | 'number'
    | 'enum'
    | 'action'

export interface ActionSlot {
    // pattern-check: skip additive optional field on existing interface
    label: string
    kind: ActionSlotKind
    /** Enum options; each may carry a neutral icon id for its dropdown row and
     *  composite cap legend (e.g. BT_NXT → "next"). A value may also carry a
     *  {@link BehaviorRef}: picking it emits that behavior directly instead of
     *  `{ ActionType.id, [value] }` — lets one composite ActionType dispatch to
     *  several real behaviors (unified Mouse → &mkp / &mmv / &msc). */
    values?: {
        value: number
        label: string
        icon?: string
        behaviorRef?: BehaviorRef
    }[]
    range?: { min: number; max: number }
    innerKinds?: string[]
    /**
     * enum param1 values that enable this (trailing) slot. Undefined = always
     * shown. Set when a behavior's later param is conditional on the command —
     * e.g. `&bt`'s profile index applies only to BT_SEL / BT_DISC.
     */
    enabledFor?: number[]
    /**
     * Display the (0-based) numeric value one-based in the UI while storing and
     * sending the raw index unchanged — e.g. `&bt`'s profile 0..4 shows as
     * "Profile 1..5". Firmware-neutral: any adapter sets it on a slot whose
     * users count from 1; the picker and cap legend honour it automatically.
     */
    oneBased?: boolean
}

export interface DeviceInfo {
    name: string
    firmware: string
    firmwareVersion?: string
    serialNumber?: string
    // pattern-check: skip — additive optional scalar fields for VIA registry cache key
    vid?: number
    pid?: number
}

export type LockState = 'locked' | 'unlocking' | 'unlocked' | 'not-applicable'

// Treats 'not-applicable' (firmware without lock semantics, e.g. VIA) as unlocked.
export const isUnlocked = (s: LockState): boolean =>
    s === 'unlocked' || s === 'not-applicable'

export interface AdapterNotification {
    topic: string
    payload: unknown
}

export interface KeyUpdate {
    layerId: number
    position: number
    action: KeyAction
}

export interface ExportedFile {
    filename: string
    mime: string
    content: string | Uint8Array
}

export type TransportKind = 'serial' | 'ble' | 'hid'

// pattern-check: skip plain data shapes for Vial dynamic entries; no abstraction
export interface TapDanceEntry {
    onTap: number
    onHold: number
    onDoubleTap: number
    onTapHold: number
    tappingTerm: number
}

export interface ComboEntry {
    keys: [number, number, number, number]
    output: number
}

export interface KeyOverrideOptions {
    activationTriggerDown: boolean
    activationRequiredModDown: boolean
    activationNegativeModUp: boolean
    oneMod: boolean
    noReregisterTrigger: boolean
    noUnregisterOnOtherKeyDown: boolean
    enabled: boolean
}

export interface KeyOverrideEntry {
    trigger: number
    replacement: number
    layers: number
    triggerMods: number
    negativeModMask: number
    suppressedMods: number
    options: KeyOverrideOptions
}

export interface AltRepeatKeyOptions {
    defaultToThisAltKey: boolean
    bidirectional: boolean
    ignoreModHandedness: boolean
    enabled: boolean
}

export interface AltRepeatKeyEntry {
    keycode: number
    altKeycode: number
    allowedMods: number
    options: AltRepeatKeyOptions
}

export interface DynamicEntryCounts {
    tapDance: number
    combo: number
    keyOverride: number
}

// pattern-check: skip discriminated-union data shape for macro actions
export type MacroAction =
    | { kind: 'tap'; keycode: number }
    | { kind: 'down'; keycode: number }
    | { kind: 'up'; keycode: number }
    | { kind: 'delay'; ms: number }
    | { kind: 'text'; text: string }
