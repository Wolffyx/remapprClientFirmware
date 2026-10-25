// Pattern check: no GoF pattern (-) — rejected — barrel re-export of the config module public surface, no logic.
//
// remappr generalized keymap config. Self-contained: depends only on
// @firmware/catalog + @firmware/types. The source-of-truth document layer that
// demo seeds from, the editor syncs into, and download compiles per firmware.

export type {
    CanonAction,
    CanonEncoderBinding,
    CanonEncoderSlot,
    CanonSliderBinding,
    CanonSliderMotor,
    SliderMap,
    CanonGeometry,
    CanonHoldTarget,
    CanonKeyPress,
    CanonLayer,
    CanonCombo,
    CanonMacro,
    CanonMacroStep,
    CanonTapDance,
    CanonTapDanceStep,
    CanonHoldTapDef,
    CanonModMorph,
    CanonConditionalLayer,
    CanonAutocorrectEntry,
    ConfigAutocorrect,
    CanonActionBinding,
    CanonSemanticAction,
    CanonKscan,
    CanonMatrixKscan,
    CanonDirectKscan,
    CanonMatrixTransform,
    CanonKeyboardMatrix,
    CanonController,
    CanonVial,
    CanonLighting,
    CanonUnderglow,
    CanonBacklight,
    CanonFirmwareConfig,
    CanonBacklightPwm,
    CanonWs2812,
    CanonExtPowerCtrl,
    CanonBattery,
    CanonDisplay,
    CanonPart,
    DisplayBus,
    PartKind,
    CanonLayout,
    DesignFeature,
    CanonLayoutOption,
    ConfigHardware,
    ConfigKeymap,
    ConfigKeyboard,
    ConfigPins,
    BoardEncoder,
    BoardSensor,
    ConfigDefaults,
    ConfigMeta,
    ConfigNode,
    ConfigClusterNode,
    ConfigLinkProfile,
    ConfigLinkProfileOverride,
    ConfigMouse,
    ConfigPowerSettings,
    ConfigRadioSettings,
    DiodeDirection,
    GpioSpec,
    LayerMode,
    LightingAction,
    LightingTarget,
    OutputAction,
    Resolve,
    Target,
} from './types'

export {
    MODIFIERS,
    type Modifier,
    resolveKeycode,
    resolveModifier,
    isKnownKeycode,
    isKnownKeyToken,
    parseKeyToken,
    friendlyName,
} from './keycodes'

export {
    ACTION_TYPES,
    KeymapSchema,
    migrate,
    parseSurface,
    safeParseSurface,
    type SurfaceKeymap,
    type SurfaceAction,
} from './schema'

export { buildConfigJsonSchema, buildDeviceJsonSchema } from './jsonSchema'
export {
    type ConfigDevice,
    type DongleSettings,
    DeviceConfigSchema,
    DongleSettingsSchema,
    isDeviceConfig,
    parseDeviceConfig,
    newDeviceConfig,
    DEVICE_PERSONALITY,
} from './device'
export {
    type DeviceDecodeResult,
    buildRemapprDeviceBlob,
    decodeRemapprDeviceBlob,
} from './compilers/remappr/device'
export {
    type BuilderFirmwareId,
    type BuilderFirmwareTarget,
    BUILDER_FIRMWARE_TARGETS,
    targetBuildsForm,
} from './firmwareTargets'
export {
    uidToHex,
    parseUid,
    randomUid,
    unlockToText,
    parseUnlock,
} from './vial'
export { type TargetDefaults, resolveDefaults } from './defaults'
export {
    type TimingFieldKey,
    type TimingFieldDef,
    TIMING_FIELDS,
    fieldSupported,
    groupedTimingFields,
    type Flavor,
    FLAVOR_LABELS,
    FLAVOR_OPTIONS,
    type HoldTapNumField,
    HOLD_TAP_NUM_FIELDS,
    type HoldTapFlagField,
    HOLD_TAP_FLAG_FIELDS,
    ALL_MODIFIERS,
    modifierLabel,
    featureSupported,
    toggleModifier,
    holdTapPatch,
    modMorphPatch,
    HOLD_TAP_BEHAVIOR_TOKENS,
    nextDefId,
    emptyHoldTap,
    emptyModMorph,
    emptyConditional,
    toggleIfLayer,
    sameConditional,
    sameConditionalList,
    conditionalLayersPatch,
    conditionalError,
    emptyAutocorrectEntry,
    withDefaultAutocorrect,
    autocorrectError,
    ROLE_OPTIONS,
    FORWARD_MODE_OPTIONS,
    CLUSTER_UID_MAX_HEX,
    CLUSTER_POSITION_MAX,
    emptyClusterNode,
    clusterError,
    LINK_PROFILE_OPTIONS,
    POWER_TIER_OPTIONS,
    type LinkKnobField,
    LINK_KNOB_FIELDS,
    LINK_PROFILE_BASE,
    emptyLinkProfile,
    linkKnobValue,
    linkKnobRange,
    withLinkOverride,
    linkProfileError,
} from './editorFields'
export {
    type DeviceNumberField,
    type DongleNumberKey,
    type RadioNumberKey,
    DONGLE_FIELDS,
    RADIO_FIELDS,
    RADIO_AUTO_PAIR_DEFAULT,
    type PowerField,
    POWER_FIELDS,
    powerTimeoutLabel,
    MOUSE_SCROLL_DIVISOR_FIELD,
    MOUSE_ACCEL_POINTS_MAX,
    MOUSE_BUTTON_NAMES,
    MOUSE_BUTTON_MAP_IDENTITY,
    compactSection,
} from './deviceFields'
export {
    type DerivedMatrix,
    deriveMatrix,
    keyCentre,
    materializeMatrix,
    matrixDims,
    matrixSplit,
    resolveKeyMatrix,
} from './matrix'
export { resolveController } from './controller'
export {
    checkCompleteness,
    effectiveFirmware,
    type FirmwareReadiness,
    type ReadinessIssue,
} from './completeness'
export {
    type AutocorrectEntry,
    AUTOCORRECT_MAX_TYPO,
    REPL_ALPHABET as AUTOCORRECT_REPL_ALPHABET,
    TYPO_ALPHABET as AUTOCORRECT_TYPO_ALPHABET,
    encodeAutocorrectDictionary,
} from './compilers/remappr/autocorrect'
export {
    DEFAULT_AUTOCORRECT_ENTRIES,
    defaultAutocorrectEntries,
} from './autocorrectDictionary'
export { normalizeAction, normalizeKeymap, parseKeymap } from './normalize'
export {
    type LegacyKnobBindings,
    knobSlotOf,
    remapKnobKeys,
    syncKnobs,
} from './knobs'
export {
    denormalizeAction,
    preferredSourceJson,
    serializeKeymap,
    serializeKeymapV2,
    toSurfaceObject,
} from './serialize'

