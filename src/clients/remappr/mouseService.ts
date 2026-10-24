// Pattern check: Template Method (Tier 1) — extended — fills src/devices/keylessService.ts KeylessServiceBase for the Remappr mouse; its ControlsApi and draft follow the optional-facade idiom of src/service.ts.
//
// The Remappr mouse as a device the app edits in the device editor. Its
// settings are one `remappr.device` document; every editor (the controls
// facade for buttons, CPI and the sensor, the settings panel for the curve,
// flags and radio) changes one staged copy, and `commit()` writes it in one
// go — the header's Save. A sensor setting is also previewed on the device at
// once (SET_SETTING, live until the next commit); a discard puts the previewed
// ones back. A view through the dongle is read-only.
import type { ConfigDevice } from '../../config/device'
import { ProtocolError } from '../../errors'
import { KeylessServiceBase } from '../../devices/keylessService'
import {
    createLayoutOverride,
    type LayoutOverride,
} from '../../devices/layoutOverride'
import type {
    ControlBinding,
    ControlsChange,
    DeviceBindings,
    SensorBinding,
    SensorInfo,
    SensorSettingValue,
} from '../../devices/types'
import type {
    Capabilities,
    ControlsApi,
    DeviceConfigApi,
    DeviceConfigDraft,
    MouseMotionApi,
    SensorApi,
} from '../../service'
import type { DeviceInfo, ExportedFile } from '../../types'
import {
    applyMouseBinding,
    mouseBindings,
    mouseCatalog,
    mouseModel,
    pointerSensor,
    sensorBindingSettings,
} from './mouseControls'
import type { InputLayout } from './inputLayout'
import {
    type Limits,
    type MotionConfig,
    powerCapability,
    type RateLimits,
} from './protocol'

export interface MouseServiceDeps {
    deviceInfo: DeviceInfo
    limits?: Limits
    /** The settings document; absent when the firmware has no config store. */
    device?: DeviceConfigApi
    /** Live MOUSE controls; absent when the firmware does not serve them. */
    motion?: MouseMotionApi
    /** Report-rate verbs; they may answer ERR_CMD. */
    rate?: { get(): Promise<RateLimits>; set(hz: number): Promise<number> }
    /** The sensor's settings, procedures and readings; absent when the
     *  firmware does not serve the SENSOR namespace. */
    sensor?: SensorApi
    /** False for a read-only view. */
    writable: boolean
    /** GET_PERSONALITY_MAP hw_caps (0 / absent = not reported). */
    hwCaps?: number
    /** Where the controls sit, when the firmware reports it (GET_INPUT_LAYOUT). */
    layout?: InputLayout
    onTransportClosed?: (cb: (reason?: unknown) => void) => void
    /** Close an owned transport; absent when it is borrowed (node view). */
    closeTransport?: () => Promise<void>
}

const PROFILE = { id: 'p0', name: 'Default' } as const

/** JSON with sorted keys, so two equal documents compare equal. */
function stableJson(v: unknown): string {
    return JSON.stringify(v, (_k, x: unknown) =>
        x && typeof x === 'object' && !Array.isArray(x)
            ? Object.fromEntries(
                  Object.entries(x as Record<string, unknown>).sort(
                      ([a], [b]) => a.localeCompare(b),
                  ),
              )
            : x,
    )
}

const sameDoc = (a: ConfigDevice | null, b: ConfigDevice | null): boolean =>
    stableJson(a) === stableJson(b)

/** The hardware took a sensor value other than the one asked for: the editor
 *  must re-read to show it. */
const snapped = (asked: SensorBinding, took: SensorBinding): boolean =>
    Object.entries(took.settings).some(([k, v]) => asked.settings[k] !== v)

export class RemapprMouseService extends KeylessServiceBase {
    readonly kind = 'mouse' as const
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities
    readonly limits?: Limits
    readonly motion?: MouseMotionApi
    readonly sensor?: SensorApi
    readonly device?: DeviceConfigApi
    readonly controls: ControlsApi

    private readonly layout: LayoutOverride
    private stored: ConfigDevice | null = null
    private draft: ConfigDevice | null = null
    private motionCfg: MotionConfig | null = null
    private rates: RateLimits | null = null
    private stagedRate: number | null = null
    /** The pointer sensor as last described (values in force then). */
    private sensorInfo: SensorInfo | null = null
    /** Sensor settings changed live since the last commit or discard. */
    private readonly previewed = new Set<string>()
    private loading: Promise<void> | null = null
    private readonly changeListeners = new Set<(c: ControlsChange) => void>()
    private readonly draftListeners = new Set<(d: ConfigDevice) => void>()

