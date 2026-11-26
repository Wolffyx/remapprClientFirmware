// Pattern check: no GoF pattern (-) — rejected — frame codec, config decoder and one serial request queue over feature reports; plain functions plus a small class.
//
// MCHOSE vendor mouse protocol: the receiver's vendor collection (usage page
// 0xFF01) takes feature report 0x11 (20-byte payload) and 0x12 (64-byte
// payload). Every exchange is SET with the command, then GET for its reply.
// Each payload byte travels XOR 0xFF (an unused byte is 0xFF on the wire), and
// a reply echoes the command byte. No checksum, no sequence number.
//
// The tri-state 0x42 fields and the performance mode bits were measured on an
// A7X Ultra, firmware 5.30.3.0.
import { ProtocolError } from '../../errors'
import type { FeatureReports } from '../../transport'

export const SHORT = 0x11
export const LONG = 0x12
export const CONFIG_LEN = 63
export const DPI_STAGES = 6
export const BUTTON_SLOTS = 6
/** The mouse wedges its config channel when two transactions come closer. */
export const MIN_GAP_MS = 25
const ATTEMPTS = 8

export const Cmd = {
    VERSION: 0x04,
    IDENTITY: 0x06,
    SLEEP: 0x0a,
    DPI: 0x40,
    RATE: 0x41,
    SENSOR: 0x42,
    DEBOUNCE: 0x43,
    PROFILE: 0x58,
    BUTTON: 0x52,
    WRITE_CONFIG: 0x57,
    READ_CONFIG: 0x67,
} as const

export const payloadLength = (report: number): number =>
    report === SHORT ? 20 : 64

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

/** A command's payload as it goes on the wire. */
export function encodeBody(
    report: number,
    body: readonly number[],
): Uint8Array {
    const out = new Uint8Array(payloadLength(report)).fill(0xff)
    if (body.length > out.length) {
        throw new RangeError(`Command longer than report 0x${hex2(report)}`)
    }
    body.forEach((b, i) => {
        out[i] = (b ^ 0xff) & 0xff
    })
    return out
}

/** A reply's payload decoded, or null when it echoes another command. */
export function decodeReply(
    command: number,
    payload: Uint8Array,
): Uint8Array | null {
    if (payload.length < 1 || (payload[0] ^ 0xff) !== command) return null
    return payload.slice(1).map((b) => b ^ 0xff)
}

const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8)

/** Input report 0x13: the mouse pushes its status as it changes. */
export const PUSH_REPORT = 0x13
const STATUS_PUSH = 0xe2

/** The live DPI stage a status push carries, else null. The config block
 *  keeps only the stored stage, so a DPI button press shows only here.
 *  Electron hands over the report id first, WebHID does not. */
export function pushedStage(report: Uint8Array): number | null {
    const payload = report[0] === PUSH_REPORT ? report.subarray(1) : report
    const d = decodeReply(STATUS_PUSH, payload)
    return d && d.length > 4 ? d[4] : null
}

// --- identity ------------------------------------------------------------

export type LinkMode = 'usb' | 'p24g' | 'bt'

const LINK_MODES: readonly LinkMode[] = ['usb', 'p24g', 'bt']

export interface Identity {
    readonly vid: number
    /** The mouse's own PID (the receiver has another). */
    readonly pid: number
    readonly link?: LinkMode
    /** The mouse answers through the receiver. */
    readonly connected: boolean
    readonly battery: number
    readonly charging: boolean
}

export function parseIdentity(d: Uint8Array): Identity {
    const link = LINK_MODES[d[8] & 0x07]
    return {
        vid: u16(d, 0),
        pid: u16(d, 2),
        ...(link ? { link } : {}),
        connected: (d[8] & 0x08) !== 0,
        battery: Math.min(d[9], 100),
        charging: d[10] !== 0,
    }
}

export function parseVersion(d: Uint8Array): string {
    const n = Math.min(d[0], d.length - 1)
    return new TextDecoder().decode(d.subarray(1, 1 + n)).replace(/\0+$/, '')
}

// --- config block (0x12 0x67 read, 0x12 0x57 write) ------------------------

/** Sensor byte (config[17]): LOD index in bits 0-1, ripple / angle snap /
 *  motion sync in bits 2-4, the performance mode in bits 6-7. */
export interface SensorFlags {
    readonly lod: number
    readonly ripple: boolean
    readonly angleSnap: boolean
    readonly motionSync: boolean
    /** 1-3 as 0x42 sets it; absent when the bits hold a value it never set. */
    readonly performance?: number
    /** Sensor angle, degrees (config[49], signed). */
    readonly rotation: number
}

