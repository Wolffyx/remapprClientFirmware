import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    materializeMatrix,
    parseKeymap,
    parseSurface,
    preferredSourceJson,
    safeParseSurface,
    serializeKeymap,
    ACTION_TYPES,
} from '../index'

const seedPath = fileURLToPath(
    new URL('../../clients/mock/seed.keymap.json', import.meta.url),
)
const seed = readFileSync(seedPath, 'utf8')

describe('config schema', () => {
    it('parses the demo seed without validation errors', () => {
        const res = safeParseSurface(seed)
        if (!res.success) {
            // Surface failures clearly so the assertion message is actionable.
            throw new Error(JSON.stringify(res.error.issues, null, 2))
        }
        expect(res.success).toBe(true)
    })

    it('normalizes shorthands to canonical form', () => {
        const km = parseKeymap(seed)
        const base = km.layers.find((l) => l.name === 'base')!
        // bare string "Q" -> key_press
        expect(base.bindings[0]).toMatchObject({ type: 'key_press' })
        // "Ctrl+C" on the lower layer -> key_press with mods
        const lower = km.layers.find((l) => l.name === 'lower')!
        const copy = lower.bindings[10]
        expect(copy).toMatchObject({ type: 'key_press', mods: ['LEFT_CTRL'] })
        // layer_tap preset -> tap_hold with a layer hold (R-thumb Backspace/Lower)
        expect(base.bindings[34]).toMatchObject({
            type: 'tap_hold',
            hold: { type: 'layer', layer: 'lower' },
            _preset: 'layer_tap',
        })
    })

    it('round-trips parse -> serialize -> parse to a stable document', () => {
        const once = parseKeymap(seed)
        const text = serializeKeymap(once)
        const twice = parseKeymap(text)
        // Strip serialize-only hints for a structural compare.
        expect(stripHints(twice)).toEqual(stripHints(once))
        // And serialize is idempotent.
        expect(serializeKeymap(twice)).toEqual(text)
    })

    it('flags an unknown keycode with a precise path', () => {
        const bad = seed.replace('"Q",', '"NOT_A_KEY",')
        const res = safeParseSurface(bad)
        expect(res.success).toBe(false)
        if (!res.success) {
            const issue = res.error.issues.find((i) =>
                i.message.includes('NOT_A_KEY'),
            )
            expect(issue).toBeDefined()
            expect(issue!.path).toEqual(['layers', 0, 'bindings', 0])
        }
    })

    it('allows an under-specified binding count (trailing transparents padded)', () => {
        const surface = parseSurface(seed)
        // drop one base binding — the gap is implicitly transparent, so valid
        const trimmed = {
            ...surface,
            layers: surface.layers.map((l, i) =>
                i === 0 ? { ...l, bindings: l.bindings.slice(0, -1) } : l,
            ),
        }
        const res = safeParseSurface(JSON.stringify(trimmed))
        expect(res.success).toBe(true)
    })

    it('flags too many bindings (more than the board has keys)', () => {
        const surface = parseSurface(seed)
        // append a stray binding with no key to land on
        const broken = {
            ...surface,
            layers: surface.layers.map((l, i) =>
                i === 0
                    ? { ...l, bindings: [...l.bindings, l.bindings[0]] }
                    : l,
            ),
        }
        const res = safeParseSurface(JSON.stringify(broken))
        expect(res.success).toBe(false)
    })

    it('drops trailing transparents on serialize and pads them back on parse', () => {
        const km = parseKeymap(seed)
        const keyCount = km.keyboard.keys.length
        // Force a layer's tail to transparent, keeping one real key up front.
        const sparse = {
            ...km,
            layers: km.layers.map((l, i) =>
                i === 0
                    ? {
                          ...l,
                          bindings: l.bindings.map((b, bi) =>
                              bi === 0 ? b : ({ type: 'transparent' } as const),
                          ),
                      }
                    : l,
            ),
        }
        const json = serializeKeymap(sparse)
        const reparsed = JSON.parse(json) as {
            layers: { bindings: unknown[] }[]
        }
        // Only the single real key survives in the emitted JSON…
        expect(reparsed.layers[0].bindings).toHaveLength(1)
        // …but normalize re-fills the layer back to one binding per key.
        const round = parseKeymap(json)
        expect(round.layers[0].bindings).toHaveLength(keyCount)
        expect(round.layers[0].bindings[keyCount - 1]).toEqual({
            type: 'transparent',
        })
    })

    it("preferredSourceJson keeps the user's literal text (incl. default values) when in sync", () => {
        // A hand-written config that spells out a key's default `"w": 1` — a
        // fresh serialize would strip it; preferredSourceJson must not.
        const literal = JSON.stringify(
            {
                schemaVersion: 1,
                kind: 'remappr.keymap',
                meta: { name: 'L', target: 'zmk' },
                keyboard: {
                    id: 'l',
                    name: 'L',
                    keys: [{ x: 0, y: 0, w: 1 }],
                },
                layers: [{ name: 'base', bindings: ['Q'] }],
            },
            null,
            2,
        )
        const config = parseKeymap(literal)
        // canonical serialize drops the explicit default…
        expect(serializeKeymap(config)).not.toContain('"w": 1')
        // …but the in-sync literal source is returned verbatim, preserving it.
        expect(preferredSourceJson(config, literal)).toBe(literal)
        expect(preferredSourceJson(config, literal)).toContain('"w": 1')
    })

    it('preferredSourceJson falls back to canonical when source has diverged', () => {
        const config = parseKeymap(seed)
        // A stale source from a different board → not in sync → canonical.
        const stale = '{"different":"config"}'
        expect(preferredSourceJson(config, stale)).toBe(serializeKeymap(config))
        expect(preferredSourceJson(config, null)).toBe(serializeKeymap(config))
    })

    it('strips default geometry (x/y/w/h/r) but keeps keyboard-specific markers', () => {
        const km = JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'G', target: 'zmk' },
            keyboard: {
                id: 'g',
                name: 'G',
                keys: [
                    // origin key, all defaults → serializes to {}
                    { x: 0, y: 0, w: 1, h: 1, r: 0 },
                    // only non-default x kept; variant/pin kept (board structure)
                    { x: 2, y: 0, variant: 'left', pin: 'GP1' },
                ],
            },
            layers: [{ name: 'base', bindings: ['Q', 'W'] }],
        })
        const out = JSON.parse(serializeKeymap(parseKeymap(km))) as {
            keyboard: { keys: Record<string, unknown>[] }
        }
        expect(out.keyboard.keys[0]).toEqual({})
        expect(out.keyboard.keys[1]).toEqual({
            x: 2,
            variant: 'left',
            pin: 'GP1',
        })
        // round-trips: normalize re-fills the stripped geometry.
        const round = parseKeymap(serializeKeymap(parseKeymap(km)))
        expect(round.keyboard.keys[0]).toMatchObject({ x: 0, y: 0, w: 1, r: 0 })
        expect(round.keyboard.keys[1]).toMatchObject({ x: 2, y: 0 })
    })

    it('strips tap-hold timings that equal the target default, per firmware', () => {
        const make = (target: string): string =>
            JSON.stringify({
                schemaVersion: 1,
                kind: 'remappr.keymap',
                meta: { name: 'T', target },
                keyboard: { id: 't', name: 'T', keys: [{ x: 0, y: 0 }] },
                layers: [
                    {
                        name: 'base',
                        bindings: [
                            {
                                type: 'mod_tap',
                                tap: 'A',
                                mod: 'LEFT_CTRL',
                                tappingTermMs: 200, // == default both targets → stripped
                                quickTapMs: 200, // default differs: zmk 0, qmk 200
                            },
                        ],
                    },
                ],
            })
        // ZMK: quickTapMs default 0, so an explicit 200 is kept; tappingTerm dropped.
        const zmk = serializeKeymap(parseKeymap(make('zmk')))
        expect(zmk).not.toContain('tappingTermMs')
        expect(zmk).toContain('quickTapMs')
        // QMK: quickTapMs default 200, so BOTH timings drop out.
        const qmk = serializeKeymap(parseKeymap(make('qmk')))
        expect(qmk).not.toContain('tappingTermMs')
        expect(qmk).not.toContain('quickTapMs')
    })

    it('carries per-key matrix [row,col] + board matrix descriptor, always visible', () => {
        const km = JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'M', target: 'qmk' },
            keyboard: {
                id: 'm',
                name: 'M',
                keys: [
                    { x: 0, y: 0, matrix: [0, 0] },
                    { x: 1, y: 0, matrix: [0, 1] },
                ],
                matrix: { rows: 1, cols: 2, diodeDirection: 'col2row' },
            },
            layers: [{ name: 'base', bindings: ['Q', 'W'] }],
        })
        const config = parseKeymap(km)
        expect(config.keyboard.keys[0].matrix).toEqual([0, 0])
        expect(config.keyboard.keys[1].matrix).toEqual([0, 1])
        expect(config.keyboard.matrix).toEqual({
            rows: 1,
            cols: 2,
            diodeDirection: 'col2row',
        })
        // matrix is keyboard-specific — present in serialized output (not stripped)
        const out = serializeKeymap(config)
        expect(out).toContain('"matrix": [')
        expect(out).toContain('"diodeDirection": "col2row"')
        // round-trips losslessly
        expect(stripHints(parseKeymap(out))).toEqual(stripHints(config))
    })

    it('materializeMatrix fills derived [row,col] + dims, keeping explicit ones', () => {
        // 2x2 grid, one key pre-wired by hand; the rest derive from position.
        const km = JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'D', target: 'qmk' },
            keyboard: {
                id: 'd',
                name: 'D',
                keys: [
                    { x: 0, y: 0, matrix: [5, 5] }, // explicit — must survive
                    { x: 1, y: 0 },
                    { x: 0, y: 1 },
                    { x: 1, y: 1 },
                ],
            },
            layers: [{ name: 'base', bindings: ['Q', 'W', 'E', 'R'] }],
        })
        const out = materializeMatrix(parseKeymap(km))
        expect(out.keyboard.keys[0].matrix).toEqual([5, 5]) // explicit kept
        // the rest are derived (present + within a 2-col grid)
        out.keyboard.keys.slice(1).forEach((k) => {
            expect(k.matrix).toBeDefined()
            expect(k.matrix![1]).toBeLessThanOrEqual(1)
        })
        // dims cover the explicit [5,5] → at least 6x6, diode + mode defaulted
        expect(out.keyboard.matrix?.rows).toBeGreaterThanOrEqual(6)
        expect(out.keyboard.matrix?.cols).toBeGreaterThanOrEqual(6)
        expect(out.keyboard.matrix?.diodeDirection).toBe('col2row')
        expect(out.keyboard.matrix?.mode).toBe('matrix')
    })

    it('exposes the action palette', () => {
        expect(ACTION_TYPES).toContain('key_press')
        expect(ACTION_TYPES).toContain('mod_tap')
        expect(ACTION_TYPES).toContain('layer')
    })
})

