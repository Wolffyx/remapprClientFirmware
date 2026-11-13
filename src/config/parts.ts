// Pattern check: no GoF pattern (-) — rejected — how parts and non-key
// positions are drawn, as two lookup tables plus a pure lowering.
//
// Parts on a keyboard (config.keyboard.parts) and keymap positions that are
// not keycaps (a key's `element`) are drawn with the device editor's control
// shapes, in the builder and in the editor alike.
import type { ControlShape } from '../devices/types'
import type { PhysicalLayoutPart } from '../types'
import type { CanonGeometry, CanonPart, PartKind } from './types'

export const PART_SHAPE: Readonly<Record<PartKind, ControlShape>> = {
    display: 'screen',
    stick: 'stick',
    hat: 'hat',
    trigger: 'trigger',
}

/** How a keymap position that is not a keycap is drawn. */
export const ELEMENT_SHAPE: Readonly<
    Record<NonNullable<CanonGeometry['element']>, ControlShape>
> = {
    encoder: 'knob',
    slider: 'pill',
    button: 'round',
}

/** What a part shows on its face: a screen its size. */
export function partGlyph(p: CanonPart): string | undefined {
    return p.display ? `${p.display.width}×${p.display.height}` : undefined
}

/** A part lowered to the runtime layout (centi-units, centi-degrees). */
export function partToLayout(p: CanonPart): PhysicalLayoutPart {
    const cu = (v: number): number => Math.round(v * 100)
    const glyph = partGlyph(p)
    return {
        id: p.id,
        name: p.name,
        shape: PART_SHAPE[p.kind],
        x: cu(p.x),
        y: cu(p.y),
        w: cu(p.w),
        h: cu(p.h),
        ...(p.r ? { r: cu(p.r) } : {}),
        ...(glyph ? { glyph } : {}),
    }
}
