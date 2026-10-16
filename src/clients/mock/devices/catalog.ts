// pattern-check: skip — pure data: the demo devices' action catalog.
//
// What the demo devices can bind. A real adapter declares only what its
// firmware honours; the demo declares everything the device editor can show,
// so every inspector section has something to drive.
import type {
    ActionId,
    ControlOption,
    DeviceForm,
    ControlsCatalog,
    DeviceAction,
    DeviceActionCategory,
    DeviceActionGroup,
    SensorSpec,
} from '@firmware/devices/types'

/** The demo sensor, described the way a Remappr sensor describes itself
 *  (SENSOR namespace): every setting type, an advanced one, a gated option,
 *  a procedure and readings, so the inspector and the settings panel have
 *  something to drive. Names and option values follow the Remappr sensor
 *  registry. */
export const DEMO_SENSOR: Pick<
    SensorSpec,
    'settings' | 'procedures' | 'metrics'
> = {
    settings: [
        {
            name: 'liftCutoff',
            label: 'Lift-off distance',
            type: 'enum',
            unit: '',
            options: [
                { value: 10, label: '1 mm' },
                { value: 20, label: '2 mm' },
                { value: 0, label: 'Calibrated', needs: 'liftCalibration' },
            ],
            advanced: false,
            default: 10,
            help: 'How high the mouse can be lifted before it stops tracking.',
        },
        {
            name: 'angleSnap',
            label: 'Angle snapping',
            type: 'bool',
            unit: '',
            advanced: false,
            default: false,
            help: 'Straightens nearly straight lines.',
        },
        {
            name: 'motionSync',
            label: 'Motion sync',
            type: 'bool',
            unit: '',
            advanced: false,
            default: true,
            help: 'Reads the sensor in step with the host’s polling.',
        },
        {
            name: 'angleTune',
            label: 'Angle tune',
            type: 'int',
            unit: 'deg',
            min: -30,
            max: 30,
            step: 1,
            advanced: false,
            default: 0,
            help: 'Rotates the motion to match how you hold the mouse.',
        },
        {
            name: 'performanceMode',
            label: 'Performance mode',
            type: 'enum',
            unit: '',
            options: [
                { value: 0, label: 'High performance' },
                { value: 1, label: 'Low power' },
                { value: 2, label: 'Office' },
                { value: 3, label: 'Corded gaming' },
            ],
            advanced: false,
            default: 0,
        },
        {
            name: 'runDownshiftMs',
            label: 'Run to rest 1',
            type: 'int',
            unit: 'ms',
            min: 1,
            max: 26112,
            step: 1,
            advanced: true,
            default: 500,
        },
    ],
    procedures: [
        {
            name: 'liftCalibration',
            label: 'Lift-off calibration',
            phases: [
                'Move the mouse slowly over the whole surface you use, then press Next.',
                'Keep moving the mouse while it measures.',
            ],
            hasResult: true,
        },
    ],
    metrics: [
        { name: 'surfaceQuality', label: 'Surface quality', max: 182 },
        { name: 'lifted', label: 'Lifted', max: 1 },
    ],
}

const GROUPS: readonly (DeviceActionGroup & { items: readonly string[] })[] = [
    {
        id: 'mouse',
        label: 'Mouse',
        category: 'mouse',
        items: [
            'Left click',
            'Right click',
            'Middle click',
            'Back',
            'Forward',
            'Scroll up',
            'Scroll down',
            'Tilt left',
            'Tilt right',
            'Double click',
            'DPI cycle',
            'DPI up',
            'DPI down',
            'Sniper (hold)',
        ],
    },
    {
        id: 'key',
        label: 'Keyboard',
        category: 'key',
        items: [
            'Esc',
            'Enter',
            'Space',
            'Tab',
            'Shift',
            'Ctrl',
            'Alt',
            'Win',
            'Gui',
            'Bksp',
            ';',
            "'",
            ',',
            '.',
            '/',
            'Ctrl + C',
            'Ctrl + V',
            'Ctrl + Z',
            'Alt + Tab',
            ...'QWERTYUIOPASDFGHJKLZXCVBNM'.split(''),
            '↑',
            '↓',
            '←',
            '→',
        ],
    },
    {
        id: 'media',
        label: 'Media',
        category: 'media',
        items: [
            'Play / Pause',
            'Next track',
            'Prev track',
            'Volume up',
            'Volume down',
            'Mute',
            'Mic mute',
        ],
    },
    {
        id: 'pad',
        label: 'Gamepad',
        category: 'pad',
        items: [
            'A',
            'B',
            'X',
            'Y',
            'LB',
            'RB',
            'LT',
            'RT',
            'L3',
            'R3',
            'D-pad ↑',
            'D-pad ↓',
            'D-pad ←',
            'D-pad →',
            'View',
            'Menu',
            'Guide',
            ...Array.from({ length: 8 }, (_, i) => `Button ${i + 1}`),
        ],
    },
    {
        id: 'system',
        label: 'System',
        category: 'system',
        items: [
            'Screenshot',
            'Lock screen',
            'Show desktop',
            'Task view',
            'Calculator',
            'Open browser',
        ],
    },
    {
        id: 'macro',
        label: 'Macro',
        category: 'macro',
        items: [
            'Scene 1',
            'Scene 2',
            'Scene 3',
            'Go live',
            'Toggle cam',
            'Build & run',
            'Copy as Markdown',
            'Reload + swap',
            'Ping location',
        ],
    },
    {
        id: 'profile',
        label: 'Profile / layer',
        category: 'profile',
        items: [
            'Lower',
            'Raise',
            'Next profile',
            'Prev profile',
            'Shift layer (hold)',
            'Profile: Default',
            'Profile: FPS',
        ],
    },
]

