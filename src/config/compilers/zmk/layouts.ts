// Pattern check: no GoF pattern (-) — rejected — pure planning function (variant key sets, off-end slot allocation, position-map lines) shared by the ZMK overlay and keymap emitters.
//
// The ZMK physical layouts of a board. With no builder variants
// (`keyboard.layouts`) there is one layout holding every key. With variants,
// each becomes its own `zmk,physical-layout` (the keys common to all plus the
// ones tagged into it) with its own matrix transform; the first is the default
// (`chosen`). The `.keymap` is written in the default layout's key order.
//
// A `zmk,physical-layout-position-map` ties the layouts together so Studio keeps
// every binding when it switches layout. A key a layout lacks gets a slot "off
// the end" of that layout (ZMK keeps it, unseen); the keymap holds
// ZMK_KEYMAP_LEN = the longest layout's key count, so there are only that many
// slots. A key that does not fit is left to ZMK's own match by position.
import type { DiagnosticBag } from '../../diagnostics'
import type { ConfigKeymap } from '../../types'
import { dtsString, sanitize } from './maps'

export interface ZmkLayout {
    /** devicetree label of the `zmk,physical-layout` node. */
    readonly label: string
    readonly transformLabel: string
    /** `keymap_transform_<n>` node name. */
    readonly transformNode: string
    readonly name: string
    /** Config key indices, in key order. */
    readonly keys: readonly number[]
}

export interface ZmkLayoutPlan {
    /** The first one is the default. */
    readonly layouts: readonly ZmkLayout[]
    /** Config key index at each `.keymap` binding position: the default
     *  layout's keys, then the keys it keeps off its end. */
    readonly keymapKeys: readonly number[]
    /** The position-map node; [] with a single layout. */
    readonly positionMap: readonly string[]
}

const SINGLE = (config: ConfigKeymap): ZmkLayoutPlan => {
    const keys = config.keyboard.keys.map((_, i) => i)
    return {
        layouts: [
            {
                label: 'physical_layout_default',
                transformLabel: 'default_transform',
                transformNode: 'keymap_transform_0',
                name: config.keyboard.name,
                keys,
            },
        ],
        keymapKeys: keys,
        positionMap: [],
    }
}

/** Each variant's keys: the untagged ones plus its own. A key tagged into a
 *  variant that does not exist is treated as common (and warned). */
function variantLayouts(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): ZmkLayout[] {
    const variants = config.keyboard.layouts ?? []
    const ids = new Set(variants.map((v) => v.id))
    config.keyboard.keys.forEach((k, i) => {
        if (k.variant && !ids.has(k.variant)) {
            diag.warn(
                `key ${i} is tagged into unknown layout variant "${k.variant}"; it is in every layout`,
                ['keyboard', 'keys', i, 'variant'],
            )
        }
    })
    return variants.map((v, n) => {
        const id = sanitize(v.id)
        return {
            label: `physical_layout_${id}`,
            transformLabel: `transform_${id}`,
            transformNode: `keymap_transform_${n}`,
            name: v.name,
            keys: config.keyboard.keys
                .map((k, i) =>
                    !k.variant || !ids.has(k.variant) || k.variant === v.id
                        ? i
                        : -1,
                )
                .filter((i) => i >= 0),
        }
    })
}

interface Slots {
    /** Per layout: config key → position (real or off the end). */
    readonly byLayout: Map<number, number>[]
    /** Config keys every layout found a slot for, in key order. */
    readonly mapped: number[]
    readonly complete: boolean
}

function allocateSlots(layouts: readonly ZmkLayout[], total: number): Slots {
    const byLayout = layouts.map(
        (l) => new Map(l.keys.map((k, pos) => [k, pos])),
    )
    const maxLen = Math.max(...layouts.map((l) => l.keys.length))
    const next = layouts.map((l) => l.keys.length)
    const mapped: number[] = []
    let complete = true
    for (let key = 0; key < total; key++) {
        const missing = byLayout.flatMap((m, li) => (m.has(key) ? [] : [li]))
        if (missing.length === layouts.length) continue // in no layout
        if (missing.some((li) => next[li]! >= maxLen)) {
            complete = false
            continue
        }
        for (const li of missing) byLayout[li]!.set(key, next[li]!++)
        mapped.push(key)
    }
    return { byLayout, mapped, complete }
}

function positionMapLines(
    layouts: readonly ZmkLayout[],
    slots: Slots,
): string[] {
    const children = layouts.flatMap((l, li) => {
        const positions = slots.mapped.map((k) => slots.byLayout[li]!.get(k))
        return [
            `        ${l.label}_map {`,
            `            physical-layout = <&${l.label}>;`,
            `            positions = <${positions.join(' ')}>;`,
            `        };`,
        ]
    })
    return [
        `    layout_position_map {`,
        `        compatible = "zmk,physical-layout-position-map";`,
        ...(slots.complete ? [`        complete;`] : []),
        ``,
        ...children,
        `    };`,
    ]
}

export function planLayouts(
    config: ConfigKeymap,
    diag: DiagnosticBag,
): ZmkLayoutPlan {
    if (!config.keyboard.layouts?.length) return SINGLE(config)
    const layouts = variantLayouts(config, diag)
    const total = config.keyboard.keys.length
    const slots = allocateSlots(layouts, total)
    if (!slots.complete) {
        diag.warn(
            'some variant-only keys do not fit off the end of every layout; ' +
                'ZMK matches their bindings by position when the layout changes',
            ['keyboard', 'layouts'],
        )
    }
    const def = slots.byLayout[0]!
    const keymapKeys = [...def.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k)
    return {
        layouts,
        keymapKeys,
        positionMap:
            layouts.length > 1 ? positionMapLines(layouts, slots) : [],
    }
}

/** Config key index → `.keymap` position, for key-position lists (combos,
 *  hold-trigger positions). */
export function keymapPositions(plan: ZmkLayoutPlan): Map<number, number> {
    return new Map(plan.keymapKeys.map((k, pos) => [k, pos]))
}

/** The `zmk,physical-layout` node for `layout`. */
export function physicalLayoutNode(
    config: ConfigKeymap,
    layout: ZmkLayout,
): string[] {
    const cu = (n: number): number => Math.round(n * 100) // key units -> centi-units
    const keyLines = layout.keys.map((ki, i) => {
        const k = config.keyboard.keys[ki]!
        const attrs =
            `<&key_physical_attrs ${cu(k.w)} ${cu(k.h)} ${cu(k.x)} ${cu(k.y)} ` +
            `${cu(k.r)} ${cu(k.rx ?? 0)} ${cu(k.ry ?? 0)}>`
        return `            ${i === 0 ? '=' : ','} ${attrs}`
    })
    return [
        `    ${layout.label}: ${layout.label} {`,
        `        compatible = "zmk,physical-layout";`,
        `        display-name = "${dtsString(layout.name)}";`,
        `        transform = <&${layout.transformLabel}>;`,
        `        keys`,
        ...keyLines,
        `            ;`,
        `    };`,
    ]
}
