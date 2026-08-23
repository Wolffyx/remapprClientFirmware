// Pattern check: no GoF pattern (-) — rejected — fixture data only; mirrors GetBehaviorDetailsResponse shapes the real ZMK firmware emits over RPC, used by both export tests and any downstream test that needs a behavior map.
//
// One synthetic GetBehaviorDetailsResponse per behavior listed at
// https://zmk.dev/docs/keymaps/behaviors, mirroring the param-descriptor
// shape the ZMK firmware emits over RPC. behaviorToActionType merges every
// metadata set, so a behavior may declare multiple sets (see BT: a no-arg
// command set plus BT_SEL / BT_DISC sets that carry the profile-index
// param2).
//
// IDs are arbitrary — the keymap layer references them by behaviorId.

import type {
    BehaviorParameterValueDescription,
    GetBehaviorDetailsResponse,
} from '@zmkfirmware/zmk-studio-ts-client/behaviors'

const HID_PAGE_KEYBOARD = 0x07
const HID_PAGE_CONSUMER = 0x0c

export const encodeHid = (page: number, id: number): number => (page << 16) | id

export const HID_KP = (id: number): number => encodeHid(HID_PAGE_KEYBOARD, id)
export const HID_CC = (id: number): number => encodeHid(HID_PAGE_CONSUMER, id)

const KEYBOARD_MAX = 0xff
const CONSUMER_MAX = 0xffff

const hidUsage = (name: string): BehaviorParameterValueDescription => ({
    name,
    hidUsage: { keyboardMax: KEYBOARD_MAX, consumerMax: CONSUMER_MAX },
})

const layerId = (name: string): BehaviorParameterValueDescription => ({
    name,
    layerId: {},
})

const constant = (
    value: number,
    name: string,
): BehaviorParameterValueDescription => ({ name, constant: value })

const range = (
    min: number,
    max: number,
    name = 'index',
): BehaviorParameterValueDescription => ({ name, range: { min, max } })

const nil = (name = ''): BehaviorParameterValueDescription => ({
    name,
    nil: {},
})

interface ParamSetSpec {
    param1?: BehaviorParameterValueDescription[]
    param2?: BehaviorParameterValueDescription[]
}

interface FixtureSpec {
    id: number
    displayName: string
    param1?: BehaviorParameterValueDescription[]
    param2?: BehaviorParameterValueDescription[]
    // Multiple metadata sets — for behaviors whose param2 is conditional on
    // param1 (e.g. &bt). Omit to declare a single set from param1/param2.
    sets?: ParamSetSpec[]
}

const fixture = (s: FixtureSpec): GetBehaviorDetailsResponse => ({
    id: s.id,
    displayName: s.displayName,
    metadata: (s.sets ?? [{ param1: s.param1, param2: s.param2 }]).map(
        (set) => ({
            param1: set.param1 ?? [nil()],
            param2: set.param2 ?? [nil()],
        }),
    ),
})

// Each fixture's id matches the export below so tests can reference by name.
// param1/param2 omitted ⇒ [nil()] (zero-arg behavior).
export const KP = fixture({
    id: 1,
    displayName: 'Key Press',
    param1: [hidUsage('key')],
})
export const MT = fixture({
    id: 2,
    displayName: 'Mod-Tap',
    param1: [hidUsage('mod')],
    param2: [hidUsage('key')],
})
export const LT = fixture({
    id: 3,
    displayName: 'Layer-Tap',
    param1: [layerId('layer')],
    param2: [hidUsage('key')],
})
export const MO = fixture({
    id: 4,
    displayName: 'Momentary Layer',
    param1: [layerId('layer')],
})
export const TO = fixture({
    id: 5,
    displayName: 'To Layer',
    param1: [layerId('layer')],
})
export const TOG = fixture({
    id: 6,
    displayName: 'Toggle Layer',
    param1: [layerId('layer')],
})
export const SL = fixture({
    id: 7,
    displayName: 'Sticky Layer',
    param1: [layerId('layer')],
})
export const SK = fixture({
    id: 8,
    displayName: 'Sticky Key',
    param1: [hidUsage('key')],
})
export const KT = fixture({
    id: 9,
    displayName: 'Key Toggle',
    param1: [hidUsage('key')],
})
export const TRANS = fixture({ id: 10, displayName: 'Transparent' })
export const NONE = fixture({ id: 11, displayName: 'None' })
export const CAPS_WORD = fixture({ id: 12, displayName: 'Caps Word' })
export const KEY_REPEAT = fixture({ id: 13, displayName: 'Key Repeat' })
export const GRESC = fixture({ id: 14, displayName: 'Grave Escape' })

