// Pattern check: no GoF pattern (-) — rejected — fetching the physical layout is
// a straight protocol read (GET_KEYMAP_BOUNDS + chunked GET_KEY_LAYOUT) plus a
// coordinate transform into the neutral PhysicalLayout; no abstraction family.
//
// proto-v2 devices serve their REAL physical geometry (per-key x/y/w/h/rotation
// in 1/100 units — already the renderer's centi-unit scale). proto-v1 devices and
// any fetch failure fall back to a synthetic grid sized to the keymap's position
// count (derived from the decoded blob's binding count).
import type { PhysicalLayout, PhysicalLayoutKey } from '../types'
import { type RemapprRpc, RELAY_READ_RETRIES } from './rpc'
import {
    type KeyLayoutChunk,
    KeyboardVerb,
    Namespace,
    parseKeyLayoutChunk,
    parseKeymapBounds,
    Status,
} from './protocol'

const U = 100 // one key unit in centi-units (renderer scale)
// A relayed layout fetch is many round-trips (one per chunk); on a flapping
// 2.4 GHz link a single dropout aborts the whole sequence, so retry the entire
// fetch a few times before giving up on the real geometry.
const LAYOUT_FETCH_ATTEMPTS = 3

const u16le = (v: number): Uint8Array =>
    Uint8Array.of(v & 0xff, (v >> 8) & 0xff)

interface LayoutFetch {
    /** The real per-key layout, or null when the chunk stream couldn't be read
     *  in full (e.g. the relay link flapped mid-sequence). */
    layout: PhysicalLayout | null
    /** Position count from GET_KEYMAP_BOUNDS — a single, reliable read even when
     *  the multi-chunk layout can't complete. 0 if bounds itself failed. */
    numPositions: number
}

/** Fetch the device's real per-key layout over the universal KEYBOARD verbs.
 *  `targetNode` (default 0) addresses a node behind a dongle (§6.2). `layout` is
 *  null when the per-key stream can't be read in full; `numPositions` still
 *  carries the real key count from the (single-read) bounds so the caller can
 *  size a grid to it instead of the decoded-blob count. */
async function fetchRealLayout(
    rpc: RemapprRpc,
    targetNode = 0,
): Promise<LayoutFetch> {
    const boundsReply = await rpc.callUniversalPlain(
        Namespace.KEYBOARD,
        KeyboardVerb.GET_KEYMAP_BOUNDS,
        undefined,
        { targetNode, retries: RELAY_READ_RETRIES },
    )
    if (boundsReply.status !== Status.OK) return { layout: null, numPositions: 0 }
    const bounds = parseKeymapBounds(boundsReply.data)
    if (bounds.numPositions <= 0) return { layout: null, numPositions: 0 }

    const keys: PhysicalLayoutKey[] = []
    let start = 0
    let guard = 0
    while (keys.length < bounds.numPositions && guard++ < 512) {
        // A relayed layout chunk ships as a §9.2 FRAG chain; a lost middle fragment
        // reassembles a short body that parseKeyLayoutChunk rejects. Retry the same
        // (idempotent) chunk before giving up, so one dropped fragment doesn't waste
        // a whole outer attempt — mirrors control_cli cmd_get_layout. Direct reads
        // (targetNode 0) never fragment this way, so no extra chunk attempts there.
        let chunk: KeyLayoutChunk | null = null
        const chunkAttempts = targetNode ? RELAY_READ_RETRIES : 0
        for (let attempt = 0; attempt <= chunkAttempts; attempt++) {
            const reply = await rpc.callUniversalPlain(
                Namespace.KEYBOARD,
                KeyboardVerb.GET_KEY_LAYOUT,
                u16le(start),
                { targetNode, retries: RELAY_READ_RETRIES },
            )
            // ERR_STATE / timeout is already retried inside callUniversalPlain; a
            // non-OK status here poisons the fetch — bail so the caller retries the
            // whole sequence (a partial layout would render wrong). numPositions kept.
            if (reply.status !== Status.OK) break
            try {
                chunk = parseKeyLayoutChunk(reply.data)
                break
            } catch {
                chunk = null // truncated (lost fragment) — retry the identical chunk
            }
        }
        if (!chunk || chunk.count === 0) break
        for (const p of chunk.positions) {
            const rotated = p.rot !== 0
            keys.push({
                x: p.x,
                y: p.y,
                w: p.w || U,
                h: p.h || U,
                ...(rotated ? { r: p.rot, rx: p.rotx, ry: p.roty } : {}),
            })
        }
        start = chunk.start + chunk.count
    }
    const layout =
        keys.length === bounds.numPositions
            ? { id: 0, name: 'Remappr', keys }
            : null
    return { layout, numPositions: bounds.numPositions }
}

/** A plain row-major grid sized to `keyCount`, in centi-units. */
function syntheticLayout(keyCount: number): PhysicalLayout {
    const STEP = 105 // 1u key + small gap
    const count = Math.max(1, keyCount)
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
    const keys: PhysicalLayoutKey[] = Array.from({ length: count }, (_, i) => ({
        x: (i % cols) * STEP,
        y: Math.floor(i / cols) * STEP,
        w: U,
        h: U,
    }))
    return { id: 0, name: 'Remappr (grid)', keys }
}

/**
 * Resolve the editor's physical layouts. On proto-v2 fetches the real geometry;
 * on v1 (or any fetch error) returns a synthetic grid sized `fallbackKeyCount`
 * (the decoded keymap's position count).
 */
export async function fetchPhysicalLayouts(
    rpc: RemapprRpc,
    opts: { protoMax: number; fallbackKeyCount: number; targetNode?: number },
): Promise<{ layouts: PhysicalLayout[]; activeLayoutId: number }> {
    if (opts.protoMax >= 2) {
        let positionCount = 0
        for (let attempt = 0; attempt < LAYOUT_FETCH_ATTEMPTS; attempt++) {
            try {
                const { layout, numPositions } = await fetchRealLayout(
                    rpc,
                    opts.targetNode ?? 0,
                )
                if (layout) return { layouts: [layout], activeLayoutId: 0 }
                if (numPositions > 0) positionCount = numPositions
            } catch {
                /* transient — try the whole fetch again */
            }
        }
        // Real per-key geometry unreadable (link too flappy to stream every
        // chunk). A grid sized to the device's real position count still shows
        // every key — prefer it over the decoded-blob count, which can be 1 when
        // the config read also truncated on the same flap.
        if (positionCount > 0) {
            return { layouts: [syntheticLayout(positionCount)], activeLayoutId: 0 }
        }
    }
    return {
        layouts: [syntheticLayout(opts.fallbackKeyCount)],
        activeLayoutId: 0,
    }
}
