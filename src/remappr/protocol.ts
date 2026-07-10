// Pattern check: no GoF pattern (-) — rejected — pure wire constants + stateless
// frame encode/parse functions (DataView reads); mirrors the existing
// zmk/keychron protocol.ts data-codec style, no GoF abstraction warranted.
//
// The Remappr control wire format — both the legacy flat protocol and the
// proto-v2 universal (UCH / 0xE2) layer. Ground truth: firmware
// include/remappr/{control,control_auth,control_frag}.h +
// docs/universal-request-response-protocol.md. Little-endian throughout. This
// module is pure (no I/O); rpc.ts drives the transport, auth.ts the crypto.

/* ── transport demux tags (byte 0) ──────────────────────────────────────── */

export const EVENT_TAG = 0xe0 // legacy event frame
export const SEALED_TAG = 0xe1 // sealed reply / envelope
export const UNIVERSAL_TAG = 0xe2 // universal (UCH-wrapped) frame
// 0x01–0x7F = a plaintext response (byte 0 echoes the request cmd)

/** Fixed report size on both USB and BLE. */
export const FRAME = 64
/** USB seal padding: inner plaintext is zero-filled to this before encrypt so
 *  the sealed frame fills the 64-byte report (1 tag + 4 ctr + 43 + 16 tag). */
export const SEAL_PLAIN = 43
/** Sealed-envelope overhead beyond the plaintext: ctr(4) + tag(16). */
export const SEAL_OVERHEAD = 20

/** Universal-sealed RELAY (§6.3) AEAD-plaintext size: the host pads `UCH(8) ||
 *  inner` to this so the dongle forwards a full 64-byte radio CTRL frame and the
 *  node derives the same plaintext length from `env_len` (control_auth.c). Budget
 *  (§9.1, universal-sealed-relay row): 64 − 1(0xE2) − 8(UCH_outer) − 1(0xE1) −
 *  4(ctr) − 16(tag) = 34. Blob chunk floors to BLOB_ALIGN (16). NOTE: the relay
 *  data plane is firmware HW-proof-pending — this byte layout follows §6.3/§9.1
 *  but is not yet validated against the firmware relay decoder. */
export const RELAY_SEAL_PLAIN = 34

/** Legacy sealed (0xE1) config-chunk size — the firmware's legacy data-plane
 *  figure (the universal-sealed GET_LIMITS value of 16 is a different path).
 *  Config writes ride the legacy sealed path, so they use this. */
export const LEGACY_SEALED_CHUNK = 32
/** Blob flash alignment (STM32U5 quadword): pad the blob to a multiple of 16. */
export const BLOB_ALIGN = 16

/* ── legacy control verbs (enum remappr_control_cmd) ────────────────────── */

export const Cmd = {
    GET_DEVICE_INFO: 0x01,
    GET_SCHEMA_VERSION: 0x02,
    GET_CAPABILITIES: 0x03,
    WRITE_CONFIG_BEGIN: 0x10,
    WRITE_CONFIG_CHUNK: 0x11,
    VALIDATE_CONFIG: 0x12,
    COMMIT_CONFIG: 0x13,
    ROLLBACK_CONFIG: 0x14,
    READ_CONFIG_CHUNK: 0x15,
    UNPAIR_RADIO: 0x18, // COMMON: forget the bonded dongle, re-arm (owner-sealed, P1)
    GET_PROFILE_STATUS: 0x20,
    SELECT_PROFILE: 0x21,
    CLEAR_PROFILE: 0x22,
    SET_RGB: 0x30,
    SET_BASE_LAYER: 0x40,
    GET_LAYER_STATE: 0x41,
    GET_DIAGNOSTICS: 0x50,
    CONTROL_AUTH_BEGIN: 0x60,
    CONTROL_AUTH_FINISH: 0x61,
} as const

/** Verbs reachable without a sealed envelope (cmd_open_plaintext, control.c). */
export const PLAINTEXT_CMDS: ReadonlySet<number> = new Set([
    Cmd.GET_DEVICE_INFO,
    Cmd.GET_SCHEMA_VERSION,
    Cmd.GET_CAPABILITIES,
    Cmd.READ_CONFIG_CHUNK,
    Cmd.GET_PROFILE_STATUS,
    Cmd.GET_LAYER_STATE,
    Cmd.GET_DIAGNOSTICS,
    Cmd.CONTROL_AUTH_BEGIN,
    Cmd.CONTROL_AUTH_FINISH,
])

