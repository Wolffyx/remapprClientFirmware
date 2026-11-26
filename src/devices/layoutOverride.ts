// Pattern check: no GoF pattern (-) — rejected — one small factory shared by every adapter that lets the user re-draw a device (validate, remember, notify); a plain closure over the base model.
//
// The ControlsLayoutApi most adapters want: the device reports a base layout
// (or gets the generic one); the user may replace it with one that keeps the
// same controls; the replacement is remembered under the adapter's key.
import { clearLayout, loadLayout, saveLayout } from './layoutCache'
import { layoutFits } from './schema'
import type { DeviceModel } from './types'
import type { ControlsLayoutApi } from '../service'

export interface LayoutOverride {
    /** The layout to draw now: the override, else the base. */
    model(): DeviceModel
    readonly api: ControlsLayoutApi
}

/** `key` = where to remember the override (omit to keep it for the session
 *  only); `onChanged` fires after an apply or a reset. */
export function createLayoutOverride(
    base: DeviceModel,
    opts: { key?: string; onChanged: () => void },
): LayoutOverride {
    const restored = opts.key ? loadLayout(opts.key) : null
    let current: DeviceModel | null =
        restored && !layoutFits(base, restored) ? restored : null
    return {
        model: () => current ?? base,
        api: {
            apply: (model) => {
                const misfit = layoutFits(base, model)
                if (misfit) return Promise.reject(new Error(misfit))
                const { defaulted: _d, hidSummary: _h, ...own } = model
                current = { ...own, kind: base.kind }
                if (opts.key) saveLayout(opts.key, current)
                opts.onChanged()
                return Promise.resolve()
            },
            reset: () => {
                current = null
                if (opts.key) clearLayout(opts.key)
                opts.onChanged()
                return Promise.resolve()
            },
            overridden: () => current !== null,
        },
    }
}
