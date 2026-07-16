// Pattern check: Adapter (Tier 1) — extended — backs src/firmware/service.ts KeyboardService Facade; in-memory keyboard implementation for dev/storybook/tests, mirrors ZmkKeyboardService surface.
// pattern-check: skip — wire encoders/dynamic/macros sub-bundles defined in service.ts
import { filterCatalogByCodec } from '@firmware/catalog/filter'
import type { KeyCatalog } from '@firmware/catalog/types'
import type {
    Capabilities,
    ClusterApi,
    ClusterDiag,
    DynamicEntriesApi,
    EncoderApi,
    HsvColor,
    IndicatorConfig,
    KeyboardService,
    MacroApi,
    RgbApi,
    RgbEffectState,
    RoleEvent,
} from '@firmware/service'
import type {
    ActionType,
    AdapterNotification,
    AltRepeatKeyEntry,
    ComboEntry,
    DeviceInfo,
    DynamicEntryCounts,
    EncoderAction,
    ExportedFile,
    KeyAction,
    Keymap,
    KeyOverrideEntry,
    KeyUpdate,
    Layer,
    LockState,
    MacroAction,
    PhysicalLayout,
    TapDanceEntry,
} from '@firmware/types'
import { LockedError, ProtocolError } from '@firmware/errors'
import { RGB_MATRIX_CATALOG } from '@firmware/lighting'

import {
    buildMockActionTypes,
    buildMockKeyAction,
    MOCK_KIND_TRANSPARENT,
    relabelLayer,
} from './actions'
import { mockCodec } from './codec'
import { MOCK_CORNE_LAYOUT, MOCK_LAYOUTS } from './layout'
import { configToPhysicalLayout, lowerConfigToMock } from './configBridge'
import {
    parseKeymap,
    serializeKeymap,
    type CanonConditionalLayer,
    type CanonHoldTapDef,
    type CanonModMorph,
    type ConfigDefaults,
    type ConfigKeymap,
} from '@firmware/config'
import type { RemapprConfigEditing } from '@firmware/remappr/configEditing'
import type { Limits } from '@firmware/remappr/protocol'
// Raw JSON source of the demo remappr.keymap — the config editor + download
// modal's source of truth. `?raw` hands back the file verbatim as a string, so
// it round-trips through parseKeymap unchanged. Parsed once: it both seeds the
// runtime editing buffer (lowered below) and is served to the config store.
import seedConfigSource from './seed.keymap.json?raw'

const SEED_CONFIG: ConfigKeymap = parseKeymap(seedConfigSource)

const MOCK_DYNAMIC_COUNTS: DynamicEntryCounts = {
    tapDance: 4,
    combo: 4,
    keyOverride: 4,
}

const MOCK_MACRO_COUNT = 3
const MOCK_MACRO_BUFFER = 256
const MOCK_ENCODER_COUNT = 2

const MOCK_CAPABILITIES: Capabilities = {
    lock: true,
    rename: true,
    notifications: true,
    reorderLayers: true,
    variableLayerCount: true,
    exportFormats: ['mock-json'],
    // Mock keeps edits in memory only; nothing is saved across a reconnect.
    saveMode: 'none',
    maxLayers: 8,
    encoders: MOCK_ENCODER_COUNT,
    dynamicEntries: MOCK_DYNAMIC_COUNTS,
    macros: { count: MOCK_MACRO_COUNT, bufferSize: MOCK_MACRO_BUFFER },
    behaviors: {
        capsWord: true,
        leader: true,
        autoShift: true,
        swapHands: true,
    },
}

const ZERO_TAP_DANCE: TapDanceEntry = {
    onTap: 0,
    onHold: 0,
    onDoubleTap: 0,
    onTapHold: 0,
    tappingTerm: 200,
}

const ZERO_COMBO: ComboEntry = { keys: [0, 0, 0, 0], output: 0 }

