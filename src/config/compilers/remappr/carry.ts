// Pattern check: no GoF pattern (-) — rejected — a pure blob-splice function with
// two guard-clause refusals; one caller, no family of variants to abstract.
//
// Carry what the config does not model. A device's config is edited by
// decoding its blob, changing the config and compiling it again, so a table
// the decoder does not read into the config would be dropped by the first save.
// carryUnmodeledTables appends those tables, byte for byte, from the blob read
// off the device to the freshly compiled one. TBL_PART is the keymap's only in
// part (matrix timing, the shown displays' settings), so it is kept per entry.

import type { DiagnosticBag } from '../../diagnostics'
import {
    BLOB_HEADER_LEN,
    CLUSTER_PSK_LEN,
    crc32,
    type SensorTableEntry,
    TableId,
} from './blobWriter'
import { DecodeCode, readBlobFrames, type TableFrame } from './decode'
import { readDisplayTable } from './display'
import { MATRIX_TIMING_IDS } from './matrix'
import { mergePartEntries, readPartEntries } from './sensor'
import { sliderTableReadable } from './slider'

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
    TableId.Display,
    TableId.Slider,
])

/** TBL_RGB flags bit 0: one color map per layer. The config models only a
 *  single map, so the decoder leaves a per-layer table out of it. */
const RGB_FLAG_PER_LAYER = 0x01

/** Whether the config leaves this table of `blob` out, so it must be carried. */
export function isCarriedTable(blob: Uint8Array, t: TableFrame): boolean {
    if (!MODELED_TABLES.has(t.id)) return true
    if (t.id === TableId.Display) return !isShownDisplay(blob, t)
    if (t.id === TableId.Slider) return !sliderTableReadable(blob, t)
    return t.id === TableId.Rgb && t.end - t.start >= 2 && isPerLayerRgb(blob, t)
}

/** A TBL_DISPLAY the decoder read into `node.displays`; any other (a newer
 *  version, a widget this client cannot show) is carried as read. So is an
 *  empty table (it clears the screens): `node.displays: []` writes none. */
function isShownDisplay(blob: Uint8Array, t: TableFrame): boolean {
    if (t.version !== 1) return false
    const shown = readDisplayTable(blob, t.start, t.end)
    return typeof shown === 'object' && shown.length > 0
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
    // Slider steps name BEHAVIOR-table indices, which a recompile renumbers
    // (only a table the decoder could not read into layers[].sliders is
    // carried).
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

    const extra: Uint8Array[] = []
    for (const t of from.frames) {
        if (t.id === TableId.Sensor) continue // per entry, below
        if (!isCarriedTable(original, t) || written.has(t.id)) continue
        const refusal = carryRefusal(original, t, behaviorsMatch)
        if (refusal) {
            diag.error(`table ${t.id}: ${refusal}`)
            continue
        }
        extra.push(frameBytes(original, t))
    }
    const part = partTableCarry(original, from.frames, blob, to.frames)
    const kept = part ? to.frames.filter((f) => f.id !== TableId.Sensor) : to.frames
    if (part) extra.push(part)
    return extra.length > 0 ? withFrames(blob, kept, extra) : blob
}

const frameBytes = (b: Uint8Array, t: TableFrame): Uint8Array =>
    b.subarray(t.start - 8, t.end) // header + payload

/** The parts whose channel-0 settings the decoder reads into `node.displays`:
 *  those a shown TBL_DISPLAY names. */
function shownDisplayParts(blob: Uint8Array, frames: TableFrame[]): Set<number> {
    const t = frames.find((f) => f.id === TableId.Display)
    if (!t || !isShownDisplay(blob, t)) return new Set()
    const shown = readDisplayTable(blob, t.start, t.end)
    return new Set(typeof shown === 'string' ? [] : shown.map((d) => d.part))
}

/** An entry the keymap reads back and writes again: matrix timing, or a
 *  shown display part's setting. A save leaves those to the compile. */
function isModeledPartEntry(e: SensorTableEntry, displays: ReadonlySet<number>): boolean {
    if ((e.ch ?? 0) !== 0) return false
    return MATRIX_TIMING_IDS.has(e.id) || displays.has(e.sensor)
}

/**
 * The TBL_PART frame a save writes, or undefined to leave the compiled blob's
 * as it is. The device's entries the keymap does not model (a sensor's
 * defaults, eager-press, a part's other channels) are kept beside the
 * compiled ones; a compiled entry wins for the same part, setting and
 * channel. A table this client cannot read is carried whole when the compile
 * wrote none.
 */
function partTableCarry(
    original: Uint8Array,
    from: TableFrame[],
    blob: Uint8Array,
    to: TableFrame[],
): Uint8Array | undefined {
    const ot = from.find((f) => f.id === TableId.Sensor)
    if (!ot) return undefined
    const ct = to.find((f) => f.id === TableId.Sensor)
    const all = readPartEntries(original, ot.start, ot.end)
    if (typeof all === 'string') return ct ? undefined : frameBytes(original, ot)
    const displays = shownDisplayParts(original, from)
    const keep = all.filter((e) => !isModeledPartEntry(e, displays))
    if (!ct) {
        if (keep.length === 0) return undefined
        // Nothing dropped: the device's table as read, byte for byte.
        if (keep.length === all.length) return frameBytes(original, ot)
        return partFrame(keep, ot.version)
    }
    const compiled = readPartEntries(blob, ct.start, ct.end)
    if (typeof compiled === 'string' || keep.length === 0) return undefined
    return partFrame(mergePartEntries(keep, compiled), Math.max(ot.version, ct.version))
}

/** A TBL_PART frame (header + payload) holding `entries`. */
function partFrame(entries: readonly SensorTableEntry[], version: number): Uint8Array {
    const channels = entries.some((e) => (e.ch ?? 0) !== 0)
    const len = 2 + entries.length * 8
    const out = new Uint8Array(8 + len)
    const dv = new DataView(out.buffer)
    dv.setUint16(0, TableId.Sensor, true)
    dv.setUint16(2, Math.max(version, channels ? 2 : 1), true)
    dv.setUint32(4, len, true)
    dv.setUint16(8, entries.length, true)
    entries.forEach((e, i) => {
        const at = 10 + i * 8
        out.set([e.sensor, e.id, e.ch ?? 0, 0], at)
        dv.setUint32(at + 4, e.value >>> 0, true)
    })
    return out
}

/** `blob`'s header with its `frames` (in order) and then `extra` (whole
 *  frames), body length and CRC recomputed. */
function withFrames(
    blob: Uint8Array,
    frames: readonly TableFrame[],
    extra: readonly Uint8Array[],
): Uint8Array {
    const parts = [...frames.map((t) => frameBytes(blob, t)), ...extra]
    const bodyLen = parts.reduce((n, f) => n + f.length, 0)
    const out = new Uint8Array(BLOB_HEADER_LEN + bodyLen)
    out.set(blob.subarray(0, BLOB_HEADER_LEN), 0)
    let off = BLOB_HEADER_LEN
    for (const f of parts) {
        out.set(f, off)
        off += f.length
    }
    const dv = new DataView(out.buffer)
    dv.setUint32(12, bodyLen, true)
    dv.setUint32(16, crc32(out.subarray(BLOB_HEADER_LEN)), true)
    return out
}
