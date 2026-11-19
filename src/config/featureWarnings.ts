// Pattern check: no GoF pattern (-) — rejected — a pure config scanner with a
// flat field→feature-bit map; sibling to preflight.ts, one concern, one caller,
// no polymorphism to abstract.
//
// Firmware capability warnings (§7.4.1): a config may set optional timing /
// behavior fields (hold-trigger-on-release, caps-word idle, sticky release,
// macro defaults, matrix poll period) that only Phase-2+ firmware honors. The
// device advertises what it honors in the GET_LIMITS feature bitmask; older
// firmware reports 0. This module reports which features a config USES that the
// connected device does NOT advertise, so the app can warn "firmware ignores X"
// instead of silently dropping the field on push (the dlen-gated-tail failure
// mode). Pure + dependency-light — the UI wiring lives in the app (Phase 5).
//
// Behavior families (bits 13-20) are the other kind of gap: a keyboard built
// without a family REFUSES a config that uses it (validate fails), so those
// warnings are `blocking` — the app must not push such a config at all.

import { HID_USAGE_BY_CANONICAL } from '../catalog/entries'
import {
    BEHAVIOR_FAMILY_BIT,
    effectiveFeatureBitmask,
    LimitsFeature,
    type BehaviorFamily,
} from '../clients/remappr/protocol'
import type { CanonAction, ConfigKeymap } from './types'

/** A LimitsFeature bit name (the optional firmware features a config can need). */
export type FeatureName = keyof typeof LimitsFeature

/** One capability gap: the config uses `feature` but the connected firmware's
 *  GET_LIMITS bitmask does not advertise it. Non-blocking: the device SILENTLY
 *  IGNORES that field, and `message` is a "firmware ignores X" line. Blocking (a
 *  behavior family the image was built without): the device refuses the whole
 *  config, so the app must not save it; `message` says what to remove. */
export interface CapabilityWarning {
    feature: FeatureName
    message: string
    blocking: boolean
}

/** What each behavior family covers, for "built without X" messages and UI. */
export const BEHAVIOR_FAMILY_LABEL: Readonly<Record<BehaviorFamily, string>> = {
    tapHold: 'tap-hold keys (mod-tap, layer-tap, auto shift, tap-toggle, tapping-term tuning)',
    combos: 'combos',
    macros: 'macros (incl. recorded macros)',
    sequences: 'tap-dances and leader sequences',
    unicode: 'Unicode keys',
    conditionals: 'conditional layers',
    keyOverrides: 'key overrides',
}

const FAMILY_BY_BIT = new Map<number, BehaviorFamily>(
    (Object.entries(BEHAVIOR_FAMILY_BIT) as [BehaviorFamily, number][]).map(
        ([f, bit]) => [bit, f],
    ),
)

/** Human label for each warnable feature (what the firmware will ignore). The
 *  other bits name tables / actions a config never requires through here. */
const FEATURE_LABEL: Partial<Record<FeatureName, string>> = {
    holdTriggerOnRelease: 'hold-trigger-on-release tap-holds',
    capsWordIdle: 'the caps-word idle timeout',
    stickyReleaseAfter: 'the sticky-key release timeout',
    macroDefaults: 'the default macro wait / tap timings',
    matrixPollPeriod: 'the matrix poll period',
    // layerTailV3 is the internal container for the four tail defaults above; a
    // config never requires it directly (the specific field bits are more
    // actionable), so it carries no label of its own.
    layerTailV3: 'extended timing defaults',
    kbdExt: 'international, LANG and keyboard-page volume keys (usages 0x78..0xA7)',
    clusterMode: 'the cluster mode (always alone)',
    tblClusterV2: 'the cluster side map (side-stable key numbering)',
}

/** Keyboard usages only a KBD_EXT build sends (0x78..0xA7). */
const KBD_EXT_FIRST = 0x78
const KBD_EXT_LAST = 0xa7
const HID_PAGE_KEYBOARD = 7

function isExtKey(key: string | undefined): boolean {
    const u = key === undefined ? undefined : HID_USAGE_BY_CANONICAL.get(key)
    return (
        u !== undefined &&
        u.page === HID_PAGE_KEYBOARD &&
        u.usage >= KBD_EXT_FIRST &&
        u.usage <= KBD_EXT_LAST
    )
}