const ZERO_KEY_OVERRIDE: KeyOverrideEntry = {
    trigger: 0,
    replacement: 0,
    layers: 0xffff,
    triggerMods: 0,
    negativeModMask: 0,
    suppressedMods: 0,
    options: {
        activationTriggerDown: false,
        activationRequiredModDown: false,
        activationNegativeModUp: false,
        oneMod: false,
        noReregisterTrigger: false,
        noUnregisterOnOtherKeyDown: false,
        enabled: false,
    },
}

const ZERO_ARK: AltRepeatKeyEntry = {
    keycode: 0,
    altKeycode: 0,
    allowedMods: 0,
    options: {
        defaultToThisAltKey: false,
        bidirectional: false,
        ignoreModHandedness: false,
        enabled: false,
    },
}

type NotificationHandler = (notification: AdapterNotification) => void
type LockStateHandler = (state: LockState) => void
type PendingChangesHandler = (pending: boolean) => void
type ClosedHandler = (reason?: unknown) => void

interface MockServiceOptions {
    deviceInfo?: Partial<DeviceInfo>
    initiallyLocked?: boolean
    /** Seed the runtime from a specific config (builder "Open in editor"
     *  handoff) instead of the static Corne demo. The physical layout, key
     *  count, and getConfigSource() all derive from this board. */
    seedConfig?: ConfigKeymap
}

