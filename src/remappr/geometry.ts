// Pattern check: no GoF pattern (-) — rejected — fetching the physical layout is
// a straight protocol read (GET_KEYMAP_BOUNDS + chunked GET_KEY_LAYOUT) plus a
// coordinate transform into the neutral PhysicalLayout; no abstraction family.
//
// proto-v2 devices serve their REAL physical geometry (per-key x/y/w/h/rotation
// in 1/100 units — already the renderer's centi-unit scale). proto-v1 devices and
// any fetch failure fall back to a synthetic grid sized to the keymap's position
// count (derived from the decoded blob's binding count).
import type { PhysicalLayout, PhysicalLayoutKey } from '../types'
import type { RemapprRpc } from './rpc'
import {
    KeyboardVerb,
    Namespace,
    parseKeyLayoutChunk,
    parseKeymapBounds,
    Status,
} from './protocol'

const U = 100 // one key unit in centi-units (renderer scale)

const u16le = (v: number): Uint8Array =>
    Uint8Array.of(v & 0xff, (v >> 8) & 0xff)

/** Fetch the device's real per-key layout over the universal KEYBOARD verbs.
 *  Returns null if the device can't answer (caller falls back to synthetic). */
async function fetchRealLayout(rpc: RemapprRpc): Promise<PhysicalLayout | null> {
    const boundsReply = await rpc.callUniversalPlain(
        Namespace.KEYBOARD,
        KeyboardVerb.GET_KEYMAP_BOUNDS,
    )
    if (boundsReply.status !== Status.OK) return null
    const bounds = parseKeymapBounds(boundsReply.data)
    if (bounds.numPositions <= 0) return null

    const keys: PhysicalLayoutKey[] = []
    let start = 0
    let guard = 0
    while (keys.length < bounds.numPositions && guard++ < 512) {
        const reply = await rpc.callUniversalPlain(
            Namespace.KEYBOARD,
            KeyboardVerb.GET_KEY_LAYOUT,
            u16le(start),
        )
        if (reply.status !== Status.OK) return null
        const chunk = parseKeyLayoutChunk(reply.data)
        if (chunk.count === 0) break
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
    return keys.length > 0 ? { id: 0, name: 'Remappr', keys } : null
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
    opts: { protoMax: number; fallbackKeyCount: number },
): Promise<{ layouts: PhysicalLayout[]; activeLayoutId: number }> {
    if (opts.protoMax >= 2) {
        try {
            const real = await fetchRealLayout(rpc)
            if (real) return { layouts: [real], activeLayoutId: 0 }
        } catch {
            /* fall through to synthetic */
        }
    }
    return {
        layouts: [syntheticLayout(opts.fallbackKeyCount)],
        activeLayoutId: 0,
    }
}
