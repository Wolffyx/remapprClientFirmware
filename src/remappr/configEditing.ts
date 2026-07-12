// Pattern check: no GoF pattern (-) — rejected — a capability interface + a
// structural type-guard for the config-blob editing surface; mirrors the existing
// EncoderApi / MacroApi facade-probe idiom, no new abstraction.
//
// The config-blob editing surface (§7.4 timing defaults + the custom hold-tap /
// mod-morph def pools + conditional tri-layers) shared by the concrete Remappr
// service and the demo mock. It is DELIBERATELY separate from the generic
// KeyboardService interface — ZMK / QMK / Keychron have no config blob, so these
// setters must not leak onto them. UI editors probe for the surface via
// supportsConfigEditing() instead of binding to a concrete class, which is what
// lets demo mode (the mock) present the very same editors as a real device.
import type { KeyboardService } from '../service'
import type {
    CanonConditionalLayer,
    CanonHoldTapDef,
    CanonModMorph,
    ConfigDefaults,
} from '../config'

export interface RemapprConfigEditing {
    /** Active §7.4 timing defaults with any pending edit applied. */
    getConfigDefaults(): ConfigDefaults
    /** Stage a defaults patch (undefined value drops a key back to committed). */
    setConfigDefaults(patch: Partial<ConfigDefaults>): void
    /** Custom hold-tap defs, device-truth merged with staged edits. */
    getHoldTaps(): CanonHoldTapDef[]
    /** Stage a patch onto the hold-tap def at `idx`. */
    setHoldTap(idx: number, patch: Partial<CanonHoldTapDef>): void
    /** Custom mod-morph defs, device-truth merged with staged edits. */
    getModMorphs(): CanonModMorph[]
    /** Stage a patch onto the mod-morph def at `idx`. */
    setModMorph(idx: number, patch: Partial<CanonModMorph>): void
    /** Conditional (tri-)layers, device-truth or the staged list once edited. */
    getConditionalLayers(): CanonConditionalLayer[]
    /** Stage the full conditional-layer list (the editor owns add / remove). */
    setConditionalLayers(list: CanonConditionalLayer[]): void
}

/** True when `service` exposes the config-blob editing surface — a concrete
 *  Remappr device or the demo mock. Type-guards to `KeyboardService &
 *  RemapprConfigEditing` so an editor can call the setters without importing (or
 *  narrowing to) a concrete class, keeping demo + real device on one code path. */
export function supportsConfigEditing(
    service: KeyboardService | null | undefined,
): service is KeyboardService & RemapprConfigEditing {
    const s = service as Partial<RemapprConfigEditing> | null | undefined
    return (
        !!s &&
        typeof s.getConfigDefaults === 'function' &&
        typeof s.setConfigDefaults === 'function' &&
        typeof s.getHoldTaps === 'function' &&
        typeof s.setHoldTap === 'function' &&
        typeof s.getModMorphs === 'function' &&
        typeof s.setModMorph === 'function' &&
        typeof s.getConditionalLayers === 'function' &&
        typeof s.setConditionalLayers === 'function'
    )
}
