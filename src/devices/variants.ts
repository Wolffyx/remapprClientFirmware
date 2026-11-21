// Pattern check: no GoF pattern (-) — rejected — pure immutable edits over DeviceModel.layouts, the device twin of the keyboard builder's addLayout/removeLayout.
//
// Layout variants of a device design. A variant is the controls with no
// `variant` tag plus the ones tagged into it (see DeviceVariant).
import type { DeviceControl, DeviceModel, DeviceVariant } from './types'

/** `control` is part of `variant` ("" = every variant is shown). */
export function inVariant(control: DeviceControl, variant: string): boolean {
    return !variant || control.variant === undefined || control.variant === variant
}

/** The controls of `variant` ("" = all of them). */
export function variantControls(
    model: DeviceModel,
    variant: string,
): readonly DeviceControl[] {
    return model.controls.filter((c) => inVariant(c, variant))
}

const nextVariantId = (existing: readonly DeviceVariant[]): string => {
    const used = new Set(existing.map((v) => v.id))
    let n = existing.length + 1
    while (used.has(`variant_${n}`)) n++
    return `variant_${n}`
}

/** `model` with a new variant appended; returns its id too. */
export function addVariant(model: DeviceModel): {
    model: DeviceModel
    id: string
} {
    const layouts = model.layouts ?? []
    const id = nextVariantId(layouts)
    const variant: DeviceVariant = { id, name: `Variant ${layouts.length + 1}` }
    return { model: { ...model, layouts: [...layouts, variant] }, id }
}

export function renameVariant(
    model: DeviceModel,
    id: string,
    name: string,
): DeviceModel {
    const trimmed = name.trim()
    if (!trimmed || !model.layouts) return model
    return {
        ...model,
        layouts: model.layouts.map((v) =>
            v.id === id ? { ...v, name: trimmed } : v,
        ),
    }
}

/** `model` without variant `id`; its controls become common to every variant. */
export function removeVariant(model: DeviceModel, id: string): DeviceModel {
    const layouts = (model.layouts ?? []).filter((v) => v.id !== id)
    const controls = model.controls.map((c) => {
        if (c.variant !== id) return c
        const { variant: _drop, ...rest } = c
        return rest
    })
    const { layouts: _old, ...rest } = model
    return layouts.length
        ? { ...rest, controls, layouts }
        : { ...rest, controls }
}