/** enum remappr_control_status. */
export const Status = {
    OK: 0,
    ERR_CMD: 1,
    ERR_ARG: 2,
    ERR_STATE: 3,
    ERR_STORAGE: 4,
    ERR_INVALID: 5,
    ERR_VERSION: 6,
    ERR_ACTIVATE: 7,
    ERR_AUTH: 8,
} as const

const STATUS_NAME: Record<number, string> = {
    0: 'OK',
    1: 'ERR_CMD',
    2: 'ERR_ARG',
    3: 'ERR_STATE',
    4: 'ERR_STORAGE',
    5: 'ERR_INVALID',
    6: 'ERR_VERSION',
    7: 'ERR_ACTIVATE',
    8: 'ERR_AUTH',
}

export function statusName(status: number): string {
    return STATUS_NAME[status] ?? `0x${status.toString(16)}`
}

/** enum remappr_control_cap (u32 bitmask). */
export const Cap = {
    CONFIG: 1 << 0,
    PROFILES: 1 << 1,
    RGB: 1 << 2,
    LAYERS: 1 << 3,
    DIAGNOSTICS: 1 << 4,
    AUTH: 1 << 5,
    KEYMAP: 1 << 6,
    PAIRING: 1 << 7,
} as const

/* ── universal (proto-v2) ───────────────────────────────────────────────── */

export const UCH_VERSION = 2
export const UCH_LEN = 8
/** request_id sentinel: fire-and-forget, device suppresses the reply. */
export const UCH_REQ_FIRE_AND_FORGET = 0xff

export const Namespace = {
    COMMON: 0x00,
    KEYBOARD: 0x01,
    MOUSE: 0x02,
    JOYSTICK: 0x03,
    AUDIO: 0x04,
    LIGHTING: 0x05,
    PROFILES: 0x06,
    DONGLE: 0x07,
    RADIO: 0x08,
} as const

export const UchFlag = {
    RESP: 1 << 0,
    EVENT: 1 << 1,
    FRAG_MORE: 1 << 2,
    FRAG_FIRST: 1 << 3,
} as const

/** COMMON-namespace verbs that only answer inside a 0xE2 frame (ERR_CMD on the
 *  legacy path). The legacy verbs keep their numbers under COMMON. */
export const CommonVerb = {
    GET_PERSONALITY_MAP: 0x04,
    GET_MANIFEST: 0x05,
    GET_LIMITS: 0x06,
    SUBSCRIBE_EVENTS: 0x07,
    UNSUBSCRIBE: 0x08,
    QUERY_STAGE_OFFSET: 0x16,
    GET_CONFIG_METADATA: 0x17,
} as const

/** KEYBOARD-namespace verbs (proto-v2, chunked). */
export const KeyboardVerb = {
    GET_KEYMAP_BOUNDS: 0x42,
    GET_KEY_LAYOUT: 0x43,
} as const

/** DONGLE-namespace verbs (relay path; mostly deferred). */
export const DongleVerb = {
    LIST_NODES: 0x01,
    GET_NODE_INFO: 0x02,
    /** Open/close the §17 pairing window remotely (arg[0]: 1 open / 0 close). */
    OPEN_PAIR_WINDOW: 0x03,
    /** Unbond a node by short-id (arg: u16) — clears a stale dongle bond. */
    FORGET_NODE: 0x04,
    /** Wipe the whole bond table (pipes 1..7) — recovers a dongle whose pipes are
     *  full of stale/incomplete (short-id 0) bonds that FORGET_NODE cannot clear. */
    CLEAR_ALL_BONDS: 0x05,
    /** Return the §5 master node's record (one NODE_RECORD_LEN blob), or ERR_STATE
     *  when no bonded node reports a MAIN election role. The roster already carries
     *  a `master` flag per record, so this is a convenience lookup. */
    GET_MASTER: 0x06,
    /** Keystroke routing over the dongle's USB: arg[0] 1 = the NKRO interface,
     *  0 = the boot 6KRO interface (default, BIOS-safe); NO arg = query only.
     *  Reply: u8 current state. The choice persists across dongle reboots. */
    SET_NKRO: 0x07,
} as const

/** Device role (enum remappr_role, firmware include/remappr/role.h) — reported as
 *  byte 0 of GET_PERSONALITY_MAP. A dongle self-identifies as DONGLE so the host
 *  takes the roster path instead of the keyboard connect path. */
export const Role = {
    NODE: 0,
    DONGLE: 1,
    RADIO_COPROCESSOR: 2,
    BRIDGE: 3,
    DEVKIT: 4,
} as const

