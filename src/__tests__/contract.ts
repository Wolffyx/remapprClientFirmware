// Pattern check: Template Method (Tier 1) — applied — fixed test sequence per adapter (probe → connect → exercise capability-gated facade ops); concrete steps come from caller-supplied setup() factory; same skeleton for zmk/mock/qmk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FirmwareAdapter } from '@firmware/adapter'
import type { KeyboardService } from '@firmware/service'
import type { Transport, TransportKind } from '@firmware'
import { LockedError } from '@firmware/errors'

export interface ContractSetup {
    /** Build the adapter under test. */
    makeAdapter: () => FirmwareAdapter
    /** Build a transport that adapter.canHandle should accept. */
    makeMatchingTransport: () => Transport
    /** Optional: build a transport that adapter.canHandle should reject. */
    makeMismatchingTransport?: () => Transport
    /** Hint passed to canHandle (defaults to 'serial'). */
    transportKind?: TransportKind
    /**
     * If true, the contract suite will attempt unlock() before any mutation.
     * Adapters whose `capabilities.lock === false` skip these calls; for
     * adapters that ship locked, set this so the suite can drive a real flow.
     */
    autoUnlock?: boolean
}

/**
 * Runs the FirmwareAdapter contract against a single adapter. Every adapter is
 * expected to pass this suite — capability-aware checks skip operations the
 * adapter explicitly opts out of via `Capabilities`.
 */