describe('builder metadata fields', () => {
    const builderConfig = JSON.stringify({
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: {
            name: 'B',
            target: 'zmk',
            vendorId: '0xFEED',
            productId: '0x0001',
        },
        keyboard: {
            id: 'b',
            name: 'B',
            keys: [
                {
                    x: 0,
                    y: 0,
                    variant: 'left',
                    element: 'encoder',
                    pin: 'GP29',
                },
                { x: 1, y: 0 },
            ],
            firmware: ['qmk', 'via', 'vial', 'zmk'],
            lighting: {
                underglow: { effect: 'solid', hue: 200, brightness: 80 },
                backlight: { brightness: 50, breathing: true },
            },
            firmwareConfig: {
                ble: true,
                studioLocking: false,
                softOff: true,
                kconfig: 'CONFIG_FOO=y',
            },
            hardware: {
                backlightPwm: {
                    instance: 'pwm0',
                    channel: 0,
                    pin: 'P0.13',
                    inverted: true,
                },
                ws2812: {
                    spi: 'spi3',
                    dataPin: 'P1.13',
                    chainLength: 10,
                    colorOrder: 'GRB',
                },
                extPowerCtrl: { controlGpio: 'P0.14', activeLow: true },
                studioAcm: true,
            },
            layouts: [{ id: 'left', name: 'Left' }],
            split: true,
        },
        layers: [
            {
                name: 'base',
                bindings: ['Q', 'W'],
                encoderBindings: { 0: { cw: 'A', ccw: 'B', press: 'C' } },
            },
        ],
    })

    it('parses + carries the builder fields into the canonical doc', () => {
        const km = parseKeymap(builderConfig)
        expect(km.meta.vendorId).toBe('0xFEED')
        expect(km.meta.productId).toBe('0x0001')
        expect(km.keyboard.firmware).toEqual(['qmk', 'via', 'vial', 'zmk'])
        expect(km.keyboard.lighting?.underglow?.hue).toBe(200)
        expect(km.keyboard.lighting?.backlight?.breathing).toBe(true)
        expect(km.keyboard.keys[0].variant).toBe('left')
        expect(km.keyboard.keys[0].element).toBe('encoder')
        expect(km.keyboard.keys[0].pin).toBe('GP29')
        expect(km.keyboard.keys[1].variant).toBeUndefined()
        expect(km.keyboard.layouts).toEqual([{ id: 'left', name: 'Left' }])
        expect(km.keyboard.split).toBe(true)
        expect(km.keyboard.firmwareConfig).toEqual({
            ble: true,
            studioLocking: false,
            softOff: true,
            kconfig: 'CONFIG_FOO=y',
        })
        expect(km.keyboard.hardware?.backlightPwm).toMatchObject({
            pin: 'P0.13',
            inverted: true,
        })
        expect(km.keyboard.hardware?.ws2812?.chainLength).toBe(10)
        expect(km.keyboard.hardware?.extPowerCtrl?.controlGpio).toBe('P0.14')
        expect(km.keyboard.hardware?.studioAcm).toBe(true)
        const base = km.layers[0]
        expect(base.encoderBindings?.[0]).toMatchObject({
            cw: { type: 'key_press' },
            ccw: { type: 'key_press' },
            press: { type: 'key_press' },
        })
    })

    it('round-trips the builder fields losslessly', () => {
        const once = parseKeymap(builderConfig)
        const text = serializeKeymap(once)
        const twice = parseKeymap(text)
        expect(stripHints(twice)).toEqual(stripHints(once))
        expect(serializeKeymap(twice)).toEqual(text)
    })

    it('omits the new fields when absent (old configs stay clean)', () => {
        const km = parseKeymap(serializeKeymap(parseKeymap(seed)))
        expect(km.meta.vendorId).toBeUndefined()
        expect(km.meta.productId).toBeUndefined()
        expect(km.keyboard.firmware).toBeUndefined()
        expect(km.keyboard.lighting).toBeUndefined()
        expect(km.keyboard.layouts).toBeUndefined()
        expect(km.keyboard.split).toBeUndefined()
        expect(km.keyboard.keys.some((k) => k.variant !== undefined)).toBe(
            false,
        )
        expect(km.keyboard.keys.some((k) => k.element !== undefined)).toBe(
            false,
        )
        expect(km.keyboard.keys.some((k) => k.pin !== undefined)).toBe(false)
        expect(km.layers.some((l) => l.encoderBindings !== undefined)).toBe(
            false,
        )
    })
})