// 0x42 performance mode 1 / 2 / 3 leaves bits 6-7 at 00 / 10 / 11.
const PERFORMANCE_BY_BITS: readonly (number | undefined)[] = [
    1,
    undefined,
    2,
    3,
]

export function parseSensor(s: number, rotation = 0): SensorFlags {
    const performance = PERFORMANCE_BY_BITS[s >> 6]
    return {
        lod: s & 0x03,
        ripple: (s & 0x04) !== 0,
        angleSnap: (s & 0x08) !== 0,
        motionSync: (s & 0x10) !== 0,
        ...(performance ? { performance } : {}),
        rotation: (rotation << 24) >> 24,
    }
}

/** One button's function (config[20 + 4i]): slot index in the high nibble,
 *  type in the low one, then a 3-byte value whose meaning the type picks. */
export interface ButtonSlot {
    readonly type: number
    /** The three value bytes, first byte highest. */
    readonly value: number
}

export interface MouseConfig {
    /** The block as read, so a restore never drops a field this client does
     *  not model. */
    readonly raw: Uint8Array
    readonly profile: number
    readonly stage: number
    readonly rateIndex: number
    /** All six X-axis stages. */
    readonly dpi: readonly number[]
    /** All six Y-axis stages (config[51..62]); equal to `dpi` unless the
     *  axes were set apart. */
    readonly dpiY: readonly number[]
    readonly enabledStages: number
    readonly sensor: SensorFlags
    readonly debounceMs: number
    readonly sleepMinutes: number
    readonly buttons: readonly ButtonSlot[]
}

export function parseConfig(raw: Uint8Array): MouseConfig {
    const enabled = Math.min(Math.max(raw[16], 1), DPI_STAGES)
    return {
        raw: raw.slice(0, CONFIG_LEN),
        profile: raw[0],
        stage: Math.min(raw[1] & 0x0f, enabled - 1),
        // byte 2's high nibble is the live rate; byte 1's keeps the boot one.
        rateIndex: raw[2] >> 4,
        dpi: Array.from({ length: DPI_STAGES }, (_, i) => u16(raw, 4 + i * 2)),
        dpiY: Array.from({ length: DPI_STAGES }, (_, i) =>
            u16(raw, 51 + i * 2),
        ),
        enabledStages: enabled,
        sensor: parseSensor(raw[17], raw[49]),
        debounceMs: raw[18],
        sleepMinutes: raw[19],
        buttons: Array.from({ length: BUTTON_SLOTS }, (_, i) => {
            const at = 20 + i * 4
            return {
                type: raw[at] & 0x0f,
                value: (raw[at + 1] << 16) | (raw[at + 2] << 8) | raw[at + 3],
            }
        }),
    }
}

// --- write commands --------------------------------------------------------

const le16s = (values: readonly number[]): number[] =>
    values.flatMap((v) => [v & 0xff, v >> 8])

/** Report 0x12: the six X stages, then 0xFF and the six Y stages (the
 *  short 0x11 form writes X only and copies it onto Y). */
export function dpiCommand(from: MouseConfig, to: MouseConfig): number[] {
    return [
        Cmd.DPI,
        to.stage,
        to.stage,
        from.raw[3],
        ...le16s(to.dpi),
        to.enabledStages,
        0xff,
        ...le16s(to.dpiY),
    ]
}

export const rateCommand = (index: number): number[] => [Cmd.RATE, index, index]

// 0x42 fields are tri-state: 0 leaves the setting as it is, 1 turns it on,
// 2 turns it off. Rotation is the same: 1 + signed degrees, or 2 for 0°.
const onOff = (on: boolean): number => (on ? 1 : 2)

export function sensorCommand(s: SensorFlags): number[] {
    return [
        Cmd.SENSOR,
        s.lod,
        onOff(s.ripple),
        onOff(s.angleSnap),
        onOff(s.motionSync),
        0,
        0,
        s.performance ?? 0,
        onOff(s.rotation !== 0),
        s.rotation & 0xff,
    ]
}

export const debounceCommand = (ms: number): number[] => [Cmd.DEBOUNCE, ms]

export const sleepCommand = (minutes: number): number[] => [
    Cmd.SLEEP,
    minutes > 0 ? 1 : 0,
    minutes,
]

export const profileCommand = (index: number): number[] => [Cmd.PROFILE, index]

/** Report 0x12: set one button's function. */
export const buttonCommand = (index: number, s: ButtonSlot): number[] => [
    Cmd.BUTTON,
    index,
    0,
    s.type,
    (s.value >> 16) & 0xff,
    (s.value >> 8) & 0xff,
    s.value & 0xff,
]

/** One command and the report it goes out on. */
export interface Write {
    readonly report: number
    readonly body: number[]
}