    constructor(private readonly deps: MouseServiceDeps) {
        super()
        const editable = deps.writable && !!deps.device
        this.deviceInfo = deps.deviceInfo
        this.limits = deps.limits
        this.motion = deps.motion
        this.sensor = deps.sensor
        // Drawn as the mouse reports itself, else generic; a layout drawn in
        // the Builder is remembered per mouse and wins while it fits.
        this.layout = createLayoutOverride(
            mouseModel(deps.deviceInfo.name, deps.hwCaps, deps.layout),
            {
                key: `remappr:mouse:${deps.deviceInfo.serialNumber || deps.deviceInfo.name}`,
                onChanged: () => {
                    const change: ControlsChange = { type: 'model' }
                    for (const cb of [...this.changeListeners]) cb(change)
                },
            },
        )
        const power = powerCapability(deps.hwCaps)
        this.capabilities = {
            lock: 'none',
            rename: false,
            notifications: false,
            reorderLayers: false,
            variableLayerCount: false,
            exportFormats: deps.device ? ['remappr.device.json'] : [],
            saveMode: 'manual',
            persistence: true,
            ...(editable ? {} : { readOnly: true }),
            ...(power ? { power } : {}),
        }
        this.device =
            deps.device && editable
                ? { ...deps.device, draft: this.draftApi() }
                : deps.device
        this.controls = editable ? this.editableControls() : this.readControls()
        deps.onTransportClosed?.((reason) => this.closedBy(reason))
    }

    // --- save / discard / reset ---------------------------------------------

    override async commit(): Promise<void> {
        const device = this.deps.device
        if (device && this.draft && !sameDoc(this.draft, this.stored)) {
            await device.write(this.draft)
            this.stored = this.draft
        }
        await this.applyStagedRate()
        // The pushed config holds the sensor values now; the live ones ended.
        this.previewed.clear()
        this.setPending(false)
        // A pushed config replaces the live DPI / acceleration / wheel values.
        this.motionCfg =
            (await this.deps.motion?.getConfig().catch(() => null)) ??
            this.motionCfg
    }

    override async discardChanges(): Promise<void> {
        this.stagedRate = null
        this.draft = this.stored
        this.setPending(false)
        this.announce(this.stored)
        await this.restorePreviewed()
    }

    /** Back to the firmware defaults: a document without mouse, radio or
     *  sensor settings, written at once. */
    override async resetSettings(): Promise<void> {
        await this.load()
        if (!this.stored) return
        const {
            mouse: _mouse,
            radio: _radio,
            sensor: _sensor,
            ...defaults
        } = this.stored
        this.draft = defaults
        await this.commit()
        this.announce(this.draft)
    }

    override async exportConfig(): Promise<ExportedFile[]> {
        await this.load()
        const doc = this.draft ?? this.stored
        if (!doc) return []
        return [
            {
                filename: `${this.deviceInfo.name}.device.json`,
                mime: 'application/json',
                content: JSON.stringify(doc, null, 2),
            },
        ]
    }

    protected override async close(): Promise<void> {
        this.changeListeners.clear()
        this.draftListeners.clear()
        await this.deps.closeTransport?.()
    }

    // --- state -------------------------------------------------------------

    private load(): Promise<void> {
        this.loading ??= this.read().catch((e: unknown) => {
            this.loading = null
            throw e
        })
        return this.loading
    }

    private async read(): Promise<void> {
        const [snap, motion, rates, sensors] = await Promise.all([
            this.deps.device?.read() ?? null,
            this.deps.motion?.getConfig().catch(() => null) ?? null,
            this.deps.rate?.get().catch(() => null) ?? null,
            // The editor still opens when the sensor cannot be described: it
            // then offers only the DPI and the rate.
            this.deps.sensor?.getSensors().catch(() => null) ?? null,
        ])
        this.stored = snap?.config ?? null
        this.draft = this.stored
        this.motionCfg = motion
        this.rates = rates
        this.sensorInfo = pointerSensor(sensors)
    }

    /** A sensor setting's value with nothing set: the device's default. */
    private sensorDefault(name: string): SensorSettingValue | undefined {
        return this.sensorInfo?.settings.find((s) => s.name === name)?.default
    }

    /** What each sensor setting is under `doc`: its value, else the default. */
    private sensorValues(
        doc: ConfigDevice | null,
    ): Map<string, SensorSettingValue> {
        const set = sensorBindingSettings(doc?.sensor)
        const out = new Map<string, SensorSettingValue>()
        for (const s of this.sensorInfo?.settings ?? []) {
            if (!s.personality) out.set(s.name, set[s.name] ?? s.default)
        }
        return out
    }

    /**
     * Preview `b`'s sensor settings on the device: each one whose value moves
     * from the draft's is set live. Resolves to `b` with the values the
     * hardware took (an INT snaps to what its registers hold). A refusal (an
     * option that needs a calibration first) rejects before anything is
     * staged.
     */
    private async previewSensor(b: SensorBinding): Promise<SensorBinding> {
        const api = this.deps.sensor
        const info = this.sensorInfo
        if (!api || !info) return b
        const before = this.sensorValues(this.draft)
        const settings = { ...b.settings }
        for (const [name, was] of before) {
            const next = settings[name] ?? this.sensorDefault(name)
            if (next === undefined || next === was) continue
            const applied = await api
                .setSetting(info.index, name, next)
                .catch((e: unknown) => {
                    throw this.refusal(name, next, e)
                })
            this.previewed.add(name)
            if (name in settings) settings[name] = applied
        }
        return { ...b, settings }
    }

