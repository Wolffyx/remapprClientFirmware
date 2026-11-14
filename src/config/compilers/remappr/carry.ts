// Pattern check: no GoF pattern (-) — rejected — a pure blob-splice function with
// two guard-clause refusals; one caller, no family of variants to abstract.
//
// Carry what the config does not model. A device's config is edited by
// decoding its blob, changing the config and compiling it again, so a table
// the decoder does not read into the config would be dropped by the first save.
// carryUnmodeledTables appends those tables, byte for byte, from the blob read
// off the device to the freshly compiled one.

import type { DiagnosticBag } from '../../diagnostics'
import { BLOB_HEADER_LEN, CLUSTER_PSK_LEN, crc32, TableId } from './blobWriter'
import { DecodeCode, readBlobFrames, type TableFrame } from './decode'

/** Tables the keymap decoder reads into the config and the compiler writes back
 *  from it. Every other table, the reserved and unknown ids included, is
 *  carried. */
const MODELED_TABLES: ReadonlySet<number> = new Set([
    TableId.Layer,
    TableId.Binding,
    TableId.Behavior,
    TableId.Subs,
    TableId.Combo,
    TableId.Macro,
    TableId.Names,
    TableId.Conditional,
    TableId.KeyOverride,
    TableId.Leader,
    TableId.Poshold,
    TableId.Encoder,
    TableId.Rgb,
    TableId.Mouse,
    TableId.Personality,
    TableId.Cluster,
    TableId.LinkProfile,
    TableId.Radio,
    TableId.Power,
    TableId.ActionBinding,
    TableId.Autocorrect,
])

/** TBL_RGB flags bit 0: one color map per layer. The config models only a
 *  single map, so the decoder leaves a per-layer table out of it. */
const RGB_FLAG_PER_LAYER = 0x01

/** Whether the config leaves this table of `blob` out, so it must be carried. */
export function isCarriedTable(blob: Uint8Array, t: TableFrame): boolean {
    if (!MODELED_TABLES.has(t.id)) return true
    return t.id === TableId.Rgb && t.end - t.start >= 2 && isPerLayerRgb(blob, t)
}

function isPerLayerRgb(blob: Uint8Array, t: TableFrame): boolean {
    return (blob[t.start + 1] & RGB_FLAG_PER_LAYER) !== 0
}

const payload = (blob: Uint8Array, t: TableFrame): Uint8Array =>
    blob.subarray(t.start, t.end)

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => v === b[i])

/** A table that cannot be carried as read. Returns why, or null when it can. */
function carryRefusal(
    original: Uint8Array,
    t: TableFrame,
    behaviorsMatch: boolean,
): string | null {
    // The device zeroes the cluster key on read-back (§6 N5b). Carrying the
    // zeros would leave this node on a different key from the rest of the
    // cluster, and the client cannot author a key.
    if (
        t.id === TableId.ClusterSec &&
        payload(original, t).subarray(0, CLUSTER_PSK_LEN).every((b) => b === 0)
    ) {
        return (
            'the device has a cluster key, which cannot be read back, so saving ' +
            'would replace it with zeros'
        )
    }
    // Slider steps name BEHAVIOR-table indices, which a recompile renumbers.
    if (t.id === TableId.Slider && !behaviorsMatch) {
        return (
            'the device has slider bindings, which name keymap behaviors by ' +
            'index; they cannot be kept once the keymap changes'
        )
    }
    return null
}

/**
 * Append to `blob` every table of `original` (the blob read off the device) that
 * the config does not model and the compile did not write itself. A table the
 * compile wrote wins, since it comes from an edit. A table that cannot be
 * carried as read is an error diagnostic, which stops a commit.
 */
export function carryUnmodeledTables(
    blob: Uint8Array,
    original: Uint8Array,
    diag: DiagnosticBag,
): Uint8Array {
    const from = readBlobFrames(original)
    const to = readBlobFrames(blob)
    if (from.code !== DecodeCode.OK || to.code !== DecodeCode.OK) {
        diag.error('the device config could not be re-read to keep its other tables')
        return blob
    }
    const written = new Set(to.frames.map((f) => f.id))
    const behaviors = (b: Uint8Array, frames: TableFrame[]): Uint8Array | undefined => {
        const t = frames.find((f) => f.id === TableId.Behavior)
        return t ? payload(b, t) : undefined
    }
    const behaviorsMatch = sameBytes(
        behaviors(original, from.frames),
        behaviors(blob, to.frames),
    )

    const carried: TableFrame[] = []
    for (const t of from.frames) {
        if (!isCarriedTable(original, t) || written.has(t.id)) continue
        const refusal = carryRefusal(original, t, behaviorsMatch)
        if (refusal) {
            diag.error(`table ${t.id}: ${refusal}`)
            continue
        }
        carried.push(t)
    }
    return carried.length > 0 ? appendFrames(blob, original, carried) : blob
}

/** `blob` with the given frames of `source` appended, header length and CRC
 *  recomputed. */
function appendFrames(
    blob: Uint8Array,
    source: Uint8Array,
    frames: TableFrame[],
): Uint8Array {
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    const bodyLen = dv.getUint32(12, true)
    const extra = frames.reduce((n, t) => n + 8 + (t.end - t.start), 0)
    const out = new Uint8Array(BLOB_HEADER_LEN + bodyLen + extra)
    out.set(blob.subarray(0, BLOB_HEADER_LEN + bodyLen), 0)
    let off = BLOB_HEADER_LEN + bodyLen
    for (const t of frames) {
        const frame = source.subarray(t.start - 8, t.end) // header + payload
        out.set(frame, off)
        off += frame.length
    }
    const odv = new DataView(out.buffer)
    odv.setUint32(12, bodyLen + extra, true)
    odv.setUint32(16, crc32(out.subarray(BLOB_HEADER_LEN)), true)
    return out
}