/** The keyboard key an action sends, if it sends one. */
function actionKey(a: CanonAction): string | undefined {
    if (a.type === 'tap_hold') return a.tap.key
    return 'key' in a && typeof a.key === 'string' ? a.key : undefined
}

/** Every action the config binds: layer keys, encoders, sliders, combos,
 *  leader outputs and composite sub-actions. */
function allActions(config: ConfigKeymap): CanonAction[] {
    const out: CanonAction[] = []
    for (const l of config.layers) {
        out.push(...l.bindings)
        for (const e of [...(l.encoders ?? []), ...Object.values(l.encoderBindings ?? {})]) {
            out.push(e.cw, e.ccw, ...(e.press ? [e.press] : []))
        }
        for (const s of Object.values(l.sliderBindings ?? {})) {
            out.push(...(s.action ? [s.action] : []), ...(s.downAction ? [s.downAction] : []))
        }
    }
    out.push(...(config.combos ?? []).map((c) => c.action))
    out.push(...(config.leaderSequences ?? []).map((l) => l.action))
    for (const td of config.tapDances ?? []) out.push(...td.taps.map((t) => t.action))
    for (const mm of config.modMorphs ?? []) out.push(...mm.bindings)
    return out
}

/** Whether the config binds a key past 0x77 anywhere a key can go. */
function usesExtKeys(config: ConfigKeymap): boolean {
    if (allActions(config).some((a) => isExtKey(actionKey(a)))) return true
    const macroKeys = (config.macros ?? []).flatMap((m) =>
        m.steps.map((st) => ('key' in st ? st.key : undefined)),
    )
    const overrideKeys = (config.keyOverrides ?? []).flatMap((k) => [
        k.trigger,
        k.replacement,
    ])
    const leaderKeys = (config.leaderSequences ?? []).flatMap((l) => l.sequence)
    return [...macroKeys, ...overrideKeys, ...leaderKeys].some(isExtKey)
}

/** The family each family-owned action belongs to (fw behavior_table.h); any
 *  other action is core. */
const ACTION_FAMILY: Partial<Record<CanonAction['type'], BehaviorFamily>> = {
    tap_hold: 'tapHold',
    hold_tap: 'tapHold',
    auto_shift: 'tapHold',
    tap_toggle: 'tapHold',
    tune_tap_term: 'tapHold',
    macro: 'macros',
    macro_record: 'macros',
    macro_play: 'macros',
    tap_dance: 'sequences',
    leader: 'sequences',
    unicode: 'unicode',
}

/** Every action the compiled blob will carry: the roots (layer keys, encoders,
 *  sliders, combo and leader outputs) plus the tap-dance / mod-morph bodies they
 *  reach. An unreferenced composite is never compiled, so it is skipped. */
function compiledActions(config: ConfigKeymap): CanonAction[] {
    const tapDances = new Map((config.tapDances ?? []).map((t) => [t.id, t]))
    const modMorphs = new Map((config.modMorphs ?? []).map((m) => [m.id, m]))
    const seen = new Set<string>()
    const roots = allActions({ ...config, tapDances: [], modMorphs: [] })
    const out: CanonAction[] = []
    const visit = (a: CanonAction): void => {
        out.push(a)
        const key = 'ref' in a ? `${a.type}:${a.ref}` : undefined
        if (key === undefined || seen.has(key)) return
        seen.add(key)
        const body =
            a.type === 'tap_dance'
                ? tapDances.get(a.ref)?.taps.map((t) => t.action)
                : a.type === 'mod_morph'
                  ? modMorphs.get(a.ref)?.bindings
                  : undefined
        for (const b of body ?? []) visit(b)
    }
    for (const a of roots) visit(a)
    return out
}

/** The behavior families a config uses — the ones whose actions it binds, or
 *  whose table it fills. A parameterized macro that is never bound compiles to
 *  nothing; a plain macro is always written to the macro table. */
