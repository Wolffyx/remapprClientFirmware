// pattern-check: skip — pure data: 36-key Corne-shaped physical layout coordinates
import type { PhysicalLayout, PhysicalLayoutKey } from '@firmware/types'

// Renderer (`resolveBindingLabels`, `PhysicalLayoutCanvas`) expects centi-unit
// coordinates (1u = 100) and centi-degree rotation (8° = 800). Match the ZMK
// convention so mock keys render at the same scale as real hardware.
const U = 100 // one key unit, centi-units
const STEP = 112 // key (100) + 12 gap → matches the design prototype's 1.12U pitch
const SPLIT = 200 // gap between the two halves (2.0U)

// Column stagger (pinky → inner index), centi-units. Mirrored on the right half
// so the board reads as an ergonomic split, not a flat grid.
const STAGGER = [30, 6, 0, 12, 24]

const LEFT_W = 5 * STEP - (STEP - U) // right edge of the left 3x5 block
const RIGHT_X = LEFT_W + SPLIT // x where the right half begins

// Centre a rotation on the key itself (rx/ry default to the corner otherwise,
// which would swing the cap out of place).
function rotated(x: number, y: number, r: number): PhysicalLayoutKey {
    return { x, y, w: U, h: U, r, rx: x + U / 2, ry: y + U / 2 }
}

function mainBlock(baseX: number, mirror: boolean): PhysicalLayoutKey[] {
    const keys: PhysicalLayoutKey[] = []
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
            const stag = mirror ? STAGGER[4 - col] : STAGGER[col]
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

// Thumb clusters: 3 keys per half, gently fanned and tucked below row 3.
const THUMB_Y = 3 * STEP + 50
const TSP = 124 // thumb spacing (> rotated diagonal so caps never overlap)

function buildCorneLeft(): PhysicalLayoutKey[] {
    const lx = 255
    return [
        ...mainBlock(0, false),
        rotated(lx, THUMB_Y + 24, 800),
        rotated(lx + TSP, THUMB_Y + 8, 400),
        rotated(lx + 2 * TSP, THUMB_Y, 0),
    ]
}

function buildCorneRight(): PhysicalLayoutKey[] {
    const rx = RIGHT_X + 20
    return [
        ...mainBlock(RIGHT_X, true),
        rotated(rx, THUMB_Y, 0),
        rotated(rx + TSP, THUMB_Y + 8, -400),
        rotated(rx + 2 * TSP, THUMB_Y + 24, -800),
    ]
}

export const MOCK_CORNE_LAYOUT: PhysicalLayout = {
    id: 0,
    name: 'Corne (Mock)',
    keys: [...buildCorneLeft(), ...buildCorneRight()],
}

export const MOCK_LAYOUTS: PhysicalLayout[] = [MOCK_CORNE_LAYOUT]
export const MOCK_KEY_COUNT = MOCK_CORNE_LAYOUT.keys.length // 36
