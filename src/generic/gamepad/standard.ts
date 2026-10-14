// Pattern check: Dispatch Map (Tier 0) — applied — vendor id → face-button naming table; Sony and Nintendo pads differ from the Xbox default only in data.
//
// A controller the browser maps to the W3C "standard" gamepad
// (https://w3c.github.io/gamepad/#remapping): its buttons and axes have known
// places, so it opens on the stock gamepad layout, named the way its maker
// prints the buttons.
import { defaultBinding } from '../../devices/defaults'
import { pickControls, STOCK_GAMEPAD } from '../../devices/stockLayouts'
import type {
    ControlBinding,
    DeviceAction,
    DeviceControl,
    DeviceModel,
} from '../../devices/types'
import {
    nativeAction,
    nativeCatalog,
    nativeId,
    nativeOutput,
} from '../nativeCatalog'
import type { NativeProfile } from '../types'
import type { InputMap } from './inputMap'

/** The stock controls the standard mapping has (no back paddles). */
const STANDARD_IDS = [
    'lt',
    'lb',
    'rt',
    'rb',
    'ls',
    'rs',
    'dpad',
    'view',
    'menu',
    'home',
    'y',
    'x',
    'b',
    'a',
] as const

const button = (index: number) => ({ type: 'button', index }) as const

/** Standard mapping: buttons 0-16, axes 0-3. */
export const STANDARD_MAP: InputMap = {
    a: button(0),
    b: button(1),
    x: button(2),
    y: button(3),
    lb: button(4),
    rb: button(5),
    lt: { type: 'trigger', index: 6 },
    rt: { type: 'trigger', index: 7 },
    view: button(8),
    menu: button(9),
    ls: { type: 'stick', x: 0, y: 1, press: 10 },
    rs: { type: 'stick', x: 2, y: 3, press: 11 },
    dpad: { type: 'dpad', up: 12, down: 13, left: 14, right: 15 },
    home: button(16),
}

type FaceId = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt'
type CentreId = 'view' | 'menu' | 'home'

/** How a maker names a button: control name, printed glyph, what it sends. */
interface Face {
    readonly name: string
    readonly glyph?: string
    readonly sends: string
}

type Faces = Readonly<Record<FaceId | CentreId, Face>> & {
    readonly l3: string
    readonly r3: string
}

const face = (name: string, sends: string, glyph?: string): Face => ({
    name,
    sends,
    ...(glyph ? { glyph } : {}),
})

const XBOX: Faces = {
    a: face('A button', 'A', 'A'),
    b: face('B button', 'B', 'B'),
    x: face('X button', 'X', 'X'),
    y: face('Y button', 'Y', 'Y'),
    lb: face('Left bumper', 'LB', 'LB'),
    rb: face('Right bumper', 'RB', 'RB'),
    lt: face('Left trigger', 'LT', 'LT'),
    rt: face('Right trigger', 'RT', 'RT'),
    view: face('View', 'View'),
    menu: face('Menu', 'Menu'),
    home: face('Guide', 'Guide'),
    l3: 'L3',
    r3: 'R3',
}

const SONY: Faces = {
    a: face('Cross', 'Cross', '✕'),
    b: face('Circle', 'Circle', '○'),
    x: face('Square', 'Square', '□'),
    y: face('Triangle', 'Triangle', '△'),
    lb: face('L1', 'L1', 'L1'),
    rb: face('R1', 'R1', 'R1'),
    lt: face('L2', 'L2', 'L2'),
    rt: face('R2', 'R2', 'R2'),
    view: face('Share', 'Share'),
    menu: face('Options', 'Options'),
    home: face('PS button', 'PS'),
    l3: 'L3',
    r3: 'R3',
}