describe('slider value-maps', () => {
    const sliderConfig = (bindings: Record<string, unknown>): string =>
        JSON.stringify({
            schemaVersion: 1,
            kind: 'remappr.keymap',
            meta: { name: 'S', target: 'zmk' },
            keyboard: {
                id: 's',
                name: 'S',
                keys: [
                    { x: 0, y: 0, element: 'slider', pin: 'GP29' },
                    { x: 1, y: 0 },
                ],
            },
            layers: [
                {
                    name: 'base',
                    bindings: ['Q', 'W'],
                    sliderBindings: bindings,
                },
            ],
        })

    it('parses slider value-maps into the canonical doc', () => {
        const km = parseKeymap(
            sliderConfig({
                0: { map: 'volume', min: 0, max: 100 },
            }),
        )
        expect(km.layers[0].sliderBindings?.[0]).toMatchObject({
            map: 'volume',
            min: 0,
            max: 100,
        })
    })

    it('round-trips a custom slider action losslessly', () => {
        const once = parseKeymap(
            sliderConfig({ 0: { map: 'custom', action: 'A' } }),
        )
        const text = serializeKeymap(once)
        const twice = parseKeymap(text)
        expect(stripHints(twice)).toEqual(stripHints(once))
        expect(serializeKeymap(twice)).toEqual(text)
        expect(twice.layers[0].sliderBindings?.[0].action).toMatchObject({
            type: 'key_press',
        })
    })

    it('rejects a slider binding for an out-of-range key', () => {
        const res = safeParseSurface(sliderConfig({ 5: { map: 'volume' } }))
        expect(res.success).toBe(false)
    })

    it('rejects min greater than max', () => {
        const res = safeParseSurface(
            sliderConfig({ 0: { map: 'volume', min: 100, max: 0 } }),
        )
        expect(res.success).toBe(false)
    })

    it('omits sliderBindings when absent', () => {
        const km = parseKeymap(serializeKeymap(parseKeymap(seed)))
        expect(km.layers.some((l) => l.sliderBindings !== undefined)).toBe(
            false,
        )
    })
})

// Recursively drop `_keySrc` / `_preset` serialize hints for structural equality.
function stripHints(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stripHints)
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (k === '_keySrc' || k === '_preset') continue
            out[k] = stripHints(val)
        }
        return out
    }
    return v
}
