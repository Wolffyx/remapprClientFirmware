// pattern-check: skip — fixture-driven exporter test rewrite onto behaviorFixtures.ts
import { describe, expect, it } from 'vitest'
import { generateZMKConfigFile, generateZMKKeymapFile } from './export'
import type { KeyAction, Keymap, Layer } from '@firmware/types'
import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors'
import {
    ALL_FIXTURES,
    BL,
    BOOTLOADER,
    BT,
    CAPS_WORD,
    EXT_POWER,
    FIXTURE_MAP,
    HID_KP,
    INC_DEC_KP,
    KEY_REPEAT,
    KP,
    KT,
    LT,
    MKP,
    MO,
    MT,
    NONE,
    OUT,
    RGB_UG,
    SK,
    SL,
    SOFT_OFF,
    STUDIO_UNLOCK,
    SYS_RESET,
    TO,
    TOG,
    TRANS,
} from './__tests__/behaviorFixtures'

const behaviorMap: Record<number, GetBehaviorDetailsResponse> = FIXTURE_MAP

const makeAction = (
    behaviorId: number,
    p1: number = 0,
    p2: number = 0,
): KeyAction => ({
    kind: String(behaviorId),
    params: [p1, p2],
    label: { primary: 'fx' },
})

const makeLayer = (id: number, keys: KeyAction[], name = `L${id}`): Layer => ({
    id,
    name,
    keys,
})

const emptyKeymapBase: Pick<
    Keymap,
    'availableLayers' | 'activeLayoutId' | 'layouts'
> = { availableLayers: 0, activeLayoutId: 0, layouts: [] }

const baseOptions = {
    keyboardName: 'Corne',
    keymapName: 'default',
    includeLayers: true,
}

const exportSingle = (action: KeyAction): string =>
    generateZMKKeymapFile(
        { ...emptyKeymapBase, layers: [makeLayer(0, [action])] },
        behaviorMap,
        baseOptions,
    )

// ─────────────────────────────────────────────────────────────
// Header / wrapper
// ─────────────────────────────────────────────────────────────

describe('generateZMKKeymapFile / wrapper', () => {
    it('renders header with keyboard + keymap name', () => {
        const km: Keymap = { ...emptyKeymapBase, layers: [makeLayer(0, [])] }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toContain('// Generated ZMK keymap for Corne')
        expect(out).toContain('// Keymap: default')
    })

    it('wraps output in a / { ... }; devicetree overlay', () => {
        const out = exportSingle(makeAction(KP.id, HID_KP(0x04)))
        expect(out).toContain('/ {')
        expect(out).toMatch(/\};\s*$/)
    })

    it('always emits behaviors.dtsi and keys.h includes', () => {
        const out = exportSingle(makeAction(TRANS.id))
        expect(out).toContain('#include <behaviors.dtsi>')
        expect(out).toContain('#include <dt-bindings/zmk/keys.h>')
    })

    it('emits #define entries when includeLayers true', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [makeLayer(10, []), makeLayer(20, [])],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toMatch(/#define L0 10/)
        expect(out).toMatch(/#define L1 20/)
    })

    it('omits #define section when includeLayers false', () => {
        const km: Keymap = { ...emptyKeymapBase, layers: [makeLayer(0, [])] }
        const out = generateZMKKeymapFile(km, behaviorMap, {
            ...baseOptions,
            includeLayers: false,
        })
        expect(out).not.toContain('#define L0')
    })
})

// ─────────────────────────────────────────────────────────────
// Conditional includes
// ─────────────────────────────────────────────────────────────

describe('conditional #include directives', () => {
    it.each([
        ['&bt', BT, 0, 0, 'dt-bindings/zmk/bt.h'],
        ['&out', OUT, 0, 0, 'dt-bindings/zmk/outputs.h'],
        ['&rgb_ug', RGB_UG, 0, 0, 'dt-bindings/zmk/rgb.h'],
        ['&bl', BL, 0, 0, 'dt-bindings/zmk/backlight.h'],
        ['&ext_power', EXT_POWER, 0, 0, 'dt-bindings/zmk/ext_power.h'],
        ['&sys_reset', SYS_RESET, 0, 0, 'dt-bindings/zmk/reset.h'],
        ['&bootloader', BOOTLOADER, 0, 0, 'dt-bindings/zmk/reset.h'],
        ['&soft_off', SOFT_OFF, 0, 0, 'dt-bindings/zmk/soft_off.h'],
        ['&studio_unlock', STUDIO_UNLOCK, 0, 0, 'dt-bindings/zmk/studio.h'],
        ['&mkp', MKP, 0x01, 0, 'dt-bindings/zmk/mouse.h'],
    ])('emits %s include for %s', (_label, fx, p1, p2, include) => {
        const out = exportSingle(makeAction(fx.id, p1, p2))
        expect(out).toContain(`#include <${include}>`)
    })

    it('does not emit unrelated includes when only &kp is used', () => {
        const out = exportSingle(makeAction(KP.id, HID_KP(0x04)))
        expect(out).not.toContain('dt-bindings/zmk/bt.h')
        expect(out).not.toContain('dt-bindings/zmk/rgb.h')
        expect(out).not.toContain('dt-bindings/zmk/mouse.h')
    })
})

