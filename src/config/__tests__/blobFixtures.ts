// pattern-check: skip — test-only byte fixtures, no production logic
// Hand-assembled RMBC blobs for the config-safety tests: a blob is a list of raw
// table frames, so a test can add a table the compiler never writes (a sensor,
// slider or display table, a short frame, a trailing remainder) and still get a
// valid header and CRC.
import {
    BLOB_HEADER_LEN,
    BLOB_MAGIC,
    BehaviorType,
    crc32,
    TableId,
} from '../compilers/remappr/blobWriter'

export interface RawTable {
    id: number
    version: number
    payload: number[]
}

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const u32 = (v: number): number[] => [
    v & 0xff,
    (v >>> 8) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 24) & 0xff,
]

export { u16, u32 }

/** Header + frames (+ `tail` raw body bytes), with body length and CRC set. */
export function assembleBlob(
    tables: RawTable[],
    opts: { configVersion?: number; tail?: number[] } = {},
): Uint8Array {
    const body: number[] = []
    for (const t of tables) {
        body.push(...u16(t.id), ...u16(t.version), ...u32(t.payload.length))
        body.push(...t.payload)
    }
    body.push(...(opts.tail ?? []))
    const bodyBytes = Uint8Array.from(body)
    const header = [
        ...u32(BLOB_MAGIC),
        ...u16(1), // schema
        ...u16(1), // min reader
        ...u32(opts.configVersion ?? 1),
        ...u32(bodyBytes.length),
        ...u32(crc32(bodyBytes)),
    ]
    const out = new Uint8Array(BLOB_HEADER_LEN + bodyBytes.length)
    out.set(header, 0)
    out.set(bodyBytes, BLOB_HEADER_LEN)
    return out
}

/** One 16-byte behavior record on the wire. */
export function behaviorBytes(r: {
    type: number
    flavor?: number
    flags?: number
    subCount?: number
    tap?: number
    hold?: number
    term?: number
    quick?: number
    prior?: number
    subIndex?: number
}): number[] {
    return [
        r.type,
        r.flavor ?? 0,
        r.flags ?? 0,
        r.subCount ?? 0,
        ...u16(r.tap ?? 0),
        ...u16(r.hold ?? 0),
        ...u16(r.term ?? 0),
        ...u16(r.quick ?? 0),
        ...u16(r.prior ?? 0),
        ...u16(r.subIndex ?? 0),
    ]
}

/** The keymap core: one layer of `records.length` positions, each bound to its
 *  own behavior record. Defaults to two plain keys (A, B). */
export function keymapCore(records?: number[][]): RawTable[] {
    const recs = records ?? [
        behaviorBytes({ type: BehaviorType.Key, tap: 0x04 }),
        behaviorBytes({ type: BehaviorType.Key, tap: 0x05 }),
    ]
    return [
        {
            id: TableId.Layer,
            version: 1,
            payload: [...u16(1), ...u16(recs.length), ...u16(200), ...u16(0)],
        },
        {
            id: TableId.Behavior,
            version: 1,
            payload: [...u16(recs.length), ...recs.flat()],
        },
        {
            id: TableId.Binding,
            version: 1,
            payload: recs.flatMap((_, i) => u16(i)),
        },
    ]
}

/** Each table frame of a blob as { id, version, payload }. */
export function blobTables(blob: Uint8Array): RawTable[] {
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    const end = BLOB_HEADER_LEN + dv.getUint32(12, true)
    const out: RawTable[] = []
    let off = BLOB_HEADER_LEN
    while (off + 8 <= end) {
        const len = dv.getUint32(off + 4, true)
        out.push({
            id: dv.getUint16(off, true),
            version: dv.getUint16(off + 2, true),
            payload: Array.from(blob.subarray(off + 8, off + 8 + len)),
        })
        off += 8 + len
    }
    return out
}

export const tableOf = (blob: Uint8Array, id: number): RawTable | undefined =>
    blobTables(blob).find((t) => t.id === id)
