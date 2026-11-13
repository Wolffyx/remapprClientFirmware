// Pattern check: Template Method (Tier 1) — extended — same fixed-sequence shape as src/__tests__/contract.ts runContractSuite, for the ControlsApi facade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingOf } from '@firmware/devices/defaults'
import type {
    ControlBinding,
    ControlsCatalog,
    DeviceControl,
    DeviceModel,
} from '@firmware/devices/types'
import type { ControlsApi, KeyboardService } from '@firmware/service'

export interface ControlsContractSetup {
    /** A connected service whose `controls` facade is under test. */
    makeService: () => KeyboardService | Promise<KeyboardService>
}

/** Fields of a binding that name an action from the catalog. */
const ACTION_FIELDS = new Set([
    'a',
    'hold',
    'click',
    'up',
    'down',
    'left',
    'right',
    'ul',
    'ur',
    'dl',
    'dr',
    'tl',
    'tr',
    'cw',
    'ccw',
    'press',
])

function referencedActions(b: ControlBinding): string[] {
    return Object.entries(b).flatMap(([k, v]) =>
        ACTION_FIELDS.has(k) && typeof v === 'string' ? [v] : [],
    )
}

function outputsOf(catalog: ControlsCatalog, c: DeviceControl): string[] {
    const list =
        c.kind === 'stick' || c.kind === 'trigger' || c.kind === 'axis'
            ? catalog.outputs[c.kind]
            : undefined
    return (list ?? []).map((o) => o.id)
}

/** Runs the ControlsApi contract against one device service. */
export function runControlsContractSuite(
    name: string,
    setup: ControlsContractSetup,
): void {
    describe(`ControlsApi contract — ${name}`, () => {
        let service: KeyboardService
        let controls: ControlsApi
        let model: DeviceModel
        let catalog: ControlsCatalog

        beforeEach(async () => {
            service = await setup.makeService()
            if (!service.controls) throw new Error('no controls facade')
            controls = service.controls
            model = await controls.getModel()
            catalog = await controls.getCatalog()
        })

        afterEach(async () => {
            vi.useRealTimers()
            await service.disconnect()
        })

        it('reports a kind matching its model', () => {
            expect(service.kind).toBe(model.kind)
        })

        it('places controls with unique ids and positive sizes', () => {
            const ids = model.controls.map((c) => c.id)
            expect(new Set(ids).size).toBe(ids.length)
            for (const c of model.controls) {
                expect(c.w).toBeGreaterThan(0)
                expect(c.h).toBeGreaterThan(0)
            }
        })

        it('declares a consistent catalog', () => {
            const ids = catalog.actions.map((a) => a.id)
            expect(new Set(ids).size).toBe(ids.length)
            const groups = new Set(catalog.groups.map((g) => g.id))
            for (const a of catalog.actions) expect(groups).toContain(a.group)
        })

        it('serves at least one profile and its bindings', async () => {
            const { profiles, activeId } = await controls.getProfiles()
            expect(profiles.length).toBeGreaterThan(0)
            expect(profiles.map((p) => p.id)).toContain(activeId)
            const ids = new Set(model.controls.map((c) => c.id))
            for (const p of profiles) {
                const bindings = await controls.getBindings(p.id)
                for (const id of Object.keys(bindings))
                    expect(ids).toContain(id)
            }
        })

        it('only binds actions and outputs from its own catalog', async () => {
            const known = new Set(catalog.actions.map((a) => a.id))
            const { profiles } = await controls.getProfiles()
            for (const p of profiles) {
                const bindings = await controls.getBindings(p.id)
                for (const c of model.controls) {
                    const b = bindingOf(c, bindings, catalog)
                    for (const id of referencedActions(b))
                        expect(known).toContain(id)
                    if ('out' in b)
                        expect(outputsOf(catalog, c)).toContain(b.out)
                }
            }
        })

        it('writes a binding to the named profile only', async (ctx) => {
            if (!controls.setBinding) return ctx.skip()
            const { profiles } = await controls.getProfiles()
            const target = profiles.at(-1)!
            const other = profiles[0]!
            const c = model.controls[0]!
            const before = await controls.getBindings(other.id)
            const next = { ...bindingOf(c, before, catalog) }
            await controls.setBinding(target.id, c.id, next)
            expect((await controls.getBindings(target.id))[c.id]).toEqual(next)
            if (target.id !== other.id) {
                expect(await controls.getBindings(other.id)).toEqual(before)
            }
        })

        it('streams live input only while someone listens', async (ctx) => {
            if (!controls.onInput) return ctx.skip()
            vi.useFakeTimers()
            const frames = vi.fn()
            const off = controls.onInput(frames)
            await vi.advanceTimersByTimeAsync(2000)
            expect(frames).toHaveBeenCalled()
            off()
            frames.mockClear()
            await vi.advanceTimersByTimeAsync(2000)
            expect(frames).not.toHaveBeenCalled()
        })

        it('returns an unsubscribe from onChanged', () => {
            const off = controls.onChanged(() => {})
            expect(typeof off).toBe('function')
            off()
        })
    })
}
