// Pattern check: no GoF pattern (-) — rejected — a stream codec (pages ↔ macro), a step codec (MacroAction ↔ 4-byte events) and two link calls; plain functions over tables.
//
// MCHOSE button macros. Each button slot owns one macro; binding the button
// to type 4 (macro) plays it. A macro is one byte stream —
//   trigger u8 · condition u16le · time u16le · count u8 · count × event
// — cut into 58-byte pages. Write: 0x12 0x55 [idx, more, offset u16le, len,
// page]; read: 0x12 0x65 [idx, page] answers [idx, more, offset, len, page].
// The name (0x12 0x53 / 0x63) is only what the vendor app shows.
// Event layout and condition codes: the vendor web driver (mchose.com.cn);
// paging measured on an A7X Ultra.
import { UnsupportedError } from '../../errors'
import type { MacroAction, MacroPlayMode } from '../../types'
import { LONG, type MchoseLink } from './protocol'

const Cmd = { WRITE: 0x55, READ: 0x65, NAME: 0x53 } as const

const PAGE = 58
const META = 6
/** The vendor driver's step limit. */
export const MAX_EVENTS = 200
const MAX_PAGES = Math.ceil((META + MAX_EVENTS * 4) / PAGE)
const MAX_DELAY_MS = 0xffff

/** How the macro plays (header `condition`), by the vendor's codes. */
export const MacroMode = {
    WHILE_HELD: 0x2001,
    TOGGLE: 0x4001,
    ONCE: 0x0001,
    UNTIL_ANY_KEY: 0x6001,
} as const

/** The neutral play modes, by the condition each writes. */
const CONDITION: Readonly<Record<MacroPlayMode, number>> = {
    once: MacroMode.ONCE,
    whileHeld: MacroMode.WHILE_HELD,
    toggle: MacroMode.TOGGLE,
    untilAnyKey: MacroMode.UNTIL_ANY_KEY,
}

/** The modes a macro can play in, in the vendor app's order. */
export const PLAY_MODES: readonly MacroPlayMode[] = [
    'once',
    'whileHeld',
    'toggle',
    'untilAnyKey',
]

export const conditionOf = (mode: MacroPlayMode): number => CONDITION[mode]

/** The mode a header condition stands for; one this client has no name for
 *  reads as `once` (writing without a mode keeps the condition as it is). */
export const playModeOf = (condition: number): MacroPlayMode =>
    PLAY_MODES.find((m) => CONDITION[m] === condition) ?? 'once'

const Op = {
    KEY_DOWN: 0x81,
    KEY_UP: 0x01,
    MOUSE_DOWN: 0x88,
    MOUSE_UP: 0x08,
    DELAY: 0x0f,
} as const

export interface MchoseMacro {
    readonly trigger: number
    readonly condition: number
    readonly time: number
    /** 4 bytes each: [0, op, a, b]. */
    readonly events: readonly (readonly number[])[]
}

export const EMPTY_MACRO: MchoseMacro = {
    trigger: 1,
    condition: MacroMode.ONCE,
    time: 0,
    events: [],
}

// --- pages ------------------------------------------------------------------

/** The write packets for slot `index`. */
export function macroPackets(index: number, m: MchoseMacro): number[][] {
    const stream = [
        m.trigger,
        m.condition & 0xff,
        m.condition >> 8,
        m.time & 0xff,
        m.time >> 8,
        m.events.length,
        ...m.events.flat(),
    ]
    const out: number[][] = []
    for (let off = 0; off < stream.length; off += PAGE) {
        const page = stream.slice(off, off + PAGE)
        const last = off + PAGE >= stream.length
        out.push([
            Cmd.WRITE,
            index,
            last ? 0 : 1,
            off & 0xff,
            off >> 8,
            page.length,
            ...page,
        ])
    }
    return out
}

/** Pages as read ([idx, more, offset u16le, len, data…]) back into a macro;
 *  a slot never written reads as all zeroes. */
export function parseMacro(pages: readonly Uint8Array[]): MchoseMacro {
    const stream: number[] = []
    for (const p of pages) {
        const off = p[2] | (p[3] << 8)
        const len = Math.min(p[4], p.length - 5)
        stream.splice(off, len, ...p.subarray(5, 5 + len))
    }
    const condition = stream[1] | (stream[2] << 8)
    if (!condition) return EMPTY_MACRO
    const count = Math.min(
        stream[5] ?? 0,
        Math.floor((stream.length - META) / 4),
    )
    return {
        trigger: stream[0],
        condition,
        time: stream[3] | (stream[4] << 8),
        events: Array.from({ length: count }, (_, i) =>
            stream.slice(META + i * 4, META + i * 4 + 4),
        ),
    }
}

// --- steps ------------------------------------------------------------------

const KEYBOARD_PAGE = 0x07
const BUTTON_PAGE = 0x09
/** HID button 1-5 → the vendor's button bit. */
const BUTTON_BIT = [0, 0x01, 0x02, 0x04, 0x08, 0x10] as const

/** A step's keycode — a raw keyboard usage or a packed (page << 16) | id —
 *  as [down op, up op, a]. */