export function runContractSuite(name: string, setup: ContractSetup): void {
    describe(`FirmwareAdapter contract — ${name}`, () => {
        let adapter: FirmwareAdapter
        let service: KeyboardService | null = null

        beforeEach(() => {
            adapter = setup.makeAdapter()
        })

        afterEach(async () => {
            if (service) {
                await service.disconnect().catch(() => undefined)
                service = null
            }
        })

        async function connect(): Promise<KeyboardService> {
            const transport = setup.makeMatchingTransport()
            const ctrl = new AbortController()
            service = await adapter.connect(transport, ctrl.signal)
            if (setup.autoUnlock && service.capabilities.lock) {
                await service.unlock()
            }
            return service
        }

        it('exposes id and displayName', () => {
            expect(adapter.id).toBeTruthy()
            expect(typeof adapter.id).toBe('string')
            expect(adapter.displayName).toBeTruthy()
        })

        it('canHandle reports ok=true on a matching transport', async () => {
            const transport = setup.makeMatchingTransport()
            const probe = await adapter.canHandle(transport, {
                transportKind: setup.transportKind ?? 'serial',
            })
            expect(probe.ok).toBe(true)
            if (probe.ok) {
                expect(probe.deviceInfo.name).toBeTruthy()
                expect(probe.deviceInfo.firmware).toBeTruthy()
            }
        })

        if (setup.makeMismatchingTransport) {
            it('canHandle reports ok=false on a non-matching transport', async () => {
                const transport = setup.makeMismatchingTransport!()
                const probe = await adapter.canHandle(transport, {
                    transportKind: setup.transportKind ?? 'serial',
                })
                expect(probe.ok).toBe(false)
            })
        }

        it('connect returns a KeyboardService with deviceInfo + capabilities', async () => {
            const svc = await connect()
            expect(svc.deviceInfo).toBeTruthy()
            expect(svc.deviceInfo.name).toBeTruthy()
            expect(svc.deviceInfo.firmware).toBeTruthy()
            expect(svc.capabilities).toBeTruthy()
            expect(typeof svc.capabilities.lock).toBe('boolean')
            expect(Array.isArray(svc.capabilities.exportFormats)).toBe(true)
            // Every firmware must declare its save mode (drives the Save/Discard
            // affordance) — one of the three known values.
            expect(['manual', 'automatic', 'none']).toContain(
                svc.capabilities.saveMode,
            )
        })

        it('listActionTypes returns at least one ActionType', async () => {
            const svc = await connect()
            const types = await svc.listActionTypes()
            expect(types.length).toBeGreaterThan(0)
            for (const t of types) {
                expect(t.id).toBeTruthy()
                expect(t.displayName).toBeTruthy()
                expect(Array.isArray(t.slots)).toBe(true)
            }
        })

        it('getKeymap returns layers with neutral KeyAction shapes', async () => {
            const svc = await connect()
            const km = await svc.getKeymap()
            expect(Array.isArray(km.layers)).toBe(true)
            expect(km.layers.length).toBeGreaterThan(0)
            for (const layer of km.layers) {
                expect(typeof layer.id).toBe('number')
                expect(typeof layer.name).toBe('string')
                expect(Array.isArray(layer.keys)).toBe(true)
                for (const key of layer.keys) {
                    expect(typeof key.kind).toBe('string')
                    expect(Array.isArray(key.params)).toBe(true)
                    expect(typeof key.label.primary).toBe('string')
                }
            }
            expect(Array.isArray(km.layouts)).toBe(true)
            expect(km.layouts.length).toBeGreaterThan(0)
        })

        it('setKey round-trips through getKeymap', async () => {
            const svc = await connect()
            if (svc.capabilities.lock && !setup.autoUnlock) {
                // Adapter ships locked and suite was not asked to unlock —
                // setKey must reject with LockedError to satisfy the contract.
                const km0 = await svc.getKeymap()
                const layer0 = km0.layers[0]
                const types = await svc.listActionTypes()
                const trans =
                    types.find((t) => t.slots.length === 0) ?? types[0]
                await expect(
                    svc.setKey(layer0.id, 0, svc.buildKeyAction(trans.id, [])),
                ).rejects.toBeInstanceOf(LockedError)
                return
            }
            const km0 = await svc.getKeymap()
            const layer0 = km0.layers[0]
            const types = await svc.listActionTypes()
            const trans = types.find((t) => t.slots.length === 0) ?? types[0]
            const action = svc.buildKeyAction(trans.id, [])
            await svc.setKey(layer0.id, 0, action)
            const km1 = await svc.getKeymap()
            expect(km1.layers[0].keys[0].kind).toBe(trans.id)
            // Pending semantics follow saveMode: 'manual' stages the edit until
            // an explicit save; 'automatic' writes through (already durable) and
            // 'none' is session-only — neither has anything pending, and a stuck
            // true would strand the UI (Save/Discard hidden) and block
            // applyLayout's pending-changes guard.
            if (svc.capabilities.saveMode === 'manual') {
                expect(svc.hasPendingChanges()).toBe(true)
            } else {
                expect(svc.hasPendingChanges()).toBe(false)
            }
        })

        it('addLayer / removeLayer respects variableLayerCount', async () => {
            const svc = await connect()
            if (!svc.capabilities.variableLayerCount) {
                return
            }
            if (svc.capabilities.lock && !setup.autoUnlock) {
                await expect(svc.addLayer()).rejects.toBeInstanceOf(LockedError)
                return
            }
            const km0 = await svc.getKeymap()
            const before = km0.layers.length
            const added = await svc.addLayer()
            expect(added.id).toBeDefined()
            const km1 = await svc.getKeymap()
            expect(km1.layers.length).toBe(before + 1)
            await svc.removeLayer(added.id)
            const km2 = await svc.getKeymap()
            expect(km2.layers.length).toBe(before)
        })

        it('renameLayer updates the layer name when supported', async () => {
            const svc = await connect()
            if (!svc.capabilities.rename) return
            if (svc.capabilities.lock && !setup.autoUnlock) {
                const km = await svc.getKeymap()
                await expect(
                    svc.renameLayer(km.layers[0].id, 'X'),
                ).rejects.toBeInstanceOf(LockedError)
                return
            }
            const km0 = await svc.getKeymap()
            const layerId = km0.layers[0].id
            await svc.renameLayer(layerId, 'Renamed')
            const km1 = await svc.getKeymap()
            expect(km1.layers.find((l) => l.id === layerId)?.name).toBe(
                'Renamed',
            )
        })

        it('moveLayer reorders when reorderLayers is supported', async () => {
            const svc = await connect()
            if (!svc.capabilities.reorderLayers) return
            if (svc.capabilities.variableLayerCount) {
                if (!(svc.capabilities.lock && !setup.autoUnlock)) {
                    await svc.addLayer()
                }
            }
            const km0 = await svc.getKeymap()
            if (km0.layers.length < 2) return
            if (svc.capabilities.lock && !setup.autoUnlock) {
                await expect(svc.moveLayer(0, 1)).rejects.toBeInstanceOf(
                    LockedError,
                )
                return
            }
            const ids = km0.layers.map((l) => l.id)
            await svc.moveLayer(0, 1)
            const km1 = await svc.getKeymap()
            expect(km1.layers[0].id).toBe(ids[1])
            expect(km1.layers[1].id).toBe(ids[0])
        })

        it('lock state APIs honor capabilities.lock', async () => {
            const svc = await connect()
            const state = await svc.getLockState()
            if (svc.capabilities.lock) {
                expect(['locked', 'unlocking', 'unlocked']).toContain(state)
            } else {
                expect(state).toBe('not-applicable')
            }
            // unlock() must not throw regardless of capability.
            await svc.unlock()
        })

        it('subscribe returns an unsubscribe handle', async () => {
            const svc = await connect()
            const events: string[] = []
            const off = svc.subscribe((n) => events.push(n.topic))
            expect(typeof off).toBe('function')
            off()
        })

        it('exportConfig returns at least one file', async () => {
            const svc = await connect()
            const files = await svc.exportConfig()
            expect(Array.isArray(files)).toBe(true)
            expect(files.length).toBeGreaterThan(0)
            for (const f of files) {
                expect(f.filename).toBeTruthy()
                expect(f.mime).toBeTruthy()
                expect(f.content).toBeDefined()
            }
        })

        it('disconnect fires onClosed listeners exactly once', async () => {
            const svc = await connect()
            let callCount = 0
            svc.onClosed(() => callCount++)
            await svc.disconnect()
            // Re-disconnect must not double-fire.
            await svc.disconnect()
            expect(callCount).toBe(1)
            service = null
        })
    })
}
