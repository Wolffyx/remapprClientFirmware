// Pattern check: Template Method (Tier 1) — extended — fills src/devices/keylessService.ts KeylessServiceBase for an MCHOSE mouse, the same way src/clients/remappr/mouseService.ts does; its ControlsApi / WirelessApi follow the optional-facade idiom of src/service.ts.
//
// An MCHOSE mouse in the device editor. The mouse keeps its settings itself
// and takes each change at once (saveMode 'automatic'): an edit of the sensor
// binding becomes one vendor command per setting that moved, then the config
// block is read back to confirm it. The three onboard profiles switch on the
// mouse; only the live one can be read. Each button holds one function from
// the vendor's table (see ./buttons); the wheel's slot is its click.
import { ProtocolError } from '../../errors'
import { pickControls, STOCK_MOUSE } from '../../devices/stockLayouts'
import { KeylessServiceBase } from '../../devices/keylessService'
import {
    createLayoutOverride,
    type LayoutOverride,
} from '../../devices/layoutOverride'
import type {
    ButtonBinding,
    ControlBinding,
    ControlsCatalog,
    ControlsChange,
    DeviceBindings,
    DeviceModel,
    DeviceProfile,
    SensorBinding,
    WheelBinding,
} from '../../devices/types'
import type {
    Capabilities,
    ControlsApi,
    MacroApi,
    WirelessApi,
    WirelessStatus,
} from '../../service'
import type { DeviceInfo, MacroAction, MacroPlayMode } from '../../types'
import {
    BUTTON_SLOT,
    buttonCatalog,
    keepsLeftClick,
    shownAction,
    slotOf,
    SlotType,
} from './buttons'
import {
    actionsOf,
    conditionOf,
    EMPTY_MACRO,
    eventsOf,
    type MchoseMacro,
    PLAY_MODES,
    playModeOf,
    readMacro,
    writeMacro,
} from './macros'
import { bindingOf, configWith, type MchoseModel, sensorSpec } from './mouse'
import {
    type ButtonSlot,
    type MchoseLink,
    type MouseConfig,
    profileCommand,
    readConfig,
    readIdentity,
    SHORT,
    writesBetween,
} from './protocol'

export const MCHOSE_FIRMWARE = 'mchose'

const PROFILES: readonly DeviceProfile[] = [0, 1, 2].map((i) => ({
    id: `p${i}`,
    name: `Profile ${i + 1}`,
}))

const profileId = (index: number): string => `p${index}`

/** How long the mouse takes to apply a write before it reads back. */
const SETTLE_MS = 250
const CONFIRM_READS = 3

/** The five buttons the vendor driver offers, the wheel, the sensor. */
const CONTROL_IDS = ['lmb', 'rmb', 'wheel', 'fwd', 'back', 'sensor'] as const

/** The macros, one per button, in the order they are offered: a new macro
 *  lands on a side button first, the left button last. */
const MACROS = [
    { slot: 3, name: 'Side · front' },
    { slot: 4, name: 'Side · rear' },
    { slot: 1, name: 'Wheel click' },
    { slot: 2, name: 'Right button' },
    { slot: 0, name: 'Left button' },
] as const

const MACRO_NAMES = MACROS.map((m) => m.name)

/** The button slot macro `idx` belongs to; rejects one the mouse lacks. */
function macroSlot(idx: number): number {
    const m = Number.isInteger(idx) ? MACROS[idx] : undefined
    if (!m) throw new RangeError(`No macro ${idx} on this mouse`)
    return m.slot
}

const DEFAULT_SLOT: ButtonSlot = { type: SlotType.DEFAULT, value: 0 }
const MACRO_SLOT: ButtonSlot = { type: SlotType.MACRO, value: 0 }

export interface MchoseMouseDeps {
    readonly link: MchoseLink
    readonly model: MchoseModel
    readonly deviceInfo: DeviceInfo
    readonly config: MouseConfig
    /** Calls back once the transport closes on its own. */
    readonly onTransportClosed?: (cb: (reason?: unknown) => void) => void
    readonly closeTransport?: () => Promise<void>
}

export class MchoseMouseService extends KeylessServiceBase {
    readonly kind = 'mouse' as const
    readonly deviceInfo: DeviceInfo
    readonly capabilities: Capabilities = {
        lock: 'none',
        rename: false,
        notifications: false,
        reorderLayers: false,
        variableLayerCount: false,
        exportFormats: [],
        saveMode: 'automatic',
        power: { battery: true, powerOff: false },
    }
    readonly controls: ControlsApi
    readonly wireless: WirelessApi
    readonly macros: MacroApi

    private config: MouseConfig
    private readonly layout: LayoutOverride
    private readonly changeListeners = new Set<(c: ControlsChange) => void>()

