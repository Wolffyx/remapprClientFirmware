// Pattern check: no GoF pattern (-) — rejected — a pure blob-vs-caps validator
// with four inline guard checks + a minimal frame walk; Strategy/Chain would
// over-abstract four conditionals that have a single caller.
//
// Preflight validation: check a compiled RMBC blob against a device's advertised
// capacities BEFORE push/export, so an oversize / too-many-layers config fails
// with a precise "actual/limit" message instead of a late, opaque
// VALIDATE_CONFIG rejection on the wire. Pure + dependency-light (mirrors the
// header/frame layout in blobWriter + keymap_decode.c); the app/builder surface
// the issues (UI wiring is Phase 5).

import { BLOB_HEADER_LEN, BLOB_MAGIC, TableId } from './compilers/remappr/blobWriter'

/** Device capacity limits a compiled blob must satisfy, gathered live from the
 *  device (GET_LIMITS + config metadata). Every field is optional: an unknown
 *  cap is simply not enforced, so a caller advertises only what the device
 *  actually reported. */
export interface DeviceCaps {
    /** GET_LIMITS `max_config_bytes` — the storage slot size (header + body). */
    maxConfigBytes?: number
    /** Config-metadata `max_layers` — engine layer-stack depth. */
    maxLayers?: number
    /** GET_LIMITS `supports_fragmentation`. */
    supportsFragmentation?: boolean
    /** GET_LIMITS `max_unsealed_chunk` — a single WRITE_CONFIG_CHUNK payload cap. */
    maxUnsealedChunk?: number
}

/** One preflight violation. `code` is a stable machine tag (for UI mapping);
 *  `message` is a human-readable "actual/limit" line an editor can show inline. */
export interface PreflightIssue {
    code: 'config-too-large' | 'too-many-layers' | 'needs-fragmentation'
    message: string
}

// Read the LAYER table's num_layers (u16) from a blob without a full decode.
// Returns null when the blob is malformed or carries no LAYER table (the layer
// check is then skipped rather than reported as a violation).
function blobLayerCount(blob: Uint8Array): number | null {
    if (blob.length < BLOB_HEADER_LEN) return null
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    if (dv.getUint32(0, true) !== BLOB_MAGIC) return null
    let off = BLOB_HEADER_LEN
    while (off + 8 <= blob.length) {
        const id = dv.getUint16(off, true)
        const len = dv.getUint32(off + 4, true)
        const start = off + 8
        if (start + len > blob.length) return null
        if (id === TableId.Layer) return len >= 2 ? dv.getUint16(start, true) : null
        off = start + len
    }
    return null
}

/** Validate a compiled RMBC blob against a device's advertised capacities.
 *  Returns every violation found (empty = OK). Pure: unknown caps are skipped,
 *  and a malformed blob simply yields the subset of checks it can still run. */
export function preflightConfigBlob(
    blob: Uint8Array,
    caps: DeviceCaps,
): PreflightIssue[] {
    const issues: PreflightIssue[] = []

    if (caps.maxConfigBytes !== undefined && blob.length > caps.maxConfigBytes)
        issues.push({
            code: 'config-too-large',
            message: `config is ${blob.length} bytes but this device stores at most ${caps.maxConfigBytes}`,
        })

    if (caps.maxLayers !== undefined) {
        const layers = blobLayerCount(blob)
        if (layers !== null && layers > caps.maxLayers)
            issues.push({
                code: 'too-many-layers',
                message: `keymap has ${layers} layers but this device supports ${caps.maxLayers}`,
            })
    }

    if (
        caps.supportsFragmentation === false &&
        caps.maxUnsealedChunk !== undefined &&
        blob.length > caps.maxUnsealedChunk
    )
        issues.push({
            code: 'needs-fragmentation',
            message: `config is ${blob.length} bytes but this device accepts at most ${caps.maxUnsealedChunk} without fragmentation`,
        })

    return issues
}
