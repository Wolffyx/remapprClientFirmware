// Pattern check: Observer (Tier 1) — applied — listens to the window's pointer and wheel events only while someone subscribes and pushes the mouse's button and wheel state as live frames.
//
// A generic mouse cannot be read on its own: the OS merges every pointing
// device into one pointer. The live test therefore shows the system pointer's
// buttons and wheel — any mouse moves it. While it runs it keeps the context
// menu, middle-click autoscroll and back/forward navigation from firing, so
// those buttons can be tested.
import type { ControlInputFrame } from '../../devices/types'
import type { LiveSource } from '../types'

type Handler = (e: Event) => void

/** Where pointer events are heard (the window). */
export interface PointerTarget {
    addEventListener(
        type: string,
        cb: Handler,
        opts?: AddEventListenerOptions,
    ): void
    removeEventListener(
        type: string,
        cb: Handler,
        opts?: EventListenerOptions,
    ): void
}

/** `MouseEvent.buttons` bit → the stock mouse control it presses. */
const BUTTON_BITS: readonly (readonly [bit: number, id: string])[] = [
    [1, 'lmb'],
    [2, 'rmb'],
    [4, 'wheel'],
    [8, 'back'],
    [16, 'fwd'],
]

/** One wheel notch turns the drawn wheel this far (a full turn is 2). */
const NOTCH = 0.25

const wrap = (v: number): number => ((((v + 1) % 2) + 2) % 2) - 1

/** Capture phase: controls on the stage stop pointerdown from bubbling. */
const CAPTURE: AddEventListenerOptions = { capture: true }

const defaultTarget = (): PointerTarget | null =>
    typeof window === 'undefined' ? null : window

export class PointerLiveSource implements LiveSource {
    private readonly listeners = new Set<(f: ControlInputFrame) => void>()
    private buttons = 0
    private turn = 0
    private detach: (() => void) | null = null

    constructor(
        private readonly target: PointerTarget | null = defaultTarget(),
    ) {}

    subscribe(cb: (f: ControlInputFrame) => void): () => void {
        this.listeners.add(cb)
        if (this.listeners.size === 1) this.start()
        return () => {
            if (!this.listeners.delete(cb)) return
            if (this.listeners.size === 0) this.stop()
        }
    }

    private start(): void {
        const t = this.target
        if (!t) return
        const handlers: [string, Handler, AddEventListenerOptions?][] = [
            ['pointerdown', this.onPointer, CAPTURE],
            ['pointermove', this.onPointer, CAPTURE],
            ['pointerup', this.onPointer, CAPTURE],
            ['wheel', this.onWheel, { passive: true }],
            ['contextmenu', this.block],
            ['mouseup', this.onMouseUp, CAPTURE],
            ['blur', this.onBlur],
        ]
        for (const [type, cb, opts] of handlers)
            t.addEventListener(type, cb, opts)
        this.detach = () => {
            for (const [type, cb, opts] of handlers)
                t.removeEventListener(type, cb, opts)
        }
        this.emit()
    }

    private stop(): void {
        this.detach?.()
        this.detach = null
        this.buttons = 0
    }

    private readonly onPointer = (e: Event): void => {
        const p = e as PointerEvent
        if (p.pointerType && p.pointerType !== 'mouse') return
        // Middle-button down starts autoscroll (Windows) or pastes (Linux).
        if (p.type === 'pointerdown' && p.button === 1) p.preventDefault()
        this.setButtons(p.buttons)
    }

    private readonly onWheel = (e: Event): void => {
        const dy = (e as WheelEvent).deltaY
        if (!dy) return
        this.turn = wrap(this.turn + Math.sign(dy) * NOTCH)
        this.emit()
    }

    /** The back / forward buttons navigate the page on release. */
    private readonly onMouseUp = (e: Event): void => {
        if ((e as MouseEvent).button >= 3) e.preventDefault()
    }

    private readonly block = (e: Event): void => e.preventDefault()

    private readonly onBlur = (): void => this.setButtons(0)

    private setButtons(buttons: number): void {
        if (buttons === this.buttons) return
        this.buttons = buttons
        this.emit()
    }

    private emit(): void {
        const pressed = new Set(
            BUTTON_BITS.filter(([bit]) => this.buttons & bit).map(
                ([, id]) => id,
            ),
        )
        const frame: ControlInputFrame = {
            pressed,
            analog: { wheel: this.turn },
        }
        for (const cb of [...this.listeners]) cb(frame)
    }
}
