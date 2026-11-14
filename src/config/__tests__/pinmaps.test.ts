import { describe, expect, it } from 'vitest'
import {
    resolveZmkPin,
    resolveQmkPin,
    gpioSpec,
    hasZmkPinMap,
    resolveNrfPin,
    resolveRpPin,
} from '../pinmaps'
import { getCompiler } from '../compiler'
import { buildProjectBundle } from '../bundle'
import { parseKeymap } from '../normalize'
import '../compilers/zmk'
import '../compilers/qmk'

/* ── resolver ──────────────────────────────────────────────────────────── */

describe('port-pin label forms', () => {
    it('maps nRF P<port>.<pin> to the gpio<port> controller', () => {
        expect(resolveNrfPin('P0.13')).toBe('&gpio0 13')
        expect(resolveNrfPin('p1.2')).toBe('&gpio1 2')
        expect(resolveNrfPin('P0.32')).toBeNull()
        expect(resolveNrfPin('PA3')).toBeNull()
    })

    it('maps RP2040 GP<n> to the one gpio0 bank', () => {
        expect(resolveRpPin('GP29')).toBe('&gpio0 29')
        expect(resolveRpPin('gp0')).toBe('&gpio0 0')
        expect(resolveRpPin('GP48')).toBeNull()
    })
})

describe('pin resolver', () => {
    it('maps a nexus-board label to the &pro_micro phandle (case-insensitive)', () => {
        expect(resolveZmkPin('nice_nano_v2', 'P4')).toBe('&pro_micro 4')
        expect(resolveZmkPin('nice_nano_v2', 'd4')).toBe('&pro_micro 4')
        expect(resolveZmkPin('nice_nano_v2', '4')).toBe('&pro_micro 4')
    })

    it('maps RP2040 GP labels to the bare gpio bank', () => {
        expect(resolveZmkPin('rp2040', 'GP29')).toBe('&gpio0 29')
        expect(resolveZmkPin('rpi_pico', 'GP0')).toBe('&gpio0 0')
    })

    it('returns null for unknown board or label', () => {
        expect(resolveZmkPin('mystery_board', 'GP1')).toBeNull()
        expect(resolveZmkPin('nice_nano_v2', 'GP99')).toBeNull()
        expect(resolveZmkPin(undefined, 'GP1')).toBeNull()
    })

    it('composes role-specific GPIO flags', () => {
        expect(gpioSpec('&gpio0 4', 'input')).toBe(
            '&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)',
        )
        expect(gpioSpec('&gpio0 4', 'output')).toBe('&gpio0 4 GPIO_ACTIVE_HIGH')
        expect(gpioSpec('&gpio0 4', 'direct')).toBe(
            '&gpio0 4 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)',
        )
    })

    it('resolveQmkPin falls back to the upper-cased label, applies board aliases', () => {
        expect(resolveQmkPin('rp2040', 'GP29')).toBe('GP29')
        expect(resolveQmkPin(undefined, 'b2')).toBe('B2')
        expect(resolveQmkPin('pro_micro', 'D5')).toBe('C6') // Arduino D5 → AVR C6
    })

    it('hasZmkPinMap reflects table coverage', () => {
        expect(hasZmkPinMap('nice_nano_v2')).toBe(true)
        expect(hasZmkPinMap('mystery_board')).toBe(false)
        expect(hasZmkPinMap(undefined)).toBe(false)
    })
})

/* ── ZMK overlay synthesis ─────────────────────────────────────────────── */

const matrixConfig = (board: string): string => `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Pinned", "target": "zmk" },
    "keyboard": {
        "id": "pinned", "name": "Pinned",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "hardware": { "board": "${board}" },
        "pins": { "rows": ["GP5"], "cols": ["GP6", "GP7"] }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

const directConfig = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Direct", "target": "zmk" },
    "keyboard": {
        "id": "direct", "name": "Direct",
        "keys": [{"x":0,"y":0,"pin":"GP2"},{"x":1,"y":0,"pin":"GP3"}],
        "hardware": { "board": "rp2040" }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

const overlayText = (source: string): string => {
    const { files } = getCompiler('zmk').compile(parseKeymap(source))
    return String(files.find((f) => f.filename.endsWith('.overlay'))!.content)
}

describe('ZMK synth kscan from pins', () => {
    it('synthesizes a matrix kscan when only friendly labels are present', () => {
        const out = overlayText(matrixConfig('rp2040'))
        expect(out).toContain('zmk,kscan-gpio-matrix')
        expect(out).toContain('zmk,kscan = <&kscan0>')
        // row GP5 (input side, col2row) and cols GP6/GP7 (output side) resolved
        expect(out).toContain('&gpio0 5 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)')
        expect(out).toContain('&gpio0 6 GPIO_ACTIVE_HIGH')
        expect(out).toContain('&gpio0 7 GPIO_ACTIVE_HIGH')
        expect(out).toContain('diode-direction = "col2row"')
    })

    it('comments unresolved labels and warns instead of breaking devicetree', () => {
        const { files, diagnostics } = getCompiler('zmk').compile(
            parseKeymap(matrixConfig('mystery_board')),
        )
        const out = String(
            files.find((f) => f.filename.endsWith('.overlay'))!.content,
        )
        expect(out).toContain('no GpioSpec for board mystery_board')
        expect(out).not.toContain('GPIO_PULL') // nothing resolved to a real spec
        expect(
            diagnostics.some(
                (d) => d.level === 'warn' && /not resolvable/.test(d.message),
            ),
        ).toBe(true)
    })

    it('synthesizes a direct kscan from per-key pins', () => {
        const out = overlayText(directConfig)
        expect(out).toContain('zmk,kscan-gpio-direct')
        expect(out).toContain('&gpio0 2 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)')
        expect(out).toContain('&gpio0 3 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)')
    })

    it('falls back to the geometry-only scaffold when no pins exist', () => {
        const out = overlayText(`{
            "schemaVersion": 1, "kind": "remappr.keymap",
            "meta": { "name": "Bare", "target": "zmk" },
            "keyboard": { "id": "bare", "name": "Bare",
                "keys": [{"x":0,"y":0}] },
            "layers": [{ "name": "base", "bindings": ["A"] }]
        }`)
        expect(out).not.toContain('kscan-gpio')
        expect(out).toContain('NOT the real kscan wiring')
    })
})

/* ── QMK keyboard.json matrix_pins ─────────────────────────────────────── */

const kbJson = (src: string): Record<string, unknown> => {
    const b = buildProjectBundle(parseKeymap(src), 'qmk')
    const f = b.files.find((f) => f.filename.endsWith('keyboard.json'))!
    return JSON.parse(String(f.content))
}

describe('QMK keyboard.json matrix_pins', () => {
    it('emits matrix_pins cols/rows + diode_direction from friendly pins', () => {
        const json = kbJson(matrixConfig('rp2040'))
        expect(json.matrix_pins).toEqual({
            rows: ['GP5'],
            cols: ['GP6', 'GP7'],
        })
        expect(json.diode_direction).toBe('COL2ROW')
    })

    it('emits a direct-pin grid placed by [row,col] from per-key pins', () => {
        const json = kbJson(directConfig)
        expect(json.matrix_pins).toEqual({ direct: [['GP2', 'GP3']] })
    })
})
