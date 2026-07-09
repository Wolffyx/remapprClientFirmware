// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/adapter.ts FirmwareAdapter; translates ZMK GetBehaviorDetailsResponse → neutral ActionType.
import type {
    BehaviorBindingParametersSet,
    BehaviorParameterValueDescription,
    GetBehaviorDetailsResponse,
} from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import type { ActionSlot, ActionSlotKind, ActionType } from '@firmware/types'
import { hidUsagePageAndIdFromUsage } from '@firmware/_app/lib/actions/hidUsages'
import { MOUSE_COMMANDS } from '@firmware/mouseCommands'
import {
    displayNameToBinding,
    KNOWN_BINDING_PREFIXES,
    prettyBehaviorName,
} from './displayNameToBinding'
import { mouseCanonToZmk } from './mouseZmk'
import {
    ZMK_BEHAVIOR_LEGENDS,
    zmkCommandLegend,
    zmkTokenIcon,
} from './paramLabel'

const MODIFIER_DISPLAY_NAME = 'Modifier'

function describeSlotKind(
    behaviorDisplayName: string,
    descriptions: BehaviorParameterValueDescription[],
): ActionSlotKind {
    if (behaviorDisplayName === MODIFIER_DISPLAY_NAME) return 'modifier'
    if (descriptions.some((d) => d.hidUsage)) return 'hid'
    if (descriptions.some((d) => d.layerId)) return 'layer'
    if (descriptions.some((d) => d.range)) return 'number'
    if (descriptions.some((d) => d.constant !== undefined)) return 'enum'
    return 'enum'
}

function buildSlot(
    label: string,
    behaviorDisplayName: string,
    descriptions: BehaviorParameterValueDescription[],
): ActionSlot | undefined {
    if (!descriptions || descriptions.length === 0) return undefined
    const onlyNil =
        descriptions.length === 1 &&
        descriptions[0].nil !== undefined &&
        descriptions[0].constant === undefined
    if (onlyNil) return undefined

    const kind = describeSlotKind(behaviorDisplayName, descriptions)
    // First non-empty name — a merged column may lead with a nameless nil
    // (e.g. &bt's no-arg set) before the descriptor that actually names it.
    const namedLabel = descriptions
        .map((d) => d.name?.toString().trim())
        .find((n) => n && n.length > 0)
    const slot: ActionSlot = {
        label: namedLabel && namedLabel.length > 0 ? namedLabel : label,
        kind,
    }

    const range = descriptions.find((d) => d.range)?.range
    if (range) slot.range = { min: range.min, max: range.max }

    // Command icon by value label first (token-named on the mock / fixtures,
    // whose constants may differ from a live device) then by (behavior &prefix,
    // constant) — the robust path for ZMK's friendly hardware value names.
    const prefix = displayNameToBinding(behaviorDisplayName)
    const enumValues = descriptions
        .filter((d) => d.constant !== undefined)
        .map((d) => {
            const icon =
                zmkTokenIcon(d.name) ??
                zmkCommandLegend(prefix, d.constant)?.icon
            return icon
                ? { value: d.constant as number, label: d.name, icon }
                : { value: d.constant as number, label: d.name }
        })
    if (enumValues.length > 0) slot.values = enumValues

    return slot
}

// A param slot is "real" when it carries at least one non-nil description.
function hasRealParams(
    descriptions?: BehaviorParameterValueDescription[],
): boolean {
    if (!descriptions || descriptions.length === 0) return false
    const onlyNil =
        descriptions.length === 1 &&
        descriptions[0].nil !== undefined &&
        descriptions[0].constant === undefined
    return !onlyNil
}

// Flatten a param column across every metadata set, de-duped so each constant
// / range / hid / layer appears once. ZMK splits a behavior into one set per
// valid (param1, param2) shape — e.g. &bt has a no-arg set plus a BT_SEL set
// whose param2 is the profile index — and only the union exposes them all.
function mergeDescriptions(
    sets: BehaviorBindingParametersSet[],
    pick: (
        s: BehaviorBindingParametersSet,
    ) => BehaviorParameterValueDescription[] | undefined,
): BehaviorParameterValueDescription[] {
    const out: BehaviorParameterValueDescription[] = []
    const seen = new Set<string>()
    for (const set of sets) {
        for (const d of pick(set) ?? []) {
            const key =
                d.constant !== undefined
                    ? `c:${d.constant}`
                    : `k:${d.name ?? ''}:${
                          d.range
                              ? `r${d.range.min}-${d.range.max}`
                              : d.hidUsage
                                ? 'hid'
                                : d.layerId
                                  ? 'layer'
                                  : d.nil
                                    ? 'nil'
                                    : '?'
                      }`
            if (seen.has(key)) continue
            seen.add(key)
            out.push(d)
        }
    }
    return out
}

// param1 command values whose set also defines a param2, when at least one
// other set has none — i.e. the trailing slot is conditional on the command.
// Returns undefined when param2 always (or never) applies.
function conditionalParam1Values(
    sets: BehaviorBindingParametersSet[],
): number[] | undefined {
    const enablers: number[] = []
    let anyWithoutParam2 = false
    for (const set of sets) {
        if (hasRealParams(set.param2)) {
            for (const d of set.param1 ?? []) {
                if (d.constant !== undefined) enablers.push(d.constant)
            }
        } else {
            anyWithoutParam2 = true
        }
    }
    if (!anyWithoutParam2 || enablers.length === 0) return undefined
    return Array.from(new Set(enablers))
}

