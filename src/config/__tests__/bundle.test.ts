import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildProjectBundle, parseKeymap } from '../index'

const seed = readFileSync(
    fileURLToPath(new URL('../../mock/seed.keymap.json', import.meta.url)),
    'utf8',
)
const seedConfig = parseKeymap(seed)

const paths = (b: { files: { filename: string }[] }): string[] =>
    b.files.map((f) => f.filename)
const fileText = (
    b: { files: { filename: string; content: string | Uint8Array }[] },
    name: string,
): string => String(b.files.find((f) => f.filename === name)!.content)

const HW = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Board X", "target": "zmk" },
    "keyboard": {
        "id": "board_x", "name": "Board X",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "hardware": {
            "board": "nice_nano_v2",
            "shield": "boardx",
            "kscan": {
                "type": "matrix", "diodeDirection": "col2row",
                "rowGpios": ["&gpio0 5 X"],
                "colGpios": ["&gpio0 6 X", "&gpio0 7 X"]
            }
        }
    },
    "layers": [{ "name": "base", "bindings": [
        { "type": "lighting", "target": "underglow", "action": "toggle" },
        "B"
    ] }]
}`

const HW_FULL = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Board Y", "target": "zmk" },
    "keyboard": {
        "id": "board_y", "name": "Board Y",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "controller": { "board": "nrf52840dk_nrf52840", "shield": "boardy" },
        "firmwareConfig": { "ble": true },
        "hardware": {
            "kscan": {
                "type": "matrix", "diodeDirection": "col2row",
                "rowGpios": ["&gpio0 5 X"], "colGpios": ["&gpio0 6 X"]
            },
            "backlightPwm": { "instance": "pwm0", "channel": 0, "pin": "P0.13", "inverted": true },
            "ws2812": { "spi": "spi3", "dataPin": "P1.13", "chainLength": 10, "colorOrder": "GRB" },
            "extPowerCtrl": { "controlGpio": "P0.14", "activeLow": true, "initDelayMs": 10 },
            "studioAcm": true
        }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

// Same peripherals on a non-nRF (RP2040) board: pins aren't nRF "P<port>.<pin>".
const HW_RP2040 = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Board Z", "target": "zmk" },
    "keyboard": {
        "id": "board_z", "name": "Board Z",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "controller": { "board": "sparkfun_pro_micro_rp2040", "shield": "boardz" },
        "hardware": {
            "kscan": {
                "type": "matrix", "diodeDirection": "col2row",
                "rowGpios": ["&gpio0 5 X"], "colGpios": ["&gpio0 6 X"]
            },
            "backlightPwm": { "instance": "pwm0", "channel": 0, "pin": "GP4" },
            "ws2812": { "spi": "spi0", "dataPin": "GP16", "chainLength": 8 }
        }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

// A split board: two 2×2 clusters separated by a clear horizontal gap, shield
// "mysplit_left" (base "mysplit"), four column pins (2 per half).
const SPLIT = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "My Split", "target": "zmk" },
    "keyboard": {
        "id": "my_split", "name": "My Split", "split": true,
        "keys": [
            {"x":0,"y":0},{"x":1,"y":0},{"x":0,"y":1},{"x":1,"y":1},
            {"x":4,"y":0},{"x":5,"y":0},{"x":4,"y":1},{"x":5,"y":1}
        ],
        "controller": { "board": "nice_nano_v2", "shield": "mysplit_left" },
        "pins": {
            "rows": ["P0.5", "P0.6"],
            "cols": ["P0.7", "P0.8", "P0.9", "P0.10"]
        }
    },
    "layers": [{ "name": "base", "bindings": ["A","B","C","D","E","F","G","H"] }]
}`

