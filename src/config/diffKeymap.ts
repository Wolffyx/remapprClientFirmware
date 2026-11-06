// Pattern check: Dispatch Map (Tier 0) — applied — the keymap's sections are
// rows of three tables (field, keyed and set sections) that one loop each
// runs; layers, whose identity is their name, get their own matcher.
//
// What changed between two versions of a canonical keymap (ConfigKeymap, the
// result of parseKeymap). Every section ConfigKeymap carries is a row below:
// meta and keyboard details, the matrix, pins, controller, hardware, board and
// per-firmware sections field by field; keys, encoders, parts, layouts,
// combos, macros and the other behaviors item by item; layers by name, with
// their bindings, encoder and slider bindings position by position.
import { actionText, holdText, keyName, macroStepText } from './actionText'
import {
    asArray,
    asRecord,
    asText,
    diffFields,
    diffKeyed,
    diffSet,
    type DocumentChange,
    extrasText,
    type KeyedSpec,
    makeChange,
    omit,
    pick,
    type Rec,
    sameValue,
    unionKeys,
    valueText,
    type Where,
} from './diffCore'

const kb = (d: Rec): Rec => asRecord(d.keyboard)

/* ── field sections ─────────────────────────────────────────────────────── */

interface FieldSection extends Where {
    get: (doc: Rec) => unknown
}

const FIELD_SECTIONS: readonly FieldSection[] = [
    {
        area: 'document',
        path: '',
        label: 'Document',
        get: (d) => pick(d, ['schemaVersion']),
    },
    { area: 'meta', path: 'meta', label: 'Meta', get: (d) => d.meta },
    {
        area: 'meta',
        path: 'keyboard',
        label: 'Keyboard',
        get: (d) => pick(kb(d), ['id', 'name', 'split']),
    },
    {
        area: 'defaults',
        path: 'defaults',
        label: 'Defaults',
        get: (d) => d.defaults,
    },
    {
        area: 'matrix',
        path: 'keyboard.matrix',
        label: 'Matrix',
        get: (d) => kb(d).matrix,
    },
    {
        area: 'pins',
        path: 'keyboard.pins',
        label: 'Pins',
        get: (d) => kb(d).pins,
    },
    {
        area: 'controller',
        path: 'keyboard.controller',
        label: 'Controller',
        get: (d) => kb(d).controller,
    },
    {
        area: 'hardware',
        path: 'keyboard.hardware',
        label: 'Hardware',
        get: (d) => kb(d).hardware,
    },
    {
        area: 'vial',
        path: 'keyboard.vial',
        label: 'Vial',
        get: (d) => kb(d).vial,
    },
    {
        area: 'lighting',
        path: 'keyboard.lighting',
        label: 'Lighting',
        get: (d) => kb(d).lighting,
    },
    {
        area: 'firmware',
        path: 'keyboard.firmwareConfig',
        label: 'Firmware config',
        get: (d) => kb(d).firmwareConfig,
    },
    {
        area: 'firmware',
        path: 'firmware',
        label: 'Firmware',
        get: (d) => d.firmware,
    },
    { area: 'node', path: 'node', label: 'Node', get: (d) => d.node },
    { area: 'board', path: 'board', label: 'Board', get: (d) => d.board },
]

const SET_SECTIONS: readonly FieldSection[] = [
    {
        area: 'meta',
        path: 'keyboard.firmware',
        label: 'Firmware target',
        get: (d) => kb(d).firmware,
    },
    {
        area: 'feature',
        path: 'keyboard.features',
        label: 'Feature',
        get: (d) => kb(d).features,
    },
]

/* ── keyed sections ─────────────────────────────────────────────────────── */

interface KeyedSection extends KeyedSpec {
    get: (doc: Rec) => unknown
}

const byField =
    (field: string) =>
    (item: Rec, i: number): string =>
        asText(item[field], `#${i}`)

const byIndex = (_item: Rec, i: number): string => String(i)

const named =
    (noun: string, field: string) =>
    (key: string, item: Rec): string =>
        `${noun} "${asText(item[field], key)}"`

const comboText = (c: Rec): string =>
    `${asArray(c.keys).map(valueText).join('+')} → ${actionText(c.action)}${extrasText(c, ['name', 'keys', 'action'])}`

