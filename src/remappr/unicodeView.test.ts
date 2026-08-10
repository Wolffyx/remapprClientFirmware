// pattern-check: skip — test wiring: a fake RemapprRpc answers the two KEYBOARD
// unicode verbs so the facade is exercised without hardware. No GoF abstraction.
import { describe, expect, it } from 'vitest'

import { Cmd, Namespace, Status } from './protocol'
import type { RemapprRpc, UniversalReply } from './rpc'
import { buildUnicodeApi } from './unicodeView'

/** GET_UNICODE_MODE reply: {u8 mode, u8 supported bitmask}. */
function modeBytes(mode: number, supported: number): Uint8Array {
    return Uint8Array.of(mode, supported)
}

interface FakeRpc {
    rpc: RemapprRpc
    /** Every (verb, arg) the facade put on the wire, in order. */
    calls: { verb: number; arg?: Uint8Array }[]
}

function makeRpc(
    opts: { mode?: Uint8Array; setStatus?: number } = {},
): FakeRpc {
    const state: FakeRpc = { calls: [], rpc: undefined as unknown as RemapprRpc }

    state.rpc = {
        async callUniversalPlain(
            namespace: number,
            verb: number,
            arg?: Uint8Array,
        ): Promise<UniversalReply> {
            state.calls.push({ verb, arg })
            if (namespace !== Namespace.KEYBOARD)
                return { status: Status.ERR_CMD, data: new Uint8Array() }
            if (verb === Cmd.GET_UNICODE_MODE)
                return {
                    status: Status.OK,
                    // mode = linux, every method supported
                    data: opts.mode ?? modeBytes(1, 0b11111),
                }
            if (verb === Cmd.SET_UNICODE_MODE)
                return {
                    status: opts.setStatus ?? Status.OK,
                    data: new Uint8Array(),
                }
            return { status: Status.ERR_CMD, data: new Uint8Array() }
        },
    } as unknown as RemapprRpc

    return state
}

describe('unicode facade', () => {
    it('decodes the selected mode and the supported set', async () => {
        const { rpc } = makeRpc()
        const state = await buildUnicodeApi(rpc).getMode()
        expect(state.mode).toBe(1)
        expect(state.supported).toEqual([0, 1, 2, 3, 4])
    })

    it('reports only the methods the device advertises', async () => {
        // bit 0 (off) + bit 3 (windows) — a node that can only type one method
        const { rpc } = makeRpc({ mode: modeBytes(3, 0b01001) })
        const state = await buildUnicodeApi(rpc).getMode()
        expect(state.mode).toBe(3)
        expect(state.supported).toEqual([0, 3])
    })

    it('sends the mode byte on set', async () => {
        const fake = makeRpc()
        await buildUnicodeApi(fake.rpc).setMode(4)
        const set = fake.calls.find((c) => c.verb === Cmd.SET_UNICODE_MODE)
        expect(set?.arg).toEqual(Uint8Array.of(4))
    })

    it('surfaces a device rejection rather than reporting success', async () => {
        // The device answers ERR_ARG for a method it cannot type; swallowing that
        // would leave the UI showing a selection the node never took.
        const { rpc } = makeRpc({ setStatus: Status.ERR_ARG })
        await expect(buildUnicodeApi(rpc).setMode(2)).rejects.toThrow(
            /SET_UNICODE_MODE/,
        )
    })
})
