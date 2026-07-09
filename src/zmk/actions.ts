// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; translates ZMK BehaviorBinding ↔ neutral KeyAction with slot-driven labels baked in.
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import type {
    ActionSlot,
    HoldTapLabelData,
    KeyAction,
    KeyLabel,
} from '@firmware/types'
import {
    hid_usage_get_labels,
    hidUsagePageAndIdFromUsage,
} from '@firmware/_app/lib/actions/hidUsages'
import {
    abbreviateLayerName,
    formatMomentaryLayer,
} from '@firmware/_app/lib/keyAbbreviations'
import { buildParamLabel, composeLegendParts } from '../paramLabel'
import {
    displayNameToBinding,
    KNOWN_BINDING_PREFIXES,
    prettyBehaviorName,
} from './displayNameToBinding'
import { behaviorToActionType } from './actionTypes'
import { decodeMouseDelta } from './mouseZmk'
import { ZMK_BEHAVIOR_LEGENDS, zmkShortMap } from './paramLabel'

export type BehaviorMap = Record<number, GetBehaviorDetailsResponse>

export interface ZmkBindingView {
    behaviorId: number
    param1: number
    param2: number
}

export function zmkBindingFromAction(action: KeyAction): ZmkBindingView {
    const behaviorId = Number.parseInt(action.kind, 10)
    return {
        behaviorId: Number.isNaN(behaviorId) ? 0 : behaviorId,
        param1: action.params[0] ?? 0,
        param2: action.params[1] ?? 0,
    }
}

function describeUsage(usage: number): string {
    const [pageMut, id] = hidUsagePageAndIdFromUsage(usage)
    const page = pageMut & 0xff
    const labels = hid_usage_get_labels(page, id)
    const long = labels.long || labels.med || labels.short
    return long ? long.replace(/^Keyboard /, '') : `0x${usage.toString(16)}`
}

function buildHoldTapLabelData(
    binding: BehaviorBinding,
    behavior: GetBehaviorDetailsResponse,
    slots: ActionSlot[],
    keymap: { layers: { name: string }[] },
): HoldTapLabelData | undefined {
    if (slots.length !== 2) return undefined
    const actionTypeName = behavior.displayName
    const actionLabel = displayNameToBinding(actionTypeName)
    const tapParam = binding.param2
    const holdParam = binding.param1
    const tapDesc = describeUsage(tapParam)

    if (slots[0].kind === 'layer') {
        const layerName = keymap.layers[holdParam]?.name
        const layerLabel = abbreviateLayerName(layerName, holdParam)
        const mo = formatMomentaryLayer(holdParam)
        const holdDesc = layerName ? `${mo} (${layerLabel})` : mo
        return {
            actionTypeName,
            actionLabel,
            tapParam,
            tapDesc,
            holdNodeKind: 'layer',
            holdParam,
            holdLayerLabel: layerLabel,
            holdLayerMomentary: mo,
            holdLayerName: layerName,
            tooltip: `${actionTypeName}\nTap: ${tapDesc}\nHold: ${holdDesc}`,
        }
    }

    const holdDesc = describeUsage(holdParam)
    return {
        actionTypeName,
        actionLabel,
        tapParam,
        tapDesc,
        holdNodeKind: 'usage',
        holdParam,
        holdUsageDesc: holdDesc,
        tooltip: `${actionTypeName}\nTap: ${tapDesc}\nHold: ${holdDesc}`,
    }
}