export function behaviorToActionType(
    behavior: GetBehaviorDetailsResponse,
): ActionType {
    const sets = behavior.metadata ?? []
    const slots: ActionSlot[] = []
    const p1 = buildSlot(
        'param1',
        behavior.displayName,
        mergeDescriptions(sets, (s) => s.param1),
    )
    if (p1) slots.push(p1)
    const p2 = buildSlot(
        'param2',
        behavior.displayName,
        mergeDescriptions(sets, (s) => s.param2),
    )
    if (p2) slots.push(p2)

    if (slots.length === 2 && slots[0].kind === 'enum') {
        // Command-style behavior (e.g. &bt), not a hold-tap. Gate the trailing
        // slot on the commands that actually take it and label by role.
        const enabledFor = conditionalParam1Values(sets)
        // &bt's profile is a 0-based index but reads naturally as 1..N; surface
        // it one-based (the raw index is still what we store / send). Keyed on
        // the behavior identity, not the range, so other numeric params are
        // unaffected. displayName 'Bluetooth' is &bt (see displayNameToBinding).
        const oneBasedProfile =
            behavior.displayName === 'Bluetooth' && slots[1].kind === 'number'
        slots[0] = { ...slots[0], label: 'Command' }
        slots[1] = {
            ...slots[1],
            label:
                slots[1].label && slots[1].label !== 'param2'
                    ? slots[1].label
                    : 'Value',
            ...(enabledFor ? { enabledFor } : {}),
            ...(oneBasedProfile ? { oneBased: true } : {}),
        }
    } else if (slots.length === 2) {
        slots[0] = { ...slots[0], label: 'Hold' }
        slots[1] = { ...slots[1], label: 'Tap' }
    }
    const icon = ZMK_BEHAVIOR_LEGENDS[displayNameToBinding(behavior.displayName)]
        ?.icon
    return {
        id: String(behavior.id),
        displayName: prettyBehaviorName(behavior.displayName),
        ...(icon ? { icon } : {}),
        slots,
    }
}

export function behaviorsToActionTypes(
    behaviors: Record<number, GetBehaviorDetailsResponse>,
): ActionType[] {
    return Object.values(behaviors).map(behaviorToActionType)
}

// The ZMK mouse bindings the unified Mouse dropdown folds into one behavior.
const MOUSE_BINDINGS = new Set<string>(['&mkp', '&mmv', '&msc'])

/**
 * Synthesize the composite "Mouse" ActionType from the live behaviors: one enum
 * "Command" slot whose values each carry a {@link BehaviorRef} dispatching to the
 * real &mkp / &mmv / &msc behavior (button mask or packed move/scroll delta), plus
 * any `/mouse/i` user macro folded in as a command. Returns undefined when the
 * device exposes none of these — so a non-mouse keyboard gets no Mouse entry.
 *
 * Behavior ids are per-firmware, so they're resolved here from displayName, never
 * hardcoded. Picking a value emits its behaviorRef verbatim (KeyActionPicker), which
 * is why the raw &mkp / &mmv / &msc types are hidden from the dropdown.
 */
export function synthesizeMouseActionType(
    behaviors: Record<number, GetBehaviorDetailsResponse>,
): ActionType | undefined {
    // Resolve the runtime id for each mouse binding + collect /mouse/i macros.
    const idFor = new Map<string, number>()
    const macros: { id: number; name: string }[] = []
    for (const b of Object.values(behaviors)) {
        const binding = displayNameToBinding(b.displayName)
        if (MOUSE_BINDINGS.has(binding)) {
            if (!idFor.has(binding)) idFor.set(binding, b.id)
        } else if (
            !KNOWN_BINDING_PREFIXES.includes(binding) &&
            /mouse/i.test(b.displayName)
        ) {
            macros.push({ id: b.id, name: prettyBehaviorName(b.displayName) })
        }
    }
    if (idFor.size === 0 && macros.length === 0) return undefined

    const values: NonNullable<ActionSlot['values']> = []
    for (const c of MOUSE_COMMANDS) {
        const enc = mouseCanonToZmk(c.canon)
        if (!enc) continue
        const id = idFor.get(enc.binding)
        if (id === undefined) continue // binding not present on this device
        values.push({
            value: values.length,
            label: c.label,
            ...(c.icon ? { icon: c.icon } : {}),
            behaviorRef: { kind: String(id), params: [enc.param] },
        })
    }
    for (const m of macros) {
        values.push({
            value: values.length,
            label: m.name,
            behaviorRef: { kind: String(m.id), params: [] },
        })
    }
    if (values.length === 0) return undefined

    return {
        id: 'mouse',
        displayName: 'Mouse',
        icon: 'mouse-button',
        slots: [{ label: 'Command', kind: 'enum', values }],
    }
}

export function validateSlotValue(
    layerIds: number[],
    value: number | undefined,
    descriptions?: BehaviorParameterValueDescription[],
): boolean {
    if (value === undefined) {
        return (
            descriptions === undefined ||
            descriptions.length === 0 ||
            !!descriptions[0].nil
        )
    }
    const matching = descriptions?.find((v) => {
        if (v.constant !== undefined) return v.constant === value
        if (v.range) return value >= v.range.min && value <= v.range.max
        if (v.hidUsage) {
            const [page, id] = hidUsagePageAndIdFromUsage(value)
            return page !== 0 && id !== 0
        }
        if (v.layerId) return layerIds.includes(value)
        if (v.nil) return value === 0
        return false
    })
    return (
        !!matching ||
        (value === 0 && (!descriptions || descriptions.length === 0))
    )
}