describe('buildProjectBundle — ZMK', () => {
    it('emits a full zmk-config shield skeleton', () => {
        const b = buildProjectBundle(seedConfig, 'zmk')
        const id = seedConfig.keyboard.id
        const SH = id.toUpperCase()
        const dir = `config/boards/shields/${id}`
        expect(paths(b)).toEqual(
            expect.arrayContaining([
                `${dir}/${SH}.keymap`,
                `${dir}/${SH}.conf`,
                `${dir}/${SH}.overlay`,
                `${dir}/Kconfig.shield`,
                `${dir}/Kconfig.defconfig`,
                `${dir}/${id}.zmk.yml`,
                'config/west.yml',
                'build.yaml',
                '.github/workflows/build.yml',
                'README.md',
            ]),
        )
        expect(b.rootName).toBe(`${id}-zmk-config`)
        // keymap content is the real compiled devicetree
        expect(fileText(b, `${dir}/${SH}.keymap`)).toContain(
            'compatible = "zmk,keymap"',
        )
        // Kconfig registers the shield by its uppercase name
        expect(fileText(b, `${dir}/Kconfig.shield`)).toContain(
            `config SHIELD_${SH}`,
        )
        expect(fileText(b, `${dir}/Kconfig.defconfig`)).toContain(
            'ZMK_KEYBOARD_NAME',
        )
        // workflow uses the official reusable build
        expect(fileText(b, '.github/workflows/build.yml')).toContain(
            'zmkfirmware/zmk/.github/workflows/build-user-config.yml',
        )
    })

    it('uses board/shield from hardware and enables matching conf flags', () => {
        const b = buildProjectBundle(parseKeymap(HW), 'zmk')
        const dir = 'config/boards/shields/boardx'
        expect(b.rootName).toBe('boardx-zmk-config')
        expect(fileText(b, 'build.yaml')).toContain('board: nice_nano_v2')
        expect(fileText(b, 'build.yaml')).toContain('shield: BOARDX')
        const conf = fileText(b, `${dir}/BOARDX.conf`)
        expect(conf).toContain('CONFIG_ZMK_STUDIO=y')
        expect(conf).toContain('CONFIG_ZMK_USB=y') // USB on by default
        expect(conf).toContain('# CONFIG_ZMK_BLE=y') // BLE opt-in → commented
        expect(conf).toContain('CONFIG_ZMK_RGB_UNDERGLOW=y') // underglow used
        expect(conf).toContain('# CONFIG_ZMK_BACKLIGHT=y') // unused → commented
        expect(conf).toContain('# CONFIG_ZMK_USB_LOGGING=y') // off → commented hint
        // the generated overlay carries the real kscan
        expect(fileText(b, `${dir}/BOARDX.overlay`)).toContain(
            'zmk,kscan-gpio-matrix',
        )
    })

    it('emits full-parity peripheral overlay nodes + chosen + conf flags', () => {
        const b = buildProjectBundle(parseKeymap(HW_FULL), 'zmk')
        const dir = 'config/boards/shields/boardy'
        const overlay = fileText(b, `${dir}/BOARDY.overlay`)
        // chosen wires every generated peripheral
        expect(overlay).toContain('zmk,backlight = <&backlight_pwm>')
        expect(overlay).toContain('zmk,underglow = <&led_strip>')
        expect(overlay).toContain('zmk,ext-power = <&ext_power_ctrl>')
        expect(overlay).toContain('zmk,studio-rpc-uart = <&studio_acm>')
        // peripheral nodes
        expect(overlay).toContain('compatible = "zmk,ext-power-generic"')
        expect(overlay).toContain('control-gpios = <&gpio0 14 GPIO_ACTIVE_LOW>')
        expect(overlay).toContain('compatible = "pwm-leds"')
        expect(overlay).toContain('PWM_POLARITY_INVERTED')
        expect(overlay).toContain('compatible = "worldsemi,ws2812-spi"')
        expect(overlay).toContain('chain-length = <10>')
        expect(overlay).toContain(
            'color-mapping = <LED_COLOR_ID_GREEN LED_COLOR_ID_RED LED_COLOR_ID_BLUE>',
        )
        expect(overlay).toContain('compatible = "zephyr,cdc-acm-uart"')
        // pinctrl psels parsed from the nRF P<port>.<pin> labels
        expect(overlay).toContain('NRF_PSEL(PWM_OUT0, 0, 13)')
        expect(overlay).toContain('NRF_PSEL(SPIM_MOSI, 1, 13)')
        expect(overlay).toContain('&pinctrl {')
        expect(overlay).toContain('#include <zephyr/dt-bindings/led/led.h>')
        // conf flags follow the hardware + studio CDC
        const conf = fileText(b, `${dir}/BOARDY.conf`)
        expect(conf).toContain('CONFIG_ZMK_BACKLIGHT=y')
        expect(conf).toContain('CONFIG_PWM=y')
        expect(conf).toContain('CONFIG_ZMK_RGB_UNDERGLOW=y')
        expect(conf).toContain('CONFIG_ZMK_EXT_POWER=y')
        expect(conf).toContain('CONFIG_ZMK_BLE=y')
        expect(conf).toContain('CONFIG_ZMK_STUDIO_TRANSPORT_UART=y')
    })

    it('scaffolds peripheral pinctrl (not drops it) on a non-nRF board', () => {
        const b = buildProjectBundle(parseKeymap(HW_RP2040), 'zmk')
        const overlay = fileText(
            b,
            'config/boards/shields/boardz/BOARDZ.overlay',
        )
        // backlight &pwm block is still emitted (was previously dropped)
        expect(overlay).toContain('&pwm0 {')
        expect(overlay).toContain('pinctrl-0 = <&pwm0_default>')
        // SPI compatible is SoC-aware, not hardcoded nordic
        expect(overlay).toContain('compatible = "raspberrypi,pico-spi"')
        expect(overlay).not.toContain('nordic,nrf-spim')
        // pinctrl groups exist as a labelled FIXME scaffold (so refs resolve), not
        // a real nRF psel
        expect(overlay).toContain('pwm0_default: pwm0_default')
        expect(overlay).toContain('spi0_default: spi0_default')
        expect(overlay).toContain('FIXME (rp2040)')
        expect(overlay).not.toContain('NRF_PSEL')
    })

    it('emits a real split shield (shared dtsi + two half overlays)', () => {
        const b = buildProjectBundle(parseKeymap(SPLIT), 'zmk')
        const dir = 'config/boards/shields/mysplit'
        expect(b.rootName).toBe('mysplit-zmk-config')
        // one shield dir, shared base files + both half overlays
        expect(paths(b)).toEqual(
            expect.arrayContaining([
                `${dir}/mysplit.keymap`,
                `${dir}/mysplit.conf`,
                `${dir}/mysplit.dtsi`,
                `${dir}/mysplit_left.overlay`,
                `${dir}/mysplit_right.overlay`,
                `${dir}/Kconfig.shield`,
                `${dir}/Kconfig.defconfig`,
                `${dir}/mysplit.zmk.yml`,
                'build.yaml',
            ]),
        )
        // build.yaml builds BOTH halves on the same board
        const build = fileText(b, 'build.yaml')
        expect(build).toContain('shield: mysplit_left')
        expect(build).toContain('shield: mysplit_right')
        expect(build).toContain('board: nice_nano_v2')
        // Kconfig registers both half symbols + split roles
        const kshield = fileText(b, `${dir}/Kconfig.shield`)
        expect(kshield).toContain('config SHIELD_MYSPLIT_LEFT')
        expect(kshield).toContain('config SHIELD_MYSPLIT_RIGHT')
        expect(kshield).toContain('$(shields_list_contains, mysplit_left)')
        const kdef = fileText(b, `${dir}/Kconfig.defconfig`)
        expect(kdef).toContain('ZMK_SPLIT_ROLE_CENTRAL') // left = central
        expect(kdef).toContain('config ZMK_SPLIT')
        // shared dtsi: physical layout + unified transform + rows-only kscan
        const dtsi = fileText(b, `${dir}/mysplit.dtsi`)
        expect(dtsi).toContain('compatible = "zmk,physical-layout"')
        expect(dtsi).toContain('default_transform: keymap_transform_0')
        expect(dtsi).toContain('columns = <4>') // 2 left + 2 right
        expect(dtsi).toContain('row-gpios')
        expect(dtsi).toContain('col-gpios set per half') // cols deferred to overlays
        expect(dtsi).not.toMatch(/col-gpios\n\s+=/) // no real col-gpios property here
        // left overlay: includes the base, sets col-gpios, no offset
        const lo = fileText(b, `${dir}/mysplit_left.overlay`)
        expect(lo).toContain('#include "mysplit.dtsi"')
        expect(lo).toContain('col-gpios')
        expect(lo).not.toContain('col-offset')
        // right overlay: offsets the transform by the left column count
        const ro = fileText(b, `${dir}/mysplit_right.overlay`)
        expect(ro).toContain('#include "mysplit.dtsi"')
        expect(ro).toContain('&default_transform')
        expect(ro).toContain('col-offset = <2>')
        expect(ro).toContain('col-gpios')
    })
})