export function buildKeyLabel(
    binding: BehaviorBinding,
    behaviors: BehaviorMap,
    keymap: { layers: { name: string }[] },
): KeyLabel {
    const behavior = behaviors[binding.behaviorId]
    if (!behavior) {
        return { primary: 'Unknown', description: 'Unknown' }
    }
    const slots = behaviorToActionType(behavior).slots
    const bindingPrefix = displayNameToBinding(behavior.displayName)
    // A 2-slot behavior whose first slot is an enum is a COMMAND-style behavior
    // (e.g. &bt: Command + gated profile), not a hold-tap — mirrors the
    // discriminator in actionTypes.ts. Without this guard &bt renders through
    // the hold-tap path as garbage describeUsage() text (issue #147 / #148).
    const isCommandStyle = slots.length === 2 && slots[0].kind === 'enum'
    const holdTap = isCommandStyle
        ? undefined
        : buildHoldTapLabelData(binding, behavior, slots, keymap)
    if (holdTap) {
        return {
            primary: holdTap.tapDesc,
            secondary:
                holdTap.holdNodeKind === 'layer'
                    ? holdTap.holdLayerName
                        ? `${holdTap.holdLayerMomentary} (${holdTap.holdLayerLabel})`
                        : holdTap.holdLayerMomentary
                    : holdTap.holdUsageDesc,
            description: holdTap.tooltip,
            bindingPrefix,
            holdTap,
        }
    }
    // A custom behavior (macro / tap-dance / vendor) is any whose displayName
    // doesn't map to a built-in ZMK binding — displayNameToBinding falls back to
    // an &<slug> that isn't in the known set. Over the live Studio protocol a
    // macro surfaces only as its node name (e.g. "m_hello") with no params and no
    // steps, so render it as a "Macro" cap with the name as the legend.
    if (
        !holdTap &&
        bindingPrefix &&
        !KNOWN_BINDING_PREFIXES.includes(bindingPrefix)
    ) {
        return {
            primary: 'Macro',
            paramText: behavior.displayName,
            description: `Macro: ${behavior.displayName}`,
            bindingPrefix,
        }
    }
    // Mouse move / scroll expose no param metadata on hardware, so their packed
    // direction delta can't resolve through the enum path. Decode the known deltas
    // back to a direction glyph (behavior icon + arrow) — the same table the picker
    // synthesizes from, so the cap and the picker always agree.
    if (bindingPrefix === '&mmv' || bindingPrefix === '&msc') {
        const decoded = decodeMouseDelta(bindingPrefix, binding.param1)
        if (decoded) {
            const cmdPart = decoded.icon
                ? { icon: decoded.icon, text: decoded.label }
                : { text: decoded.label }
            const paramParts = composeLegendParts(
                { paramText: decoded.label, parts: [cmdPart] },
                ZMK_BEHAVIOR_LEGENDS[bindingPrefix],
            )
            const pretty = prettyBehaviorName(behavior.displayName)
            return {
                primary: pretty,
                paramText: decoded.label,
                ...(paramParts ? { paramParts } : {}),
                valueLong: decoded.label,
                description: `${pretty}: ${decoded.label}`,
                bindingPrefix,
            }
        }
    }
    const primaryUsage = slots[0]?.kind === 'hid' ? binding.param1 : undefined
    // Surface non-HID primary params (layer index, enum command, number) as a
    // short cap legend via the firmware-neutral engine.
    // Cap short-text/icon via a label-keyed map derived from this behavior's
    // enum values (value-keyed legends → the actual friendly/token labels), so
    // buildParamLabel resolves whether the firmware names values as friendly
    // phrases (hardware) or tokens (mock).
    const enumValues = slots[0]?.kind === 'enum' ? slots[0].values : undefined
    const param = buildParamLabel(
        slots,
        [binding.param1, binding.param2],
        (i) => keymap.layers[i]?.name,
        zmkShortMap(bindingPrefix, enumValues),
    )
    const pretty = prettyBehaviorName(behavior.displayName)
    const paramParts = composeLegendParts(
        param,
        ZMK_BEHAVIOR_LEGENDS[bindingPrefix],
    )
    return {
        primary: pretty,
        primaryUsage,
        ...(param.paramText ? { paramText: param.paramText } : {}),
        ...(paramParts ? { paramParts } : {}),
        ...(param.longText ? { valueLong: param.longText } : {}),
        description: param.longText ? `${pretty}: ${param.longText}` : pretty,
        bindingPrefix,
    }
}

export function bindingToKeyAction(
    binding: BehaviorBinding,
    behaviors: BehaviorMap,
    keymap: { layers: { name: string }[] },
): KeyAction {
    return {
        kind: String(binding.behaviorId),
        params: [binding.param1, binding.param2],
        label: buildKeyLabel(binding, behaviors, keymap),
    }
}

export function keyActionToBinding(action: KeyAction): BehaviorBinding {
    const view = zmkBindingFromAction(action)
    return {
        behaviorId: view.behaviorId,
        param1: view.param1,
        param2: view.param2,
    } as BehaviorBinding
}

export function bindingPrefix(behavior: GetBehaviorDetailsResponse): string {
    return displayNameToBinding(behavior.displayName)
}