    constructor(private readonly deps: MchoseMouseDeps) {
        super()
        this.deviceInfo = deps.deviceInfo
        this.config = deps.config
        const model: DeviceModel = {
            kind: 'mouse',
            form: 'mouse',
            name: deps.deviceInfo.name,
            shell: STOCK_MOUSE.shell,
            controls: pickControls(STOCK_MOUSE, CONTROL_IDS),
        }
        this.layout = createLayoutOverride(model, {
            key: `mchose:mouse:${deps.deviceInfo.name}`,
            onChanged: () => this.emit({ type: 'model' }),
        })
        this.controls = this.controlsApi()
        this.wireless = this.wirelessApi()
        this.macros = this.macroApi()
        deps.onTransportClosed?.((reason) => this.closedBy(reason))
    }

    protected override async close(): Promise<void> {
        this.changeListeners.clear()
        await this.deps.closeTransport?.()
    }

    // --- writes ------------------------------------------------------------

    /** Write what moved from the live config to `wanted`, then read back
     *  until the mouse holds it. A dropped command is sent once more. */
    private async apply(wanted: MouseConfig): Promise<void> {
        const { link } = this.deps
        for (let round = 0; round < 2; round++) {
            for (const w of writesBetween(this.config, wanted)) {
                await link.send(w.report, w.body)
            }
            for (let read = 0; read < CONFIRM_READS; read++) {
                await link.pause(SETTLE_MS)
                this.config = await readConfig(link)
                if (writesBetween(this.config, wanted).length === 0) return
            }
        }
        // Show what the mouse holds rather than what was asked.
        this.emit({
            type: 'bindings',
            profileId: profileId(this.config.profile),
        })
        throw new ProtocolError('The mouse did not take the change')
    }

    private async setSensor(binding: SensorBinding): Promise<void> {
        const fresh = await readConfig(this.deps.link)
        this.config = fresh
        await this.apply(configWith(this.deps.model, fresh, binding))
        // The mouse rounds what it cannot hold; let the editor re-read.
        const took = bindingOf(this.deps.model, this.config)
        if (JSON.stringify(took.stages) !== JSON.stringify(binding.stages)) {
            this.emit({
                type: 'bindings',
                profileId: profileId(this.config.profile),
            })
        }
    }

    /** The live config with slot `index` set to `slot`; refuses one that
     *  leaves no button left-clicking. */
    private async withButton(
        index: number,
        slot: ButtonSlot,
    ): Promise<MouseConfig> {
        const fresh = await readConfig(this.deps.link)
        this.config = fresh
        const buttons = fresh.buttons.map((s, i) => (i === index ? slot : s))
        if (!keepsLeftClick(buttons)) {
            throw new ProtocolError(
                'Keep Left click on at least one button, or the mouse cannot click.',
            )
        }
        return { ...fresh, buttons }
    }

    private async setButton(index: number, slot: ButtonSlot): Promise<void> {
        const wanted = await this.withButton(index, slot)
        // The mouse keeps a macro only while its button plays it, and binds
        // the button when the macro is written: a macro starts in Macros.
        if (
            slot.type === SlotType.MACRO &&
            this.config.buttons[index].type !== SlotType.MACRO
        ) {
            throw new ProtocolError(
                'Make this button a macro under Macros in the toolbar: saving the macro binds the button.',
            )
        }
        await this.apply(wanted)
    }

    /** Write the steps of the macro on button `slot`, which binds it; no
     *  steps puts the button back to its default. */
    /** What button `slot` holds as its macro: nothing unless it plays one
     *  (the mouse drops a macro its button stops playing). */
    private async storedMacro(slot: number): Promise<MchoseMacro> {
        const { link } = this.deps
        this.config = await readConfig(link)
        if (this.config.buttons[slot].type !== SlotType.MACRO)
            return EMPTY_MACRO
        return readMacro(link, slot)
    }

    private async setMacro(
        slot: number,
        actions: MacroAction[],
        playMode?: MacroPlayMode,
    ): Promise<void> {
        const { link } = this.deps
        if (actions.length === 0) {
            await this.apply(await this.withButton(slot, DEFAULT_SLOT))
            this.emitBindings()
            return
        }
        const events = eventsOf(actions)
        await this.withButton(slot, MACRO_SLOT)
        // Without a mode the macro keeps the one it has; a new one plays once.
        // Only the mode is carried over: trigger and time are always what the
        // vendor app writes, never bytes read back.
        const condition = playMode
            ? conditionOf(playMode)
            : (await this.storedMacro(slot)).condition || EMPTY_MACRO.condition
        const macro = { ...EMPTY_MACRO, condition, events }
        const name = MACROS.find((m) => m.slot === slot)?.name ?? ''
        for (let round = 0; round < 2; round++) {
            await writeMacro(link, slot, macro, `Remappr · ${name}`)
            await link.pause(SETTLE_MS)
            if (await this.holdsMacro(slot, macro)) {
                this.emitBindings()
                return
            }
        }
        this.emitBindings()
        throw new ProtocolError('The mouse did not take the macro')
    }

