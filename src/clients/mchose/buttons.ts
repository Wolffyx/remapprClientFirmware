// Pattern check: no GoF pattern (-) — rejected — lookup tables and pure mappings between button slots and the neutral action catalog; a dispatch table, no polymorphism.
//
// What an MCHOSE button can do, as the device editor's action catalog.
// A button slot is a type and a 3-byte value (see ButtonSlot); the table is
// the vendor web driver's (mchose.com.cn M HUB), checked on an A7X Ultra:
//   0 default · 1 mouse (b0 = button bit, b1 = wheel step) · 2 key (b0 =
//   modifiers, b1 = HID key) · 3 media (b0 = consumer usage) · 4 macro ·
//   5 DPI · 8 shortcut (page, …) · 9 disabled · 10 onboard profile.
import { CATALOG, HID_USAGE_BY_CANONICAL } from '../../catalog'
import type {
    ActionId,
    DeviceAction,
    DeviceActionCategory,
    DeviceActionGroup,
} from '../../devices/types'
import type { ButtonSlot } from './protocol'

export const SlotType = {
    DEFAULT: 0,
    MOUSE: 1,
    KEY: 2,
    MEDIA: 3,
    MACRO: 4,
    DPI: 5,
    SHORTCUT: 8,
    OFF: 9,
    PROFILE: 10,
} as const

/** Which config slot each drawn control is. The wheel's slot is its click. */
export const BUTTON_SLOT: Readonly<Record<string, number>> = {
    lmb: 0,
    wheel: 1,
    rmb: 2,
    fwd: 3,
    back: 4,
}

const LEFT_CLICK = 0x010000
/** What a slot does at its default, by slot. */
const NATIVE = [LEFT_CLICK, 0x040000, 0x020000, 0x100000, 0x080000] as const

const OFF: ButtonSlot = { type: SlotType.OFF, value: 0xffffff }

const hex6 = (v: number): string => v.toString(16).padStart(6, '0')

export const actionIdOf = (s: ButtonSlot): ActionId =>
    `mchose:${s.type}:${hex6(s.value)}`

/** The slot an action id stands for; null (Disabled) turns the button off. */
export function slotOf(id: ActionId | null): ButtonSlot {
    if (id === null) return OFF
    const m = /^mchose:(\d+):([0-9a-f]{6})$/.exec(id)
    if (!m) throw new RangeError(`Not an MCHOSE button action: ${id}`)
    return { type: Number(m[1]), value: Number.parseInt(m[2], 16) }
}

/** A slot as the editor shows it: a default one as what it does natively,
 *  a disabled one as no action. */
export function shownAction(index: number, s: ButtonSlot): ActionId | null {
    if (s.type === SlotType.OFF) return null
    const native = NATIVE[index]
    if (s.type === SlotType.DEFAULT && native !== undefined) {
        return actionIdOf({ type: SlotType.MOUSE, value: native })
    }
    return actionIdOf(s)
}

/** Some button still left-clicks; the vendor driver refuses a change that
 *  leaves none, and so does this client. */
export const keepsLeftClick = (buttons: readonly ButtonSlot[]): boolean =>
    buttons.some(
        (s, i) =>
            (i === 0 && s.type === SlotType.DEFAULT) ||
            (s.type === SlotType.MOUSE && s.value === LEFT_CLICK),
    )

// --- the catalog ------------------------------------------------------------

const GROUPS: readonly DeviceActionGroup[] = [
    { id: 'mouse', label: 'Mouse', category: 'mouse' },
    { id: 'keys', label: 'Keyboard', category: 'key' },
    { id: 'media', label: 'Media', category: 'media' },
    { id: 'shortcut', label: 'Shortcuts', category: 'system' },
    { id: 'dpi', label: 'DPI', category: 'mouse' },
    { id: 'profile', label: 'Onboard profile', category: 'profile' },
    { id: 'macro', label: 'Macro', category: 'macro' },
    { id: 'other', label: 'Other', category: 'none' },
]

type Row = readonly [label: string, value: number]

