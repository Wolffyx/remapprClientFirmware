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

import { LimitsFeature } from '../remappr/protocol'
import type { ConfigKeymap } from './types'

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
