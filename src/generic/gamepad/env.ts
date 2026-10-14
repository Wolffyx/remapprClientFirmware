// pattern-check: skip — browser seam for the Gamepad API (poll, frame clock, connect events) plus an id parser; injectable for tests, no abstraction beyond the interface.
//
// The Gamepad API only lists a controller once a button on it was pressed
// while the page had focus, and its state is polled, not pushed: read
// navigator.getGamepads() every frame.
import type { GamepadLike } from './inputMap'

export interface GamepadEnv {
    getGamepads(): readonly (GamepadLike | null)[]
    /** Run `cb` on the next display frame; returns a cancel. */
    nextFrame(cb: () => void): () => void
    /** A controller was connected or disconnected; returns an unsubscribe. */
    onConnectionChange(cb: () => void): () => void
}

const FRAME_MS = 16

function nextFrame(cb: () => void): () => void {
    if (typeof requestAnimationFrame === 'function') {
        const handle = requestAnimationFrame(() => cb())
        return () => cancelAnimationFrame(handle)
    }
    const t = setTimeout(cb, FRAME_MS)
    return () => clearTimeout(t)
}

const EVENTS = ['gamepadconnected', 'gamepaddisconnected'] as const

/** The Gamepad API of this window, or null where there is none. */
export function browserGamepadEnv(): GamepadEnv | null {
    if (typeof window === 'undefined' || typeof navigator === 'undefined')
        return null
    if (typeof navigator.getGamepads !== 'function') return null
    return {
        getGamepads: () => navigator.getGamepads(),
        nextFrame,
        onConnectionChange: (cb) => {
            for (const e of EVENTS) window.addEventListener(e, cb)
            return () => {
                for (const e of EVENTS) window.removeEventListener(e, cb)
            }
        },
    }
}

export interface GamepadIdentity {
    readonly name: string
    readonly vendorId?: number
    readonly productId?: number
}

/** Chromium: "Name (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)". */
const CHROMIUM_ID =
    /^(.*?)\s*\([^()]*?Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4})\)$/i
/** Firefox: "54c-ce6-Name". */
const FIREFOX_ID = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.+)$/i
/** Chromium XInput: "Xbox 360 Controller (XInput STANDARD GAMEPAD)". */
const TRAILING_NOTE = /\s*\([^()]*\)$/

const hex = (s: string): number => parseInt(s, 16)

/** Drivers pad product names with runs of spaces. */
const tidy = (name: string): string =>
    name.replace(/\s+/g, ' ').trim() || 'Gamepad'

/** The product name and USB ids in a Gamepad API `id` string. */
export function parseGamepadId(id: string): GamepadIdentity {
    const chromium = CHROMIUM_ID.exec(id)
    if (chromium) {
        return {
            name: tidy(chromium[1]!),
            vendorId: hex(chromium[2]!),
            productId: hex(chromium[3]!),
        }
    }
    const firefox = FIREFOX_ID.exec(id)
    if (firefox) {
        return {
            name: tidy(firefox[3]!),
            vendorId: hex(firefox[1]!),
            productId: hex(firefox[2]!),
        }
    }
    return { name: tidy(id.replace(TRAILING_NOTE, '')) }
}
