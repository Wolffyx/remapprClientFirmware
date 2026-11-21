// pattern-check: skip — pure data: the Halo M2 demo mouse.
import { STOCK_MOUSE } from '@firmware/devices/stockLayouts'
import { act } from './catalog'
import { btn, DEMO_PROFILES, type DemoDeviceDef } from './types'

const m = (label: string) => act('mouse', label)
const k = (label: string) => act('key', label)

export const HALO_M2: DemoDeviceDef = {
    id: 'halo-m2',
    model: {
        kind: 'mouse',
        form: 'mouse',
        name: 'Halo M2',
        shell: STOCK_MOUSE.shell,
        controls: STOCK_MOUSE.controls,
    },
    bindings: {
        lmb: btn(m('Left click')),
        rmb: btn(m('Right click')),
        dpi: btn(m('DPI cycle')),
        fwd: btn(m('Forward')),
        back: btn(m('Back'), { hold: m('Sniper (hold)') }),
        wheel: {
            up: m('Scroll up'),
            down: m('Scroll down'),
            click: m('Middle click'),
            tl: m('Tilt left'),
            tr: m('Tilt right'),
            lines: 3,
            smooth: true,
            freeSpin: false,
        },
        sensor: {
            stages: [400, 800, 1600, 3200, 6400],
            active: 2,
            poll: 1000,
            settings: { liftCutoff: 20 },
        },
    },
    profiles: DEMO_PROFILES,
    overrides: [
        {},
        {
            fwd: { a: k('G') },
            back: { a: k('R'), hold: undefined },
            dpi: { a: m('Sniper (hold)') },
            sensor: { active: 1, poll: 4000 },
        },
        {
            fwd: { a: k('Ctrl + V') },
            back: { a: k('Ctrl + C') },
            dpi: { a: act('system', 'Task view') },
        },
    ],
    firmwareVersion: '2.4.1',
    transport: 'p24g',
    battery: 82,
    editable: true,
}
