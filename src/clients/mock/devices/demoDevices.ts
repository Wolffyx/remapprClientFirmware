// Pattern check: Dispatch Map (Tier 0) — applied — demo id → connect factory table; Try Demo picks one entry instead of branching per device.
//
// Every device Try Demo offers: the Corne keyboard, the Deck 9 macro pad, and
// the mouse / gamepad / flight stick / generic-gamepad demo devices. The app
// renders the list and connects through connectDemoDevice; it never imports a
// mock class.
import { parseKeymap } from '@firmware/config'
import type { ConfigKeymap } from '@firmware/config'
import { fromPhysicalLayout } from '@firmware/devices/fromPhysicalLayout'
import type {
    ControlsCatalog,
    DeviceBindings,
    DeviceForm,
    DeviceKind,
    DeviceModel,
} from '@firmware/devices/types'
import type { KeyboardService } from '@firmware/service'
import { connectMock } from '../adapter'
import { configToPhysicalLayout } from '../configBridge'
import seedSource from '../seed.keymap.json?raw'
import { MockKeyboardService, type MockServiceOptions } from '../service'
import { APEX_STICK } from './apexStick'
import deck9Source from './deck9.keymap.json?raw'
import { GENERIC_GAMEPAD } from './genericGamepad'
import { HALO_M2 } from './haloM2'
import { MockDeviceService } from './MockDeviceService'
import { demoCatalog } from './catalog'
import type { DemoDeviceDef } from './types'
import { VECTOR_PAD } from './vectorPad'

export type DemoDeviceId =
    | 'corne'
    | 'deck9'
    | 'halo-m2'
    | 'vector-pad'
    | 'apex-stick'
    | 'generic-gamepad'

export interface DemoDevice {
    readonly id: DemoDeviceId
    readonly name: string
    readonly kind: DeviceKind
    readonly form: DeviceForm
    /** False: the device reports no layout and opens on a generic one. */
    readonly ready: boolean
}

/** What a start-page tile draws: the layout, tinted by its default bindings. */
export interface DemoDevicePreview {
    readonly model: DeviceModel
    readonly bindings: DeviceBindings
    readonly catalog: ControlsCatalog
}

interface Entry extends DemoDevice {
    model(): DeviceModel
    bindings: DeviceBindings
    /** Absent = the demo catalog of the model's form. */
    catalog?: ControlsCatalog
    connect(opts?: MockServiceOptions): Promise<KeyboardService>
}

let deck9: ConfigKeymap | undefined
let corne: ConfigKeymap | undefined
const deck9Config = (): ConfigKeymap => (deck9 ??= parseKeymap(deck9Source))
const corneConfig = (): ConfigKeymap => (corne ??= parseKeymap(seedSource))

function keyboardEntry(
    id: 'corne' | 'deck9',
    name: string,
    form: 'keyboard' | 'macropad',
    config: () => ConfigKeymap,
    connect: Entry['connect'],
): Entry {
    return {
        id,
        name,
        kind: 'keyboard',
        form,
        ready: true,
        bindings: {},
        model: () =>
            fromPhysicalLayout(configToPhysicalLayout(config()), {
                name,
                form,
            }),
        connect,
    }
}

function deviceEntry(id: DemoDeviceId, def: DemoDeviceDef): Entry {
    return {
        id,
        name: def.model.name,
        kind: def.model.kind,
        form: def.model.form,
        ready: !def.model.defaulted,
        bindings: def.bindings,
        ...(def.catalog ? { catalog: def.catalog } : {}),
        model: () => def.model,
        connect: () => Promise.resolve(new MockDeviceService(def)),
    }
}

const ENTRIES: readonly Entry[] = [
    keyboardEntry('corne', 'Corne', 'keyboard', corneConfig, (opts) =>
        connectMock(opts),
    ),
    keyboardEntry('deck9', 'Deck 9', 'macropad', deck9Config, (opts) =>
        Promise.resolve(
            new MockKeyboardService({ ...opts, seedConfig: deck9Config() }),
        ),
    ),
    deviceEntry('halo-m2', HALO_M2),
    deviceEntry('vector-pad', VECTOR_PAD),
    deviceEntry('apex-stick', APEX_STICK),
    deviceEntry('generic-gamepad', GENERIC_GAMEPAD),
]

const byId = new Map(ENTRIES.map((e) => [e.id, e]))

function entry(id: DemoDeviceId): Entry {
    const e = byId.get(id)
    if (!e) throw new Error(`Unknown demo device ${id}`)
    return e
}

/** The devices Try Demo offers, in display order. */
export const DEMO_DEVICES: readonly DemoDevice[] = ENTRIES.map(
    ({ id, name, kind, form, ready }) => ({ id, name, kind, form, ready }),
)

/** The demo device's layout as a device model (for previews). */
export function demoDeviceModel(id: DemoDeviceId): DeviceModel {
    return entry(id).model()
}

/** The demo device's tile preview: layout, default bindings and catalog. */
export function demoDevicePreview(id: DemoDeviceId): DemoDevicePreview {
    const e = entry(id)
    const model = e.model()
    return {
        model,
        bindings: e.bindings,
        catalog: e.catalog ?? demoCatalog(model.form),
    }
}

/** Builder "Open in editor": a session-only device drawn from `model`, every
 *  control on its kind's default binding. */
export function connectMockDeviceWithModel(
    model: DeviceModel,
): KeyboardService {
    const { defaulted: _d, hidSummary: _h, ...own } = model
    return new MockDeviceService({
        id: 'builder',
        model: own,
        bindings: {},
        profiles: ['Default'],
        firmwareVersion: 'builder',
        transport: 'usb',
        editable: true,
    })
}

/** Connect the demo device `id`. `opts` (a simulated lock …) applies to the
 *  demo keyboards. */
export function connectDemoDevice(
    id: DemoDeviceId,
    opts?: MockServiceOptions,
): Promise<KeyboardService> {
    return entry(id).connect(opts)
}