// ─────────────────────────────────────────────────────────────
// Per-behavior bindings — one row per behavior on the ZMK index page.
// ─────────────────────────────────────────────────────────────

const ENTER = HID_KP(0x28)
const A = HID_KP(0x04)
const B = HID_KP(0x05)
const SPACE = HID_KP(0x2c)
const LSHFT_HID = HID_KP(0xe1)
const LCTRL_HID = HID_KP(0xe0)

describe('per-behavior renderers', () => {
    it.each([
        ['&kp A', KP, A, 0, '&kp A'],
        ['&kp RETURN', KP, ENTER, 0, '&kp RETURN'],
        ['&kp LCTRL (bare modifier)', KP, LCTRL_HID, 0, '&kp LCTRL'],
        ['&kp LC(A) (composed modifier)', KP, A | (0x01 << 24), 0, '&kp LC(A)'],
        ['&kp LC(LS(A)) (nested)', KP, A | (0x03 << 24), 0, '&kp LC(LS(A))'],
        ['&mt LSHFT A', MT, LSHFT_HID, A, '&mt LSHFT A'],
        ['&lt 1 SPACE', LT, 1, SPACE, '&lt 1 SPACE'],
        ['&mo 2', MO, 2, 0, '&mo 2'],
        ['&to 1', TO, 1, 0, '&to 1'],
        ['&tog 0', TOG, 0, 0, '&tog 0'],
        ['&sl 1', SL, 1, 0, '&sl 1'],
        ['&sk LSHFT', SK, LSHFT_HID, 0, '&sk LSHFT'],
        ['&kt A', KT, A, 0, '&kt A'],
        ['&trans', TRANS, 0, 0, '&trans'],
        ['&none', NONE, 0, 0, '&none'],
        ['&caps_word', CAPS_WORD, 0, 0, '&caps_word'],
        ['&key_repeat', KEY_REPEAT, 0, 0, '&key_repeat'],
        ['&bt BT_CLR', BT, 0, 0, '&bt BT_CLR'],
        ['&bt BT_NXT', BT, 1, 0, '&bt BT_NXT'],
        ['&bt BT_PRV', BT, 2, 0, '&bt BT_PRV'],
        ['&bt BT_SEL 0', BT, 3, 0, '&bt BT_SEL 0'],
        ['&bt BT_SEL 2', BT, 3, 2, '&bt BT_SEL 2'],
        ['&bt BT_CLR_ALL', BT, 4, 0, '&bt BT_CLR_ALL'],
        ['&out OUT_USB', OUT, 0, 0, '&out OUT_USB'],
        ['&out OUT_BLE', OUT, 1, 0, '&out OUT_BLE'],
        ['&out OUT_TOG', OUT, 2, 0, '&out OUT_TOG'],
        ['&rgb_ug RGB_TOG', RGB_UG, 0, 0, '&rgb_ug RGB_TOG'],
        ['&rgb_ug RGB_HUI', RGB_UG, 3, 0, '&rgb_ug RGB_HUI'],
        ['&bl BL_TOG', BL, 0, 0, '&bl BL_TOG'],
        ['&ext_power EP_TOG', EXT_POWER, 0, 0, '&ext_power EP_TOG'],
        ['&mkp MB1', MKP, 0x01, 0, '&mkp MB1'],
        ['&mkp MB3', MKP, 0x04, 0, '&mkp MB3'],
        ['&sys_reset', SYS_RESET, 0, 0, '&sys_reset'],
        ['&bootloader', BOOTLOADER, 0, 0, '&bootloader'],
        ['&soft_off', SOFT_OFF, 0, 0, '&soft_off'],
        ['&studio_unlock', STUDIO_UNLOCK, 0, 0, '&studio_unlock'],
    ])('renders %s', (_label, fx, p1, p2, expected) => {
        const out = exportSingle(makeAction(fx.id, p1, p2))
        expect(out).toContain(expected)
    })
})

// ─────────────────────────────────────────────────────────────
// Sensor bindings
// ─────────────────────────────────────────────────────────────

