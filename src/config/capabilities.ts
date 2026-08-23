// Pattern check: no GoF pattern (-) — rejected — static per-firmware capability data table + a lookup helper; no abstraction.
//
// Single source for "which generalized feature does firmware X actually
// support". Compilers consult this to emit a `warn` diagnostic + drop an
// unsupported binding to a no-op, instead of scattering `if (target === 'zmk')`
// across each emitter. Keychron runs the VIA/QMK stack plus a BLE radio.

import type {
    BuiltinTarget,
    LightingTarget,
    OutputAction,
    Target,
} from './types'

export interface FirmwareCapabilities {
    /** Display name for this target, e.g. `'ZMK'`. The single source the UI
     *  reads — no per-screen label maps. */
    label: string
    /** Lighting axes the firmware can drive. */
    lighting: LightingTarget[]
    /** True when lighting is settable at RUNTIME over the firmware's own
     *  protocol. Distinct from {@link lighting}, which is what the COMPILER can
     *  emit: ZMK drives underglow and backlight but exposes no runtime
     *  RGB-settings protocol, so its lighting is compile-time only and the
     *  editor's live RGB controls cannot work against it. */
    runtimeLighting: boolean
    /** Other firmware ids this target's output also serves, so the UI can show
     *  e.g. "QMK · covers VIA · Vial" without knowing the collapse itself. */
    covers: string[]
    /** Output-routing actions; `profiles` = supports a bluetooth profile index. */
    output: { actions: OutputAction[]; profiles: boolean }
    /** Generalized behaviors with a code-gen path on this firmware. */
    behaviors: {
        capsWord: boolean
        stickyKey: boolean
        stickyLayer: boolean
        tapDance: boolean
        macro: boolean
        combo: boolean
    }
}

export const CAPABILITY_MATRIX: Record<Target, FirmwareCapabilities> = {
    zmk: {
        label: 'ZMK',
        // Underglow/backlight are compile-time devicetree only — no runtime
        // RGB-settings protocol exists, so live RGB controls can't drive ZMK.
        runtimeLighting: false,
        covers: [],
        lighting: ['underglow', 'backlight'], // no per_key matrix control
        output: {
            actions: [
                'usb',
                'bluetooth',
                'bluetooth_clear',
                'bluetooth_next',
                'bluetooth_prev',
                'bluetooth_disconnect',
                'toggle',
                'none',
            ],
            profiles: true,
        },
        behaviors: {
            capsWord: true,
            stickyKey: true,
            stickyLayer: true,
            tapDance: true,
            macro: true,
            combo: true,
        },
    },
    qmk: {
        label: 'QMK',
        runtimeLighting: true,
        // The QMK compiler's output also serves VIA and Vial.
        covers: ['via', 'vial'],
        lighting: ['underglow', 'backlight', 'per_key'],
        output: { actions: ['usb'], profiles: false }, // wired-only stock QMK
        behaviors: {
            capsWord: true,
            stickyKey: true,
            stickyLayer: true,
            tapDance: true,
            macro: true,
            combo: true,
        },
    },
    keychron: {
        label: 'Keychron',
        runtimeLighting: true,
        covers: [],
        lighting: ['underglow', 'backlight', 'per_key'],
        output: {
            actions: [
                'usb',
                'bluetooth',
                'bluetooth_clear',
                'bluetooth_next',
                'bluetooth_prev',
                'bluetooth_disconnect',
                'toggle',
                'none',
            ],
            profiles: true,
        }, // VIA/QMK + BLE
        behaviors: {
            capsWord: true,
            stickyKey: true,
            stickyLayer: true,
            tapDance: true,
            macro: true,
            combo: true,
        },
    },
    // pattern-check: skip — per-firmware capability data entry + coverage guard
    remappr: {
        label: 'Remappr',
        runtimeLighting: true,
        covers: [],
        // The native Zephyr firmware — superset: wireless output + per-key RGB
        // (TBL_RGB) + every generalized behavior in the config blob.
        lighting: ['underglow', 'backlight', 'per_key'],
        output: {
            actions: [
                'usb',
                'bluetooth',
                'bluetooth_clear',
                'bluetooth_next',
                'bluetooth_prev',
                'bluetooth_disconnect',
                'toggle',
                'none',
            ],
            profiles: true,
        },
        behaviors: {
            capsWord: true,
            stickyKey: true,
            stickyLayer: true,
            tapDance: true,
            macro: true,
            combo: true,
        },
    },

    // The Zephyr-shield flavour of the remappr target — same firmware, same
    // capabilities; it exists as a separate compiler id because it emits a
    // board/shield project rather than a bare config blob.
    'remappr-board': {
        label: 'Remappr',
        runtimeLighting: true,
        covers: [],
        // The native Zephyr firmware — superset: wireless output + per-key RGB
        // (TBL_RGB) + every generalized behavior in the config blob.
        lighting: ['underglow', 'backlight', 'per_key'],
        output: {
            actions: [
                'usb',
                'bluetooth',
                'bluetooth_clear',
                'bluetooth_next',
                'bluetooth_prev',
                'bluetooth_disconnect',
                'toggle',
                'none',
            ],
            profiles: true,
        },
        behaviors: {
            capsWord: true,
            stickyKey: true,
            stickyLayer: true,
            tapDance: true,
            macro: true,
            combo: true,
        },
    },
}

// Compile-time: every BUILTIN_TARGETS family must have a capability entry above;
// adding a family fails this line until its caps are declared.
const _matrixCoversBuiltins: Record<BuiltinTarget, FirmwareCapabilities> =
    CAPABILITY_MATRIX
void _matrixCoversBuiltins

export const supportsLighting = (
    target: Target,
    axis: LightingTarget,
): boolean => CAPABILITY_MATRIX[target].lighting.includes(axis)

export const supportsOutput = (target: Target, action: OutputAction): boolean =>
    CAPABILITY_MATRIX[target].output.actions.includes(action)

/** True when this target's lighting can be driven live over its protocol, so
 *  the editor's RGB controls are usable. False = compile-time lighting only. */
export const supportsRuntimeLighting = (target: Target): boolean =>
    CAPABILITY_MATRIX[target]?.runtimeLighting ?? false

/** Display name for a compiler target. Falls back to the raw id so an unknown
 *  target still renders something. */
export const targetLabel = (target: Target): string =>
    CAPABILITY_MATRIX[target]?.label ?? String(target)

/** Firmware ids this target's output also serves (e.g. qmk → via, vial). */
export const targetCovers = (target: Target): readonly string[] =>
    CAPABILITY_MATRIX[target]?.covers ?? []

/**
 * Targets a user may compile for. Demo (no connected firmware) → all; a
 * connected device → only its own firmware family.
 */
export function resolveAllowedTargets(
    connectedFirmware?: string | null,
): Target[] {
    // Download-bundle families (what buildProjectBundle accepts), NOT the raw
    // BUILTIN_TARGETS. `remappr` is authored as a builder firmware and downloads
    // through the remappr-board shield bundle (buildProjectBundle aliases it), so
    // the editor's Download offers it here too — not only in BuilderExportModal.
    const all: Target[] = ['zmk', 'qmk', 'keychron', 'remappr']
    if (!connectedFirmware) return all
    const fam = connectedFirmware.toLowerCase()
    return all.filter((t) => fam.includes(t))
}