    /** A refused sensor value, named for the user: an option that needs a
     *  procedure says which one to run (the device answers only ERR_STATE). */
    private refusal(
        name: string,
        value: SensorSettingValue,
        cause: unknown,
    ): Error {
        const info = this.sensorInfo
        const setting = info?.settings.find((s) => s.name === name)
        const option = setting?.options?.find((o) => o.value === value)
        const proc = info?.procedures.find((p) => p.name === option?.needs)
        if (!setting || !option || !proc) {
            return cause instanceof Error ? cause : new Error(String(cause))
        }
        return new Error(
            `${setting.label} "${option.label}" needs a ${proc.label.toLowerCase()} ` +
                'first: run it in Device settings.',
            { cause },
        )
    }

    /** Put every previewed setting back to the stored config's value. */
    private async restorePreviewed(): Promise<void> {
        const api = this.deps.sensor
        const info = this.sensorInfo
        if (!api || !info || this.previewed.size === 0) return
        const stored = this.sensorValues(this.stored)
        for (const name of [...this.previewed]) {
            const value = stored.get(name)
            if (value !== undefined) await api.setSetting(info.index, name, value)
            this.previewed.delete(name)
        }
    }

    private async applyStagedRate(): Promise<void> {
        if (this.stagedRate === null || !this.deps.rate || !this.rates) return
        const applied = await this.deps.rate.set(this.stagedRate)
        this.rates = { ...this.rates, currentHz: applied }
        this.stagedRate = null
    }

    private refreshPending(): void {
        this.setPending(
            !sameDoc(this.draft, this.stored) || this.stagedRate !== null,
        )
    }

    /** Stage `next`; a change from outside the controls facade (the settings
     *  panel, a discard) is announced to the editor so it re-reads. */
    private stage(next: ConfigDevice, fromControls: boolean): void {
        this.draft = next
        this.refreshPending()
        for (const cb of [...this.draftListeners]) cb(next)
        if (!fromControls) this.emitChange()
    }

    private announce(doc: ConfigDevice | null): void {
        if (doc) for (const cb of [...this.draftListeners]) cb(doc)
        this.emitChange()
    }

    private emitChange(): void {
        const change: ControlsChange = {
            type: 'bindings',
            profileId: PROFILE.id,
        }
        for (const cb of [...this.changeListeners]) cb(change)
    }

    private bindings(): DeviceBindings {
        const rates =
            this.rates && this.stagedRate !== null
                ? { ...this.rates, currentHz: this.stagedRate }
                : this.rates
        const all = mouseBindings(
            this.draft?.mouse,
            this.motionCfg,
            rates,
            this.draft?.sensor,
        )
        // Only the controls the mouse has (no sensor when it reports none).
        const ids = new Set(this.layout.model().controls.map((c) => c.id))
        return Object.fromEntries(
            Object.entries(all).filter(([id]) => ids.has(id)),
        )
    }

    // --- facades -------------------------------------------------------------

    private draftApi(): DeviceConfigDraft {
        return {
            get: () => this.draft,
            set: (config) => this.stage(config, false),
            onChanged: (cb) => {
                this.draftListeners.add(cb)
                return () => {
                    this.draftListeners.delete(cb)
                }
            },
        }
    }

    private readControls(): ControlsApi {
        return {
            getModel: () => Promise.resolve(this.layout.model()),
            getCatalog: async () => {
                await this.load()
                return mouseCatalog(
                    this.motionCfg,
                    this.rates,
                    this.draft?.mouse,
                    this.sensorInfo,
                )
            },
            getProfiles: () =>
                Promise.resolve({ profiles: [PROFILE], activeId: PROFILE.id }),
            getBindings: async () => {
                await this.load()
                return this.bindings()
            },
            onChanged: (cb) => {
                this.changeListeners.add(cb)
                return () => {
                    this.changeListeners.delete(cb)
                }
            },
            layout: this.layout.api,
        }
    }

    private editableControls(): ControlsApi {
        return {
            ...this.readControls(),
            setBinding: async (
                _profileId,
                controlId,
                binding: ControlBinding,
            ) => {
                await this.load()
                if (!this.draft) {
                    throw new ProtocolError(
                        'The mouse settings could not be read',
                    )
                }
                if (controlId !== 'sensor') {
                    this.stage(
                        applyMouseBinding(this.draft, controlId, binding),
                        true,
                    )
                    return
                }
                const asked = binding as SensorBinding
                const took = await this.previewSensor(asked)
                this.stageRate(took)
                this.stage(
                    applyMouseBinding(this.draft, controlId, took, this.sensorInfo),
                    !snapped(asked, took),
                )
            },
        }
    }

    private stageRate(b: SensorBinding): void {
        if (!this.rates) return
        this.stagedRate = b.poll === this.rates.currentHz ? null : b.poll
    }
}