/* ── frag reassembly limits (control_frag / control_cli) ────────────────── */

export const FRAG_REASSEMBLY_CAP = 4096
export const FRAG_INTER_TIMEOUT_MS = 2000

/* ── transport identifiers ──────────────────────────────────────────────── */

export const USB_VID = 0x1209
export const USB_PID = 0x0001
export const USB_USAGE_PAGE = 0xff00
export const USB_USAGE = 0x01

export const BLE_SERVICE_UUID = '52454d50-5200-4354-4c00-000000000001'
export const BLE_CONTROL_CHAR_UUID = '52454d50-5200-4354-4c00-000000000002'
export const BLE_EVENT_CHAR_UUID = '52454d50-5200-4354-4c00-000000000003'

/* ── legacy frame codec ─────────────────────────────────────────────────── */

/** A parsed legacy response (after the 6-byte header). */
export interface ControlResponse {
    cmd: number
    seq: number
    status: number
    data: Uint8Array
}

/** Build a legacy request frame `[cmd][seq][arg_len u16][arg]` (no padding). */
export function buildRequest(cmd: number, seq: number, arg: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + arg.length)
    const dv = new DataView(out.buffer)
    out[0] = cmd
    out[1] = seq
    dv.setUint16(2, arg.length, true)
    out.set(arg, 4)
    return out
}

/** Parse a legacy response frame (the 64-byte report or the inner sealed bytes). */
export function parseResponse(frame: Uint8Array): ControlResponse {
    const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const dataLen = dv.getUint16(4, true)
    return {
        cmd: frame[0],
        seq: frame[1],
        status: frame[2],
        data: frame.subarray(6, 6 + dataLen),
    }
}

/** A parsed legacy event frame (0xE0). */
export interface ControlEvent {
    eventId: number
    payload: Uint8Array
}

export const EVT_INPUT = 0x01

export function parseEvent(frame: Uint8Array): ControlEvent {
    const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const len = dv.getUint16(2, true)
    return { eventId: frame[1], payload: frame.subarray(4, 4 + len) }
}

/** A decoded 6-byte INPUT_EVENT record (live key/encoder/pointer telemetry). */
export interface InputEvent {
    kind: number // 0 key, 1 encoder, 2 pointer
    pressed: boolean
    seq: number
    src: number
    inputId: number
    ts: number
}

export function parseInputEvent(p: Uint8Array): InputEvent {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength)
    return {
        kind: (p[0] >> 4) & 0x0f,
        pressed: (p[0] & 0x08) !== 0,
        seq: p[0] & 0x07,
        src: p[1],
        inputId: dv.getUint16(2, true),
        ts: dv.getUint16(4, true),
    }
}

/** 16-byte DEVICE_INFO (hand-serialized, unaligned: hw_rev@9, config_version@12). */
export interface DeviceInfo {
    protoMin: number
    protoMax: number
    schemaVersion: number
    fwMajor: number
    fwMinor: number
    fwPatch: number
    hwRev: number
    hasActive: boolean
    configVersion: number
}

export function parseDeviceInfo(d: Uint8Array): DeviceInfo {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return {
        protoMin: dv.getUint16(0, true),
        protoMax: dv.getUint16(2, true),
        schemaVersion: dv.getUint16(4, true),
        fwMajor: d[6],
        fwMinor: d[7],
        fwPatch: d[8],
        hwRev: dv.getUint16(9, true),
        hasActive: d[11] !== 0,
        configVersion: dv.getUint32(12, true),
    }
}

export function parseCapabilities(d: Uint8Array): number {
    return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true)
}

/* ── universal frame codec ──────────────────────────────────────────────── */

export interface Uch {
    version: number
    namespace: number
    flags: number
    requestId: number
    targetNode: number
    /** Per-fragment sequence (§4.2 reserved bytes): 0-based index within a
     * FRAG_* chain, and the chain's total fragment count (0 = not fragmented /
     * legacy emitter with no sequence). */
    fragIndex: number
    fragCount: number
}

export function buildUch(
    namespace: number,
    requestId: number,
    targetNode = 0,
    flags = 0,
): Uint8Array {
    const out = new Uint8Array(UCH_LEN)
    const dv = new DataView(out.buffer)
    out[0] = UCH_VERSION
    out[1] = namespace
    out[2] = flags
    out[3] = requestId
    dv.setUint16(4, targetNode, true)
    dv.setUint16(6, 0, true) // reserved
    return out
}

