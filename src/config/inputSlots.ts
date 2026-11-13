// Pattern check: no GoF pattern (-) — rejected — two one-line compositions so a geometry edit keeps every input's slots (knobs, sliders) in one call.
//
// Every input that lives in a slot list (knobs.ts, sliders.ts), synced or
// renumbered together after an edit to the keys.
import { remapKnobKeys, syncKnobs } from './knobs'
import { remapSliderKeys, syncSliders } from './sliders'
import type { ConfigKeymap } from './types'

/** Knob and slider slots in line with the keys (see syncKnobs / syncSliders). */
export function syncInputSlots(config: ConfigKeymap): ConfigKeymap {
    return syncSliders(syncKnobs(config))
}

/** Knob and slider slot links following a key renumbering (`remap[old] =
 *  new`, -1 = removed), then re-synced. */
export function remapInputKeys(
    config: ConfigKeymap,
    remap: readonly number[],
): ConfigKeymap {
    return remapSliderKeys(remapKnobKeys(config, remap), remap)
}
