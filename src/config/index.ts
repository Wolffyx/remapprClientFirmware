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
    CanonLayout,
    CanonLayoutOption,
    ConfigHardware,
    ConfigKeymap,
    ConfigKeyboard,
    ConfigPins,
    ConfigDefaults,
    ConfigMeta,
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

export { buildConfigJsonSchema } from './jsonSchema'
export {
    type BuilderFirmwareId,
    type BuilderFirmwareTarget,
    BUILDER_FIRMWARE_TARGETS,
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
} from './editorFields'
export {
    type DerivedMatrix,
    deriveMatrix,
    materializeMatrix,
    matrixDims,
    resolveKeyMatrix,
} from './matrix'
export { resolveController } from './controller'
export {
    checkCompleteness,
    effectiveFirmware,
    type FirmwareReadiness,
    type ReadinessIssue,
} from './completeness'
export { normalizeAction, normalizeKeymap, parseKeymap } from './normalize'
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
    KNOWN_ZMK_BOARDS,
} from './pinmaps'

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
