// Pattern check: Dispatch Map (Tier 0) — applied — procedure step → handler table in the demo sensor; no switch.
//
// The demo mouse's sensor (service.sensor) for Try Demo: the settings, a
// procedure and readings the demo catalog describes, behaving the way a
// Remappr sensor does over the SENSOR namespace. A setting snaps to its step;
// an option that needs a procedure is refused until that procedure has run; a
// two-phase procedure waits for Next in phase 1 (readings are refused then,
// as the firmware does while calibrating) and counts by itself in phase 2;
// its status says whether a result is stored.
import type {
    SensorInfo,
    SensorSettingSpec,
    SensorSettingValue,
    SensorSpec,
} from '@firmware/devices/types'
import type {
    SensorApi,
    SensorProcedureStatus,
    SensorProcedureStep,
    SensorReading,
} from '@firmware/service'

type Described = Pick<SensorSpec, 'settings' | 'procedures' | 'metrics'>

/** How long the demo's counting phase takes, and what it counts to. */
const COUNT_MS = 3000
const COUNT_TOTAL = 3000

const IDLE: SensorProcedureStatus = {
    state: 'idle',
    phase: 0,
    progress: 0,
    total: 0,
    ok: true,
}

interface Run {
    name: string
    phase: number
    /** When the phase in hand started (ms). */
    since: number
}

export class DemoSensor implements SensorApi {
    readonly writable = true

    private readonly values = new Map<string, SensorSettingValue>()
    /** Procedures with a stored result. */
    private readonly results = new Set<string>()
    private run: Run | null = null
    private last: SensorProcedureStatus = IDLE
    private quality = 150

    constructor(
        private readonly described: Described,
        private readonly now: () => number = Date.now,
        private readonly random: () => number = Math.random,
    ) {
        for (const s of described.settings) this.values.set(s.name, s.default)
    }

    getSensors(): Promise<readonly SensorInfo[]> {
        const settings = this.described.settings.map((s) => ({
            ...s,
            value: this.values.get(s.name) ?? s.default,
            personality: false,
        }))
        return Promise.resolve([
            {
                index: 0,
                cls: 'pointer',
                model: 'Demo sensor',
                settings,
                procedures: this.described.procedures,
                metrics: this.described.metrics,
            },
        ])
    }

    setSetting(
        _sensor: number,
        name: string,
        value: SensorSettingValue,
    ): Promise<SensorSettingValue> {
        const s = this.described.settings.find((x) => x.name === name)
        if (!s) return Promise.reject(new Error(`Unknown setting "${name}"`))
        const needs = s.options?.find((o) => o.value === value)?.needs
        if (needs && !this.results.has(needs)) {
            return Promise.reject(
                new Error(`Run the ${this.labelOf(needs)} first`),
            )
        }
        const applied = snap(s, value)
        this.values.set(name, applied)
        return Promise.resolve(applied)
    }

    runProcedure(
        _sensor: number,
        name: string,
        step: SensorProcedureStep,
    ): Promise<SensorProcedureStatus> {
        if (!this.described.procedures.some((p) => p.name === name)) {
            return Promise.reject(new Error(`Unknown procedure "${name}"`))
        }
        try {
            this.steps[step](name)
        } catch (e) {
            return Promise.reject(e)
        }
        return this.getProcedureStatus(0, name)
    }

    getProcedureStatus(
        _sensor: number,
        name: string,
    ): Promise<SensorProcedureStatus> {
        this.tick()
        return Promise.resolve({
            ...this.progressOf(name),
            hasResult: this.results.has(name),
        })
    }

    getMetrics(): Promise<readonly SensorReading[]> {
        if (this.run && this.run.phase < this.phases(this.run.name)) {
            return Promise.reject(new Error('The sensor is calibrating'))
        }
        // A surface quality that wanders a little, as a real one does.
        this.quality = Math.round(
            Math.min(170, Math.max(120, this.quality + (this.random() - 0.5) * 8)),
        )
        return Promise.resolve(
            this.described.metrics.map((m) => ({
                name: m.name,
                value: m.max === 1 ? 0 : Math.min(m.max, this.quality),
                max: m.max,
            })),
        )
    }

    // --- procedures ---------------------------------------------------------

    private readonly steps: Readonly<
        Record<SensorProcedureStep, (name: string) => void>
    > = {
        begin: (name) => {
            if (this.run) throw new Error('A procedure is already running')
            this.run = { name, phase: 1, since: this.now() }
        },
        next: (name) => {
            const run = this.run
            if (run?.name !== name) throw new Error('Nothing is running')
            if (run.phase >= this.phases(name)) {
                this.finish(name)
                return
            }
            this.run = { name, phase: run.phase + 1, since: this.now() }
        },
        cancel: () => {
            this.run = null
            this.last = IDLE
        },
        reset: (name) => {
            this.run = null
            this.last = IDLE
            this.results.delete(name)
            // An option that needed the result goes back to its default.
            for (const s of this.described.settings) {
                const needs = s.options?.find(
                    (o) => o.value === this.values.get(s.name),
                )?.needs
                if (needs === name) this.values.set(s.name, s.default)
            }
        },
    }

    /** Where procedure `name` is now (the stored result aside). */
    private progressOf(name: string): SensorProcedureStatus {
        const run = this.run
        if (run?.name !== name) {
            return this.last.state === 'idle' ? IDLE : this.last
        }
        const counting = run.phase === this.phases(name)
        const progress = counting
            ? Math.min(
                  COUNT_TOTAL,
                  Math.round(((this.now() - run.since) / COUNT_MS) * COUNT_TOTAL),
              )
            : 0
        return {
            state: 'running',
            phase: run.phase,
            progress,
            total: counting ? COUNT_TOTAL : 0,
            ok: true,
        }
    }

    /** The counting phase ends by itself once it has counted. */
    private tick(): void {
        const run = this.run
        if (!run || run.phase < this.phases(run.name)) return
        if (this.now() - run.since >= COUNT_MS) this.finish(run.name)
    }

    private finish(name: string): void {
        this.run = null
        this.results.add(name)
        this.last = { state: 'done', phase: 0, progress: 0, total: 0, ok: true }
    }

    private phases(name: string): number {
        return (
            this.described.procedures.find((p) => p.name === name)?.phases
                .length ?? 1
        )
    }

    private labelOf(name: string): string {
        const label = this.described.procedures.find(
            (p) => p.name === name,
        )?.label
        return label?.toLowerCase() ?? name
    }
}

/** An INT snapped to its step inside its range; any other value as is. */
function snap(s: SensorSettingSpec, v: SensorSettingValue): SensorSettingValue {
    if (s.type !== 'int' || typeof v !== 'number') return v
    const min = s.min ?? v
    const step = s.step || 1
    const snapped = min + Math.round((v - min) / step) * step
    return Math.min(s.max ?? snapped, Math.max(min, snapped))
}
