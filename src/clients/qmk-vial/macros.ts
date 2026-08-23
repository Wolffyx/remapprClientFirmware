// Pattern check: no GoF pattern (-) — rejected — VIA macro buffer io + null-separator split; pure helpers over wire bytes.
// VIA macro buffer is a single byte-array shared by all macros, separated by 0x00 terminators.
// Macro index N = bytes between (N-1)th and Nth 0x00 (or buffer start for N=0).

import { ProtocolError } from '@firmware/errors'
import type { HidClient } from '@firmware/clients/qmk/hidClient'
import { makeFrame, VIA_PAYLOAD_SIZE } from '@firmware/clients/qmk/protocol'

const VIA_MACRO = {
    GET_COUNT: 0x0c,
    GET_BUFFER_SIZE: 0x0d,
    GET_BUFFER: 0x0e,
    SET_BUFFER: 0x0f,
} as const

const MACRO_CHUNK = VIA_PAYLOAD_SIZE - 4

function readU16BE(buf: Uint8Array, off: number): number {
    return ((buf[off] << 8) | buf[off + 1]) & 0xffff
}

function writeU16BE(buf: Uint8Array, off: number, v: number): void {
    buf[off] = (v >> 8) & 0xff
    buf[off + 1] = v & 0xff
}

export async function getMacroCount(client: HidClient): Promise<number> {
    const resp = await client.send(makeFrame(VIA_MACRO.GET_COUNT))
    return resp[1] & 0xff
}

export async function getMacroBufferSize(client: HidClient): Promise<number> {
    const resp = await client.send(makeFrame(VIA_MACRO.GET_BUFFER_SIZE))
    return readU16BE(resp, 1)
}

export async function readMacroBuffer(client: HidClient): Promise<Uint8Array> {
    const total = await getMacroBufferSize(client)
    if (total === 0) return new Uint8Array(0)
    const out = new Uint8Array(total)
    let offset = 0
    while (offset < total) {
        const size = Math.min(total - offset, MACRO_CHUNK)
        const cmd = makeFrame(VIA_MACRO.GET_BUFFER)
        writeU16BE(cmd, 1, offset)
        cmd[3] = size & 0xff
        const resp = await client.send(cmd)
        out.set(resp.subarray(4, 4 + size), offset)
        offset += size
    }
    return out
}

export async function writeMacroBuffer(
    client: HidClient,
    buffer: Uint8Array,
): Promise<void> {
    const total = await getMacroBufferSize(client)
    if (buffer.length > total) {
        throw new ProtocolError(
            `Macro buffer overflow: ${buffer.length} > ${total}`,
        )
    }
    let offset = 0
    while (offset < buffer.length) {
        const size = Math.min(buffer.length - offset, MACRO_CHUNK)
        const cmd = makeFrame(VIA_MACRO.SET_BUFFER)
        writeU16BE(cmd, 1, offset)
        cmd[3] = size & 0xff
        cmd.set(buffer.subarray(offset, offset + size), 4)
        await client.send(cmd)
        offset += size
    }
}

export function splitMacros(buffer: Uint8Array, count: number): Uint8Array[] {
    const macros: Uint8Array[] = []
    let start = 0
    let found = 0
    for (let i = 0; i < buffer.length && found < count; i++) {
        if (buffer[i] === 0x00) {
            macros.push(buffer.slice(start, i))
            start = i + 1
            found++
        }
    }
    while (macros.length < count) macros.push(new Uint8Array(0))
    return macros
}

export function joinMacros(
    macros: Uint8Array[],
    bufferSize: number,
): Uint8Array {
    let total = 0
    for (const m of macros) total += m.length + 1 // separator
    if (total > bufferSize) {
        throw new ProtocolError(
            `Macros exceed buffer: ${total} > ${bufferSize}`,
        )
    }
    const out = new Uint8Array(bufferSize)
    let off = 0
    for (const m of macros) {
        out.set(m, off)
        off += m.length
        out[off] = 0x00
        off += 1
    }
    return out
}

export async function readMacro(
    client: HidClient,
    idx: number,
): Promise<Uint8Array> {
    const count = await getMacroCount(client)
    if (idx < 0 || idx >= count) {
        throw new ProtocolError(
            `Macro index out of range: ${idx} (count ${count})`,
        )
    }
    const buffer = await readMacroBuffer(client)
    return splitMacros(buffer, count)[idx]
}

export async function writeMacro(
    client: HidClient,
    idx: number,
    bytes: Uint8Array,
): Promise<void> {
    const count = await getMacroCount(client)
    if (idx < 0 || idx >= count) {
        throw new ProtocolError(
            `Macro index out of range: ${idx} (count ${count})`,
        )
    }
    const size = await getMacroBufferSize(client)
    const buffer = await readMacroBuffer(client)
    const macros = splitMacros(buffer, count)
    if (bytes.indexOf(0x00) !== -1) {
        throw new ProtocolError('Macro body must not contain 0x00 (terminator)')
    }
    macros[idx] = bytes
    const next = joinMacros(macros, size)
    await writeMacroBuffer(client, next)
}