export function parseUch(frame: Uint8Array, off = 0): Uch {
    const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    return {
        version: frame[off],
        namespace: frame[off + 1],
        flags: frame[off + 2],
        requestId: frame[off + 3],
        targetNode: dv.getUint16(off + 4, true),
        fragIndex: frame[off + 6],
        fragCount: frame[off + 7],
    }
}

/** Wrap a legacy inner frame in a universal `[0xE2][UCH][inner]` envelope. */
export function buildUniversal(
    namespace: number,
    requestId: number,
    inner: Uint8Array,
    targetNode = 0,
): Uint8Array {
    const out = new Uint8Array(1 + UCH_LEN + inner.length)
    out[0] = UNIVERSAL_TAG
    out.set(buildUch(namespace, requestId, targetNode), 1)
    out.set(inner, 1 + UCH_LEN)
    return out
}

/* ── proto-v2 reply payloads ────────────────────────────────────────────── */

export interface Limits {
    maxUnsealedChunk: number
    maxSealedChunk: number // universal-sealed; legacy 0xE1 path uses 32
    transportFrameCap: number
    blobAlign: number
    maxConfigBytes: number
    maxOutstandingRequests: number
    supportsFragmentation: boolean
}

export function parseLimits(d: Uint8Array): Limits {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return {
        maxUnsealedChunk: dv.getUint16(0, true),
        maxSealedChunk: dv.getUint16(2, true),
        transportFrameCap: dv.getUint16(4, true),
        blobAlign: dv.getUint16(6, true),
        maxConfigBytes: dv.getUint16(8, true),
        maxOutstandingRequests: d[10],
        supportsFragmentation: d[11] !== 0,
    }
}

export interface PersonalityMap {
    role: number
    personality: number
    protoMajor: number
    namespaces: { namespace: number; verbMask: number }[]
    hwCaps: number
}

export function parsePersonalityMap(d: Uint8Array): PersonalityMap {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    const nsCount = d[3]
    const namespaces: { namespace: number; verbMask: number }[] = []
    let off = 4
    for (let i = 0; i < nsCount; i++) {
        namespaces.push({
            namespace: d[off],
            verbMask: dv.getUint16(off + 1, true),
        })
        off += 3
    }
    return {
        role: d[0],
        personality: d[1],
        protoMajor: d[2],
        namespaces,
        hwCaps: dv.getUint32(off, true),
    }
}

/** GET_CONFIG_METADATA reply: a 20-byte RMBC header of the selected slot. */
export interface ConfigMetadata {
    magic: number
    schemaVersion: number
    minReaderVersion: number
    configVersion: number
    bodyLen: number
    crc32: number
}

export function parseConfigMetadata(d: Uint8Array): ConfigMetadata {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return {
        magic: dv.getUint32(0, true),
        schemaVersion: dv.getUint16(4, true),
        minReaderVersion: dv.getUint16(6, true),
        configVersion: dv.getUint32(8, true),
        bodyLen: dv.getUint32(12, true),
        crc32: dv.getUint32(16, true),
    }
}

export interface KeymapBounds {
    maxLayers: number
    activeLayers: number
    numPositions: number
}

export function parseKeymapBounds(d: Uint8Array): KeymapBounds {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return {
        maxLayers: d[0],
        activeLayers: d[1],
        numPositions: dv.getUint16(2, true),
    }
}

/** One physical key position from GET_KEY_LAYOUT — all coords in 1/100 units. */
export interface KeyLayoutPos {
    keycode: number
    x: number
    y: number
    w: number
    h: number
    rot: number
    rotx: number
    roty: number
}

export interface KeyLayoutChunk {
    total: number
    start: number
    count: number
    positions: KeyLayoutPos[]
}

export function parseKeyLayoutChunk(d: Uint8Array): KeyLayoutChunk {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    const total = dv.getUint16(0, true)
    const start = dv.getUint16(2, true)
    const count = d[4]
    // A relayed §9.2 FRAG chain that lost one middle fragment reassembles a body
    // short by that fragment — the transport concatenates chunks by arrival order
    // with no per-fragment sequence, so a gap is invisible there. Reject the short
    // chunk explicitly (its header still declares the full `count`) so the caller
    // retries the read, instead of reading past the buffer for a cryptic DataView
    // RangeError. Mirrors control_cli cmd_get_layout's `len(body) < count*16` guard.
    if (d.length < 5 + count * 16) {
        throw new Error(
            `layout chunk truncated: ${d.length - 5} B for ${count} entries`,
        )
    }
    const positions: KeyLayoutPos[] = []
    let off = 5
    for (let i = 0; i < count; i++) {
        positions.push({
            keycode: dv.getUint16(off, true),
            x: dv.getUint16(off + 2, true),
            y: dv.getUint16(off + 4, true),
            w: dv.getUint16(off + 6, true),
            h: dv.getUint16(off + 8, true),
            rot: dv.getUint16(off + 10, true),
            rotx: dv.getUint16(off + 12, true),
            roty: dv.getUint16(off + 14, true),
        })
        off += 16
    }
    return { total, start, count, positions }
}

