// pattern-check: skip — pure data: the Apex Flight Stick demo joystick.
import { STOCK_FLIGHTSTICK } from '@firmware/devices/stockLayouts'
import { act } from './catalog'
import { btn, DEMO_PROFILES, type DemoDeviceDef } from './types'

const p = (label: string) => act('pad', label)
const k = (label: string) => act('key', label)

export const APEX_STICK: DemoDeviceDef = {
    id: 'apex-stick',
    model: {
        kind: 'joystick',
        form: 'flightstick',
        name: 'Apex Flight Stick',
        shell: STOCK_FLIGHTSTICK.shell,
        controls: STOCK_FLIGHTSTICK.controls,
    },
    bindings: {
        trig: btn(p('Button 1')),
        fire2: btn(p('Button 2')),
        thumb: btn(p('Button 3')),
        pinky: btn(act('profile', 'Shift layer (hold)')),
        b5: btn(p('Button 5')),
        b6: btn(p('Button 6')),
        b7: btn(act('system', 'Screenshot')),
        hat: {
            up: k('↑'),
            down: k('↓'),
            left: k('←'),
            right: k('→'),
            ul: null,
            ur: null,
            dl: null,
            dr: null,
            ways: 8,
        },
        xy: {
            out: 'left-stick',
            inner: 3,
            outer: 98,
            curve: 'relaxed',
            invY: true,
            click: null,
        },
        twist: { out: 'rudder', dz: 6, curve: 'relaxed', inv: false },
        thr: { out: 'throttle', dz: 2, curve: 'linear', inv: false },
    },
    profiles: DEMO_PROFILES,
    overrides: [
        {},
        { pinky: { a: p('Button 4') } },
        { xy: { out: 'mouse-cursor' } },
    ],
    firmwareVersion: '3.0.2',
    transport: 'usb',
    editable: true,
}
