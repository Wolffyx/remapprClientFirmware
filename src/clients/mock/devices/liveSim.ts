// Pattern check: Observer (Tier 1) — applied — simulated live input frames are
// pushed to subscribers; the timers run only while at least one listens, so a
// remount (StrictMode) cannot leak a second set.
//
// Fake live input for the demo devices: a random button press every 260 ms
// (held 180 ms) and fresh stick / trigger / axis values every 650 ms.
import type {
    AnalogValue,
    ControlInputFrame,
    DeviceControl,
} from '@firmware/devices/types'

type Listener = (frame: ControlInputFrame) => void
type Timer = ReturnType<typeof setTimeout>

const PRESS_EVERY_MS = 260
const HOLD_MS = 180
const MOVE_EVERY_MS = 650

const PRESSABLE = new Set(['button', 'wheel', 'hat'])
const ANALOG = new Set(['stick', 'axis', 'encoder', 'trigger'])

export class LiveInputSim {
    private readonly listeners = new Set<Listener>()
    private readonly timers = new Set<Timer>()
    private pressed: ReadonlySet<string> = new Set()
    private analog: Record<string, AnalogValue> = {}

    constructor(
        private readonly controls: readonly DeviceControl[],
        private readonly random: () => number = Math.random,
    ) {}

    subscribe(cb: Listener): () => void {
        this.listeners.add(cb)
        if (this.listeners.size === 1) this.start()
        return () => {
            if (!this.listeners.delete(cb)) return
            if (this.listeners.size === 0) this.stop()
        }
    }

    dispose(): void {
        this.listeners.clear()
        this.stop()
    }

    private start(): void {
        const pressable = this.controls.filter((c) => PRESSABLE.has(c.kind))
        const analog = this.controls.filter((c) => ANALOG.has(c.kind))
        if (pressable.length) {
            this.every(PRESS_EVERY_MS, () => this.press(pressable))
        }
        if (analog.length) this.every(MOVE_EVERY_MS, () => this.move(analog))
    }

    private stop(): void {
        for (const t of this.timers) clearTimeout(t)
        this.timers.clear()
        this.pressed = new Set()
        this.analog = {}
    }

    private every(ms: number, fn: () => void): void {
        this.timers.add(setInterval(fn, ms))
    }

    private press(pressable: readonly DeviceControl[]): void {
        const c = pressable[Math.floor(this.random() * pressable.length)]
        if (!c) return
        this.pressed = new Set([...this.pressed, c.id])
        this.emit()
        const release = setTimeout(() => {
            this.timers.delete(release)
            this.pressed = new Set(
                [...this.pressed].filter((id) => id !== c.id),
            )
            this.emit()
        }, HOLD_MS)
        this.timers.add(release)
    }

    private move(analog: readonly DeviceControl[]): void {
        this.analog = Object.fromEntries(
            analog.map((c) => [c.id, this.valueFor(c)]),
        )
        this.emit()
    }

    private valueFor(c: DeviceControl): AnalogValue {
        if (c.kind === 'trigger') {
            return this.random() < 0.4 ? 0 : this.random()
        }
        if (c.kind !== 'stick') return this.random() * 2 - 1
        const angle = this.random() * Math.PI * 2
        const r = this.random()
        return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
    }

    private emit(): void {
        const frame: ControlInputFrame = {
            pressed: this.pressed,
            analog: this.analog,
        }
        for (const cb of [...this.listeners]) cb(frame)
    }
}
