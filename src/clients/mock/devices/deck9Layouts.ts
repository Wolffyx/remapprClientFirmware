// pattern-check: skip — pure data: Deck 9 physical layout variants
import type { ConfigKeymap } from '@firmware/config'
import type { PhysicalLayout, PhysicalLayoutKey } from '@firmware/types'
import { configToPhysicalLayout } from '../configBridge'

// Centi-units, like configToPhysicalLayout's output. The pitch matches the
// config's own (1.05u).
const U = 100
const PITCH = 105

function key(x: number, y: number): PhysicalLayoutKey {
    return { x, y, w: U, h: U }
}

// All nine keys on one row, a knob above each end.
function rowLayout(id: number): PhysicalLayout {
    const keys = Array.from({ length: 9 }, (_, i) => key(i * PITCH, 160))
    const right = 8 * PITCH + U - 115
    return {
        id,
        name: 'Deck 9 row',
        keys,
        encoders: [
            { x: 15, y: 10 },
            { x: right, y: 10 },
        ],
    }
}

// The 3x3 grid with both knobs stacked down its left side.
function knobsLeftLayout(id: number): PhysicalLayout {
    const keys: PhysicalLayoutKey[] = []
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            keys.push(key(130 + col * PITCH, row * PITCH))
        }
    }
    return {
        id,
        name: 'Deck 9 knobs left',
        keys,
        encoders: [
            { x: 0, y: 0 },
            { x: 0, y: 2 * PITCH },
        ],
    }
}

/** The Deck 9's layouts: the config's own first, then two variants. Each keeps
 *  the config's 9 keys and 2 knobs in the same order, so its bindings fit. */
export function deck9Layouts(config: ConfigKeymap): PhysicalLayout[] {
    return [configToPhysicalLayout(config), rowLayout(1), knobsLeftLayout(2)]
}