export class MockKeyboardService
    implements KeyboardService, RemapprConfigEditing
{
    public readonly capabilities: Capabilities = MOCK_CAPABILITIES
    public readonly deviceInfo: DeviceInfo
    public readonly codec = mockCodec
    public readonly encoders: EncoderApi
    public readonly dynamic: DynamicEntriesApi
    public readonly macros: MacroApi
    public readonly rgb: RgbApi
    public readonly cluster: ClusterApi
    // Demo advertises the full feature bitmask so the config-blob editors show
    // (and gray nothing) — the mock honors every §7.4 setting in-memory.
    public readonly limits: Limits = {
        maxUnsealedChunk: 512,
        maxSealedChunk: 512,
        transportFrameCap: 512,
        blobAlign: 16,
        maxConfigBytes: 65536,
        maxOutstandingRequests: 4,
        supportsFragmentation: true,
        featureBitmask: 0xffffffff,
    }

    private tapDances: TapDanceEntry[] = Array.from(
        { length: MOCK_DYNAMIC_COUNTS.tapDance },
        () => ({ ...ZERO_TAP_DANCE }),
    )
    private combos: ComboEntry[] = Array.from(
        { length: MOCK_DYNAMIC_COUNTS.combo },
        () => ({ ...ZERO_COMBO, keys: [0, 0, 0, 0] as ComboEntry['keys'] }),
    )
    private keyOverrides: KeyOverrideEntry[] = Array.from(
        { length: MOCK_DYNAMIC_COUNTS.keyOverride },
        () => ({
            ...ZERO_KEY_OVERRIDE,
            options: { ...ZERO_KEY_OVERRIDE.options },
        }),
    )
    private altRepeatKeys: AltRepeatKeyEntry[] = Array.from(
        { length: 4 },
        () => ({ ...ZERO_ARK, options: { ...ZERO_ARK.options } }),
    )
    private macroBuffers: MacroAction[][] = Array.from(
        { length: MOCK_MACRO_COUNT },
        () => [] as MacroAction[],
    )

    private layers: Layer[] = []
    private layouts: PhysicalLayout[]
    /** Source config the runtime is seeded from (static demo or a builder board). */
    private readonly seedCfg: ConfigKeymap
    /** Live config the config-blob editors read/write (§7.4 defaults + custom def
     *  pools + tri-layers). Copy-on-write off `seedCfg` (never mutated in place, so
     *  the shared demo seed is safe); discardChanges resets it. */
    private cfg: ConfigKeymap
    /** Set once a config-blob editor has changed `cfg`, so getConfigSource serves
     *  the edited config instead of the pristine seed source. */
    private configEdited = false
    /** Per-layer key count — derived from the seed geometry, not a fixed Corne. */
    private readonly keyCount: number
    private activeLayoutId = 0
    private lockState: LockState
    private pendingChanges = false
    private closed = false

    private readonly notificationListeners = new Set<NotificationHandler>()
    private readonly lockStateListeners = new Set<LockStateHandler>()
    private readonly pendingChangesListeners = new Set<PendingChangesHandler>()
    private readonly closedListeners = new Set<ClosedHandler>()

    private nextLayerId = 0

    // Sized to keyCount in the constructor (one LED per key, like a real per-key
    // board) so per-key reads/writes span the whole keyboard, not a fixed 24.
    private perKeyColors: HsvColor[] = []
    private perKeyType: number = 0
    private indicators: IndicatorConfig = {
        supported: {
            numLock: true,
            capsLock: true,
            scrollLock: false,
            compose: false,
            kana: false,
        },
        disabled: {
            numLock: false,
            capsLock: false,
            scrollLock: false,
            compose: false,
            kana: false,
        },
        color: { h: 0, s: 0, v: 255 },
        raw: new Uint8Array([0x00, 0x03, 0x00, 0x00, 0x00, 0xff]),
    }
    private mixedRegions: Uint8Array = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    private mixedEffect: Uint8Array = new Uint8Array([0x05, 0x06, 0x07, 0x08])
    private rgbEffect: RgbEffectState = {
        mode: 14, // Cycle Up Down (RGB_MATRIX_EFFECTS index)
        brightness: 200,
        speed: 128,
        color: { h: 170, s: 255, v: 255 },
    }

    constructor(opts: MockServiceOptions = {}) {
        this.seedCfg = opts.seedConfig ?? SEED_CONFIG
        this.cfg = this.seedCfg
        this.keyCount = this.seedCfg.keyboard.keys.length
        this.perKeyColors = Array.from({ length: this.keyCount }, (_, i) => ({
            h: Math.round(((i * 255) / this.keyCount) % 256),
            s: 220,
            v: 200,
        }))
        this.layouts = opts.seedConfig
            ? [configToPhysicalLayout(opts.seedConfig)]
            : MOCK_LAYOUTS.map((l) => ({ ...l }))
        this.deviceInfo = {
            name:
                opts.deviceInfo?.name ??
                (opts.seedConfig ? opts.seedConfig.meta.name : 'Mock Corne'),
            firmware: 'mock',
            firmwareVersion: opts.deviceInfo?.firmwareVersion ?? '0.0.0',
            serialNumber: opts.deviceInfo?.serialNumber ?? 'MOCK-0001',
        }
        this.lockState = opts.initiallyLocked ? 'locked' : 'unlocked'
        this.seedDefaultLayers()
        // pattern-check: skip — inline closures over private state for sub-bundle stubs
        this.encoders = {
            setEncoder: async (layerId, encoderIdx, direction, action) => {
                this.requireUnlocked()
                const li = this.layerIndexById(layerId)
                if (li < 0)
                    throw new ProtocolError(`Unknown layer id: ${layerId}`)
                if (encoderIdx < 0 || encoderIdx >= MOCK_ENCODER_COUNT) {
                    throw new ProtocolError(
                        `Encoder index out of range: ${encoderIdx}`,
                    )
                }
                const layer = this.layers[li]
                const encs = (layer.encoders ?? this.defaultEncoders()).slice()
                const cur = encs[encoderIdx]
                encs[encoderIdx] =
                    direction === 0
                        ? { cw: action, ccw: cur.ccw }
                        : { cw: cur.cw, ccw: action }
                this.layers[li] = { ...layer, encoders: encs }
                this.markPending(true)
            },
        }
        this.dynamic = {
            getCounts: () => ({ ...MOCK_DYNAMIC_COUNTS }),
            getTapDance: async (idx) => ({ ...this.requireTapDance(idx) }),
            setTapDance: async (idx, entry) => {
                this.requireUnlocked()
                this.requireTapDance(idx)
                this.tapDances[idx] = { ...entry }
                this.markPending(true)
            },
            getCombo: async (idx) => {
                const c = this.requireCombo(idx)
                return { ...c, keys: [...c.keys] as ComboEntry['keys'] }
            },
            setCombo: async (idx, entry) => {
                this.requireUnlocked()
                this.requireCombo(idx)
                this.combos[idx] = {
                    ...entry,
                    keys: [...entry.keys] as ComboEntry['keys'],
                }
                this.markPending(true)
            },
            getKeyOverride: async (idx) => {
                const k = this.requireKeyOverride(idx)
                return { ...k, options: { ...k.options } }
            },
            setKeyOverride: async (idx, entry) => {
                this.requireUnlocked()
                this.requireKeyOverride(idx)
                this.keyOverrides[idx] = {
                    ...entry,
                    options: { ...entry.options },
                }
                this.markPending(true)
            },
            getAltRepeatKey: async (idx) => {
                const a = this.requireAltRepeatKey(idx)
                return { ...a, options: { ...a.options } }
            },
            setAltRepeatKey: async (idx, entry) => {
                this.requireUnlocked()
                this.requireAltRepeatKey(idx)
                this.altRepeatKeys[idx] = {
                    ...entry,
                    options: { ...entry.options },
                }
                this.markPending(true)
            },
        }
        this.macros = {
            getCount: () => MOCK_MACRO_COUNT,
            getMacro: async (idx) => {
                this.requireMacro(idx)
                return this.macroBuffers[idx].map((a) => ({ ...a }))
            },
            setMacro: async (idx, actions) => {
                this.requireUnlocked()
                this.requireMacro(idx)
                this.macroBuffers[idx] = actions.map((a) => ({ ...a }))
                this.markPending(true)
            },
        }
        this.rgb = {
            getLedCount: async () => this.perKeyColors.length,
            getIndicators: async () => this.indicators,
            setIndicators: async (cfg) => {
                this.indicators = { ...this.indicators, ...cfg }
                this.markPending(true)
            },
            save: async () => {
                /* in-memory mock has no persistence */
            },
            // Simulated boards have no custom per-key effect enum; report the
            // current mode so the per-key editor treats it as already active
            // (no effect switch, no "could not resolve" warning).
            getPerKeyEffectMode: async () => this.rgbEffect.mode,
            getPerKeyType: async () => this.perKeyType,
            setPerKeyType: async (t) => {
                this.perKeyType = t & 0xff
                this.markPending(true)
            },
            getPerKeyColors: async (start, count) => {
                if (start < 0 || start + count > this.perKeyColors.length) {
                    throw new ProtocolError(
                        `Per-key range out of bounds: start=${start} count=${count}`,
                    )
                }
                return this.perKeyColors
                    .slice(start, start + count)
                    .map((c) => ({ ...c }))
            },
            setPerKeyColors: async (start, colors) => {
                if (
                    start < 0 ||
                    start + colors.length > this.perKeyColors.length
                ) {
                    throw new ProtocolError(
                        `Per-key range out of bounds: start=${start} count=${colors.length}`,
                    )
                }
                for (let i = 0; i < colors.length; i++) {
                    this.perKeyColors[start + i] = { ...colors[i] }
                }
                this.markPending(true)
            },
            getMixedRegions: async () => this.mixedRegions.slice(),
            setMixedRegions: async (b) => {
                this.mixedRegions = b.slice()
                this.markPending(true)
            },
            getMixedEffect: async () => this.mixedEffect.slice(),
            setMixedEffect: async (b) => {
                this.mixedEffect = b.slice()
                this.markPending(true)
            },
            effectCatalog: RGB_MATRIX_CATALOG,
            getEffect: async () => ({
                ...this.rgbEffect,
                color: { ...this.rgbEffect.color },
            }),
            setEffect: async (state) => {
                this.rgbEffect = { ...state, color: { ...state.color } }
                this.markPending(true)
            },
        }

        // Cluster diagnostics (§N4b-3). The snapshot mirrors the firmware test
        // double: a coordinator with two node-bus followers (one ready+seen, one
        // still coming up). The real role event is dormant until the N5 election,
        // so — for the demo device only — emit one simulated transition a beat
        // after the first subscriber so the live feed isn't empty; the timer is
        // cleared when the last listener leaves.
        const roleListeners = new Set<(e: RoleEvent) => void>()
        let roleDemoTimer: ReturnType<typeof setTimeout> | null = null
        this.cluster = {
            getDiag: async (): Promise<ClusterDiag> => ({
                coordinator: true,
                localFlags: 0,
                localTerm: 0,
                peers: [
                    {
                        coordinator: false,
                        ready: true,
                        seen: true,
                        term: 0,
                        hbFlags: 0x01,
                    },
                    {
                        coordinator: false,
                        ready: false,
                        seen: true,
                        term: 0,
                        hbFlags: 0x00,
                    },
                ],
            }),
            onRoleChanged: (cb) => {
                roleListeners.add(cb)
                if (roleListeners.size === 1) {
                    roleDemoTimer = setTimeout(() => {
                        for (const l of roleListeners) {
                            l({ coordinator: false, flags: 0, term: 1 })
                        }
                        roleDemoTimer = null
                    }, 2000)
                }
                return () => {
                    roleListeners.delete(cb)
                    if (roleListeners.size === 0 && roleDemoTimer) {
                        clearTimeout(roleDemoTimer)
                        roleDemoTimer = null
                    }
                }
            },
        }
    }

    private defaultEncoders(): EncoderAction[] {
        const xparent: KeyAction = buildMockKeyAction(
            MOCK_KIND_TRANSPARENT,
            [],
            this.layerNames(),
        )
        return Array.from({ length: MOCK_ENCODER_COUNT }, () => ({
            cw: xparent,
            ccw: xparent,
        }))
    }

    private requireTapDance(idx: number): TapDanceEntry {
        if (idx < 0 || idx >= this.tapDances.length) {
            throw new ProtocolError(`Tap-dance index out of range: ${idx}`)
        }
        return this.tapDances[idx]
    }

    private requireCombo(idx: number): ComboEntry {
        if (idx < 0 || idx >= this.combos.length) {
            throw new ProtocolError(`Combo index out of range: ${idx}`)
        }
        return this.combos[idx]
    }

    private requireKeyOverride(idx: number): KeyOverrideEntry {
        if (idx < 0 || idx >= this.keyOverrides.length) {
            throw new ProtocolError(`Key-override index out of range: ${idx}`)
        }
        return this.keyOverrides[idx]
    }

    private requireAltRepeatKey(idx: number): AltRepeatKeyEntry {
        if (idx < 0 || idx >= this.altRepeatKeys.length) {
            throw new ProtocolError(`Alt-repeat-key index out of range: ${idx}`)
        }
        return this.altRepeatKeys[idx]
    }

    private requireMacro(idx: number): void {
        if (idx < 0 || idx >= this.macroBuffers.length) {
            throw new ProtocolError(`Macro index out of range: ${idx}`)
        }
    }

    private seedDefaultLayers(): void {
        // The runtime editing buffer is LOWERED from the seed config (source of
        // truth). Rich config-only features (lighting/macros/…) lower to
        // transparent here but survive in the config; edits raise back via
        // raiseMockToConfig. Base mirrors the legacy QWERTY+home-row-mods demo.
        const { layers } = lowerConfigToMock(this.seedCfg)
        this.nextLayerId = 0
        this.layers = layers.map((l) => {
            if (l.keys.length !== this.keyCount) {
                throw new ProtocolError(
                    `Seed layer "${l.name}" has ${l.keys.length} keys, expected ${this.keyCount}`,
                )
            }
            return { id: this.nextLayerId++, name: l.name, keys: l.keys }
        })
    }

    private layerNames(): string[] {
        return this.layers.map((l) => l.name)
    }

    private makeFiller(kind: string, params: number[] = []): KeyAction[] {
        return Array.from({ length: this.keyCount }, () =>
            buildMockKeyAction(kind, params, this.layerNames()),
        )
    }

    private requireUnlocked(): void {
        if (this.lockState !== 'unlocked') {
            throw new LockedError()
        }
    }

    private markPending(pending: boolean): void {
        // saveMode 'none': the demo is session-only — nothing is ever
        // save-pending, and with Save/Discard hidden a raised flag could never
        // be cleared. Keep the Observer plumbing (and the call sites marking
        // where a manual-save firmware WOULD pend) but pin the flag false.
        if (pending) return
        if (this.pendingChanges === pending) return
        this.pendingChanges = pending
        for (const cb of this.pendingChangesListeners) cb(pending)
    }

    private setLockState(next: LockState): void {
        if (this.lockState === next) return
        this.lockState = next
        for (const cb of this.lockStateListeners) cb(next)
    }

    private emitNotification(topic: string, payload: unknown): void {
        for (const cb of this.notificationListeners) cb({ topic, payload })
    }

    async getLockState(): Promise<LockState> {
        return this.lockState
    }

    async unlock(): Promise<void> {
        if (this.lockState === 'unlocked') return
        this.setLockState('unlocking')
        // Mock: instant unlock; real device would wait for user.
        this.setLockState('unlocked')
    }

    onLockStateChanged(cb: LockStateHandler): () => void {
        this.lockStateListeners.add(cb)
        return () => this.lockStateListeners.delete(cb)
    }

    async listActionTypes(): Promise<ActionType[]> {
        return buildMockActionTypes(this.capabilities.maxLayers ?? 8)
    }

    buildKeyAction(kind: string, params: number[]): KeyAction {
        return buildMockKeyAction(kind, params, this.layerNames())
    }

    async listKeyCatalog(): Promise<KeyCatalog> {
        return filterCatalogByCodec(this.codec)
    }

    async getKeymap(): Promise<Keymap> {
        return {
            layers: this.layers.map((l) => ({
                id: l.id,
                name: l.name,
                keys: relabelLayer(l.keys, this.layerNames()),
            })),
            availableLayers:
                (this.capabilities.maxLayers ?? 8) - this.layers.length,
            activeLayoutId: this.activeLayoutId,
            layouts: this.layouts.map((l) => ({ ...l })),
        }
    }

    async getPhysicalLayouts(): Promise<{
        layouts: PhysicalLayout[]
        activeLayoutId: number
    }> {
        return {
            layouts: this.layouts.map((l) => ({ ...l })),
            activeLayoutId: this.activeLayoutId,
        }
    }

    private layerIndexById(layerId: number): number {
        return this.layers.findIndex((l) => l.id === layerId)
    }

    async setKey(
        layerId: number,
        position: number,
        action: KeyAction,
    ): Promise<void> {
        this.requireUnlocked()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        if (position < 0 || position >= this.keyCount) {
            throw new ProtocolError(`Position out of range: ${position}`)
        }
        const layer = this.layers[idx]
        const next = layer.keys.slice()
        next[position] = buildMockKeyAction(
            action.kind,
            action.params,
            this.layerNames(),
        )
        this.layers[idx] = { ...layer, keys: next }
        this.markPending(true)
    }

    async setKeys(updates: KeyUpdate[]): Promise<void> {
        for (const u of updates) {
            await this.setKey(u.layerId, u.position, u.action)
        }
    }

    async addLayer(): Promise<Layer> {
        this.requireUnlocked()
        const max = this.capabilities.maxLayers ?? 8
        if (this.layers.length >= max) {
            throw new ProtocolError('Max layers reached')
        }
        const layer: Layer = {
            id: this.nextLayerId++,
            name: `Layer ${this.layers.length}`,
            keys: this.makeFiller(MOCK_KIND_TRANSPARENT),
        }
        this.layers.push(layer)
        this.markPending(true)
        return { ...layer, keys: relabelLayer(layer.keys, this.layerNames()) }
    }

    async removeLayer(layerId: number): Promise<void> {
        this.requireUnlocked()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        if (this.layers.length <= 1) {
            throw new ProtocolError('Cannot remove the only layer')
        }
        this.layers.splice(idx, 1)
        this.markPending(true)
    }

    async renameLayer(layerId: number, name: string): Promise<void> {
        this.requireUnlocked()
        const idx = this.layerIndexById(layerId)
        if (idx < 0) throw new ProtocolError(`Unknown layer id: ${layerId}`)
        this.layers[idx] = { ...this.layers[idx], name }
        this.markPending(true)
    }

    async moveLayer(startIndex: number, destIndex: number): Promise<void> {
        this.requireUnlocked()
        if (
            startIndex < 0 ||
            startIndex >= this.layers.length ||
            destIndex < 0 ||
            destIndex >= this.layers.length
        ) {
            throw new ProtocolError(
                `moveLayer indices out of range: ${startIndex} -> ${destIndex}`,
            )
        }
        const [moved] = this.layers.splice(startIndex, 1)
        this.layers.splice(destIndex, 0, moved)
        this.markPending(true)
    }

    async restoreLayer(layerId: number, atIndex: number): Promise<Layer> {
        this.requireUnlocked()
        const layer: Layer = {
            id: layerId,
            name: `Restored ${layerId}`,
            keys: this.makeFiller(MOCK_KIND_TRANSPARENT),
        }
        const clamped = Math.max(0, Math.min(atIndex, this.layers.length))
        this.layers.splice(clamped, 0, layer)
        this.nextLayerId = Math.max(this.nextLayerId, layerId + 1)
        this.markPending(true)
        return { ...layer, keys: relabelLayer(layer.keys, this.layerNames()) }
    }

    async setActivePhysicalLayout(layoutId: number): Promise<Keymap> {
        this.requireUnlocked()
        if (!this.layouts.some((l) => l.id === layoutId)) {
            throw new ProtocolError(`Unknown layout id: ${layoutId}`)
        }
        this.activeLayoutId = layoutId
        return this.getKeymap()
    }

    /* ── config-blob editing (demo) ──────────────────────────────────────────
     * The same surface the concrete RemapprKeyboardService exposes, so demo mode
     * presents the identical timing / behaviors / conditional-layer editors. The
     * mock has no blob compile + no commit round-trip, so setters mutate `cfg`
     * directly (copy-on-write); commit() is a no-op and discardChanges() resets. */

    getConfigDefaults(): ConfigDefaults {
        return { ...this.cfg.defaults }
    }

    setConfigDefaults(patch: Partial<ConfigDefaults>): void {
        this.requireUnlocked()
        const defaults = { ...this.cfg.defaults }
        for (const key of Object.keys(patch) as (keyof ConfigDefaults)[]) {
            const value = patch[key]
            if (value !== undefined) {
                defaults[key] = value
            } else {
                // undefined reverts the key to the seed (committed) value — matching
                // the concrete service, where dropping a staged edit falls back to
                // device truth rather than deleting the field.
                const seedVal = this.seedCfg.defaults?.[key]
                if (seedVal !== undefined) defaults[key] = seedVal
                else delete defaults[key]
            }
        }
        this.cfg = { ...this.cfg, defaults }
        this.configEdited = true
        this.markPending(true)
    }

    getHoldTaps(): CanonHoldTapDef[] {
        return (this.cfg.holdTaps ?? []).map((h) => ({ ...h }))
    }

    setHoldTap(idx: number, patch: Partial<CanonHoldTapDef>): void {
        this.requireUnlocked()
        const list = [...(this.cfg.holdTaps ?? [])]
        if (!list[idx])
            throw new ProtocolError(`no hold-tap definition at index ${idx}`)
        list[idx] = { ...list[idx], ...patch }
        this.cfg = { ...this.cfg, holdTaps: list }
        this.configEdited = true
        this.markPending(true)
    }

    getModMorphs(): CanonModMorph[] {
        return (this.cfg.modMorphs ?? []).map((m) => ({ ...m }))
    }

    setModMorph(idx: number, patch: Partial<CanonModMorph>): void {
        this.requireUnlocked()
        const list = [...(this.cfg.modMorphs ?? [])]
        if (!list[idx])
            throw new ProtocolError(`no mod-morph definition at index ${idx}`)
        list[idx] = { ...list[idx], ...patch }
        this.cfg = { ...this.cfg, modMorphs: list }
        this.configEdited = true
        this.markPending(true)
    }

    getConditionalLayers(): CanonConditionalLayer[] {
        return (this.cfg.conditionalLayers ?? []).map((c) => ({
            ifLayers: [...c.ifLayers],
            thenLayer: c.thenLayer,
        }))
    }

    setConditionalLayers(list: CanonConditionalLayer[]): void {
        this.requireUnlocked()
        this.cfg = {
            ...this.cfg,
            conditionalLayers: list.map((c) => ({
                ifLayers: [...c.ifLayers],
                thenLayer: c.thenLayer,
            })),
        }
        this.configEdited = true
        this.markPending(true)
    }

    async commit(): Promise<void> {
        this.requireUnlocked()
        this.markPending(false)
    }

    async discardChanges(): Promise<void> {
        this.requireUnlocked()
        this.seedDefaultLayers()
        this.cfg = this.seedCfg
        this.configEdited = false
        this.markPending(false)
    }

    async resetSettings(): Promise<void> {
        this.requireUnlocked()
        this.seedDefaultLayers()
        this.cfg = this.seedCfg
        this.configEdited = false
        this.activeLayoutId = 0
        this.markPending(false)
    }

    hasPendingChanges(): boolean {
        return this.pendingChanges
    }

    async refreshPendingChanges(): Promise<boolean> {
        return this.pendingChanges
    }

    onPendingChangesChanged(cb: PendingChangesHandler): () => void {
        this.pendingChangesListeners.add(cb)
        return () => this.pendingChangesListeners.delete(cb)
    }

    subscribe(cb: NotificationHandler): () => void {
        this.notificationListeners.add(cb)
        return () => this.notificationListeners.delete(cb)
    }

    /** Test/demo helper: synthesize an inbound notification. */
    pushNotification(topic: string, payload: unknown): void {
        this.emitNotification(topic, payload)
    }

    async exportConfig(): Promise<ExportedFile[]> {
        const km = await this.getKeymap()
        return [
            {
                filename: `${this.deviceInfo.name}.mock.json`,
                mime: 'application/json',
                content: JSON.stringify(
                    {
                        deviceInfo: this.deviceInfo,
                        keymap: {
                            layers: km.layers.map((l) => ({
                                id: l.id,
                                name: l.name,
                                keys: l.keys.map((k) => ({
                                    kind: k.kind,
                                    params: k.params,
                                })),
                            })),
                            activeLayoutId: km.activeLayoutId,
                        },
                    },
                    null,
                    2,
                ),
            },
        ]
    }

    async getConfigSource(): Promise<string | null> {
        // Once a config-blob editor has run, serve the edited config so the source
        // view reflects it. Otherwise the static demo returns its verbatim source
        // (comments + formatting preserved); a builder-seeded board serializes its
        // own config so the editor's source-of-truth is the board just designed.
        if (this.configEdited) return serializeKeymap(this.cfg)
        return this.seedCfg === SEED_CONFIG
            ? seedConfigSource
            : serializeKeymap(this.seedCfg)
    }

    onClosed(cb: ClosedHandler): () => void {
        if (this.closed) {
            cb()
            return () => undefined
        }
        this.closedListeners.add(cb)
        return () => this.closedListeners.delete(cb)
    }

    async disconnect(): Promise<void> {
        if (this.closed) return
        this.closed = true
        for (const cb of this.closedListeners) cb()
    }

    /** Used by layouts referencing MOCK_CORNE_LAYOUT for storybook fidelity. */
    static get layoutForStory(): PhysicalLayout {
        return MOCK_CORNE_LAYOUT
    }
}