const QMK_FULL = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Plank", "target": "qmk", "author": "me",
              "vendorId": "0x1234", "productId": "0x5678" },
    "keyboard": {
        "id": "plank", "name": "Plank",
        "keys": [{"x":0,"y":0},{"x":1,"y":0,"w":2}],
        "controller": {
            "processor": "atmega32u4", "bootloader": "atmel-dfu",
            "board": "PROMICRO", "deviceVersion": "1.0.0"
        },
        "pins": { "rows": ["B0"], "cols": ["B1", "B2"] }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

describe('buildProjectBundle — QMK', () => {
    it('emits a qmk_userspace skeleton with a keyboard.json + build target', () => {
        const b = buildProjectBundle(seedConfig, 'qmk')
        const kb = seedConfig.keyboard.id
        expect(paths(b)).toEqual(
            expect.arrayContaining([
                `keyboards/${kb}/keyboard.json`,
                `keyboards/${kb}/keymaps/remappr/keymap.c`,
                `keyboards/${kb}/keymaps/remappr/rules.mk`,
                `keyboards/${kb}/keymaps/remappr/config.h`,
                'qmk.json',
                '.github/workflows/build_binaries.yml',
                'README.md',
            ]),
        )
        expect(b.rootName).toBe(`${kb}-qmk-userspace`)
        expect(
            fileText(b, `keyboards/${kb}/keymaps/remappr/keymap.c`),
        ).toContain('PROGMEM keymaps')
        const manifest = JSON.parse(fileText(b, 'qmk.json'))
        expect(manifest.build_targets).toEqual([[kb, 'remappr']])
    })

    it('keyboard.json carries identity, matrix pins and a LAYOUT', () => {
        const b = buildProjectBundle(parseKeymap(QMK_FULL), 'qmk')
        const json = JSON.parse(fileText(b, 'keyboards/plank/keyboard.json'))
        expect(json.keyboard_name).toBe('Plank')
        expect(json.maintainer).toBe('me')
        expect(json.usb).toEqual({
            vid: '0x1234',
            pid: '0x5678',
            device_version: '1.0.0',
        })
        expect(json.processor).toBe('atmega32u4')
        expect(json.bootloader).toBe('atmel-dfu')
        expect(json.board).toBe('PROMICRO')
        expect(json.matrix_pins).toEqual({ rows: ['B0'], cols: ['B1', 'B2'] })
        expect(json.diode_direction).toBe('COL2ROW')
        // LAYOUT pairs each key's [row,col] with its placement; w!=1 is kept.
        expect(json.layouts.LAYOUT.layout).toEqual([
            { matrix: [0, 0], x: 0, y: 0 },
            { matrix: [0, 1], x: 1, y: 0, w: 2 },
        ])
    })

    it('warns + defaults USB ids when the builder left them unset', () => {
        const b = buildProjectBundle(seedConfig, 'qmk')
        const kb = seedConfig.keyboard.id
        const json = JSON.parse(fileText(b, `keyboards/${kb}/keyboard.json`))
        expect(json.usb.vid).toBe('0xFEED')
        expect(
            b.diagnostics.some((d) => /vendor\/product id/.test(d.message)),
        ).toBe(true)
    })

    it('does not emit a VIA definition or enable VIA when not targeted', () => {
        const b = buildProjectBundle(parseKeymap(QMK_FULL), 'qmk')
        expect(paths(b)).not.toContain('via/plank.json')
        expect(
            fileText(b, 'keyboards/plank/keymaps/remappr/rules.mk'),
        ).not.toContain('VIA_ENABLE')
    })
})

const VIA_FULL = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Macro5", "target": "qmk",
              "vendorId": "0xCEEB", "productId": "0x0007" },
    "keyboard": {
        "id": "macro5", "name": "Macro5",
        "keys": [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}],
        "pins": { "rows": ["B0"], "cols": ["B1", "B2", "B3"] },
        "firmware": ["qmk", "via"]
    },
    "layers": [
        { "name": "base", "bindings": [
            "A",
            { "type": "layer", "mode": "momentary", "layer": "fn" },
            "B"
        ] },
        { "name": "fn", "bindings": [] }
    ]
}`

describe('buildProjectBundle — VIA', () => {
    it('ships a VIA definition + enables VIA when via is targeted', () => {
        const b = buildProjectBundle(parseKeymap(VIA_FULL), 'qmk')
        expect(paths(b)).toContain('via/macro5.json')
        // VIA support compiled into the keymap
        expect(
            fileText(b, 'keyboards/macro5/keymaps/remappr/rules.mk'),
        ).toContain('VIA_ENABLE = yes')
        // definition carries identity + matrix
        const def = JSON.parse(fileText(b, 'via/macro5.json'))
        expect(def.name).toBe('Macro5')
        expect(def.vendorId).toBe('0xCEEB')
        expect(def.productId).toBe('0x0007')
        expect(def.matrix).toEqual({ rows: 1, cols: 3 })
    })

    it('the VIA keymap carries "row,col" legends + per-category cap colours', () => {
        const b = buildProjectBundle(parseKeymap(VIA_FULL), 'qmk')
        const def = JSON.parse(fileText(b, 'via/macro5.json'))
        // one physical row, three keys; matrix annotation is the top-left legend
        const row = def.layouts.keymap[0]
        expect(row).toEqual([
            '0,0', // A → neutral alpha cap (no colour prop)
            { c: '#6fa8dc' }, // layer key → blue
            '0,1',
            { c: '#cccccc' }, // back to neutral for B
            '0,2',
        ])
    })
})

const VIAL_FULL = `{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "Pad", "target": "qmk",
              "vendorId": "0xCEEB", "productId": "0x0007" },
    "keyboard": {
        "id": "pad", "name": "Pad",
        "keys": [{"x":0,"y":0},{"x":1,"y":0}],
        "pins": { "rows": ["B0"], "cols": ["B1", "B2"] },
        "firmware": ["qmk", "via", "vial"],
        "vial": {
            "uid": [254, 6, 191, 82, 24, 186, 79, 138],
            "unlockKeys": [[0, 0], [0, 1]]
        }
    },
    "layers": [{ "name": "base", "bindings": ["A", "B"] }]
}`

describe('buildProjectBundle — Vial', () => {
    it('ships vial.json + a UID/unlock config.h and enables VIAL', () => {
        const b = buildProjectBundle(parseKeymap(VIAL_FULL), 'qmk')
        expect(paths(b)).toContain('keyboards/pad/keymaps/remappr/vial.json')
        const rules = fileText(b, 'keyboards/pad/keymaps/remappr/rules.mk')
        expect(rules).toContain('VIA_ENABLE = yes')
        expect(rules).toContain('VIAL_ENABLE = yes')
        const configH = fileText(b, 'keyboards/pad/keymaps/remappr/config.h')
        expect(configH).toContain(
            '#define VIAL_KEYBOARD_UID {0xFE, 0x06, 0xBF, 0x52, 0x18, 0xBA, 0x4F, 0x8A}',
        )
        expect(configH).toContain('#define VIAL_UNLOCK_COMBO_ROWS {0, 0}')
        expect(configH).toContain('#define VIAL_UNLOCK_COMBO_COLS {0, 1}')
    })

    it('does not ship vial artifacts when vial is not targeted', () => {
        const b = buildProjectBundle(parseKeymap(VIA_FULL), 'qmk')
        expect(paths(b)).not.toContain(
            'keyboards/macro5/keymaps/remappr/vial.json',
        )
        expect(
            fileText(b, 'keyboards/macro5/keymaps/remappr/rules.mk'),
        ).not.toContain('VIAL_ENABLE')
    })
})

describe('buildProjectBundle — Remappr shield', () => {
    it('emits a self-contained remappr shield project via remappr-board', () => {
        const b = buildProjectBundle(seedConfig, 'remappr-board')
        expect(b.rootName).toMatch(/-remappr-shield$/)
        // the standalone west workspace + Zephyr module manifest + README
        expect(paths(b)).toEqual(
            expect.arrayContaining([
                'west.yml',
                'zephyr/module.yml',
                'README.md',
            ]),
        )
        // module.yml exposes boards/shields via board_root
        expect(fileText(b, 'zephyr/module.yml')).toContain('board_root: .')
    })

    it('aliases the `remappr` builder id / meta.target to that shield bundle', () => {
        // the editor Download offers the pinned meta.target ('remappr') verbatim;
        // it must resolve to the same shield bundle as the 'remappr-board' target.
        const board = buildProjectBundle(seedConfig, 'remappr-board')
        const alias = buildProjectBundle(seedConfig, 'remappr')
        expect(paths(alias)).toEqual(paths(board))
        expect(alias.rootName).toBe(board.rootName)
    })
})
