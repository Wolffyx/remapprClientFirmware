// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it, vi } from 'vitest'

import { buildHostSetArgs, buildHostValuesApi, localSeconds, parseHostKeys } from './hostValues'
import { Namespace } from './protocol'
import type { RemapprRpc } from './rpc'

const arr = (a: Uint8Array): number[] => Array.from(a)

describe('HOST namespace', () => {
    it('writes a number, a time and a text in pieces', () => {
        expect(buildHostSetArgs(0x02, 'int', 42).map(arr)).toEqual([[0x02, 0, 0, 4, 42, 0, 0, 0]])
        const d = new Date(Date.UTC(2026, 10, 12, 12, 34, 0))
        const [t] = buildHostSetArgs(0x01, 'time', d)
        expect(arr(t.subarray(0, 4))).toEqual([0x01, 2, 0, 4])
        expect(new DataView(t.buffer).getUint32(4, true)).toBe(localSeconds(d))
        const pieces = buildHostSetArgs(0x10, 'text', 'Hello from the host app :)')
        expect(pieces.map((p) => arr(p.subarray(0, 4)))).toEqual([
            [0x10, 1, 0, 26],
            [0x10, 1, 20, 26],
        ])
        expect(new TextDecoder().decode(pieces[1].subarray(4))).toBe('app :)')
        expect(buildHostSetArgs(0x10, 'text', '').map(arr)).toEqual([[0x10, 1, 0, 0]])
        expect(buildHostSetArgs(0x10, 'text', 'x'.repeat(100)).length).toBe(4) // 64 bytes max
    })

    it('reads the keys the screens show', () => {
        expect(parseHostKeys(new Uint8Array([1, 2, 0x01, 0x10]))).toEqual([0x01, 0x10])
    })

    it('talks HOST through the rpc by key name', async () => {
        const calls: [number, number, number[]][] = []
        const rpc = {
            callUniversalPlain: vi.fn(async (ns: number, verb: number, arg?: Uint8Array) => {
                calls.push([ns, verb, arr(arg ?? new Uint8Array())])
                return { status: 0, data: verb === 1 ? new Uint8Array([1, 2, 0x01, 0x02]) : new Uint8Array() }
            }),
        } as unknown as RemapprRpc
        const api = buildHostValuesApi(rpc)
        expect(await api.keys()).toEqual(['time', 'cpu'])
        await api.set('cpu', 37)
        await api.clear()
        expect(calls.map(([ns, verb]) => [ns, verb])).toEqual([
            [Namespace.HOST, 1],
            [Namespace.HOST, 2],
            [Namespace.HOST, 3],
        ])
        expect(calls[1][2]).toEqual([0x02, 0, 0, 4, 37, 0, 0, 0])
        await expect(api.set('nope', 1)).rejects.toThrow(/not a host value/)
    })
})