describe('sensor-bindings (encoders)', () => {
    it('emits <&inc_dec_kp ccw cw> when both directions are &kp', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [
                {
                    id: 0,
                    name: 'L0',
                    keys: [],
                    encoders: [
                        {
                            cw: makeAction(KP.id, HID_KP(0x52)), // Up
                            ccw: makeAction(KP.id, HID_KP(0x51)), // Down
                        },
                    ],
                },
            ],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toContain(
            'sensor-bindings = <<&inc_dec_kp DOWN_ARROW UP_ARROW>>;',
        )
    })

    it('omits sensor-bindings line when no encoders', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [{ id: 0, name: 'L0', keys: [makeAction(KP.id, A)] }],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).not.toContain('sensor-bindings')
    })
})

// ─────────────────────────────────────────────────────────────
// Layer block structure
// ─────────────────────────────────────────────────────────────

describe('layer block structure', () => {
    it('emits one layer block per layer', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [
                makeLayer(0, [makeAction(KP.id, A)]),
                makeLayer(1, [makeAction(KP.id, B)]),
            ],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toContain('layer_0 {')
        expect(out).toContain('layer_1 {')
        expect(out).toContain('label = "L0"')
        expect(out).toContain('label = "L1"')
    })

    it('skips bindings whose behaviorId is not in BehaviorMap', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [makeLayer(0, [makeAction(KP.id, A), makeAction(9999, B)])],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toContain('&kp A')
        expect(out).not.toContain('&kp B')
    })

    it('emits compatible attribute for keymap node', () => {
        const out = exportSingle(makeAction(TRANS.id))
        expect(out).toContain('compatible = "zmk,keymap";')
    })
})

// ─────────────────────────────────────────────────────────────
// Snapshot of a kitchen-sink layer.
// ─────────────────────────────────────────────────────────────

describe('snapshot', () => {
    it('renders kitchen-sink layer covering every behavior shape', () => {
        const km: Keymap = {
            ...emptyKeymapBase,
            layers: [
                makeLayer(
                    0,
                    [
                        makeAction(KP.id, A),
                        makeAction(KP.id, A | (0x03 << 24)),
                        makeAction(MT.id, LSHFT_HID, A),
                        makeAction(LT.id, 1, SPACE),
                        makeAction(MO.id, 2),
                        makeAction(TO.id, 1),
                        makeAction(TOG.id, 0),
                        makeAction(SL.id, 1),
                        makeAction(SK.id, LSHFT_HID),
                        makeAction(KT.id, A),
                        makeAction(TRANS.id),
                        makeAction(NONE.id),
                        makeAction(CAPS_WORD.id),
                        makeAction(KEY_REPEAT.id),
                        makeAction(BT.id, 3, 0),
                        makeAction(OUT.id, 2),
                        makeAction(RGB_UG.id, 0),
                        makeAction(BL.id, 0),
                        makeAction(EXT_POWER.id, 0),
                        makeAction(MKP.id, 1),
                        makeAction(SYS_RESET.id),
                        makeAction(BOOTLOADER.id),
                        makeAction(STUDIO_UNLOCK.id),
                    ],
                    'Kitchen Sink',
                ),
            ],
        }
        const out = generateZMKKeymapFile(km, behaviorMap, baseOptions)
        expect(out).toMatchSnapshot()
    })
})

// ─────────────────────────────────────────────────────────────
// Coverage gate — every fixture in ALL_FIXTURES must have a known prefix.
// ─────────────────────────────────────────────────────────────

describe('coverage', () => {
    it('every fixture renders to a non-empty &prefix-prefixed token', () => {
        for (const fx of ALL_FIXTURES) {
            // INC_DEC_KP is a user-instance behavior; surfaces only via
            // sensor-bindings, not as a keymap binding.
            if (fx === INC_DEC_KP) continue
            const out = exportSingle(makeAction(fx.id, 0, 0))
            expect(out).toMatch(/&\w+/)
        }
    })
})

// ─────────────────────────────────────────────────────────────
// Config file
// ─────────────────────────────────────────────────────────────

describe('generateZMKConfigFile', () => {
    it('embeds keyboard name in CONFIG_BT_DEVICE_NAME', () => {
        const out = generateZMKConfigFile({
            keyboardName: 'Lily58',
            keymapName: 'default',
        })
        expect(out).toContain('CONFIG_BT_DEVICE_NAME="Lily58"')
    })

    it('includes core CONFIG flags', () => {
        const out = generateZMKConfigFile({
            keyboardName: 'k',
            keymapName: 'k',
        })
        expect(out).toContain('CONFIG_BT=y')
        expect(out).toContain('CONFIG_ZMK_USB_LOGGING=y')
        expect(out).toContain('CONFIG_ZMK_BATTERY_REPORTING=y')
    })
})