function target(keycode: number): [number, number, number] {
    const page = keycode >> 16 || KEYBOARD_PAGE
    const id = keycode & 0xffff
    if (page === KEYBOARD_PAGE && id >= 0x04 && id <= 0xe7) {
        return [Op.KEY_DOWN, Op.KEY_UP, id]
    }
    const bit = page === BUTTON_PAGE ? BUTTON_BIT[id] : undefined
    if (bit) return [Op.MOUSE_DOWN, Op.MOUSE_UP, bit]
    throw new UnsupportedError(
        `A mouse macro can press keyboard keys and mouse buttons 1-5, not 0x${keycode.toString(16)}`,
    )
}

const delayEvents = (ms: number): number[][] => {
    const out: number[][] = []
    for (
        let left = Math.max(0, Math.round(ms));
        left > 0;
        left -= MAX_DELAY_MS
    ) {
        const d = Math.min(left, MAX_DELAY_MS)
        out.push([0, Op.DELAY, d & 0xff, d >> 8])
    }
    return out
}

type StepEncoder = (a: MacroAction) => number[][]

const keyOf = (a: MacroAction): [number, number, number] =>
    target('keycode' in a ? a.keycode : 0)

const ENCODE: Readonly<Record<MacroAction['kind'], StepEncoder>> = {
    tap: (a) => {
        const [down, up, x] = keyOf(a)
        return [
            [0, down, x, 0],
            [0, up, x, 0],
        ]
    },
    down: (a) => {
        const [down, , x] = keyOf(a)
        return [[0, down, x, 0]]
    },
    up: (a) => {
        const [, up, x] = keyOf(a)
        return [[0, up, x, 0]]
    },
    delay: (a) => delayEvents('ms' in a ? a.ms : 0),
    text: () => {
        throw new UnsupportedError(
            'A mouse macro cannot type text: record the keys instead',
        )
    },
}

export function eventsOf(actions: readonly MacroAction[]): number[][] {
    const events = actions.flatMap((a) => ENCODE[a.kind](a))
    if (events.length > MAX_EVENTS) {
        throw new RangeError(
            `A mouse macro holds at most ${MAX_EVENTS} steps, not ${events.length}`,
        )
    }
    return events
}

const BIT_BUTTON = new Map<number, number>(
    BUTTON_BIT.map((bit, id) => [bit, id]),
)

/** One event as a step; null for one a step cannot say (a scroll). */
function stepOf(e: readonly number[]): MacroAction | null {
    const [, op, a, b] = e
    if (op === Op.DELAY) return { kind: 'delay', ms: a | (b << 8) }
    if (op === Op.KEY_DOWN) return { kind: 'down', keycode: a }
    if (op === Op.KEY_UP) return { kind: 'up', keycode: a }
    const button = BIT_BUTTON.get(a)
    if (!button) return null
    const keycode = (BUTTON_PAGE << 16) | button
    if (op === Op.MOUSE_DOWN) return { kind: 'down', keycode }
    if (op === Op.MOUSE_UP) return { kind: 'up', keycode }
    return null
}

// shortcut: a step the editor cannot show (a scroll recorded in the vendor
// app) is left out, so saving such a macro drops it; add a scroll step kind
// to MacroAction if that matters.
/** The events as steps, a press straight followed by its release as a tap. */
export function actionsOf(
    events: readonly (readonly number[])[],
): MacroAction[] {
    const steps = events.map(stepOf).filter((s): s is MacroAction => !!s)
    const out: MacroAction[] = []
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        const next = steps[i + 1]
        const tap =
            s.kind === 'down' &&
            next?.kind === 'up' &&
            next.keycode === s.keycode
        if (!tap) {
            out.push(s)
            continue
        }
        out.push({ kind: 'tap', keycode: s.keycode })
        i++
    }
    return out
}

// --- the link ---------------------------------------------------------------

const CONDITIONS = new Set(Object.values(CONDITION))

/**
 * Page `n` of slot `index`'s macro, as a bound button's macro reads: its own
 * slot and offset, and on the first page a known play mode and a length that
 * fits the step count. The mouse's reply buffer is not reliable around writes
 * — the first reply after idle is empty, one after a name write can carry the
 * name — so a page that does not fit is asked again.
 */
export function pageFits(d: Uint8Array, index: number, n: number): boolean {
    const off = d[2] | (d[3] << 8)
    const len = d[4]
    if (d[0] !== index || off !== n * PAGE || len < 1 || len > PAGE)
        return false
    if (n > 0) return true
    const more = d[1] === 1
    const condition = d[6] | (d[7] << 8)
    const fits = more ? len === PAGE : len === META + d[10] * 4
    return CONDITIONS.has(condition) && fits
}

/** Read the macro of a button bound to it. */
export async function readMacro(
    link: MchoseLink,
    index: number,
): Promise<MchoseMacro> {
    const pages: Uint8Array[] = []
    for (let n = 0; n < MAX_PAGES; n++) {
        const page = await link.request(LONG, [Cmd.READ, index, n], (d) =>
            pageFits(d, index, n),
        )
        pages.push(page)
        if (page[1] !== 1) break
    }
    return parseMacro(pages)
}

export async function writeMacro(
    link: MchoseLink,
    index: number,
    macro: MchoseMacro,
    name: string,
): Promise<void> {
    for (const packet of macroPackets(index, macro))
        await link.send(LONG, packet)
    const bytes = [...new TextEncoder().encode(name)].slice(0, 56)
    await link.send(LONG, [Cmd.NAME, index, bytes.length, ...bytes])
}
