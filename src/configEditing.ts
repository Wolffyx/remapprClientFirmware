// Pattern check: Facade (Tier 1) — extended — same optional-facade idiom as
// EncoderApi / MacroApi / RgbApi in service.ts: one cohesive capability surface
// a firmware may or may not implement, probed structurally rather than by class.
//
// The config-blob editing surface: §7.4-style timing defaults, the custom
// hold-tap / mod-morph def pools, conditional tri-layers, the autocorrect
// dictionary and whole-node config. DELIBERATELY separate from the generic
// KeyboardService interface — a firmware with no config blob (ZMK / QMK /
// Keychron today) must not carry these setters.
//
// This module is firmware-NEUTRAL by design and lives at the firmware-system
// root, not under any client dir. Any adapter may implement it; the app probes
// with supportsConfigEditing() and never names a firmware. Today the Remappr
// client and the demo mock implement it, which is exactly what lets demo mode
// present the very same editors as a real device.
import type { KeyboardService } from './service'
import type {
    CanonAutocorrectEntry,
    CanonConditionalLayer,
    CanonHoldTapDef,
    CanonModMorph,
    ConfigDefaults,
    ConfigNode,
} from './config'

/** One firmware-owned knob range for the link-profile editor: the min/max the
 *  device itself reports for knob `knob`, so a UI never offers an out-of-range
 *  value. Neutral DTO — the wire parse that produces it stays in the client. */
export interface LinkLimitKnob {
    knob: number
    min: number
    max: number
}

export interface ConfigEditingApi {
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
    /** Autocorrect dictionary (§5.2-E), device-truth or the staged list once edited. */
    getAutocorrect(): CanonAutocorrectEntry[]
    /** Stage the full dictionary; an empty list clears the device's. */
    setAutocorrect(entries: CanonAutocorrectEntry[]): void
    /** Whole-node config (§N4b role / §N4c forwardMode + cluster map), device-truth
     *  merged with staged edits. */
    getNode(): ConfigNode
    /** Stage a node-config patch (role / forwardMode / cluster / linkProfile); an
     *  `undefined` value drops that key back to committed, mirroring
     *  setConfigDefaults. The link profile is staged whole (setNode({ linkProfile })). */
    setNode(patch: Partial<ConfigNode>): void
    /** Live GET_LINK_LIMITS (§8, N6): the firmware-owned per-knob min/max ranges
     *  for the link-profile editor, so it never offers an out-of-range value. */
    getLinkLimits(): Promise<LinkLimitKnob[]>
}

/** True when `service` exposes the config-blob editing surface. Type-guards to
 *  `KeyboardService & ConfigEditingApi` so an editor can call the setters
 *  without importing (or narrowing to) a concrete class — the app gates its
 *  config editors on this, never on a firmware name, which is what keeps demo
 *  and real device on one code path. */
export function supportsConfigEditing(
    service: KeyboardService | null | undefined,
): service is KeyboardService & ConfigEditingApi {
    const s = service as Partial<ConfigEditingApi> | null | undefined
    return (
        !!s &&
        typeof s.getConfigDefaults === 'function' &&
        typeof s.setConfigDefaults === 'function' &&
        typeof s.getHoldTaps === 'function' &&
        typeof s.setHoldTap === 'function' &&
        typeof s.getModMorphs === 'function' &&
        typeof s.setModMorph === 'function' &&
        typeof s.getConditionalLayers === 'function' &&
        typeof s.setConditionalLayers === 'function' &&
        typeof s.getAutocorrect === 'function' &&
        typeof s.setAutocorrect === 'function' &&
        typeof s.getNode === 'function' &&
        typeof s.setNode === 'function' &&
        typeof s.getLinkLimits === 'function'
    )
}