const macroText = (m: Rec): string =>
    `${asArray(m.steps).map(macroStepText).join(', ')}${extrasText(m, ['id', 'steps'])}`

function tapDanceText(t: Rec): string {
    const taps = asArray(t.taps).map((x) => {
        const step = asRecord(x)
        return `${asText(step.count, '?')}× ${actionText(step.action)}`
    })
    const hold = t.hold === undefined ? [] : [`hold ${holdText(t.hold)}`]
    return `${[...taps, ...hold].join(', ')}${extrasText(t, ['id', 'taps', 'hold'])}`
}

function modMorphText(m: Rec): string {
    const [plain, morphed] = asArray(m.bindings)
    const mods = asArray(m.mods).map(valueText).join('+')
    return `${actionText(plain)} / ${mods}: ${actionText(morphed)}${extrasText(m, ['id', 'mods', 'bindings'])}`
}

const conditionalText = (c: Rec): string =>
    `${asArray(c.ifLayers).map(valueText).join(' + ')} → ${asText(c.thenLayer, '?')}`

const overrideKey = (o: Rec, i: number): string =>
    [asText(o.trigger, `#${i}`), ...asArray(o.triggerMods).map(valueText)].join(
        '+',
    )

const leaderKey = (l: Rec, i: number): string =>
    asArray(l.sequence).map(keyName).join(' ') || `#${i}`

const KEY_GEOMETRY = ['x', 'y', 'w', 'h', 'r', 'rx', 'ry'] as const
const BOX_GEOMETRY = ['x', 'y', 'w', 'h', 'r'] as const

const KEYED_SECTIONS: readonly KeyedSection[] = [
    {
        area: 'key',
        path: 'keyboard.keys',
        get: (d) => kb(d).keys,
        key: byIndex,
        label: (key) => `Key ${key}`,
        geometry: KEY_GEOMETRY,
    },
    {
        area: 'encoder',
        path: 'keyboard.encoders',
        get: (d) => kb(d).encoders,
        key: byIndex,
        label: (key) => `Encoder ${key}`,
        geometry: ['x', 'y'],
    },
    {
        area: 'part',
        path: 'keyboard.parts',
        get: (d) => kb(d).parts,
        key: byField('id'),
        label: named('Part', 'name'),
        geometry: BOX_GEOMETRY,
    },
    {
        area: 'layout',
        path: 'keyboard.layouts',
        get: (d) => kb(d).layouts,
        key: byField('id'),
        label: named('Layout', 'name'),
    },
    {
        area: 'layout',
        path: 'keyboard.layoutOptions',
        get: (d) => kb(d).layoutOptions,
        key: byField('label'),
        label: named('Layout option', 'label'),
    },
    {
        area: 'combo',
        path: 'combos',
        get: (d) => d.combos,
        key: byField('name'),
        label: named('Combo', 'name'),
        text: comboText,
    },
    {
        area: 'macro',
        path: 'macros',
        get: (d) => d.macros,
        key: byField('id'),
        label: named('Macro', 'id'),
        text: macroText,
    },
    {
        area: 'tapDance',
        path: 'tapDances',
        get: (d) => d.tapDances,
        key: byField('id'),
        label: named('Tap dance', 'id'),
        text: tapDanceText,
    },
    {
        area: 'modMorph',
        path: 'modMorphs',
        get: (d) => d.modMorphs,
        key: byField('id'),
        label: named('Mod-morph', 'id'),
        text: modMorphText,
    },
    {
        area: 'holdTap',
        path: 'holdTaps',
        get: (d) => d.holdTaps,
        key: byField('id'),
        label: named('Hold-tap', 'id'),
    },
    {
        area: 'conditionalLayer',
        path: 'conditionalLayers',
        get: (d) => d.conditionalLayers,
        key: byField('thenLayer'),
        label: named('Conditional layer', 'thenLayer'),
        text: conditionalText,
    },
    {
        area: 'keyOverride',
        path: 'keyOverrides',
        get: (d) => d.keyOverrides,
        key: overrideKey,
        label: (_key, o) => `Key override ${keyName(o.trigger)}`,
    },
    {
        area: 'leader',
        path: 'leaderSequences',
        get: (d) => d.leaderSequences,
        key: leaderKey,
        label: (key) => `Leader "${key}"`,
        text: (l) => actionText(l.action),
    },
    {
        area: 'actionBinding',
        path: 'actionBindings',
        get: (d) => d.actionBindings,
        key: byField('position'),
        label: (key) => `Action binding, key ${key}`,
        text: (b) => actionText(b.action),
    },
    {
        area: 'autocorrect',
        path: 'autocorrect.entries',
        get: (d) => asRecord(d.autocorrect).entries,
        key: byField('typo'),
        label: (key) => `Autocorrect "${key}"`,
        text: (e) => asText(e.correction, valueText(e.correction)),
    },
]

