// pattern-check: skip — static lookup table; matchBoard is a one-screen pure function over presets.
//
// Per-board overrides for Keychron QMK keyboards. The protocol exposes
// neither matrix dimensions nor encoder count, so Studio has to guess.
// Default fallback (DEFAULT_ROWS×DEFAULT_COLS) lives in adapter.ts and
// targets K5 Max; this table extends coverage for other Keychron boards
// shipped with QMK + Keychron's Raw HID layer.
//
// Add a new board by appending to KEYCHRON_BOARDS. Match is by case-
// insensitive substring of the HID transport label (which is built from
// `product · VID:PID` in src/main/hid.ts:93). Match priority is highest
// `priority` value first; ties broken by table order.
//
// All known Keychron boards declare VIA usage page 0xff60 / usage 0x61 +
// VID 0x3434, so the discovery filter doesn't change per board.

export interface KeychronBoardPreset {
    id: string
    displayName: string
    rows: number
    cols: number
    encoders: number
    matchSubstrings: string[]
    priority?: number
}

export const KEYCHRON_BOARDS: KeychronBoardPreset[] = [
    {
        id: 'k5-max',
        displayName: 'Keychron K5 Max',
        rows: 6,
        cols: 21,
        encoders: 0,
        matchSubstrings: ['k5 max', 'k5max'],
        priority: 10,
    },
    {
        id: 'k1-max',
        displayName: 'Keychron K1 Max',
        rows: 6,
        cols: 18,
        encoders: 0,
        matchSubstrings: ['k1 max', 'k1max'],
    },
    {
        id: 'k3-max',
        displayName: 'Keychron K3 Max',
        rows: 5,
        cols: 16,
        encoders: 0,
        matchSubstrings: ['k3 max', 'k3max'],
    },
    {
        id: 'k4-max',
        displayName: 'Keychron K4 Max',
        rows: 6,
        cols: 19,
        encoders: 0,
        matchSubstrings: ['k4 max', 'k4max'],
    },
    {
        id: 'k7-max',
        displayName: 'Keychron K7 Max',
        rows: 5,
        cols: 16,
        encoders: 0,
        matchSubstrings: ['k7 max', 'k7max'],
    },
    {
        id: 'k8-max',
        displayName: 'Keychron K8 Max',
        rows: 6,
        cols: 17,
        encoders: 0,
        matchSubstrings: ['k8 max', 'k8max'],
    },
    {
        id: 'k10-max',
        displayName: 'Keychron K10 Max',
        rows: 6,
        cols: 19,
        encoders: 0,
        matchSubstrings: ['k10 max', 'k10max'],
    },
    {
        id: 'q1-max',
        displayName: 'Keychron Q1 Max',
        rows: 5,
        cols: 16,
        encoders: 1,
        matchSubstrings: ['q1 max', 'q1max'],
    },
    {
        id: 'q3-max',
        displayName: 'Keychron Q3 Max',
        rows: 6,
        cols: 17,
        encoders: 1,
        matchSubstrings: ['q3 max', 'q3max'],
    },
    {
        id: 'q5-max',
        displayName: 'Keychron Q5 Max',
        rows: 6,
        cols: 19,
        encoders: 1,
        matchSubstrings: ['q5 max', 'q5max'],
    },
    {
        id: 'q6-max',
        displayName: 'Keychron Q6 Max',
        rows: 6,
        cols: 21,
        encoders: 1,
        matchSubstrings: ['q6 max', 'q6max'],
    },
    {
        id: 'v1-max',
        displayName: 'Keychron V1 Max',
        rows: 5,
        cols: 16,
        encoders: 1,
        matchSubstrings: ['v1 max', 'v1max'],
    },
    {
        id: 'v3-max',
        displayName: 'Keychron V3 Max',
        rows: 6,
        cols: 17,
        encoders: 1,
        matchSubstrings: ['v3 max', 'v3max'],
    },
    {
        id: 'v5-max',
        displayName: 'Keychron V5 Max',
        rows: 6,
        cols: 19,
        encoders: 1,
        matchSubstrings: ['v5 max', 'v5max'],
    },
    {
        id: 'v6-max',
        displayName: 'Keychron V6 Max',
        rows: 6,
        cols: 21,
        encoders: 1,
        matchSubstrings: ['v6 max', 'v6max'],
    },
    // Wired-only Q/V (no Lekker module) — kept for keymap-only support.
    {
        id: 'q1',
        displayName: 'Keychron Q1',
        rows: 5,
        cols: 16,
        encoders: 1,
        matchSubstrings: ['q1 v', ' q1 ', 'q1_v'],
    },
    {
        id: 'q2',
        displayName: 'Keychron Q2',
        rows: 5,
        cols: 15,
        encoders: 1,
        matchSubstrings: ['q2 v', ' q2 ', 'q2_v'],
    },
]

export function matchBoard(label: string): KeychronBoardPreset | null {
    const lc = label.toLowerCase()
    let best: KeychronBoardPreset | null = null
    let bestPriority = -Infinity
    for (const board of KEYCHRON_BOARDS) {
        if (!board.matchSubstrings.some((sub) => lc.includes(sub))) continue
        const p = board.priority ?? 0
        if (p > bestPriority) {
            best = board
            bestPriority = p
        }
    }
    return best
}

export function getBoardById(id: string): KeychronBoardPreset | null {
    return KEYCHRON_BOARDS.find((b) => b.id === id) ?? null
}