export function configRequiredFamilies(config: ConfigKeymap): Set<BehaviorFamily> {
    const out = new Set<BehaviorFamily>()
    for (const a of compiledActions(config)) {
        const f = ACTION_FAMILY[a.type]
        if (f) out.add(f)
    }
    const plainMacro = (config.macros ?? []).some(
        (m) => !m.steps.some((s) => s.type === 'param'),
    )
    if (plainMacro) out.add('macros')
    if (config.combos?.length) out.add('combos')
    if (config.leaderSequences?.length) out.add('sequences')
    if (config.conditionalLayers?.length) out.add('conditionals')
    if (config.keyOverrides?.length) out.add('keyOverrides')
    return out
}

/**
 * The LimitsFeature bitmask a config exercises — the optional firmware features
 * that must be present for the config to behave exactly as authored. Absent /
 * zero timing fields impose nothing (they mean "keep the firmware default").
 */
export function configRequiredFeatures(config: ConfigKeymap): number {
    let req = 0

    const d = config.defaults
    if (d?.capsWordIdleMs) req |= LimitsFeature.capsWordIdle
    if (d?.stickyReleaseDefaultMs) req |= LimitsFeature.stickyReleaseAfter
    if (d?.macroDefaultWaitMs || d?.macroDefaultTapMs)
        req |= LimitsFeature.macroDefaults
    if (d?.matrixPollPeriodMs) req |= LimitsFeature.matrixPollPeriod

    // hold-trigger-on-release can sit on an inline tap-hold binding or a hold-tap
    // definition; either use requires the behavior flag.
    const htorInDefs = (config.holdTaps ?? []).some(
        (h) => h.holdTriggerOnRelease,
    )
    const htorInline = config.layers.some((l) =>
        l.bindings.some((b) => b.type === 'tap_hold' && b.holdTriggerOnRelease),
    )
    if (htorInDefs || htorInline) req |= LimitsFeature.holdTriggerOnRelease

    // A key past 0x77 reaches the host only from a KBD_EXT build; an older
    // one drops it.
    if (usesExtKeys(config)) req |= LimitsFeature.kbdExt

    // A non-default cluster mode rides TBL_PERSONALITY byte 3 (§5.4).
    if (config.node?.clusterMode === 'alone') req |= LimitsFeature.clusterMode
    // A side map rides TBL_CLUSTER v2 (§5.3).
    if (config.node?.clusterSides?.length) req |= LimitsFeature.tblClusterV2

    // Each behavior family the config uses: its bit must be set (or the device
    // predate family advertisement — see effectiveFeatureBitmask).
    for (const f of configRequiredFamilies(config)) req |= BEHAVIOR_FAMILY_BIT[f]

    return req
}

/** The warning for one missing feature bit: a family the image was built
 *  without blocks the save; anything else is a field the firmware ignores. */
function warningFor(name: FeatureName, bit: number): CapabilityWarning {
    const family = FAMILY_BY_BIT.get(bit)
    if (family)
        return {
            feature: name,
            blocking: true,
            message:
                `This keyboard's firmware was built without ${BEHAVIOR_FAMILY_LABEL[family]}, ` +
                'so it will refuse this config — remove them, or flash firmware that includes them.',
        }
    return {
        feature: name,
        blocking: false,
        message: `This firmware ignores ${FEATURE_LABEL[name] ?? name} — update the firmware to use it.`,
    }
}

/**
 * The features a config needs that the device's GET_LIMITS bitmask lacks. Each
 * is either a field the firmware will SILENTLY IGNORE on push, or (`blocking`)
 * a behavior family the image was built without, which makes the device refuse
 * the config. Empty when the device covers everything the config uses. Pass the
 * device's `featureBitmask` (0 for pre-Phase-2 firmware, which then warns about
 * every optional field in use; firmware without the BEHAVIOR_FAMILIES bit has
 * every family, so it never gets a blocking warning).
 */
export function capabilityWarnings(
    config: ConfigKeymap,
    deviceFeatureBitmask: number,
): CapabilityWarning[] {
    const missing =
        configRequiredFeatures(config) & ~effectiveFeatureBitmask(deviceFeatureBitmask)
    const out: CapabilityWarning[] = []
    for (const [name, bit] of Object.entries(LimitsFeature) as [
        FeatureName,
        number,
    ][]) {
        if (missing & bit) out.push(warningFor(name, bit))
    }
    return out
}
