// pattern-check: skip — pure data: 36-key Corne-shaped physical layout coordinates
import type { PhysicalLayout, PhysicalLayoutKey } from '@firmware/types'

// Renderer (`resolveBindingLabels`, `PhysicalLayoutCanvas`) expects centi-unit
// coordinates (1u = 100) and centi-degree rotation (8° = 800). Match the ZMK
// convention so mock keys render at the same scale as real hardware.
const U = 100 // one key unit, centi-units
const STEP = 112 // key (100) + 12 gap → matches the design prototype's 1.12U pitch

const LEFT_W = 5 * STEP - (STEP - U) // right edge of the left 3x5 block

// Thumb clusters: 3 keys per half, tucked below row 3.
const THUMB_Y = 3 * STEP + 50
const TSP = 124 // thumb spacing (> rotated diagonal so caps never overlap)

// What varies between the mock's layouts. Every layout keeps the same 36 keys
// in the same order, so the keymap's bindings fit each one.
interface CorneShape {
    // Column stagger (pinky → inner index), centi-units. Mirrored on the right.
    stagger: number[]
    // Gap between the two halves, centi-units.
    split: number
    // Thumb keys outer → inner: rotation (centi-degrees) and drop below
    // THUMB_Y (centi-units). Mirrored on the right half.
    fan: [number, number, number]
    drop: [number, number, number]
}

// Centre a rotation on the key itself (rx/ry default to the corner otherwise,
// which would swing the cap out of place).
function rotated(x: number, y: number, r: number): PhysicalLayoutKey {
    return { x, y, w: U, h: U, r, rx: x + U / 2, ry: y + U / 2 }
}

function mainBlock(
    baseX: number,
    stagger: number[],
    mirror: boolean,
): PhysicalLayoutKey[] {
    const keys: PhysicalLayoutKey[] = []
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
            const stag = mirror ? stagger[4 - col] : stagger[col]
            keys.push({
                x: baseX + col * STEP,
                y: row * STEP + stag,
                w: U,
                h: U,
            })
        }
    }
    return keys
}

function corneKeys({
    stagger,
    split,
    fan,
    drop,
}: CorneShape): PhysicalLayoutKey[] {
    const rightX = LEFT_W + split
    const lx = 255
    const rx = rightX + 20
    return [
        ...mainBlock(0, stagger, false),
        rotated(lx, THUMB_Y + drop[0], fan[0]),
        rotated(lx + TSP, THUMB_Y + drop[1], fan[1]),
        rotated(lx + 2 * TSP, THUMB_Y + drop[2], fan[2]),
        ...mainBlock(rightX, stagger, true),
        rotated(rx, THUMB_Y + drop[2], -fan[2]),
        rotated(rx + TSP, THUMB_Y + drop[1], -fan[1]),
        rotated(rx + 2 * TSP, THUMB_Y + drop[0], -fan[0]),
    ]
}

function corneLayout(
    id: number,
    name: string,
    shape: CorneShape,
): PhysicalLayout {
    return {
        id,
        name,
        keys: corneKeys(shape),
        // The seed config's one knob (keyboard.encoders[0]), centred in the
        // split gap on the top row. The renderer draws it as a 1u CCW|CW pair.
        encoders: [{ x: LEFT_W + (shape.split - U) / 2, y: 0 }],
    }
}

export const MOCK_CORNE_LAYOUT = corneLayout(0, 'Corne (Mock)', {
    stagger: [30, 6, 0, 12, 24],
    split: 200,
    fan: [800, 400, 0],
    drop: [24, 8, 0],
})

// Extra layouts so demo mode shows the layout picker, as a real board that
// ships several physical layouts does.
export const MOCK_LAYOUTS: PhysicalLayout[] = [
    MOCK_CORNE_LAYOUT,
    corneLayout(1, 'Corne flat (Mock)', {
        stagger: [0, 0, 0, 0, 0],
        split: 200,
        fan: [0, 0, 0],
        drop: [0, 0, 0],
    }),
    corneLayout(2, 'Corne wide (Mock)', {
        stagger: [44, 10, 0, 18, 34],
        split: 320,
        fan: [1500, 750, 0],
        drop: [56, 18, 0],
    }),
]
export const MOCK_KEY_COUNT = MOCK_CORNE_LAYOUT.keys.length // 36
