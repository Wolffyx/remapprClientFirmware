// pattern-check: skip — test-only fake of the firmware config store verbs
// A scripted device for the config-safety tests: it serves READ_CONFIG_CHUNK from
// an active blob and runs the BEGIN / CHUNK / VALIDATE / COMMIT / ROLLBACK
// staging verbs the way subsys/remappr/control/control.c does, with knobs to make
// a read or a commit fail the ways the audit describes.
import type { RemapprRpc } from './rpc'
import { Cmd, Status } from './protocol'

export interface FakeConfigDeviceOpts {
    /** The active blob (undefined = no active config). */
    active?: Uint8Array
    /** READ_CONFIG_CHUNK at or past this offset answers `readFailStatus`. */
    readFailAt?: number
    readFailStatus?: number
    /** READ_CONFIG_CHUNK at or past this offset answers OK with no bytes. */
    readEofAt?: number
    /** Staging capacity (GET_LIMITS max_config_bytes); a CHUNK past it fails. */
    capacity?: number
    /** The first COMMIT answers ERR_ACTIVATE. `keep` = main firmware (the new
     *  config and its version stay active); `revert` = intl-keys (the previous
     *  stays). Later COMMITs succeed. */
    activateFails?: 'keep' | 'revert'
}

type Reply = { status: number; data: Uint8Array }

const ok = (data: Uint8Array = new Uint8Array()): Reply => ({ status: Status.OK, data })
const err = (status: number): Reply => ({ status, data: new Uint8Array() })
const u32At = (b: Uint8Array, off: number): number =>
    new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, true)

export class FakeConfigDevice {
    active: Uint8Array | undefined
    staged: number[] | null = null
    private commits = 0
    /** Every command the host sent, in order. */
    readonly log: number[] = []
    readonly rpc: RemapprRpc

    constructor(private readonly opts: FakeConfigDeviceOpts = {}) {
        this.active = opts.active
        const call = async (cmd: number, arg?: Uint8Array): Promise<Reply> =>
            this.handle(cmd, arg ?? new Uint8Array())
        this.rpc = {
            callPlain: call,
            callSealed: async (_s: unknown, cmd: number, arg?: Uint8Array) =>
                call(cmd, arg),
            callUniversalPlain: async (_ns: number, cmd: number, arg?: Uint8Array) =>
                call(cmd, arg),
            onClosed: () => () => undefined,
            subscribeInput: () => () => undefined,
            close: async () => undefined,
        } as unknown as RemapprRpc
    }

    get version(): number {
        return this.active && this.active.length >= 12 ? u32At(this.active, 8) : 0
    }

    private handle(cmd: number, arg: Uint8Array): Reply {
        this.log.push(cmd)
        switch (cmd) {
            case Cmd.GET_DEVICE_INFO:
                return ok(this.deviceInfo())
            case Cmd.READ_CONFIG_CHUNK:
                return this.read(arg)
            case Cmd.WRITE_CONFIG_BEGIN:
                this.staged = []
                return ok()
            case Cmd.WRITE_CONFIG_CHUNK:
                return this.write(arg)
            case Cmd.VALIDATE_CONFIG:
                return this.validate()
            case Cmd.COMMIT_CONFIG:
                return this.commit()
            case Cmd.ROLLBACK_CONFIG:
                this.staged = null
                return ok()
            default:
                return err(Status.ERR_CMD)
        }
    }

    private deviceInfo(): Uint8Array {
        const d = new Uint8Array(16)
        const dv = new DataView(d.buffer)
        dv.setUint16(0, 1, true)
        dv.setUint16(2, 1, true)
        dv.setUint16(4, 1, true)
        d[11] = this.active ? 1 : 0
        dv.setUint32(12, this.version, true)
        return d
    }

    private read(arg: Uint8Array): Reply {
        if (!this.active) return err(Status.ERR_STATE)
        const off = u32At(arg, 0)
        const want = new DataView(arg.buffer, arg.byteOffset).getUint16(4, true)
        if (this.opts.readFailAt !== undefined && off >= this.opts.readFailAt)
            return err(this.opts.readFailStatus ?? Status.ERR_STORAGE)
        if (this.opts.readEofAt !== undefined && off >= this.opts.readEofAt) return ok()
        if (off > this.active.length) return err(Status.ERR_ARG)
        return ok(this.active.slice(off, Math.min(off + want, this.active.length)))
    }

    private write(arg: Uint8Array): Reply {
        if (!this.staged) return err(Status.ERR_STATE)
        const cap = this.opts.capacity
        if (cap !== undefined && this.staged.length + arg.length > cap)
            return err(Status.ERR_STORAGE)
        this.staged.push(...arg)
        return ok()
    }

    private validate(): Reply {
        if (!this.staged) return err(Status.ERR_STATE)
        const blob = Uint8Array.from(this.staged)
        if (blob.length < 20) return err(Status.ERR_INVALID)
        if (this.active && u32At(blob, 8) <= this.version) return err(Status.ERR_VERSION)
        return ok()
    }

    private commit(): Reply {
        if (!this.staged) return err(Status.ERR_STATE)
        const blob = Uint8Array.from(this.staged)
        this.staged = null
        const fails = this.commits++ === 0 ? this.opts.activateFails : undefined
        if (fails === 'revert') return err(Status.ERR_ACTIVATE)
        this.active = blob
        if (fails === 'keep') return err(Status.ERR_ACTIVATE)
        return ok()
    }
}