/* ── layers ─────────────────────────────────────────────────────────────── */

const layerName = (l: Rec, i: number): string => asText(l.name, `layer ${i}`)

/** New index → old index: same name first, then a renamed layer that kept
 *  its slot. Unpaired new layers were added, unpaired old ones removed. */
function matchLayers(a: Rec[], b: Rec[]): Map<number, number> {
    const byName = new Map<string, number>()
    a.forEach((l, i) => {
        if (!byName.has(layerName(l, i))) byName.set(layerName(l, i), i)
    })
    const pairs = new Map<number, number>()
    const used = new Set<number>()
    b.forEach((l, j) => {
        const i = byName.get(layerName(l, j))
        if (i === undefined || used.has(i)) return
        pairs.set(j, i)
        used.add(i)
    })
    b.forEach((_l, j) => {
        if (pairs.has(j) || j >= a.length || used.has(j)) return
        pairs.set(j, j)
        used.add(j)
    })
    return pairs
}

/** New indices of paired layers whose order among the pairs changed. */
function reorderedLayers(pairs: Map<number, number>): Set<number> {
    const byNew = [...pairs].sort((x, y) => x[0] - y[0])
    const byOld = [...byNew].sort((x, y) => x[1] - y[1])
    const oldRank = new Map(byOld.map(([j], rank) => [j, rank]))
    return new Set(
        byNew.filter(([j], rank) => oldRank.get(j) !== rank).map(([j]) => j),
    )
}

const isSet = (x: unknown): boolean => asRecord(x).type !== 'transparent'

function layerText(l: Rec, i: number): string {
    const set = asArray(l.bindings).filter(isSet).length
    return `${layerName(l, i)} (${set} keys set)`
}

interface LayerPair {
    before: Rec
    after: Rec
    from: number
    to: number
}

export function diffLayers(a: unknown, b: unknown): DocumentChange[] {
    const before = asArray(a).map(asRecord)
    const after = asArray(b).map(asRecord)
    const pairs = matchLayers(before, after)
    const moved = reorderedLayers(pairs)
    const kept = after.flatMap((layer, j) => {
        const i = pairs.get(j)
        if (i === undefined) return [layerAdded(layer, j)]
        return diffLayer(
            { before: before[i], after: layer, from: i, to: j },
            moved,
        )
    })
    const paired = new Set(pairs.values())
    const gone = before.flatMap((l, i) =>
        paired.has(i) ? [] : [layerRemoved(l, i)],
    )
    return [...kept, ...gone]
}

const layerWhere = (l: Rec, i: number): Where => ({
    area: 'layer',
    path: `layers.${i}`,
    label: `Layer "${layerName(l, i)}"`,
})

const layerAdded = (l: Rec, j: number): DocumentChange =>
    makeChange(layerWhere(l, j), undefined, layerText(l, j))

const layerRemoved = (l: Rec, i: number): DocumentChange =>
    makeChange(layerWhere(l, i), layerText(l, i), undefined)

const LAYER_PARTS = ['name', 'bindings', 'encoders', 'sliderBindings']

function diffLayer(p: LayerPair, moved: Set<number>): DocumentChange[] {
    const where = layerWhere(p.after, p.to)
    return [
        ...renamed(p),
        ...(moved.has(p.to) ? [layerMoved(where, p)] : []),
        ...diffFields(
            where,
            omit(p.before, LAYER_PARTS),
            omit(p.after, LAYER_PARTS),
        ),
        ...diffBindings(where, p.before.bindings, p.after.bindings),
        ...diffEncoders(where, p.before.encoders, p.after.encoders),
        ...diffSliders(where, p.before.sliderBindings, p.after.sliderBindings),
    ]
}