    /** Button `slot` plays `macro` as written. */
    private async holdsMacro(
        slot: number,
        macro: MchoseMacro,
    ): Promise<boolean> {
        const got = await this.storedMacro(slot)
        return (
            got.condition === macro.condition &&
            JSON.stringify(got.events) === JSON.stringify(macro.events)
        )
    }

    private emitBindings(): void {
        this.emit({
            type: 'bindings',
            profileId: profileId(this.config.profile),
        })
    }

    private async selectProfile(id: string): Promise<void> {
        const index = PROFILES.findIndex((p) => p.id === id)
        if (index < 0) throw new ProtocolError(`Unknown profile ${id}`)
        const { link } = this.deps
        await link.send(SHORT, profileCommand(index))
        for (let read = 0; read < CONFIRM_READS; read++) {
            await link.pause(SETTLE_MS)
            this.config = await readConfig(link)
            if (this.config.profile === index) break
        }
        this.emit({ type: 'profiles' })
        this.emit({
            type: 'bindings',
            profileId: profileId(this.config.profile),
        })
        if (this.config.profile !== index) {
            throw new ProtocolError('The mouse did not switch profile')
        }
    }

    private emit(change: ControlsChange): void {
        for (const cb of [...this.changeListeners]) cb(change)
    }

    // --- facades -------------------------------------------------------------

    private catalog(): ControlsCatalog {
        return {
            ...buttonCatalog(this.config.buttons),
            outputs: {},
            fields: {
                button: ['a'],
                wheel: ['click'],
                sensor: ['stages', 'active', 'poll', 'settings'],
            },
            sensor: sensorSpec(this.deps.model),
        }
    }

    private bindings(): DeviceBindings {
        const c = this.config
        const action = (id: string) =>
            shownAction(BUTTON_SLOT[id], c.buttons[BUTTON_SLOT[id]])
        const button = (id: string): ButtonBinding => ({ a: action(id) })
        const wheel: WheelBinding = {
            up: null,
            down: null,
            click: action('wheel'),
            tl: null,
            tr: null,
            lines: 1,
            smooth: false,
            freeSpin: false,
        }
        return {
            lmb: button('lmb'),
            rmb: button('rmb'),
            fwd: button('fwd'),
            back: button('back'),
            wheel,
            sensor: bindingOf(this.deps.model, c),
        }
    }

    private setControl(
        controlId: string,
        binding: ControlBinding,
    ): Promise<void> {
        if (controlId === 'sensor')
            return this.setSensor(binding as SensorBinding)
        const index = BUTTON_SLOT[controlId]
        if (index === undefined) {
            return Promise.reject(new ProtocolError(`No control ${controlId}`))
        }
        const id =
            controlId === 'wheel'
                ? (binding as WheelBinding).click
                : (binding as ButtonBinding).a
        return this.setButton(index, slotOf(id))
    }

    private controlsApi(): ControlsApi {
        return {
            getModel: () => Promise.resolve(this.layout.model()),
            getCatalog: () => Promise.resolve(this.catalog()),
            getProfiles: () =>
                Promise.resolve({
                    profiles: PROFILES,
                    activeId: profileId(this.config.profile),
                }),
            // shortcut: the mouse reads back only its live profile, so every
            // profile id answers with it; select a profile to see another.
            getBindings: async () => {
                this.config = await readConfig(this.deps.link)
                return this.bindings()
            },
            setBinding: (_profileId, controlId, binding) =>
                this.setControl(controlId, binding),
            selectProfile: (id) => this.selectProfile(id),
            onChanged: (cb) => {
                this.changeListeners.add(cb)
                return () => {
                    this.changeListeners.delete(cb)
                }
            },
            layout: this.layout.api,
        }
    }

    private macroApi(): MacroApi {
        return {
            getCount: () => MACRO_NAMES.length,
            listNames: () => MACRO_NAMES,
            getMacro: async (idx) =>
                actionsOf((await this.storedMacro(macroSlot(idx))).events),
            setMacro: (idx, actions, playMode) =>
                this.setMacro(macroSlot(idx), actions, playMode),
            playModes: PLAY_MODES,
            getPlayMode: async (idx) =>
                playModeOf((await this.storedMacro(macroSlot(idx))).condition),
        }
    }

    private wirelessApi(): WirelessApi {
        const { link } = this.deps
        return {
            getStatus: async (): Promise<WirelessStatus> => {
                const id = await readIdentity(link)
                return {
                    transport: id.link ?? 'usb',
                    battery: { level: id.battery, charging: id.charging },
                }
            },
            // The mouse's low-power mode is its sleep timer.
            getLpm: () =>
                Promise.resolve({
                    enabled: this.config.sleepMinutes > 0,
                    timeoutMs: this.config.sleepMinutes * 60_000,
                }),
            setLpm: async ({ enabled, timeoutMs }) => {
                const minutes = enabled
                    ? Math.min(Math.max(Math.round(timeoutMs / 60_000), 1), 60)
                    : 0
                this.config = await readConfig(link)
                await this.apply({ ...this.config, sleepMinutes: minutes })
            },
            onStatusChanged: () => () => {},
        }
    }
}
