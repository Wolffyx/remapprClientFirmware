// Pattern check: no GoF pattern (-) — rejected — Vial wire fetch + XZ decode glue around shared KLE parser.
// Vial firmware ships a per-board JSON definition compressed as an XZ stream
// (vial-qmk util/vial_generate_definition.py: Python lzma.compress, whose
// default format is XZ — not raw LZMA1).
// Wire flow: GET_SIZE → GET_DEFINITION (block index) → concat → XZ decode → JSON.

import { XzReadableStream } from 'xz-decompress'

import { ProtocolError } from '@firmware/errors'
import {
    type ParsedKeyboardDef,
    parseKeyboardDef,
    type RawKeyboardDef,
    validateDef,
} from '@firmware/kle/parser'
import type { HidClient } from '@firmware/clients/qmk/hidClient'
import { VIA_PAYLOAD_SIZE } from '@firmware/clients/qmk/protocol'

import { getDefinitionCmd, getSizeCmd, parseSize } from './protocol'

export type {
    ParsedKeyboardDef,
    RawKeyboardDef,
    VialCustomKeycode,
} from '@firmware/kle/parser'
export { parseKeyboardDef, validateDef } from '@firmware/kle/parser'

export async function fetchKeyboardDefBytes(
    client: HidClient,
): Promise<Uint8Array> {
    const sizeResp = await client.send(getSizeCmd())
    const size = parseSize(sizeResp)
    if (size === 0 || size > 0x100000) {
        throw new ProtocolError(`Vial def: implausible size ${size}`)
    }
    const out = new Uint8Array(size)
    let written = 0
    let block = 0
    while (written < size) {
        const resp = await client.send(getDefinitionCmd(block))
        const remaining = size - written
        const take = Math.min(remaining, VIA_PAYLOAD_SIZE)
        out.set(resp.subarray(0, take), written)
        written += take
        block += 1
    }
    return out
}

// Cap on the decompressed payload. The compressed wire frame is already
// limited to 1 MiB (see fetchKeyboardDefBytes); XZ can blow that up 100×+,
// so the cap is enforced while decoding — a hostile firmware blob is cut off
// as soon as it passes the cap instead of OOMing the renderer first. Real
// Vial defs are tens of KB; 5 MiB is comfortable safety.
const MAX_DECOMPRESSED_DEF_BYTES = 5 * 1024 * 1024

const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]

async function decodeXz(
    bytes: Uint8Array,
    maxBytes: number,
): Promise<Uint8Array> {
    if (!XZ_MAGIC.every((b, i) => bytes[i] === b)) {
        throw new ProtocolError('Vial def: not an XZ stream')
    }
    const input = new ReadableStream<Uint8Array>({
        start(ctrl) {
            ctrl.enqueue(bytes)
            ctrl.close()
        },
    })
    const reader = new XzReadableStream(input).getReader()
    const parts: Uint8Array[] = []
    let total = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.length
            if (total > maxBytes) {
                throw new ProtocolError(
                    `Vial def: decompressed size exceeds ${maxBytes}-byte cap`,
                )
            }
            parts.push(value)
        }
    } catch (err) {
        await reader.cancel().catch(() => undefined)
        if (err instanceof ProtocolError) throw err
        throw new ProtocolError(
            `Vial def: corrupt XZ stream (${err instanceof Error ? err.message : String(err)})`,
        )
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) {
        out.set(p, offset)
        offset += p.length
    }
    return out
}

export async function decompressDef(
    bytes: Uint8Array,
    maxBytes: number = MAX_DECOMPRESSED_DEF_BYTES,
): Promise<RawKeyboardDef> {
    const text = new TextDecoder('utf-8').decode(
        await decodeXz(bytes, maxBytes),
    )
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        throw new ProtocolError('Vial def: invalid JSON')
    }
    return validateDef(json)
}

export async function fetchAndParseKeyboardDef(
    client: HidClient,
): Promise<ParsedKeyboardDef> {
    const bytes = await fetchKeyboardDefBytes(client)
    const def = await decompressDef(bytes)
    return parseKeyboardDef(def)
}
