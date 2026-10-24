// pattern-check: skip — test of the RPC deadline over fake streams
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client'
import { TransportError } from '@firmware/errors'
import { RPC_DEADLINE_MS, ZmkKeyboardService } from './service'

/** A connection whose device answers (or never does). Aborting the request
 *  side ends the replies, as closing the transport does. */
function fakeConnection(answers: boolean): RpcConnection {
    let replies!: ReadableStreamDefaultController<unknown>
    const request_response_readable = new ReadableStream({
        start: (c) => {
            replies = c
        },
    })
    const request_writable = new WritableStream<{ requestId: number }>({
        write: (req) => {
            if (answers)
                replies.enqueue({ requestId: req.requestId, core: {} })
        },
        abort: () => replies.close(),
    })
    return {
        label: 'fake',
        request_response_readable,
        request_writable,
        notification_readable: new ReadableStream(),
        current_request: 0,
    } as unknown as RpcConnection
}

const info = { name: 'Fake', firmware: 'zmk' as const }

describe('ZMK RPC deadline', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('fails a request the keyboard never answers and closes the link', async () => {
        vi.useFakeTimers()
        const service = new ZmkKeyboardService(fakeConnection(false), info)
        const closed = vi.fn()
        service.onClosed(closed)

        const pending = service.getLockState()
        const outcome = expect(pending).rejects.toBeInstanceOf(TransportError)
        await vi.advanceTimersByTimeAsync(RPC_DEADLINE_MS)
        await outcome
        expect(closed).toHaveBeenCalled()
    })

    it('frees the library request lock for the next connection', async () => {
        vi.useFakeTimers()
        const dead = new ZmkKeyboardService(fakeConnection(false), info)
        const failed = expect(dead.getLockState()).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(RPC_DEADLINE_MS)
        await failed

        vi.useRealTimers()
        const reply = await call_rpc(fakeConnection(true), {
            core: { getLockState: true },
        })
        expect(reply.requestId).toBe(0)
    })
})
