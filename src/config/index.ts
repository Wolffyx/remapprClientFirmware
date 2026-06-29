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

// Side-effect imports: each concrete compiler self-registers on load.
import './compilers/zmk'
import './compilers/qmk'
import './compilers/remappr'