/** Build the `u32 offset | u16 want` arg for READ_CONFIG_CHUNK. */
export function buildReadChunkArg(offset: number, want: number): Uint8Array {
    const out = new Uint8Array(6)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, offset, true)
    dv.setUint16(4, want, true)
    return out
}

/* ── DONGLE namespace: node roster (§5.9) ───────────────────────────────── */
// pattern-check: skip — pure node-record DataView codec, data-only like the rest
// of protocol.ts (file header already declares no GoF pattern).

/** One DONGLE.LIST_NODES / GET_NODE_INFO record (§5.9). `deviceIdTail` is the
 *  last 6 bytes of the node's device id, hex-encoded for display / matching. */
export interface NodeRecord {
    shortId: number
    personality: number
    pipe: number
    /** Radio liveness (§15 failsafe): the node has been heard recently. True
     *  even before a crypto session resumes — show it, the app can reach it. */
    online: boolean
    bonded: boolean
    /** A crypto session is up AND the node is online, so the dongle can seal
     *  control toward it right now. Gate "open / control" on this, not `online`. */
    secured: boolean
    hopCount: number
    rssi: number // i8 dBm (signed)
    deviceIdTail: string // 6-byte hex
    /** Battery state-of-charge 0..100, or null when the node has not reported
     *  one (firmware sends 0xFF = unknown). */
    battery: number | null
    /** The node holds a §5 MAIN election bit, so the dongle treats it as the
     *  master. A v2/legacy node carries no role and always reads false. */
    master: boolean
    /** Raw §5 election-role low byte (enum remappr_node_role); 0 = unknown. Kept
     *  alongside `master` for callers that want the exact role, not just the bit. */
    nodeRole: number
}

/** Wire size of one node record: u16 short_id, u8 personality, u8 pipe, u8 flags,
 *  u8 hop_count, i8 rssi, 6×u8 device_id_tail, u8 battery_soc (0xFF = unknown),
 *  u8 node_role (§5 election-role low byte, 0 = unknown). */
export const NODE_RECORD_LEN = 15

/** Flags-byte bit that marks the §5 master node (mirrors firmware
 *  REMAPPR_DONGLE_NODE_F_MASTER). */
const NODE_F_MASTER = 0x08

export function parseNodeRecord(d: Uint8Array, off = 0): NodeRecord {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    const flags = d[off + 4]
    let tail = ''
    for (let i = 0; i < 6; i++)
        tail += d[off + 7 + i].toString(16).padStart(2, '0')
    const batt = d[off + 13]
    return {
        shortId: dv.getUint16(off, true),
        personality: d[off + 2],
        pipe: d[off + 3],
        online: (flags & 0x01) !== 0,
        bonded: (flags & 0x02) !== 0,
        secured: (flags & 0x04) !== 0,
        hopCount: d[off + 5],
        rssi: (d[off + 6] << 24) >> 24, // sign-extend i8
        deviceIdTail: tail,
        battery: batt === 0xff ? null : batt,
        master: (flags & NODE_F_MASTER) !== 0,
        nodeRole: d[off + 14],
    }
}

/** Parse a packed LIST_NODES reply (concatenated 15-byte records). A trailing
 *  partial record (shorter than NODE_RECORD_LEN) is ignored. */
export function parseNodeList(d: Uint8Array): NodeRecord[] {
    const out: NodeRecord[] = []
    for (let off = 0; off + NODE_RECORD_LEN <= d.length; off += NODE_RECORD_LEN)
        out.push(parseNodeRecord(d, off))
    return out
}

/** Build the `u16 short_id` arg for DONGLE.GET_NODE_INFO. */
export function buildNodeInfoArg(shortId: number): Uint8Array {
    const out = new Uint8Array(2)
    new DataView(out.buffer).setUint16(0, shortId, true)
    return out
}
