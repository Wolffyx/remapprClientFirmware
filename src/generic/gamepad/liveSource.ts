// Pattern check: Observer (Tier 1) — applied — polls one controller every display frame only while someone listens and pushes changed frames to the listeners.
//
// The Gamepad API is polled: read the controller each frame, skip frames that
// change nothing, stop polling when the last listener leaves.
import type { ControlInputFrame } from '../../devices/types'
import type { LiveSource } from '../types'
import type { GamepadEnv } from './env'
import { frameKey, frameOf, type GamepadLike, type InputMap } from './inputMap'

type Listener = (frame: ControlInputFrame) => void

export class GamepadLiveSource implements LiveSource {
    private readonly listeners = new Set<Listener>()
    private cancel: (() => void) | null = null
    private lastKey: string | null = null

    constructor(
        private readonly env: GamepadEnv,
        private readonly pad: Pick<GamepadLike, 'index' | 'id'>,
        private readonly map: InputMap,
    ) {}

    subscribe(cb: Listener): () => void {
        this.listeners.add(cb)
        if (this.listeners.size === 1) this.start()
        return () => {
            if (!this.listeners.delete(cb)) return
            if (this.listeners.size === 0) this.stop()
        }
    }

    private start(): void {
        this.lastKey = null
        this.tick()
    }

    private stop(): void {
        this.cancel?.()
        this.cancel = null
    }

    private readonly tick = (): void => {
        this.cancel = this.env.nextFrame(this.tick)
        this.read()
    }

    private read(): void {
        const gp = this.env.getGamepads()[this.pad.index]
        if (!gp || gp.id !== this.pad.id) return
        const frame = frameOf(gp, this.map)
        const key = frameKey(frame)
        if (key === this.lastKey) return
        this.lastKey = key
        for (const cb of [...this.listeners]) cb(frame)
    }
}
