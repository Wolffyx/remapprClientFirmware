// Pattern check: Adapter (Tier 1) — applied — converts the keymap runtime's
// PhysicalLayout (centi-units, pivot rotation) into the device-controls model
// (key units, rotation about each control's own centre).
//
// Lets a keyboard or macro pad be drawn with the device stage (start-page
// previews, demo tiles) without a second geometry engine.
import { FORM_KIND } from './defaultLayout'
import { control } from './stockLayouts'
import type { DeviceControl, DeviceForm, DeviceModel } from './types'
import type { PhysicalLayout, PhysicalLayoutKey } from '../types'

/** Firmware layouts are in centi-units (1U = 100) and centi-degrees. */
const CENTI = 100

const round = (v: number): number => Math.round(v * 1000) / 1000

/** A key rotated about its pivot (rx, ry; default its top-left) becomes the same
 *  key rotated about its own centre: move the box so its centre lands where the
 *  pivot rotation put it. */
function keyControl(key: PhysicalLayoutKey, index: number): DeviceControl {
    const [x, y, w, h] = [
        key.x / CENTI,
        key.y / CENTI,
        key.w / CENTI,
        key.h / CENTI,
    ]
    const r = (key.r ?? 0) / CENTI
    const name = `Key ${index + 1}`
    if (!r)
        return control(`k${index}`, name, 'button', 'key', [
            round(x),
            round(y),
            round(w),
            round(h),
        ])
    const px = (key.rx || key.x) / CENTI
    const py = (key.ry || key.y) / CENTI
    const a = (r * Math.PI) / 180
    const [dx, dy] = [x + w / 2 - px, y + h / 2 - py]
    const cx = px + dx * Math.cos(a) - dy * Math.sin(a)
    const cy = py + dx * Math.sin(a) + dy * Math.cos(a)
    return control(
        `k${index}`,
        name,
        'button',
        'key',
        [round(cx - w / 2), round(cy - h / 2), round(w), round(h)],
        { r: round(r) },
    )
}

/** A keyboard's physical layout as a device model: keys become key-shaped
 *  buttons (`k<position>`), encoders become knobs (`e<index>`). */
export function fromPhysicalLayout(
    layout: PhysicalLayout,
    opts: { name: string; form?: Extract<DeviceForm, 'keyboard' | 'macropad'> },
): DeviceModel {
    const form = opts.form ?? 'keyboard'
    const keys = layout.keys.map(keyControl)
    const knobs = (layout.encoders ?? []).map((e, i) =>
        control(`e${i}`, `Encoder ${i + 1}`, 'encoder', 'knob', [
            round(e.x / CENTI),
            round(e.y / CENTI),
            1,
            1,
        ]),
    )
    return {
        kind: FORM_KIND[form],
        form,
        name: opts.name,
        shell: { type: 'plate', pad: 0.3 },
        controls: [...knobs, ...keys],
    }
}
