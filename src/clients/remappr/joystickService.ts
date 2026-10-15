// Pattern check: Template Method (Tier 1) — extended — fills src/devices/keylessService.ts KeylessServiceBase for the Remappr joystick, as RemapprMouseService does.
//
// The Remappr joystick (input-layout plan §4) as a device the app edits in the
// device editor. Its settings are one `remappr.device` document; the controls
// facade (buttons, sticks, the hat) changes one staged copy and `commit()`
// writes it — the header's Save. Calibration is the unit's own (service
// .joystick); the live readout polls GET_AXIS_STATE while someone listens.
import type { ConfigDevice } from '../../config/device'
import { ProtocolError } from '../../errors'
import { KeylessServiceBase } from '../../devices/keylessService'
import {
    createLayoutOverride,
    type LayoutOverride,
} from '../../devices/layoutOverride'
import type {
    ControlBinding,
    ControlInputFrame,
    ControlsChange,
} from '../../devices/types'
import type {
    Capabilities,
    ControlsApi,
    DeviceConfigApi,
    DeviceConfigDraft,
    JoystickApi,
} from '../../service'
import type { DeviceInfo, ExportedFile } from '../../types'
import type { InputLayout } from './inputLayout'
import type { JoystickVerbs } from './joystick'
import {
    applyJoystickBinding,
    joystickBindings,
    joystickCatalog,
    joystickFrame,
    joystickInputs,
    joystickModel,
    joystickSticks,
    stickSuggestions,
} from './joystickControls'
import type { InputLayoutEntry, Limits } from './protocol'

export interface JoystickServiceDeps {
    deviceInfo: DeviceInfo
    limits?: Limits
    /** The settings document; absent when the firmware has no config store. */
    device?: DeviceConfigApi
    /** Live JOYSTICK verbs; absent when the firmware does not serve them. */
    joystick?: JoystickVerbs
    /** False for a read-only view. */
    writable: boolean
    /** Where the controls sit (GET_INPUT_LAYOUT). */
    layout?: InputLayout
    /** Live readout period, ms (default 50). */
    pollMs?: number
    onTransportClosed?: (cb: (reason?: unknown) => void) => void
    closeTransport?: () => Promise<void>
}

const PROFILE = { id: 'p0', name: 'Default' } as const

/** Failed reads in a row that end the live readout. One is a busy moment (a
 *  calibration step writing flash); a run of them is a device gone away. */
const MAX_FAILED_READS = 5

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

export class RemapprJoystickService extends KeylessServiceBase {
    readonly kind = 'joystick' as const
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities
    readonly limits?: Limits
    readonly joystick?: JoystickApi
    readonly device?: DeviceConfigApi
    readonly controls: ControlsApi

    private readonly layout: LayoutOverride
    private readonly inputs: ReadonlyMap<string, InputLayoutEntry>
    private stored: ConfigDevice | null = null
    private draft: ConfigDevice | null = null
    private loading: Promise<void> | null = null
    private poll: ReturnType<typeof setInterval> | null = null
    private readonly changeListeners = new Set<(c: ControlsChange) => void>()
    private readonly draftListeners = new Set<(d: ConfigDevice) => void>()
    private readonly inputListeners = new Set<(f: ControlInputFrame) => void>()

    constructor(private readonly deps: JoystickServiceDeps) {
        super()
        const editable = deps.writable && !!deps.device
        this.deviceInfo = deps.deviceInfo
        this.limits = deps.limits
        this.inputs = joystickInputs(deps.layout)
        this.joystick = deps.joystick && this.joystickApi(deps.joystick)
        this.layout = createLayoutOverride(
            joystickModel(deps.deviceInfo.name, deps.layout),
            {
                key: `remappr:joystick:${deps.deviceInfo.serialNumber || deps.deviceInfo.name}`,
                onChanged: () => this.emit({ type: 'model' }),
            },
        )
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
        this.setPending(false)
    }

    override discardChanges(): Promise<void> {
        this.draft = this.stored
        this.setPending(false)
        this.announce(this.stored)
        return Promise.resolve()
    }

    /** Back to the firmware defaults: a document without joystick settings,
     *  written at once. The calibration stays (it is the unit's). */
    override async resetSettings(): Promise<void> {
        await this.load()
        if (!this.stored) return
        const { joystick: _joystick, ...defaults } = this.stored
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
        this.stopPolling()
        this.changeListeners.clear()
        this.draftListeners.clear()
        this.inputListeners.clear()
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
        const snap = (await this.deps.device?.read()) ?? null
        this.stored = snap?.config ?? null
        this.draft = this.stored
    }

    private stage(next: ConfigDevice, fromControls: boolean): void {
        this.draft = next
        this.setPending(!sameDoc(this.draft, this.stored))
        for (const cb of [...this.draftListeners]) cb(next)
        if (!fromControls)
            this.emit({ type: 'bindings', profileId: PROFILE.id })
    }

    private announce(doc: ConfigDevice | null): void {
        if (doc) for (const cb of [...this.draftListeners]) cb(doc)
        this.emit({ type: 'bindings', profileId: PROFILE.id })
    }

    private emit(change: ControlsChange): void {
        for (const cb of [...this.changeListeners]) cb(change)
    }

    private bindings() {
        return joystickBindings(this.draft?.joystick, this.inputs)
    }

    // --- live readout ---------------------------------------------------------

    private startPolling(): void {
        const api = this.deps.joystick
        if (this.poll || !api) return
        let busy = false
        let failed = 0
        this.poll = setInterval(() => {
            if (busy) return
            busy = true
            api.getState()
                .then((state) => {
                    failed = 0
                    const frame = joystickFrame(state, this.bindings())
                    for (const cb of [...this.inputListeners]) cb(frame)
                })
                // A run of failed reads ends the readout (the device went
                // away or refuses); listeners keep their last frame.
                .catch(() => {
                    failed += 1
                    if (failed >= MAX_FAILED_READS) this.stopPolling()
                })
                .finally(() => {
                    busy = false
                })
        }, this.deps.pollMs ?? 50)
    }

    private stopPolling(): void {
        if (this.poll) clearInterval(this.poll)
        this.poll = null
    }

    // --- facades -------------------------------------------------------------

    /** The JOYSTICK verbs, with what a calibration measured per analog input
     *  put onto the controls that read them, and the sticks it declares. */
    private joystickApi(verbs: JoystickVerbs): JoystickApi {
        return {
            ...verbs,
            calibrate: async (step, input) =>
                stickSuggestions(await verbs.calibrate(step, input), this.inputs),
            sticks: () => joystickSticks(this.inputs),
        }
    }

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

    private onInput(cb: (f: ControlInputFrame) => void): () => void {
        this.inputListeners.add(cb)
        this.startPolling()
        return () => {
            this.inputListeners.delete(cb)
            if (this.inputListeners.size === 0) this.stopPolling()
        }
    }

    private readControls(): ControlsApi {
        return {
            getModel: () => Promise.resolve(this.layout.model()),
            getCatalog: async () => {
                await this.load()
                return joystickCatalog(this.draft?.joystick, this.inputs)
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
            ...(this.deps.joystick
                ? {
                      onInput: (cb: (f: ControlInputFrame) => void) =>
                          this.onInput(cb),
                  }
                : {}),
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
                        'The joystick settings could not be read',
                    )
                }
                this.stage(
                    applyJoystickBinding(
                        this.draft,
                        this.inputs,
                        controlId,
                        binding,
                    ),
                    true,
                )
            },
        }
    }
}
