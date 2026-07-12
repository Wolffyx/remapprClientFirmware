import { describe, expect, it } from 'vitest'
import { getCompiler, parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr/index'
import { serializeKeymap } from '../serialize'
import {
    isV2,
    migrateAction,
    migrateMacroStep,
    migrateToV1,
} from '../migrate'

// Compile a JSON source to its RMBC bytes through the full pipeline.
const bytesOf = (source: string): Uint8Array =>
    getCompiler('remappr').compile(parseKeymap(source)).files[0]
        .content as Uint8Array

describe('migrate: v2 detection', () => {
    it('detects schemaVersion:2 and version:2, ignores v1', () => {
        expect(isV2({ schemaVersion: 2 })).toBe(true)
        expect(isV2({ version: 2 })).toBe(true)
        expect(isV2({ schemaVersion: 1 })).toBe(false)
        expect(isV2({})).toBe(false)
        expect(isV2('nope')).toBe(false)
    })

    it('leaves a v1 document untouched', () => {
        const v1 = { schemaVersion: 1, kind: 'remappr.keymap', layers: [] }
        expect(migrateToV1(v1)).toBe(v1)
    })
})

describe('migrate: action string grammar', () => {
    it('lowers keyword actions', () => {
        expect(migrateAction('___')).toEqual({ type: 'transparent' })
        expect(migrateAction('xxx')).toEqual({ type: 'none' })
        expect(migrateAction('capsword')).toEqual({ type: 'caps_word' })
        expect(migrateAction('repeat')).toEqual({ type: 'key_repeat' })
        expect(migrateAction('reset')).toEqual({ type: 'reset' })
    })

    it('lowers layer verbs with mode + aliases', () => {
        expect(migrateAction('layer:nav')).toEqual({
            type: 'layer',
            mode: 'momentary',
            layer: 'nav',
        })
        expect(migrateAction('layer:game:toggle')).toEqual({
            type: 'layer',
            mode: 'toggle',
            layer: 'game',
        })
        expect(migrateAction('mo:nav')).toEqual({
            type: 'layer',
            mode: 'momentary',
            layer: 'nav',
        })
        expect(migrateAction('tog:game')).toEqual({
            type: 'layer',
            mode: 'toggle',
            layer: 'game',
        })
    })

    it('lowers ref verbs incl. parameterized calls', () => {
        expect(migrateAction('sticky:LShift')).toEqual({
            type: 'sticky_key',
            key: 'LShift',
        })
        expect(migrateAction('macro:email')).toEqual({
            type: 'macro',
            ref: 'email',
        })
        expect(migrateAction('macro:greet(A)')).toEqual({
            type: 'macro',
            ref: 'greet',
            param: 'A',
        })
        expect(migrateAction('td:esc-caps')).toEqual({
            type: 'tap_dance',
            ref: 'esc-caps',
        })
        expect(migrateAction('mm:shift-del')).toEqual({
            type: 'mod_morph',
            ref: 'shift-del',
        })
        expect(migrateAction('ht:home-row(LGui,A)')).toEqual({
            type: 'hold_tap',
            ref: 'home-row',
            holdParam: 'LGui',
            tapParam: 'A',
        })
        expect(migrateAction('mouse:left')).toEqual({
            type: 'mouse_key',
            button: 'left',
        })
        expect(migrateAction('scroll:up')).toEqual({
            type: 'mouse_scroll',
            direction: 'up',
        })
    })

    it('passes bare keys and unknown verbs through as strings', () => {
        expect(migrateAction('A')).toBe('A')
        expect(migrateAction('Ctrl+C')).toBe('Ctrl+C')
    })

    it('lowers a tap-hold object', () => {
        expect(migrateAction({ tap: 'A', hold: 'LGui' })).toEqual({
            type: 'tap_hold',
            tap: 'A',
            hold: { type: 'modifier', modifier: 'LEFT_GUI' },
        })
        expect(
            migrateAction({ tap: 'Space', hold: 'layer:nav', term: 200 }),
        ).toEqual({
            type: 'tap_hold',
            tap: 'Space',
            hold: { type: 'layer', layer: 'nav' },
            tappingTermMs: 200,
        })
    })
})

describe('migrate: macro step grammar', () => {
    it('lowers step strings', () => {
        expect(migrateMacroStep('A')).toEqual({ type: 'tap', key: 'A' })
        expect(migrateMacroStep('wait:50')).toEqual({ type: 'wait', ms: 50 })
        expect(migrateMacroStep('text:hi there')).toEqual({
            type: 'text',
            text: 'hi there',
        })
        expect(migrateMacroStep('param')).toEqual({ type: 'param' })
        expect(migrateMacroStep('pause')).toEqual({
            type: 'pause_for_release',
        })
    })
})

// The headline guarantee: an ergonomic v2 doc and its verbose v1 spelling
// compile to the EXACT same RMBC blob. Proves the down-migration is
// semantics-preserving without hardcoding golden bytes.
describe('migrate: v2 ≡ v1 byte-identical', () => {
    const V1 = `{
        "schemaVersion": 1, "kind": "remappr.keymap",
        "meta": { "name": "Demo", "target": "zmk" },
        "keyboard": { "id": "demo", "name": "Demo",
            "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
        "defaults": { "tappingTermMs": 200 },
        "layers": [
            { "name": "base", "bindings": [
                "A",
                { "type": "tap_hold", "tap": "F",
                  "hold": { "type": "modifier", "modifier": "LEFT_GUI" } },
                { "type": "layer", "mode": "momentary", "layer": "nav" },
                { "type": "macro", "ref": "greet", "param": "A" }
            ] },
            { "name": "nav", "bindings": ["Left","Down","Up","Right"] }
        ],
        "macros": [
            { "id": "greet", "steps": [
                { "type": "tap", "key": "H" },
                { "type": "param" },
                { "type": "tap", "key": "1" }
            ] }
        ]
    }`

    const V2 = `{
        "version": 2, "kind": "remappr.keymap",
        "meta": { "name": "Demo", "target": "zmk" },
        "keyboard": { "id": "demo", "name": "Demo",
            "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},{"x":3,"y":0}] },
        "defaults": { "tappingTermMs": 200 },
        "layers": [
            { "name": "base", "keys": [
                "A",
                { "tap": "F", "hold": "LGui" },
                "layer:nav",
                "macro:greet(A)"
            ] },
            { "name": "nav", "keys": ["Left","Down","Up","Right"] }
        ],
        "macros": {
            "greet": [ "H", "param", "1" ]
        }
    }`

    it('produces identical bytes', () => {
        expect(bytesOf(V2)).toEqual(bytesOf(V1))
    })

    it('synthesizes geometry when keyboard is omitted', () => {
        const noBoard = `{
            "version": 2, "kind": "remappr.keymap",
            "meta": { "name": "NB", "target": "zmk" },
            "layers": [ { "name": "base", "keys": ["A","B","C"] } ]
        }`
        // Compiles without a keyboard block (geometry synthesized from layer 0).
        const b = bytesOf(noBoard)
        expect(b.slice(0, 4)).toEqual(Uint8Array.from([0x52, 0x4d, 0x42, 0x43]))
    })
})

describe('migrate: node/firmware/board sections', () => {
    const SRC = `{
        "version": 2, "kind": "remappr.keymap", "meta": { "name": "N" },
        "layers": [ { "name": "base", "keys": ["A","B"] } ],
        "node": { "personality": "mouse", "mouse": { "cpi": 1600 } },
        "firmware": { "remappr": { "storage": "zms" } },
        "board": { "controller": { "custom": true, "soc": "stm32u5a5zj",
                   "name": "my_split" }, "split": true }
    }`

    it('preserves sections through parse + serialize', () => {
        const cfg = parseKeymap(SRC)
        expect(cfg.node).toEqual({ personality: 'mouse', mouse: { cpi: 1600 } })
        expect(cfg.firmware).toEqual({ remappr: { storage: 'zms' } })
        expect(cfg.board?.controller).toEqual({
            custom: true,
            soc: 'stm32u5a5zj',
            name: 'my_split',
        })
        const round = JSON.parse(serializeKeymap(cfg))
        expect(round.node).toEqual(cfg.node)
        expect(round.firmware).toEqual(cfg.firmware)
        expect(round.board).toEqual(cfg.board)
    })

    it('does not affect the compiled blob', () => {
        const bare = `{ "version": 2, "kind": "remappr.keymap",
            "meta": { "name": "N" },
            "layers": [ { "name": "base", "keys": ["A","B"] } ] }`
        expect(bytesOf(SRC)).toEqual(bytesOf(bare))
    })
})

describe('migrate: studio_unlock is rejected on remappr', () => {
    it('emits a clear error, not a silent NONE', () => {
        const cfg = parseKeymap(`{
            "version": 2, "kind": "remappr.keymap",
            "meta": { "name": "SU", "target": "zmk" },
            "layers": [ { "name": "base",
                "keys": ["A", { "type": "studio_unlock" }] } ]
        }`)
        const { diagnostics } = buildRemapprBlob(cfg, { configVersion: 1 })
        const err = diagnostics.find(
            (d) => d.level === 'error' && /studio_unlock/.test(d.message),
        )
        expect(err).toBeDefined()
        expect(err?.message).toMatch(/RUCP control/)
    })
})

// Guards the docs/json-config.md examples: a doc exercising the full v2 grammar
// must compile with zero errors, so the reference never drifts from the code.
describe('migrate: documented v2 grammar compiles clean', () => {
    it('compiles the reference example', () => {
        const cfg = parseKeymap(`{
            "version": 2, "kind": "remappr.keymap",
            "meta": { "name": "Ref" },
            "defaults": { "tappingTermMs": 180, "quickTapMs": 120 },
            "layers": [
                { "name": "base", "keys": [
                    "Q", "Ctrl+C", "␣",
                    { "tap": "A", "hold": "LGui" },
                    { "tap": "Space", "hold": "layer:nav", "term": 200 },
                    "layer:nav", "layer:game:toggle", "sticky:LShift",
                    "capsword", "repeat",
                    "macro:email", "macro:greet(A)",
                    "td:esc-caps", "mm:shift-del", "ht:home-row(LGui,A)",
                    "mouse:left", "scroll:up", "___", "xxx"
                ] },
                { "name": "nav", "keys": ["Left","Down","Up","Right"] },
                { "name": "game", "keys": ["1","2","3","4"] }
            ],
            "combos": [ { "keys": [0, 5], "do": "Esc", "timeoutMs": 30 } ],
            "macros": {
                "email": [ "text:me@example.com", "wait:50", "Enter" ],
                "greet": [ "H", "param", "1" ]
            },
            "tapDances": {
                "esc-caps": { "1": "Esc", "2": "capsword",
                              "timing": { "tappingTermMs": 200 } }
            },
            "modMorphs": {
                "shift-del": { "on": ["LShift","RShift"], "base": "Backspace",
                               "morphed": "Delete", "keepMods": ["LShift"] }
            },
            "holdTaps": {
                "home-row": { "flavor": "balanced",
                    "timing": { "tappingTermMs": 220, "quickTapMs": 150 },
                    "flags": { "retroTap": true },
                    "positions": [3, 4] }
            },
            "conditionalLayers": [ { "if": ["nav", "game"], "then": "base" } ]
        }`)
        const { diagnostics } = buildRemapprBlob(cfg, { configVersion: 1 })
        expect(diagnostics.filter((d) => d.level === 'error')).toEqual([])
    })
})
