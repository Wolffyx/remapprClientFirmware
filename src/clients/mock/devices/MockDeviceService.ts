// Pattern check: Template Method (Tier 1) — extended — fills src/devices/keylessService.ts KeylessServiceBase with an in-memory demo device.
//
// A simulated mouse / gamepad / flight stick for Try Demo. Edits live for the
// session (saveMode 'none', like the demo keyboard); a definition marked not
// editable stands in for a generic HID device and leaves the write methods out.
import { KeylessServiceBase } from '@firmware/devices/keylessService'
import {
    createLayoutOverride,
    type LayoutOverride,
} from '@firmware/devices/layoutOverride'
import type {
    ControlBinding,
    ControlsChange,
    DeviceBindings,
    DeviceKind,
    DeviceProfile,
} from '@firmware/devices/types'
import type {
    Capabilities,
    ControlsApi,
    SensorApi,
    WirelessApi,
} from '@firmware/service'
import type { DeviceInfo, ExportedFile } from '@firmware/types'
import { demoCatalog } from './catalog'
import { DemoSensor } from './demoSensor'
import { LiveInputSim } from './liveSim'
import type { DemoDeviceDef, ProfileOverrides } from './types'

/** `base` with a profile's per-control changes applied; an `undefined` field in
 *  a change removes that field (e.g. drops a hold action). */
function applyOverrides(
    base: DeviceBindings,
    overrides: ProfileOverrides = {},
): DeviceBindings {
    const out: Record<string, ControlBinding> = { ...base }
    for (const [id, change] of Object.entries(overrides)) {
        const merged: Record<string, unknown> = { ...out[id], ...change }
        for (const [k, v] of Object.entries(change)) {
            if (v === undefined) delete merged[k]
        }
        out[id] = merged as unknown as ControlBinding
    }
    return out
}

interface Seed {
    profiles: DeviceProfile[]
    bindings: Map<string, DeviceBindings>
}

function seed(def: DemoDeviceDef): Seed {
    const profiles = def.profiles.map((name, i) => ({ id: `p${i}`, name }))
    const bindings = new Map(
        profiles.map((p, i) => [
            p.id,
            applyOverrides(def.bindings, def.overrides?.[i]),
        ]),
    )
    return { profiles, bindings }
}

function demoWireless(def: DemoDeviceDef): WirelessApi | undefined {
    if (def.battery === undefined) return undefined
    const status = {
        transport: def.transport,
        battery: { level: def.battery, charging: false },
    }
    return {
        getLpm: () => Promise.resolve({ enabled: false, timeoutMs: 0 }),
        setLpm: () => Promise.resolve(),
        getStatus: () => Promise.resolve(status),
        onStatusChanged: () => () => {},
    }
}

export class MockDeviceService extends KeylessServiceBase {
    readonly kind: DeviceKind
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities
    readonly controls: ControlsApi
    readonly wireless?: WirelessApi
    /** The demo sensor, on a device whose catalog describes one with
     *  procedures (the demo mouse). */
    readonly sensor?: SensorApi

    private profiles: DeviceProfile[]
    private activeId: string
    private bindings: Map<string, DeviceBindings>
    private readonly changeListeners = new Set<(c: ControlsChange) => void>()
    private readonly sim: LiveInputSim
    private readonly layout: LayoutOverride

    constructor(private readonly def: DemoDeviceDef) {
        super()
        this.kind = def.model.kind
        this.deviceInfo = {
            name: def.model.name,
            firmware: 'mock',
            firmwareVersion: def.firmwareVersion,
            serialNumber: `DEMO-${def.id}`,
        }
        this.capabilities = {
            lock: 'none',
            rename: false,
            notifications: false,
            reorderLayers: false,
            variableLayerCount: false,
            exportFormats: ['json'],
            saveMode: 'none',
            demo: true,
            ...(def.editable ? {} : { readOnly: true }),
        }
        const s = seed(def)
        this.profiles = s.profiles
        this.bindings = s.bindings
        this.activeId = s.profiles[0]!.id
        this.sim = new LiveInputSim(def.model.controls)
        // The demo keeps a re-drawn layout for the session only.
        this.layout = createLayoutOverride(def.model, {
            onChanged: () => this.changed({ type: 'model' }),
        })
        this.wireless = demoWireless(def)
        const described = (def.catalog ?? demoCatalog(def.model.form)).sensor
        if (def.model.form === 'mouse' && described?.procedures.length) {
            this.sensor = new DemoSensor(described)
        }
        this.controls = def.editable
            ? this.editableControls()
            : this.readControls()
    }

    override resetSettings(): Promise<void> {
        const s = seed(this.def)
        this.profiles = s.profiles
        this.bindings = s.bindings
        this.activeId = s.profiles[0]!.id
        this.changed({ type: 'profiles' })
        return Promise.resolve()
    }

    override exportConfig(): Promise<ExportedFile[]> {
        const doc = {
            app: 'Remappr',
            device: this.def.model.name,
            profiles: this.profiles.map((p) => ({
                name: p.name,
                bindings: this.bindings.get(p.id),
            })),
        }
        return Promise.resolve([
            {
                filename: `${this.def.model.name}.profiles.json`,
                mime: 'application/json',
                content: JSON.stringify(doc, null, 2),
            },
        ])
    }

    protected override close(): Promise<void> {
        this.sim.dispose()
        this.changeListeners.clear()
        return Promise.resolve()
    }

    private changed(change: ControlsChange): void {
        for (const cb of [...this.changeListeners]) cb(change)
    }

    private profileBindings(profileId: string): DeviceBindings {
        const b = this.bindings.get(profileId)
        if (!b) throw new Error(`Unknown profile ${profileId}`)
        return b
    }

    /** The read half every demo device has. */
    private readControls(): ControlsApi {
        return {
            getModel: () => Promise.resolve(this.layout.model()),
            getCatalog: () =>
                Promise.resolve(
                    this.def.catalog ?? demoCatalog(this.def.model.form),
                ),
            getProfiles: () =>
                Promise.resolve({
                    profiles: [...this.profiles],
                    activeId: this.activeId,
                }),
            getBindings: (id) => Promise.resolve(this.profileBindings(id)),
            onChanged: (cb) => {
                this.changeListeners.add(cb)
                return () => {
                    this.changeListeners.delete(cb)
                }
            },
            onInput: (cb) => this.sim.subscribe(cb),
            layout: this.layout.api,
        }
    }

    private editableControls(): ControlsApi {
        return {
            ...this.readControls(),
            setBinding: (profileId, controlId, binding) => {
                const current = this.profileBindings(profileId)
                this.bindings.set(profileId, {
                    ...current,
                    [controlId]: binding,
                })
                return Promise.resolve()
            },
            selectProfile: (id) => {
                this.profileBindings(id)
                this.activeId = id
                return Promise.resolve()
            },
            addProfile: (name) => {
                const profile = { id: `p${this.profiles.length}`, name }
                this.bindings.set(
                    profile.id,
                    this.profileBindings(this.activeId),
                )
                this.profiles = [...this.profiles, profile]
                return Promise.resolve(profile)
            },
            renameProfile: (id, name) => {
                this.profileBindings(id)
                this.profiles = this.profiles.map((p) =>
                    p.id === id ? { ...p, name } : p,
                )
                return Promise.resolve()
            },
        }
    }
}
