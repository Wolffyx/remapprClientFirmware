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

import { HID_USAGE_BY_CANONICAL } from '../catalog/entries'
import { LimitsFeature } from '../clients/remappr/protocol'
import type { CanonAction, ConfigKeymap } from './types'

/** A LimitsFeature bit name (the optional firmware features a config can need). */
export type FeatureName = keyof typeof LimitsFeature

/** One capability gap: the config uses `feature` but the connected firmware's
 *  GET_LIMITS bitmask does not advertise it, so the device SILENTLY IGNORES that
 *  field. `message` is a ready-to-show "firmware ignores X" line. */
export interface CapabilityWarning {
    feature: FeatureName
    message: string
}

/** Human label for each warnable feature (what the firmware will ignore). */
const FEATURE_LABEL: Record<FeatureName, string> = {
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
        for (const e of l.encoders ?? []) {
            out.push(e.cw, e.ccw, ...(e.press ? [e.press] : []))
        }
        for (const s of l.sliders ?? []) {
            if (!s) continue
            for (const a of [s.action, s.up, s.down]) if (a) out.push(a)
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

    return req
}

/**
 * The features a config needs that the device's GET_LIMITS bitmask lacks — each
 * a field the firmware will SILENTLY IGNORE on push. Empty when the device
 * covers everything the config uses. Pass the device's `featureBitmask` (0 for
 * pre-Phase-2 firmware, which then warns about every optional field in use).
 */
export function capabilityWarnings(
    config: ConfigKeymap,
    deviceFeatureBitmask: number,
): CapabilityWarning[] {
    const missing = configRequiredFeatures(config) & ~deviceFeatureBitmask
    const out: CapabilityWarning[] = []
    for (const [name, bit] of Object.entries(LimitsFeature) as [
        FeatureName,
        number,
    ][]) {
        if (missing & bit)
            out.push({
                feature: name,
                message: `This firmware ignores ${FEATURE_LABEL[name]} — update the firmware to use it.`,
            })
    }
    return out
}