const LISTS: readonly [
    group: string,
    type: number,
    category: DeviceActionCategory,
    rows: readonly Row[],
][] = [
    [
        'mouse',
        SlotType.MOUSE,
        'mouse',
        [
            ['Left click', LEFT_CLICK],
            ['Right click', 0x020000],
            ['Middle click', 0x040000],
            ['Back', 0x080000],
            ['Forward', 0x100000],
            ['Scroll up', 0x000200],
            ['Scroll down', 0x00fe00],
        ],
    ],
    [
        'shortcut',
        SlotType.SHORTCUT,
        'system',
        [
            ['Copy', 0x070106],
            ['Cut', 0x07011b],
            ['Paste', 0x070119],
            ['Screen brightness up', 0x0c6f00],
            ['Screen brightness down', 0x0c7000],
        ],
    ],
    [
        'dpi',
        SlotType.DPI,
        'mouse',
        [
            ['DPI cycle', 0x010000],
            ['DPI up', 0x020000],
            ['DPI down', 0x030000],
        ],
    ],
    [
        'profile',
        SlotType.PROFILE,
        'profile',
        [
            ['Profile 1', 0x010000],
            ['Profile 2', 0x020000],
            ['Profile 3', 0x030000],
            ['Cycle profiles', 0x040000],
        ],
    ],
]

const KEYBOARD_PAGE = 0x07
const CONSUMER_PAGE = 0x0c

/** Plain keys (no modifiers) and the media keys a slot can hold: a media
 *  value carries one byte of usage, so only usages up to 0xFF. */
function keyActions(): DeviceAction[] {
    const out: DeviceAction[] = []
    for (const entry of CATALOG) {
        const hid = HID_USAGE_BY_CANONICAL.get(entry.id)
        if (!hid) continue
        const packed = (hid.page << 16) | hid.usage
        if (
            hid.page === KEYBOARD_PAGE &&
            hid.usage >= 0x04 &&
            hid.usage <= 0xe7
        ) {
            const value = hid.usage << 8
            out.push({
                id: actionIdOf({ type: SlotType.KEY, value }),
                label: entry.label,
                group: 'keys',
                category: 'key',
                usage: packed,
            })
        }
        if (hid.page === CONSUMER_PAGE && hid.usage <= 0xff) {
            out.push({
                id: actionIdOf({
                    type: SlotType.MEDIA,
                    value: hid.usage << 16,
                }),
                label: entry.label,
                group: 'media',
                category: 'media',
                usage: packed,
            })
        }
    }
    // Aliases share a usage: keep the first entry of each.
    return [...new Map(out.map((a) => [a.id, a])).values()]
}

const STATIC_ACTIONS: readonly DeviceAction[] = [
    ...LISTS.flatMap(([group, type, category, rows]) =>
        rows.map(([label, value]) => ({
            id: actionIdOf({ type, value }),
            label,
            group,
            category,
        })),
    ),
    ...keyActions(),
]

/** An action the catalog does not list, so a slot holding it still shows
 *  and round-trips: a button's macro (made in the Macros sheet, which binds
 *  the button), a key with modifiers, a vendor function. */
const foreignAction = (s: ButtonSlot): DeviceAction =>
    s.type === SlotType.MACRO
        ? {
              id: actionIdOf(s),
              label: 'Macro',
              group: 'macro',
              category: 'macro',
          }
        : {
              id: actionIdOf(s),
              label: `Vendor function ${s.type}:${hex6(s.value)}`,
              group: 'other',
              category: 'none',
          }

/** The groups and actions, plus whatever the mouse holds now that they do
 *  not list. */
export function buttonCatalog(buttons: readonly ButtonSlot[]): {
    groups: readonly DeviceActionGroup[]
    actions: readonly DeviceAction[]
} {
    const known = new Set(STATIC_ACTIONS.map((a) => a.id))
    // Only the drawn buttons: a slot the mouse has no button for stays out.
    const extra = Object.values(BUTTON_SLOT)
        .map((i) => ({ s: buttons[i], id: shownAction(i, buttons[i]) }))
        .filter(({ id }) => id !== null && !known.has(id))
        .map(({ s }) => foreignAction(s))
    const unique = [...new Map(extra.map((a) => [a.id, a])).values()]
    const used = new Set(unique.map((a) => a.group))
    const groups = GROUPS.filter(
        (g) => (g.id !== 'other' && g.id !== 'macro') || used.has(g.id),
    )
    return { groups, actions: [...STATIC_ACTIONS, ...unique] }
}