function renamed(p: LayerPair): DocumentChange[] {
    const from = layerName(p.before, p.from)
    const to = layerName(p.after, p.to)
    if (from === to) return []
    const where = {
        area: 'layer',
        path: `layers.${p.to}.name`,
        label: `Layer ${p.to} name`,
    }
    return [makeChange(where, from, to)]
}

const layerMoved = (where: Where, p: LayerPair): DocumentChange =>
    makeChange(where, `position ${p.from}`, `position ${p.to}`, 'moved')

/* ── bindings ───────────────────────────────────────────────────────────── */

/** A missing binding is the transparent pad normalize fills in. */
const padded = (x: unknown): unknown => x ?? { type: 'transparent' }

const bindingText = (x: unknown): string | undefined =>
    x === undefined ? undefined : actionText(x)

function diffAction(where: Where, x: unknown, y: unknown): DocumentChange[] {
    if (sameValue(padded(x), padded(y))) return []
    return [makeChange(where, bindingText(x), bindingText(y))]
}

function diffBindings(layer: Where, a: unknown, b: unknown): DocumentChange[] {
    const before = asArray(a)
    const after = asArray(b)
    const count = Math.max(before.length, after.length)
    return Array.from({ length: count }, (_, k) => {
        const where = {
            area: 'binding',
            path: `${layer.path}.bindings.${k}`,
            label: `${layer.label}, key ${k}`,
        }
        return diffAction(where, before[k], after[k])
    }).flat()
}

const ENCODER_SLOTS: readonly [string, string][] = [
    ['cw', 'clockwise'],
    ['ccw', 'counter-clockwise'],
    ['press', 'press'],
]

function diffEncoders(layer: Where, a: unknown, b: unknown): DocumentChange[] {
    const before = asArray(a).map(asRecord)
    const after = asArray(b).map(asRecord)
    const count = Math.max(before.length, after.length)
    return Array.from({ length: count }, (_, k) =>
        ENCODER_SLOTS.flatMap(([slot, name]) => {
            const where = {
                area: 'encoder',
                path: `${layer.path}.encoders.${k}.${slot}`,
                label: `${layer.label}, encoder ${k} ${name}`,
            }
            const x = before[k]?.[slot]
            const y = after[k]?.[slot]
            return sameValue(x, y)
                ? []
                : [makeChange(where, bindingText(x), bindingText(y))]
        }),
    ).flat()
}

function sliderText(s: unknown): string {
    const r = asRecord(s)
    const actions = ['up', 'down', 'action']
        .filter((k) => r[k] !== undefined)
        .map((k) => `, ${k} ${actionText(r[k])}`)
    return `${valueText(r.map)}${actions.join('')}${extrasText(r, ['map', 'up', 'down', 'action'])}`
}

function diffSliders(layer: Where, a: unknown, b: unknown): DocumentChange[] {
    const before = asRecord(a)
    const after = asRecord(b)
    return unionKeys(before, after).flatMap((pos) => {
        if (sameValue(before[pos], after[pos])) return []
        const where = {
            area: 'slider',
            path: `${layer.path}.sliderBindings.${pos}`,
            label: `${layer.label}, slider ${pos}`,
        }
        const text = (s: unknown) =>
            s === undefined ? undefined : sliderText(s)
        return [makeChange(where, text(before[pos]), text(after[pos]))]
    })
}

/* ── the keymap ─────────────────────────────────────────────────────────── */

/** Every change between two canonical keymaps, section by section. */
export function diffKeymap(a: Rec, b: Rec): DocumentChange[] {
    return [
        ...FIELD_SECTIONS.flatMap((s) => diffFields(s, s.get(a), s.get(b))),
        ...SET_SECTIONS.flatMap((s) => diffSet(s, s.get(a), s.get(b))),
        ...KEYED_SECTIONS.flatMap((s) => diffKeyed(s, s.get(a), s.get(b))),
        ...diffLayers(a.layers, b.layers),
    ]
}
