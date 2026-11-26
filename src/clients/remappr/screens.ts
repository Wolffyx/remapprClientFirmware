// Pattern check: Facade (Tier 1) — applied — buildScreensApi assembles the screen registry, the canvas mirror, the dither and the TBL_DISPLAY checks behind ScreensApi, as HostValuesApi does for HOST.
//
// The screens facade (display part design §5): the device's display parts
// with their panel size (GET_IO DISPLAY a / b), the values a widget can show,
// and the drawing an editor previews with — the firmware's own rules, from
// screenPreview.ts.
import type { ScreenPanel, ScreensApi, SensorApi } from '../../service'
import type { SensorInfo } from '../../devices/types'
import { encodeDisplays } from '../../config/compilers/remappr/display'
import { SCREEN_SOURCES } from './screenRegistry'
import { imageFromRgba, SCREEN_IMAGE_MAX } from './screenImage'
import {
    logicalSize,
    logicalToPanelRect,
    panelToLogical,
    renderScreenPage,
} from './screenPreview'

/** The device's display parts with their panel size; a part that reports no
 *  size is left out. */
export function screenPanels(parts: readonly SensorInfo[]): ScreenPanel[] {
    return parts.flatMap((p) => {
        if (p.cls !== 'display') return []
        const io = p.io.find((x) => x.kind === 'display')
        if (!io || io.a <= 0 || io.b <= 0) return []
        return [{ part: p.index, model: p.model, width: io.a, height: io.b, info: p }]
    })
}

const SOURCES = SCREEN_SOURCES.map((s) => ({
    name: s.name,
    label: s.label,
    from: s.name.startsWith('host.') ? ('host' as const) : ('device' as const),
}))

/** The screens facade; `sensor` reads the parts (none without it). */
export function buildScreensApi(sensor: SensorApi | undefined): ScreensApi {
    return {
        async displays() {
            return sensor ? screenPanels(await sensor.getSensors()) : []
        },
        sources: SOURCES,
        imageMax: SCREEN_IMAGE_MAX,
        logicalSize,
        render: renderScreenPage,
        panelToLogical: (px, py, o) => panelToLogical(px, py, o.width, o.height, o.rotation),
        panelBox: (box, o) => logicalToPanelRect(box, o.width, o.height, o.rotation),
        image: (rgba, width, height, opts) => imageFromRgba(rgba, width, height, opts),
        problems: (displays) => encodeDisplays(displays).problems,
    }
}
