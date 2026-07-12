// pattern-check: skip — test wiring: compiles two bench-board configs through the
// remappr-board shield compiler + bundle and asserts the generated DT/Kconfig.
import { describe, expect, it } from 'vitest'

import { buildProjectBundle, getCompiler, parseKeymap } from '../../index'

// nRF52840 14-key macropad (rows 3/3/4/4), raw SoC gpios, col2row, NVS storage.
const NRF = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "NRF Macropad", "target": "zmk" },
    "keyboard": { "id": "nrf52840_test", "name": "NRF Macropad", "keys": [
        {"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0},
        {"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1},
        {"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2},{"x":3,"y":2},
        {"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":3,"y":3}
    ],
        "hardware": { "transform": { "rows": 4, "columns": 4, "map": [
            [0,0],[0,1],[0,2], [1,0],[1,1],[1,2],
            [2,0],[2,1],[2,2],[2,3], [3,0],[3,1],[3,2],[3,3] ] } } },
    "layers": [
        { "name": "base", "bindings": [
            "1","2","3","Q","W","E","A","S","D","F","Z","X","C","V" ] },
        { "name": "fn", "bindings": [
            {"type":"transparent"},{"type":"none"},{"type":"transparent"},
            {"type":"transparent"},{"type":"transparent"},{"type":"transparent"},
            {"type":"transparent"},{"type":"transparent"},{"type":"transparent"},
            {"type":"transparent"},{"type":"transparent"},{"type":"transparent"},
            {"type":"transparent"},{"type":"transparent"} ] }
    ],
    "board": { "matrix": { "diode": "col2row",
        "rows": [
            "&gpio1 15 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)",
            "&gpio1 13 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)",
            "&gpio0 9 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)",
            "&gpio0 10 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)" ],
        "cols": [
            "&gpio0 31 GPIO_ACTIVE_HIGH",
            "&gpio0 29 GPIO_ACTIVE_HIGH",
            "&gpio0 2 GPIO_ACTIVE_HIGH",
            "&gpio1 11 GPIO_ACTIVE_HIGH" ],
        "pollMs": 1 },
        "storage": "nvs" }
}`)

// STM32 U5 2x2, raw STM32 gpios, row2col, ZMS storage.
const STM = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "U5 Pad", "target": "zmk" },
    "keyboard": { "id": "u5a5_pad", "name": "U5 Pad", "keys": [
        {"x":0,"y":0},{"x":1,"y":0},{"x":0,"y":1},{"x":1,"y":1}
    ]},
    "layers": [ { "name": "base", "bindings": ["A","B","C","D"] } ],
    "board": { "matrix": { "diode": "row2col",
        "rows": ["&gpioa 0 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)",
                 "&gpioa 1 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)"],
        "cols": ["&gpiob 0 GPIO_ACTIVE_HIGH", "&gpiob 1 GPIO_ACTIVE_HIGH"] },
        "storage": "zms" }
}`)

// Geometry only — no transform / per-key matrix / board.matrix → wiring auto-derived.
const GEO = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Geo Pad", "target": "zmk" },
    "keyboard": { "id": "geo_pad", "name": "Geo Pad", "keys": [
        {"x":0,"y":0},{"x":1,"y":0} ]},
    "layers": [ { "name": "base", "bindings": ["A","B"] } ]
}`)

const overlayOf = (config: typeof NRF, slug: string): string =>
    String(
        getCompiler('remappr-board')
            .compile(config)
            .files.find((f) => f.filename.endsWith(`${slug}.overlay`))!.content,
    )

describe('remappr-board shield compiler', () => {
    it('emits the shield file set (overlay + Kconfig.shield + Kconfig.defconfig)', () => {
        const { files } = getCompiler('remappr-board').compile(NRF)
        expect(files.map((f) => f.filename)).toEqual([
            'boards/shields/nrf52840_test/nrf52840_test.overlay',
            'boards/shields/nrf52840_test/Kconfig.shield',
            'boards/shields/nrf52840_test/Kconfig.defconfig',
        ])
    })

    it('emits the remappr-native matrix + keymap nodes with the raw gpios', () => {
        const ov = overlayOf(NRF, 'nrf52840_test')
        expect(ov).toContain('compatible = "remappr,kbd-matrix"')
        expect(ov).toContain('diode-direction = "col2row"')
        expect(ov).toContain('poll-period-ms = <1>;')
        expect(ov).toContain('<&gpio1 15 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(ov).toContain('<&gpio0 31 GPIO_ACTIVE_HIGH>')
        expect(ov).toContain('compatible = "input-keymap"')
        expect(ov).toContain('REMAPPR_MATRIX_KEYMAP(')
        // Explicit transform wiring → cells match the electrical matrix.
        expect(ov).toContain('CELL(0, 0)')
        expect(ov).toContain('CELL(2, 3)')
        expect(ov).toContain('CELL(3, 3)')
        expect(ov).toContain('row-size = <4>;')
        expect(ov).toContain('col-size = <4>;')
        expect(ov).toContain('compatible = "remappr,keymap"')
        expect(ov).toContain('scan = <&kbd_matrix>;')
        expect(ov).toContain('columns = <4>;')
        expect(ov).toContain('rows = <3 3 4 4>;')
        expect(ov).toContain('max-layers = <2>;')
    })

    it('lowers plain keys to &key HID usages and transparent/none to &pass/&block', () => {
        const ov = overlayOf(NRF, 'nrf52840_test')
        expect(ov).toContain('layer_0 {')
        expect(ov).toContain('&key 0x1E') // "1"
        expect(ov).toContain('&key 0x04') // "A"
        expect(ov).toContain('&key 0x14') // "Q"
        expect(ov).toContain('layer_1 {')
        expect(ov).toContain('&pass') // transparent
        expect(ov).toContain('&block') // none
    })

    it('registers the shield Kconfig with the firmware def_bool form', () => {
        const files = getCompiler('remappr-board').compile(NRF).files
        const shield = String(
            files.find((f) => f.filename.endsWith('Kconfig.shield'))!.content,
        )
        expect(shield).toContain('config SHIELD_NRF52840_TEST')
        expect(shield).toContain('def_bool $(shields_list_contains,nrf52840_test)')
    })

    it('defaults INPUT + the NVS storage backend in Kconfig.defconfig', () => {
        const defcfg = String(
            getCompiler('remappr-board')
                .compile(NRF)
                .files.find((f) => f.filename.endsWith('Kconfig.defconfig'))!
                .content,
        )
        expect(defcfg).toContain('if SHIELD_NRF52840_TEST')
        expect(defcfg).toContain('config INPUT')
        expect(defcfg).toContain('default y')
        expect(defcfg).toContain('choice REMAPPR_SETTINGS_BACKEND')
        expect(defcfg).toContain('default REMAPPR_SETTINGS_BACKEND_NVS')
        expect(defcfg).toContain('endif # SHIELD_NRF52840_TEST')
    })

    it('honors diode/ storage for a second (STM32 U5) board', () => {
        const ov = overlayOf(STM, 'u5a5_pad')
        expect(ov).toContain('diode-direction = "row2col"')
        expect(ov).toContain('<&gpioa 0 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>')
        expect(ov).toContain('rows = <2 2>;')
        expect(ov).toContain('columns = <2>;')
        const defcfg = String(
            getCompiler('remappr-board')
                .compile(STM)
                .files.find((f) => f.filename.endsWith('Kconfig.defconfig'))!
                .content,
        )
        expect(defcfg).toContain('default REMAPPR_SETTINGS_BACKEND_ZMS')
    })

    it('warns when the matrix wiring is auto-derived from geometry', () => {
        const geo = getCompiler('remappr-board').compile(GEO)
        expect(
            geo.diagnostics.some((d) => /auto-derived/.test(d.message)),
        ).toBe(true)
        // The explicit-transform board does NOT warn about wiring.
        const nrf = getCompiler('remappr-board').compile(NRF)
        expect(
            nrf.diagnostics.some((d) => /auto-derived/.test(d.message)),
        ).toBe(false)
    })

    it('buildProjectBundle wraps the shield dir + a README', () => {
        const bundle = buildProjectBundle(NRF, 'remappr-board')
        const paths = bundle.files.map((f) => f.filename)
        expect(paths).toEqual(
            expect.arrayContaining([
                'boards/shields/nrf52840_test/nrf52840_test.overlay',
                'boards/shields/nrf52840_test/Kconfig.shield',
                'boards/shields/nrf52840_test/Kconfig.defconfig',
                'README.md',
            ]),
        )
        expect(bundle.rootName).toBe('nrf52840_test-remappr-shield')
    })
})