export {
    type Diagnostic,
    type DiagnosticLevel,
    type DiagnosticPath,
    DiagnosticBag,
    formatPath,
} from './diagnostics'

export {
    type FirmwareCapabilities,
    CAPABILITY_MATRIX,
    resolveAllowedTargets,
    supportsLighting,
    supportsOutput,
    supportsRuntimeLighting,
    targetCovers,
    targetLabel,
} from './capabilities'

export {
    type CompileResult,
    type KeymapCompiler,
    getCompiler,
    hasCompiler,
    registerCompiler,
} from './compiler'

export { type ProjectBundle, buildProjectBundle } from './bundle'
export {
    type DeviceCaps,
    type PreflightIssue,
    preflightConfigBlob,
} from './preflight'
export {
    type CapabilityWarning,
    type FeatureName,
    capabilityWarnings,
    configRequiredFeatures,
} from './featureWarnings'
export {
    type ZmkConfFlags,
    deriveZmkConf,
    deriveQmkConfigH,
    deriveQmkRulesMk,
    resolveZmkConfFlags,
    someAction,
} from './firmwareConf'

export {
    type PinRole,
    ZMK_PIN_MAPS,
    QMK_PIN_ALIASES,
    resolveZmkPin,
    resolveQmkPin,
    gpioSpec,
    hasZmkPinMap,
    boardPinLabels,
    boardPinForms,
    samePin,
    boardFootprint,
    type BoardFootprint,
    KNOWN_ZMK_BOARDS,
} from './pinmaps'
export {
    BOARD_PIN_ABILITIES,
    reservedPins,
    suggestPinsByRole,
    type BoardBus,
    type BoardPin,
    type BoardPinAbilities,
    type PinNeed,
    type PinUse,
} from './pinAbilities'

export {
    type ActionCategory,
    type ActionMeta,
    type PaletteGroup,
    type PaletteKeycode,
    ACTION_META,
    getActionMeta,
    KEYCODE_PALETTE,
} from './editorMeta'

// Side-effect imports: each concrete compiler self-registers on load. The
// remappr module also registers its sibling `remappr-board` shield/DT target.
import './compilers/zmk'
import './compilers/qmk'
import './compilers/remappr'
export {
    DESIGN_FEATURES,
    SUGGESTED_FEATURES,
    FIRMWARE_SWITCHES,
    firmwareForDisplay,
    setDesignFeature,
    supportsFeature,
    type DesignFeatureCard,
    type FirmwareSwitch,
    type SwitchTable,
} from './firmwareSwitches'
export { DESIGN_FEATURE_NAME } from './firmwareConf'
export { ELEMENT_SHAPE, PART_SHAPE, partGlyph, partToLayout } from './parts'
export { SLIDER_MAP_INFO, type SliderMapInfo, sliderMapInfo } from './sliders'
export {
    DISPLAY_MODULES,
    DISPLAY_PIN_NAMES,
    displayFromModule,
    displayModule,
    displayPins,
    displaySize,
    type DisplayModule,
    type DisplayPin,
} from './displays'