/** Nintendo pads are mapped by position: the bottom button is B. */
const NINTENDO: Faces = {
    a: face('B button', 'B', 'B'),
    b: face('A button', 'A', 'A'),
    x: face('Y button', 'Y', 'Y'),
    y: face('X button', 'X', 'X'),
    lb: face('L button', 'L', 'L'),
    rb: face('R button', 'R', 'R'),
    lt: face('ZL button', 'ZL', 'ZL'),
    rt: face('ZR button', 'ZR', 'ZR'),
    view: face('Minus', '−', '−'),
    menu: face('Plus', '+', '+'),
    home: face('HOME', 'HOME'),
    l3: 'Left stick press',
    r3: 'Right stick press',
}

const FACES_BY_VENDOR: Readonly<Record<number, Faces>> = {
    0x054c: SONY,
    0x057e: NINTENDO,
}

const FACE_IDS = [
    'a',
    'b',
    'x',
    'y',
    'lb',
    'rb',
    'view',
    'menu',
    'home',
] as const
const TRIGGER_IDS = ['lt', 'rt'] as const
const DPAD = [
    ['up', 'D-pad ↑'],
    ['down', 'D-pad ↓'],
    ['left', 'D-pad ←'],
    ['right', 'D-pad →'],
] as const

const NAMED: ReadonlySet<string> = new Set([...FACE_IDS, ...TRIGGER_IDS])
const isNamed = (id: string): id is FaceId | CentreId => NAMED.has(id)

function renamed(c: DeviceControl, faces: Faces): DeviceControl {
    if (!isNamed(c.id)) return c
    const f = faces[c.id]
    const { glyph: _g, ...rest } = c
    return { ...rest, name: f.name, ...(f.glyph ? { glyph: f.glyph } : {}) }
}

function standardActions(faces: Faces): DeviceAction[] {
    return [
        ...FACE_IDS.map((id) =>
            nativeAction('pad', `pad:${id}`, faces[id].sends),
        ),
        nativeAction('pad', 'pad:l3', faces.l3),
        nativeAction('pad', 'pad:r3', faces.r3),
        ...DPAD.map(([dir, label]) => nativeAction('pad', `pad:${dir}`, label)),
    ]
}

/** The native profile of a standard-mapped controller named `name`. */
export function standardProfile(
    name: string,
    vendorId?: number,
): NativeProfile & { readonly map: InputMap } {
    const faces = (vendorId !== undefined && FACES_BY_VENDOR[vendorId]) || XBOX
    const model: DeviceModel = {
        kind: 'joystick',
        form: 'gamepad',
        name,
        shell: STOCK_GAMEPAD.shell,
        controls: pickControls(STOCK_GAMEPAD, STANDARD_IDS).map((c) =>
            renamed(c, faces),
        ),
    }
    const catalog = nativeCatalog(standardActions(faces), {
        stick: [
            nativeOutput('stick:left', 'Left stick'),
            nativeOutput('stick:right', 'Right stick'),
        ],
        trigger: TRIGGER_IDS.map((id) =>
            nativeOutput(`trigger:${id}`, `${faces[id].sends} (analog)`),
        ),
    })
    const stick = (side: string, click: string): ControlBinding => ({
        ...defaultBinding('stick', catalog),
        out: nativeId(`stick:${side}`),
        click: nativeId(`pad:${click}`),
    })
    const bindings: Record<string, ControlBinding> = {
        ls: stick('left', 'l3'),
        rs: stick('right', 'r3'),
        dpad: {
            ...defaultBinding('hat', catalog),
            ...Object.fromEntries(DPAD.map(([d]) => [d, nativeId(`pad:${d}`)])),
        },
    }
    for (const id of FACE_IDS) bindings[id] = { a: nativeId(`pad:${id}`) }
    for (const id of TRIGGER_IDS) {
        bindings[id] = {
            ...defaultBinding('trigger', catalog),
            out: nativeId(`trigger:${id}`),
            start: 0,
            end: 100,
        }
    }
    return { model, catalog, bindings, map: STANDARD_MAP }
}