/** The id of the demo action `label` in `group` (labels repeat across groups:
 *  "A" is a key and a gamepad button). */
export const act = (group: string, label: string): ActionId =>
    `${group}:${label}`

const option = (
    id: string,
    label: string,
    category: DeviceActionCategory,
): ControlOption => ({ id, label, category })

export const STICK_OUTPUTS = [
    option('left-stick', 'Left stick', 'pad'),
    option('right-stick', 'Right stick', 'pad'),
    option('mouse-cursor', 'Mouse cursor', 'mouse'),
    option('wasd', 'WASD', 'key'),
    option('arrows', 'Arrow keys', 'key'),
    option('scroll', 'Scroll', 'mouse'),
] as const

export const TRIGGER_OUTPUTS = [
    option('lt-analog', 'LT analog', 'pad'),
    option('rt-analog', 'RT analog', 'pad'),
    option('right-click', 'Right click', 'mouse'),
    option('left-click', 'Left click', 'mouse'),
    option('shift', 'Shift', 'key'),
] as const

export const AXIS_OUTPUTS = [
    option('rudder', 'Rudder (Z)', 'pad'),
    option('throttle', 'Throttle', 'pad'),
    option('slider', 'Slider', 'pad'),
    option('q-e', 'Q / E keys', 'key'),
    option('scroll', 'Scroll', 'mouse'),
    option('volume', 'Volume', 'media'),
] as const

const actions: DeviceAction[] = GROUPS.flatMap((g) =>
    g.items.map((label) => ({
        id: act(g.id, label),
        label,
        group: g.id,
        category: g.category,
    })),
)

export const DEMO_CATALOG: ControlsCatalog = {
    groups: GROUPS.map(({ id, label, category }) => ({ id, label, category })),
    actions,
    outputs: {
        stick: STICK_OUTPUTS,
        trigger: TRIGGER_OUTPUTS,
        axis: AXIS_OUTPUTS,
    },
    fields: {
        button: ['a', 'hold', 'turbo', 'toggle'],
        wheel: [
            'up',
            'down',
            'click',
            'tl',
            'tr',
            'lines',
            'smooth',
            'freeSpin',
        ],
        stick: ['out', 'inner', 'outer', 'curve', 'invY', 'click'],
        trigger: ['out', 'start', 'end', 'mode', 'rumble'],
        hat: ['up', 'down', 'left', 'right', 'ul', 'ur', 'dl', 'dr', 'ways'],
        sensor: ['stages', 'active', 'poll', 'settings'],
        encoder: ['cw', 'ccw', 'press', 'sens'],
        axis: ['out', 'dz', 'curve', 'inv'],
    },
    sensor: {
        dpiMin: 100,
        dpiMax: 26000,
        dpiStep: 100,
        maxStages: 5,
        pollRates: [125, 500, 1000, 4000, 8000],
        ...DEMO_SENSOR,
        index: 0, // the one sensor DemoSensor reports
    },
}

/** The demo catalog as a device of `form` honours it: a mouse button has no
 *  turbo or latch, a controller's does. */
export function demoCatalog(form: DeviceForm): ControlsCatalog {
    if (form !== 'mouse') return DEMO_CATALOG
    return {
        ...DEMO_CATALOG,
        fields: { ...DEMO_CATALOG.fields, button: ['a', 'hold'] },
    }
}
