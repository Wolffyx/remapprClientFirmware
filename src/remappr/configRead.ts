// pattern-check: skip — extracted read→decode→geometry pipeline shared by the
// direct adapter.connect path and the relayed node-view path. No GoF abstraction:
// it's the same linear protocol read, parameterized by `targetNode` (0 = the
// unchanged direct probe; ≠0 rides the §6.2 COMMON relay to a behind-dongle node).
import type { ConfigKeymap } from '../config'
import { decodeRemapprBlob, DecodeCode } from '../config/compilers/remappr/decode'
import type { PhysicalLayout } from '../types'

import type { DiscoveryResult } from './discovery'
import { fetchPhysicalLayouts } from './geometry'
import {
    buildReadChunkArg,
    Cmd,
    Namespace,
    Status,
} from './protocol'
import { type RemapprRpc, RELAY_READ_RETRIES } from './rpc'

// Direct legacy frame: 64 − 6-byte response header = 58 blob bytes per reply.
// The RELAYED universal path adds a 0xE2 tag + 8-byte UCH, so a reply only fits
// 64 − 1 − 8 − 6 = 49 bytes before it FRAGments — and the dongle does not forward
// a FRAG chain, so the app hangs on the missing continuation (Remappr RPC timeout
// after 2000 ms on "open node"). Request ≤48 (the advertised max_unsealed_chunk)
// over the relay so every chunk is a single frame; the device caps to the actual
// blob length and the loop advances by what it returns.
const READ_CHUNK_WANT_DIRECT = 58
const READ_CHUNK_WANT_RELAY = 48

/**
 * Read the full active blob over the plaintext READ_CONFIG_CHUNK loop. With
 * `targetNode` unset (or 0) it uses the direct legacy frame; with a node short-id
 * the verb rides the universal COMMON relay (legacy verbs keep their number under
 * COMMON, §6.2) so the same loop reads a behind-dongle node.
 */
export async function readConfigBlob(
    rpc: RemapprRpc,
    hasActive: boolean,
    opts: { targetNode?: number } = {},
): Promise<Uint8Array> {
    if (!hasActive) return new Uint8Array()
    const target = opts.targetNode ?? 0
    const chunks: Uint8Array[] = []
    let offset = 0
    let total = 0
    const want = target === 0 ? READ_CHUNK_WANT_DIRECT : READ_CHUNK_WANT_RELAY
    let guard = 0
    while (guard++ < 8192) {
        const arg = buildReadChunkArg(offset, want)
        const r =
            target === 0
                ? await rpc.callPlain(Cmd.READ_CONFIG_CHUNK, arg)
                : await rpc.callUniversalPlain(
                      Namespace.COMMON,
                      Cmd.READ_CONFIG_CHUNK,
                      arg,
                      { targetNode: target, retries: RELAY_READ_RETRIES },
                  )
        if (r.status !== Status.OK || r.data.length === 0) break // EOF
        chunks.push(r.data)
        offset += r.data.length
        total += r.data.length
    }
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
        out.set(c, off)
        off += c.length
    }
    return out
}

/** A minimal single-layer config for a device/node with no active blob. */
export function defaultConfig(keyCount: number): ConfigKeymap {
    return {
        schemaVersion: 1,
        kind: 'remappr.keymap',
        meta: { name: 'Remappr', target: null },
        keyboard: { id: 'remappr', name: 'Remappr', keys: [] },
        layers: [
            {
                name: 'Base',
                bindings: Array.from({ length: Math.max(1, keyCount) }, () => ({
                    type: 'transparent' as const,
                })),
            },
        ],
    }
}

export interface LoadedConfig {
    config: ConfigKeymap
    configVersion: number
    layouts: PhysicalLayout[]
    activeLayoutId: number
    maxLayers: number
}

/**
 * Assemble the editor's keyboard model from a connected (or relayed) device:
 * read the active blob → decode to the canonical config (or a default) → fetch
 * real/synthetic geometry. `opts.targetNode` (default 0) selects the direct
 * endpoint or a behind-dongle node; every read uses the matching path.
 */
export async function loadDeviceConfig(
    rpc: RemapprRpc,
    discovery: DiscoveryResult,
    opts: { targetNode?: number } = {},
): Promise<LoadedConfig> {
    const target = opts.targetNode ?? 0
    const blob = await readConfigBlob(rpc, discovery.deviceInfo.hasActive, {
        targetNode: target,
    })
    const decoded =
        blob.length > 0
            ? decodeRemapprBlob(blob)
            : { code: DecodeCode.MISSING as number }

    let config: ConfigKeymap | null = null
    let configVersion = discovery.deviceInfo.configVersion
    if (decoded.code === DecodeCode.OK && 'config' in decoded && decoded.config) {
        config = decoded.config
        configVersion = decoded.configVersion ?? configVersion
    }

    const fallbackCount = config?.layers[0]?.bindings.length ?? 0
    const geometry = await fetchPhysicalLayouts(rpc, {
        protoMax: discovery.protoMax,
        fallbackKeyCount: fallbackCount,
        targetNode: target,
    })

    if (!config) config = defaultConfig(geometry.layouts[0]?.keys.length ?? 0)

    const maxLayers = discovery.personality
        ? Math.max(config.layers.length, 16)
        : Math.max(config.layers.length, 8)

    return {
        config,
        configVersion,
        layouts: geometry.layouts,
        activeLayoutId: geometry.activeLayoutId,
        maxLayers,
    }
}
