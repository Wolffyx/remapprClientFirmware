// pattern-check: skip — pure data: the Vector Pad demo gamepad.
import { STOCK_GAMEPAD } from '@firmware/devices/stockLayouts'
import type { DeviceBindings } from '@firmware/devices/types'
import { act } from './catalog'
import { btn, DEMO_PROFILES, type DemoDeviceDef } from './types'

const p = (label: string) => act('pad', label)

/** The stock gamepad bindings; the generic demo gamepad reuses them. */
export const VECTOR_PAD_BINDINGS: DeviceBindings = {
    lt: { out: 'lt-analog', start: 6, end: 94, mode: 'analog', rumble: true },
    rt: { out: 'rt-analog', start: 4, end: 70, mode: 'hair', rumble: true },
    lb: btn(p('LB')),
    rb: btn(p('RB')),
    y: btn(p('Y')),
    b: btn(p('B')),
    a: btn(p('A')),
    x: btn(p('X')),
    view: btn(p('View')),
    menu: btn(p('Menu')),
    home: btn(p('Guide'), { hold: act('system', 'Screenshot') }),
    lp: btn(p('A'), { turbo: false }),
    rp: btn(act('macro', 'Ping location')),
    ls: {
        out: 'left-stick',
        inner: 8,
        outer: 94,
        curve: 'linear',
        invY: false,
        click: p('L3'),
    },
    rs: {
        out: 'right-stick',
        inner: 6,
        outer: 96,
        curve: 'aggressive',
        invY: false,
        click: p('R3'),
    },
    dpad: {
        up: p('D-pad ↑'),
        down: p('D-pad ↓'),
        left: p('D-pad ←'),
        right: p('D-pad →'),
        ul: null,
        ur: null,
        dl: null,
        dr: null,
        ways: 4,
    },
}

export const VECTOR_PAD: DemoDeviceDef = {
    id: 'vector-pad',
    model: {
        kind: 'joystick',
        form: 'gamepad',
        name: 'Vector Pad',
        shell: STOCK_GAMEPAD.shell,
        controls: STOCK_GAMEPAD.controls,
    },
    bindings: VECTOR_PAD_BINDINGS,
    profiles: DEMO_PROFILES,
    overrides: [
        {},
        { lp: { a: p('X'), turbo: true }, rp: { a: p('B') } },
        {
            ls: { out: 'mouse-cursor' },
            rs: { out: 'scroll' },
            a: { a: act('mouse', 'Left click') },
            b: { a: act('mouse', 'Right click') },
        },
    ],
    firmwareVersion: '1.9.0',
    transport: 'usb',
    battery: 64,
    editable: true,
}