const sameFlags = (a: SensorFlags, b: SensorFlags): boolean =>
    a.lod === b.lod &&
    a.ripple === b.ripple &&
    a.angleSnap === b.angleSnap &&
    a.motionSync === b.motionSync &&
    (a.performance ?? 0) === (b.performance ?? 0) &&
    a.rotation === b.rotation

/** The commands that take the mouse from `from` to `to`, one per setting
 *  that differs. Empty = they hold the same settings. */
export function writesBetween(from: MouseConfig, to: MouseConfig): Write[] {
    const out: number[][] = []
    const dpiMoved =
        from.stage !== to.stage ||
        from.enabledStages !== to.enabledStages ||
        from.dpi.some((v, i) => v !== to.dpi[i]) ||
        from.dpiY.some((v, i) => v !== to.dpiY[i])
    const dpi: Write[] = dpiMoved
        ? [{ report: LONG, body: dpiCommand(from, to) }]
        : []
    if (from.rateIndex !== to.rateIndex) out.push(rateCommand(to.rateIndex))
    if (!sameFlags(from.sensor, to.sensor)) out.push(sensorCommand(to.sensor))
    if (from.debounceMs !== to.debounceMs) {
        out.push(debounceCommand(to.debounceMs))
    }
    if (from.sleepMinutes !== to.sleepMinutes) {
        out.push(sleepCommand(to.sleepMinutes))
    }
    const writes: Write[] = [
        ...dpi,
        ...out.map((body) => ({ report: SHORT, body })),
    ]
    to.buttons.forEach((s, i) => {
        const was = from.buttons[i]
        if (was.type === s.type && was.value === s.value) return
        writes.push({ report: LONG, body: buttonCommand(i, s) })
    })
    return writes
}

// --- the link ----------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

const anyNonZero = (d: Uint8Array): boolean => d.some((b) => b !== 0)

/**
 * One mouse's feature-report channel. Transactions run one at a time with
 * the gap the mouse needs; a request is re-sent while the reply echoes
 * another command or comes back empty (the first reply after the mouse idled
 * is all zeroes).
 */
export class MchoseLink {
    private tail: Promise<unknown> = Promise.resolve()
    private lastAt = 0

    constructor(
        private readonly hid: FeatureReports,
        private readonly wait: (ms: number) => Promise<void> = sleep,
    ) {}

    send(report: number, body: readonly number[]): Promise<void> {
        return this.serial(() => this.put(report, body))
    }

    request(
        report: number,
        body: readonly number[],
        accept: (reply: Uint8Array) => boolean = anyNonZero,
    ): Promise<Uint8Array> {
        return this.serial(() => this.ask(report, body, accept))
    }

    /** Let the mouse settle (after a write, before reading it back). */
    pause(ms: number): Promise<void> {
        return this.serial(() => this.wait(ms))
    }

    private serial<T>(job: () => Promise<T>): Promise<T> {
        const run = this.tail.then(job, job)
        this.tail = run.catch(() => undefined)
        return run
    }

    private async gap(): Promise<void> {
        const since = Date.now() - this.lastAt
        if (since < MIN_GAP_MS) await this.wait(MIN_GAP_MS - since)
        this.lastAt = Date.now()
    }

    private async put(report: number, body: readonly number[]): Promise<void> {
        await this.gap()
        await this.hid.send(report, encodeBody(report, body))
    }

    private async ask(
        report: number,
        body: readonly number[],
        accept: (reply: Uint8Array) => boolean,
    ): Promise<Uint8Array> {
        const command = body[0]
        let empty = false
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            await this.put(report, body)
            await this.wait(80 + attempt * 20)
            await this.gap()
            const payload = await this.hid.receive(
                report,
                payloadLength(report),
            )
            const reply = decodeReply(command, payload)
            if (reply && accept(reply)) return reply
            empty ||= reply !== null
            await this.wait(150 + attempt * 100)
        }
        throw new ProtocolError(
            empty
                ? `The mouse answered command 0x${hex2(command)} empty: is it awake and paired?`
                : `The mouse did not answer command 0x${hex2(command)}`,
        )
    }
}

export const readIdentity = async (link: MchoseLink): Promise<Identity> =>
    parseIdentity(
        await link.request(
            SHORT,
            [Cmd.IDENTITY],
            (d) => d.length >= 11 && u16(d, 0) !== 0,
        ),
    )

export const readVersion = async (link: MchoseLink): Promise<string> =>
    parseVersion(await link.request(SHORT, [Cmd.VERSION]))

export const readConfig = async (link: MchoseLink): Promise<MouseConfig> =>
    parseConfig(
        await link.request(
            LONG,
            [Cmd.READ_CONFIG],
            (d) =>
                d.length >= CONFIG_LEN && anyNonZero(d.subarray(0, CONFIG_LEN)),
        ),
    )
