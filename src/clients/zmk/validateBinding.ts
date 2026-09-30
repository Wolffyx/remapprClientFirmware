// Pattern check: no GoF pattern (-) — rejected — pure predicate module mirroring
// the device's own binding validation; no abstraction or polymorphism warranted.
import type {
    BehaviorBindingParametersSet,
    BehaviorParameterValueDescription,
    GetBehaviorDetailsResponse,
} from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import { hidUsagePageAndIdFromUsage } from '@firmware/_app/lib/actions/hidUsages'

/** HID usage pages ZMK's `validate_hid_usage` accepts. */
const HID_USAGE_PAGE_KEY = 0x07
const HID_USAGE_PAGE_CONSUMER = 0x0c

/**
 * Local mirror of the firmware's `zmk_behavior_validate_binding`
 * (zmk `app/src/behavior.c`), so the client can tell — without a round trip —
 * whether `keymap.setLayerBinding` would answer INVALID_PARAMETERS.
 *
 * Deliberately no stricter than the device: when we can't tell, we say "settable"
 * and let the real RPC decide. False positives cost one rejected write; false
 * negatives would silently drop a binding the keyboard would have accepted.
 *
 * The notable case it catches: a behavior whose metadata carries no parameter
 * sets at all (ZMK `&ext_power`, `&mmv`, `&msc`, parameterized macros, and any
 * behavior whose metadata failed to encode — e.g. an HSV-typed param, which
 * aborts the whole `GetBehaviorDetails` metadata encode firmware-side). Those
 * accept `(0, 0)` and reject every other parameter pair.
 */
export function canSetZmkBinding(
    behavior: GetBehaviorDetailsResponse | undefined,
    param1: number,
    param2: number,
    layerCount: number,
): boolean {
    // Unknown behavior id — the device answers INVALID_BEHAVIOR, not parameters,
    // but either way the write cannot succeed.
    if (!behavior) return false
    const sets = behavior.metadata ?? []
    // Mirrors `zmk_behavior_check_params_match_metadata`'s empty-metadata branch.
    if (sets.length === 0) return param1 === 0 && param2 === 0
    return sets.some((set) => matchesSet(set, param1, param2, layerCount))
}

function matchesSet(
    set: BehaviorBindingParametersSet,
    param1: number,
    param2: number,
    layerCount: number,
): boolean {
    return (
        matchesColumn(set.param1, param1, layerCount) &&
        matchesColumn(set.param2, param2, layerCount)
    )
}

/**
 * One parameter column of one metadata set. An empty column means the behavior
 * takes no parameter there, which the firmware accepts only for a zero param
 * (`-ENODEV` + `param == 0` in `zmk_behavior_check_params_match_metadata`).
 */
function matchesColumn(
    descriptions: BehaviorParameterValueDescription[] | undefined,
    param: number,
    layerCount: number,
): boolean {
    if (!descriptions || descriptions.length === 0) return param === 0
    return descriptions.some((d) => matchesDescription(d, param, layerCount))
}

/** Mirrors the firmware's `check_param_matches_value`. */
function matchesDescription(
    d: BehaviorParameterValueDescription,
    param: number,
    layerCount: number,
): boolean {
    if (d.constant !== undefined) return param === d.constant
    if (d.range) return param >= d.range.min && param <= d.range.max
    if (d.layerId) return param >= 0 && param < layerCount
    if (d.hidUsage) return isValidHidUsage(param, d)
    if (d.nil) return param === 0
    return false
}

function isValidHidUsage(
    usage: number,
    d: BehaviorParameterValueDescription,
): boolean {
    const [page, id] = hidUsagePageAndIdFromUsage(usage)
    if (id === 0) return false
    // The device's own bounds, reported per behavior. Treat a zero/absent max as
    // "unknown" and accept, rather than rejecting a usage the keyboard allows.
    if (page === HID_USAGE_PAGE_KEY) {
        const max = d.hidUsage?.keyboardMax ?? 0
        return max === 0 || id <= max
    }
    if (page === HID_USAGE_PAGE_CONSUMER) {
        const max = d.hidUsage?.consumerMax ?? 0
        return max === 0 || id <= max
    }
    return false
}
