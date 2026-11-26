// pattern-check: skip — unit test, no production logic
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { diffDocuments, parseKeymap } from '../index'
import { newDeviceConfig } from '../device'
import { layoutFromModel } from '../../devices/schema'
import { STOCK_MOUSE } from '../../devices/stockLayouts'

type Json = Record<string, any>

const seedText = readFileSync(
    fileURLToPath(
        new URL('../../clients/mock/seed.keymap.json', import.meta.url),
    ),
    'utf8',
)

/** The seed keymap's surface JSON, edited, then parsed like the library does. */
function seed(edit: (s: Json) => void = () => {}) {
    const surface = JSON.parse(seedText) as Json
    edit(surface)
    return parseKeymap(JSON.stringify(surface))
}

const base = seed()

describe('diffDocuments: keymap', () => {
    it('finds nothing between equal documents', () => {
        const d = diffDocuments(base, seed())
        expect(d).toEqual({
            kind: 'remappr.keymap',
            sameKind: true,
            changes: [],
            counts: {},
            summary: 'No changes',
        })
    })

    it('ignores how a key was spelled', () => {
        const spelled = seed((s) => {
            s.layers[0].bindings[0] = 'KC_Q'
        })
        expect(diffDocuments(base, spelled).changes).toEqual([])
    })

    it('reports a changed binding with readable texts', () => {
        const next = seed((s) => {
            s.layers[0].bindings[0] = 'Ctrl+C'
        })
        const d = diffDocuments(base, next)
        expect(d.changes).toEqual([
            {
                area: 'binding',
                op: 'changed',
                path: 'layers.0.bindings.0',
                label: 'Layer "base", key 0',
                before: 'Q',
                after: 'Ctrl+C',
            },
        ])
        expect(d.counts).toEqual({ binding: 1 })
        expect(d.summary).toBe('1 binding')
    })

    it('spells a mod-tap as tap / hold', () => {
        const next = seed((s) => {
            s.layers[0].bindings[5] = {
                type: 'mod_tap',
                tap: 'A',
                mod: 'LEFT_CTRL',
            }
        })
        const [c] = diffDocuments(base, next).changes
        expect(c).toMatchObject({
            before: 'A / hold Gui',
            after: 'A / hold Ctrl',
        })
    })

    it('reports a layer added, removed and renamed', () => {
        const added = seed((s) => {
            s.layers.push({ name: 'nav', bindings: ['Left', 'Right'] })
        })
        const d = diffDocuments(base, added)
        expect(d.changes).toEqual([
            {
                area: 'layer',
                op: 'added',
                path: 'layers.3',
                label: 'Layer "nav"',
                after: 'nav (2 keys set)',
            },
        ])
        expect(d.summary).toBe('1 layer added')

        const removed = diffDocuments(added, base)
        expect(removed.changes).toHaveLength(1)
        expect(removed.changes[0]).toMatchObject({
            area: 'layer',
            op: 'removed',
        })

        const renamed = parseKeymap(seedText.replaceAll('"raise"', '"upper"'))
        const r = diffDocuments(base, renamed).changes
        expect(r).toContainEqual({
            area: 'layer',
            op: 'changed',
            path: 'layers.2.name',
            label: 'Layer 2 name',
            before: 'raise',
            after: 'upper',
        })
    })

    it('reports reordered layers as moved', () => {
        const swapped = seed((s) => {
            ;[s.layers[1], s.layers[2]] = [s.layers[2], s.layers[1]]
        })
        const d = diffDocuments(base, swapped)
        const moved = d.changes.filter((c) => c.area === 'layer')
        expect(moved.map((c) => [c.op, c.label])).toEqual([
            ['moved', 'Layer "raise"'],
            ['moved', 'Layer "lower"'],
        ])
        expect(d.changes.every((c) => c.area === 'layer')).toBe(true)
    })

    it('reports combo and macro changes', () => {
        const next = seed((s) => {
            s.combos[0].action = 'TAB'
            s.combos = s.combos.filter((c: Json) => c.name !== 'tab')
            s.combos.push({ name: 'enter', keys: [10, 11], action: 'ENTER' })
            s.macros[0].steps.push({ type: 'wait', ms: 20 })
            s.macros.push({ id: 'hi', steps: [{ type: 'text', text: 'hi' }] })
        })
        const d = diffDocuments(base, next)
        const combos = d.changes.filter((c) => c.area === 'combo')
        expect(combos.map((c) => [c.op, c.label])).toEqual([
            ['changed', 'Combo "esc"'],
            ['added', 'Combo "enter"'],
            ['removed', 'Combo "tab"'],
        ])
        expect(combos[0].before).toMatch(/^0\+1 → Esc \(/)
        expect(combos[0].after).toMatch(/^0\+1 → Tab/)
        const macros = d.changes.filter((c) => c.area === 'macro')
        expect(macros.map((c) => [c.op, c.label])).toEqual([
            ['changed', 'Macro "lock_screen"'],
            ['added', 'Macro "hi"'],
        ])
        expect(macros[0].after).toContain('Release LGui, Wait 20 ms')
        expect(macros[1].after).toBe('Text "hi"')
        expect(d.summary).toBe('3 combos · 2 macros')
    })

    it('reports keys moved, added and removed', () => {
        const next = seed((s) => {
            s.keyboard.keys[0] = { x: 0.5, y: 0 }
            s.keyboard.keys.push({ x: 9, y: 9 })
        })
        const d = diffDocuments(base, next)
        const keys = d.changes.filter((c) => c.area === 'key')
        expect(keys[0]).toEqual({
            area: 'key',
            op: 'moved',
            path: 'keyboard.keys.0',
            label: 'Key 0',
            before: 'x: 0, y: 0, w: 1, h: 1, r: 0',
            after: 'x: 0.5, y: 0, w: 1, h: 1, r: 0',
        })
        expect(keys[1]).toMatchObject({ op: 'added', path: 'keyboard.keys.36' })
        expect(d.summary).toBe('2 keys')

        const removed = diffDocuments(next, base).changes.filter(
            (c) => c.area === 'key',
        )
        expect(removed.map((c) => c.op)).toEqual(['moved', 'removed'])
    })

    it('reports encoder bindings and meta', () => {
        const next = seed((s) => {
            s.meta.name = 'Renamed'
            s.layers[0].encoders[0].cw = 'PAGE_UP'
        })
        const d = diffDocuments(base, next)
        expect(d.changes.map((c) => [c.area, c.label, c.after])).toEqual([
            ['meta', 'Meta: name', 'Renamed'],
            ['encoder', 'Layer "base", encoder 0 clockwise', 'PgUp'],
        ])
    })
})

describe('diffDocuments: device layout', () => {
    const model = {
        kind: 'mouse' as const,
        form: 'mouse' as const,
        name: 'Mouse',
        shell: STOCK_MOUSE.shell,
        controls: [...STOCK_MOUSE.controls],
    }
    const layout = layoutFromModel(model)

    it('reports a moved control and a renamed layout', () => {
        const next = layoutFromModel({
            ...model,
            name: 'My mouse',
            controls: model.controls.map((c) =>
                c.id === 'wheel' ? { ...c, y: 1 } : c,
            ),
        })
        const d = diffDocuments(layout, next)
        expect(d.changes).toEqual([
            {
                area: 'meta',
                op: 'changed',
                path: 'name',
                label: 'Layout: name',
                before: 'Mouse',
                after: 'My mouse',
            },
            expect.objectContaining({
                area: 'control',
                op: 'moved',
                path: 'controls.wheel',
                label: 'Control "Scroll wheel"',
            }),
        ])
        expect(d.summary).toBe('1 detail · 1 control moved')
    })

    it('reports a control added and removed', () => {
        const fewer = layoutFromModel({
            ...model,
            controls: model.controls.filter((c) => c.id !== 'dpi'),
        })
        expect(diffDocuments(layout, fewer).changes).toEqual([
            expect.objectContaining({
                area: 'control',
                op: 'removed',
                path: 'controls.dpi',
            }),
        ])
        expect(diffDocuments(fewer, layout).summary).toBe('1 control added')
    })
})

describe('diffDocuments: device config', () => {
    it('reports a changed setting', () => {
        const a = {
            ...newDeviceConfig('mouse', 'Travel')!,
            mouse: { cpi: 800 },
        }
        const b = {
            ...a,
            mouse: { cpi: 1600, invertY: true },
            power: { sleepMs: 60000 },
        }
        const d = diffDocuments(a, b)
        expect(d.changes).toEqual([
            {
                area: 'setting',
                op: 'changed',
                path: 'mouse.cpi',
                label: 'Mouse: cpi',
                before: '800',
                after: '1600',
            },
            {
                area: 'setting',
                op: 'added',
                path: 'mouse.invertY',
                label: 'Mouse: invertY',
                after: 'true',
            },
            {
                area: 'setting',
                op: 'added',
                path: 'power.sleepMs',
                label: 'Power: sleepMs',
                after: '60000',
            },
        ])
        expect(d.summary).toBe('3 settings')
    })
})

describe('diffDocuments: kinds and malformed input', () => {
    it('reports a changed document type', () => {
        const d = diffDocuments(base, newDeviceConfig('mouse', 'M'))
        expect(d).toEqual({
            kind: 'remappr.device',
            sameKind: false,
            changes: [
                {
                    area: 'document',
                    op: 'changed',
                    path: 'kind',
                    label: 'Document type',
                    before: 'remappr.keymap',
                    after: 'remappr.device',
                },
            ],
            counts: { document: 1 },
            summary: '1 document change',
        })
    })

    it('compares an unknown kind field by field', () => {
        const d = diffDocuments(
            { kind: 'x.other', a: 1, b: { c: 2 } },
            { kind: 'x.other', a: 1, b: { c: 3 } },
        )
        expect(d.sameKind).toBe(true)
        expect(d.changes).toEqual([
            {
                area: 'document',
                op: 'changed',
                path: 'b.c',
                label: 'Document: b.c',
                before: '2',
                after: '3',
            },
        ])
    })

    it('never throws on malformed input', () => {
        const junk: unknown[] = [
            null,
            undefined,
            42,
            'text',
            [],
            { kind: 'remappr.keymap' },
            {
                kind: 'remappr.keymap',
                layers: 'no',
                keyboard: { keys: [null, 3] },
            },
            {
                kind: 'remappr.keymap',
                layers: [{ bindings: [null, { type: 'tap_hold' }, 7] }],
                combos: [{ keys: 'x' }, null],
                macros: [{ steps: [null, { type: 'tap' }] }],
            },
            { kind: 'remappr.device-layout', controls: [{}, null, 'x'] },
            { kind: 'remappr.device', mouse: 5, power: { idleMs: null } },
        ]
        for (const a of junk) {
            for (const b of junk) {
                expect(() => diffDocuments(a, b)).not.toThrow()
            }
        }
        const cyclic: Json = { kind: 'x.cycle' }
        cyclic.self = cyclic
        expect(() => diffDocuments(cyclic, { kind: 'x.cycle' })).not.toThrow()
        expect(diffDocuments(null, null).changes).toEqual([])
    })

    it('is deterministic', () => {
        const next = seed((s) => {
            s.layers[1].bindings[3] = 'Esc'
            s.keyboard.keys[2] = { x: 4, y: 4 }
        })
        expect(diffDocuments(base, next)).toEqual(diffDocuments(base, next))
        expect(diffDocuments(base, next).summary).toBe(
            '1 binding · 1 key moved',
        )
    })
})