// &bt — modelled the way real ZMK reports it: several metadata sets. The
// no-arg commands take no param2; BT_SEL and BT_DISC each take a profile
// index (RANGE). behaviorToActionType merges these into one enum command
// slot + a profile slot gated (enabledFor) on BT_SEL / BT_DISC.
export const BT = fixture({
    id: 20,
    displayName: 'Bluetooth',
    sets: [
        {
            param1: [
                constant(0, 'BT_CLR'),
                constant(1, 'BT_NXT'),
                constant(2, 'BT_PRV'),
                constant(4, 'BT_CLR_ALL'),
            ],
        },
        {
            param1: [constant(3, 'BT_SEL')],
            param2: [range(0, 4, 'profile')],
        },
        {
            param1: [constant(5, 'BT_DISC')],
            param2: [range(0, 4, 'profile')],
        },
    ],
})

// &out — single enum.
export const OUT = fixture({
    id: 21,
    displayName: 'Output Selection',
    param1: [
        constant(0, 'OUT_USB'),
        constant(1, 'OUT_BLE'),
        constant(2, 'OUT_TOG'),
    ],
})

// &rgb_ug — single enum (subset of full ZMK set).
export const RGB_UG = fixture({
    id: 22,
    displayName: 'RGB Underglow',
    param1: [
        constant(0, 'RGB_TOG'),
        constant(1, 'RGB_ON'),
        constant(2, 'RGB_OFF'),
        constant(3, 'RGB_HUI'),
        constant(4, 'RGB_HUD'),
        constant(5, 'RGB_SAI'),
        constant(6, 'RGB_SAD'),
        constant(7, 'RGB_BRI'),
        constant(8, 'RGB_BRD'),
        constant(9, 'RGB_SPI'),
        constant(10, 'RGB_SPD'),
        constant(11, 'RGB_EFF'),
        constant(12, 'RGB_EFR'),
    ],
})

export const BL = fixture({
    id: 23,
    displayName: 'Backlight',
    param1: [
        constant(0, 'BL_TOG'),
        constant(1, 'BL_INC'),
        constant(2, 'BL_DEC'),
        constant(3, 'BL_ON'),
        constant(4, 'BL_OFF'),
        constant(5, 'BL_CYCLE'),
    ],
})

export const EXT_POWER = fixture({
    id: 24,
    displayName: 'External Power',
    param1: [
        constant(0, 'EP_TOG'),
        constant(1, 'EP_ON'),
        constant(2, 'EP_OFF'),
    ],
})

export const MKP = fixture({
    id: 25,
    displayName: 'Mouse Button Press',
    param1: [
        constant(0x01, 'MB1'),
        constant(0x02, 'MB2'),
        constant(0x04, 'MB3'),
        constant(0x08, 'MB4'),
        constant(0x10, 'MB5'),
    ],
})

export const MMV = fixture({
    id: 26,
    displayName: 'Mouse Move',
    param1: [
        constant(0x00010000, 'MOVE_UP'),
        constant(0x00000100, 'MOVE_DOWN'),
        constant(0xffff0000, 'MOVE_LEFT'),
        constant(0x0000ffff, 'MOVE_RIGHT'),
    ],
})

export const MSC = fixture({
    id: 27,
    displayName: 'Mouse Scroll',
    param1: [
        constant(0x00010000, 'SCRL_UP'),
        constant(0x00000100, 'SCRL_DOWN'),
        constant(0xffff0000, 'SCRL_LEFT'),
        constant(0x0000ffff, 'SCRL_RIGHT'),
    ],
})

export const SOFT_OFF = fixture({ id: 30, displayName: 'Soft Off' })
export const STUDIO_UNLOCK = fixture({ id: 31, displayName: 'Studio Unlock' })
export const SYS_RESET = fixture({ id: 32, displayName: 'System Reset' })
export const BOOTLOADER = fixture({ id: 33, displayName: 'Bootloader' })

// User-instance sensor-rotate behavior (e.g. &inc_dec_kp). One entry; the
// real firmware reports each user instance separately.
export const INC_DEC_KP = fixture({
    id: 40,
    displayName: 'inc_dec_kp',
    param1: [hidUsage('increment')],
    param2: [hidUsage('decrement')],
})

export const ALL_FIXTURES = [
    KP,
    MT,
    LT,
    MO,
    TO,
    TOG,
    SL,
    SK,
    KT,
    TRANS,
    NONE,
    CAPS_WORD,
    KEY_REPEAT,
    GRESC,
    BT,
    OUT,
    RGB_UG,
    BL,
    EXT_POWER,
    MKP,
    MMV,
    MSC,
    SOFT_OFF,
    STUDIO_UNLOCK,
    SYS_RESET,
    BOOTLOADER,
    INC_DEC_KP,
]

export const FIXTURE_MAP: Record<number, GetBehaviorDetailsResponse> =
    Object.fromEntries(ALL_FIXTURES.map((f) => [f.id, f]))
