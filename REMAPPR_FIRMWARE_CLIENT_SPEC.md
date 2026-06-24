# Remappr firmware client — protocol & implementation spec

How to build the **Remappr** firmware adapter inside `@remappr/firmware`: the
client that talks to Remappr nodes (keyboard / mouse / cluster) over USB, BLE,
and (later) the 2.4 GHz dongle, reading live input and driving full node
settings.

> Scope: the **Remappr** firmware family only. The existing zmk / qmk / via /
> keychron adapters are unaffected. This adds a new `src/remappr/` module that
> registers a `FirmwareAdapter` exactly like the others.

---

## 1. Mental model — one protocol, three transports, many nodes

The firmware exposes **one transport-agnostic protocol** with two channels:

| Channel | Direction | Semantics | Use |
|---|---|---|---|
| **Control RPC** | host ⇄ node | request → response, reliable, sequenced | device info, config push/commit, profiles, RGB |
| **Event stream** | node → host | push, fire-and-forget, lossy | live key presses / actions (the Key-Test view) |

The *same frame bytes* travel over every transport — only the carrier differs:

| Transport | Control RPC carrier | Event carrier | Driverless |
|---|---|---|---|
| **USB** | vendor-HID OUT/IN reports (64 B) | unsolicited HID IN reports | ✅ everywhere |
| **BLE** | GATT control char (Write + Notify) | GATT event char (Notify) | ✅ |
| **Dongle 2.4 GHz** *(firmware TODO)* | node_proto CONTROL relayed via dongle vendor-HID | node_proto INPUT_EVENT relayed | n/a |

> **Detect all nodes, regardless of link.** The client enumerates HID devices
> (wired nodes + the dongle), Web-Bluetooth/noble devices (BLE nodes), and — once
> the dongle bridge ships — the nodes *behind* a connected dongle (each tagged by
> a `src` id). A node is identified by `GET_DEVICE_INFO` + its serial number, so
> the same physical node seen over two links can be de-duplicated.

---

## 2. Firmware capabilities — today vs roadmap

What the firmware backs **right now** (drives which `KeyboardService` members the
adapter populates):

| Capability | Firmware command(s) | `KeyboardService` surface | Status |
|---|---|---|---|
| Device info | `GET_DEVICE_INFO` (0x01), `GET_SCHEMA_VERSION` (0x02) | `deviceInfo` | ✅ USB + BLE |
| Keymap read | `READ_CONFIG_CHUNK` (0x15) | `getKeymap()` | ✅ (decode blob) |
| Keymap write | `WRITE_CONFIG_BEGIN/CHUNK/VALIDATE/COMMIT/ROLLBACK` (0x10–0x14) | `setKey`/`setKeys`/`commit`/`discardChanges` | ✅ (encode blob) |
| Live input | event `INPUT` (0x01) | `keyTest.onMatrixState` | ✅ USB + BLE |
| RGB | `SET_RGB` (0x30) | `rgb.setEffect` | ⚠️ set-only, effect state |
| Profiles (BLE hosts) | `GET_PROFILE_STATUS`/`SELECT`/`CLEAR` (0x20–0x22) | `wireless` / profile UI | ⚠️ needs `CONFIG_REMAPPR_PROFILE_SLOTS` |

**Not in firmware yet** → omit the optional `KeyboardService` members (the UI hides
them): encoders, dynamic entries (tap-dance/combos/overrides/macros as *live* RPC —
note combos *do* ship inside the config blob), advanced debounce/report-rate,
hardware layer control, per-key RGB, OTA-over-wire. See §9 roadmap.

---

## 3. Wire protocol

All integers **little-endian**. Reference: firmware `include/remappr/control.h`,
`include/remappr/control_usb.h`, `include/remappr/node_proto.h`.

### 3.1 Frame layer

One frame = one carrier unit (one HID report, or one GATT Write/Notify). On USB,
the host zero-pads each frame to 64 B; on BLE the frame length is the ATT value
length (no padding needed, but ≤ 64 B per §4.2).

**Request** (host → node, control channel):

```
offset  size  field
0       1     cmd
1       1     seq        (host-chosen; node echoes it)
2       2     arg_len
4       N     arg[arg_len]
```

**Response** (node → host, control channel):

```
offset  size  field
0       1     cmd        (echoes the request cmd)
1       1     seq        (echoes the request seq)
2       1     status     (enum, §3.4)
3       1     _pad (0)
4       2     data_len
6       M     data[data_len]
```

**Event** (node → host, event channel — *unsolicited*):

```
offset  size  field
0       1     tag = 0xE0     (distinguishes events from responses)
1       1     event_id
2       2     len
4       L     payload[len]
```

> **Demux rule.** On a shared IN stream (USB), classify each report by byte 0:
> `0x01..0x7F` → a control response; `0xE0` → an event frame. Over BLE the two
> ride **separate characteristics**, so no demux is needed there. While awaiting
> a response, skip any `0xE0` frame (it is telemetry, not your reply).

### 3.2 Command set

| cmd | name | arg | response data |
|---|---|---|---|
| 0x01 | `GET_DEVICE_INFO` | — | 16 B (§3.5) |
| 0x02 | `GET_SCHEMA_VERSION` | — | `u16 schema_version` |
| 0x10 | `WRITE_CONFIG_BEGIN` | — | — (erases the inactive slot, starts staging) |
| 0x11 | `WRITE_CONFIG_CHUNK` | blob bytes (≤ frame cap − 4) | — (appended in order) |
| 0x12 | `VALIDATE_CONFIG` | — | — (validates staged blob without committing) |
| 0x13 | `COMMIT_CONFIG` | — | — (atomic slot flip + live keymap activation) |
| 0x14 | `ROLLBACK_CONFIG` | — | — (abort staging) |
| 0x15 | `READ_CONFIG_CHUNK` | `u32 offset, u16 want` | up to `want` active-blob bytes |
| 0x20 | `GET_PROFILE_STATUS` | — | `u8 count, u8 active, count×u8 flags` (bit0 bonded, bit1 connected) |
| 0x21 | `SELECT_PROFILE` | `u8 slot` | — |
| 0x22 | `CLEAR_PROFILE` | `u8 slot` | — |
| 0x30 | `SET_RGB` | `u8 effect,hue,sat,val,speed` | — |

Unknown commands return `status = ERR_CMD`. Profile/RGB commands return `ERR_CMD`
unless the firmware wired the handler (profile-slots / RGB build options).

### 3.3 Event ids

| event_id | name | payload |
|---|---|---|
| 0x01 | `INPUT` | 6-byte `node_proto` INPUT_EVENT record (§3.6) |

### 3.4 Status codes

| value | name | meaning |
|---|---|---|
| 0 | `OK` | |
| 1 | `ERR_CMD` | unknown / unsupported command |
| 2 | `ERR_ARG` | malformed args or length |
| 3 | `ERR_STATE` | wrong staging state |
| 4 | `ERR_STORAGE` | flash I/O failure |
| 5 | `ERR_INVALID` | config failed validation |
| 6 | `ERR_VERSION` | staged `config_version` not newer than active |
| 7 | `ERR_ACTIVATE` | committed blob failed to decode/activate |

### 3.5 `GET_DEVICE_INFO` response data (16 B)

```
offset  size  field
0       2     proto_min          (= 1)
2       2     proto_max          (= 1)
4       2     schema_version     (blob reader version, = 1)
6       1     fw_major
7       1     fw_minor
8       1     fw_patch
9       2     hw_rev
11      1     has_active_config  (0/1)
12      4     active_config_version
```

### 3.6 INPUT_EVENT record (6 B) — live input

Firmware `remappr_input_event_encode`. Byte 0 is bit-packed:

```
byte 0 : bits 7..4 = kind   (0=key, 1=encoder, 2=pointer)
         bit  3    = pressed (1=down, 0=up)
         bits 2..0 = seq     (per-source 3-bit rolling counter)
byte 1 : src        (source short-id; 0 = the local node, non-zero = a node
                     behind a dongle relay once that path ships)
byte 2..3 : input_id  (u16; for keys = the physical matrix position)
byte 4..5 : timestamp (u16; 16 µs ticks, wraps)
```

For the Key-Test view: maintain a `Set<number>` of pressed `input_id`s — add on
`pressed`, delete on release — and feed `keyTest.onMatrixState`.

### 3.7 Config push sequence (set keymap)

```
BEGIN → CHUNK × ceil(blobLen / (frameCap-4)) → VALIDATE → COMMIT
                                                        ↘ (on error) ROLLBACK
```

- Encode the blob with **`@remappr/config-compiler`** — `compile(KeymapJson): Uint8Array`
  (already a workspace package; the firmware never parses JSON). Its
  `BLOB_READER_VERSION` must be ≤ the node's `schema_version`.
- `config_version` lives at **blob byte 8** (u32); it must exceed the node's
  `active_config_version` or `COMMIT` returns `ERR_VERSION`. Bump it per push.
- `COMMIT` is atomic and **activates the keymap live** (no reboot): the node
  swaps the engine keymap in its main loop.

---

## 4. Transport bindings (exact values)

### 4.1 USB — vendor HID

| Property | Value |
|---|---|
| VID | `0x1209` (pid.codes dev allocation) |
| PID | `0x0001` keyboard · `0x0002` dongle |
| Product string | `"Remappr Keyboard"` / `"Remappr Dongle"` |
| Control interface | vendor HID, **usage page `0xFF00`**, usage `0x01` |
| Report size | 64 B, no report ID |
| Request | HID **OUTPUT** report (host → node) |
| Response + events | HID **INPUT** reports (node → host), demuxed by byte 0 |

- **WebHID**: `navigator.hid.requestDevice({ filters:[{ vendorId:0x1209, usagePage:0xFF00 }] })`,
  then `device.sendReport(0, frame64)` to send, `device.addEventListener('inputreport', …)` to receive.
- **node-hid**: filter `vendorId===0x1209 && usagePage===0xFF00`; on Linux/macOS
  hidapi prepends a report-ID byte on write — write `[0x00, ...frame64]`; reads
  return the 64-byte report.
- A node also exposes its normal keyboard HID interface (usage page 0x01); pick
  the **`0xFF00`** one for control.

### 4.2 BLE — GATT service

| Item | UUID |
|---|---|
| Service | `52454d50-5200-4354-4c00-000000000001` |
| Control char (Write + Notify) | `52454d50-5200-4354-4c00-000000000002` |
| Event char (Notify) | `52454d50-5200-4354-4c00-000000000003` |

- Advertised GAP name `"Remappr Keyboard"`, appearance `0x03C1` (HID keyboard).
- **Negotiate ATT MTU ≥ 67** on connect so a 64 B frame rides one Write/Notify
  (the firmware advertises MTU 247). Web Bluetooth negotiates MTU automatically;
  with noble, request a larger MTU or keep frames ≤ 20 B.
- Flow: subscribe to **both** Notify characteristics, then `writeValue(frame)` on
  the control char → response arrives as a control-char notification; events
  arrive as event-char notifications.
- **Web Bluetooth**: `navigator.bluetooth.requestDevice({ filters:[{ services:[SERVICE_UUID] }] })`
  (the service UUID must be in `optionalServices` or a filter).

### 4.3 Dongle 2.4 GHz *(firmware TODO — design only)*

The dongle is a **relay**, not an endpoint: it will expose the same vendor-HID
control interface (PID `0x0002`) and tunnel control/INPUT_EVENT frames to/from the
wireless nodes over ESB. One dongle fronts several nodes, demultiplexed by the
`src` field (§3.6) and a node address. Plan the client so a single HID transport
can surface **multiple logical nodes** (a `nodeId`/`src` dimension on the
adapter), even though today one HID device = one node.

---

## 5. Node discovery & identity

Goal: **detect every node — wired, BLE-connected, or behind a dongle — and present
a unified list.**

1. **Enumerate per transport** (the client already has transport plumbing):
   - HID: all `0x1209` devices on usage page `0xFF00` (wired nodes + dongles).
   - BLE: devices advertising the control service UUID (§4.2), plus already-bonded
     devices the OS exposes.
2. **Probe** each candidate with `GET_DEVICE_INFO` in `FirmwareAdapter.canHandle`
   (§6). A valid 16-byte response ⇒ it's a Remappr node ⇒ `Probe.ok`.
3. **Identify / de-dupe** by `serialNumber` (USB string / BLE) and, for dongle
   relays, the `src` id. The same node reachable over USB *and* BLE should collapse
   to one entry with multiple links; surface the active link in the UI.
4. **Lifecycle**: on disconnect, mark the node offline but keep it listed if
   another link is live. Re-probe on reconnect (config_version may have changed).

The registry pattern (`pickAdapter`) already drives step 2 — register the Remappr
adapter with the right `discovery` descriptors and it participates automatically.

---

## 6. Client implementation — slotting into `@remappr/firmware`

Mirror an existing firmware module (`src/qmk`, `src/zmk`). Create `src/remappr/`:

```
src/remappr/
  index.ts        // side-effectful: registerAdapter(remapprAdapter)
  adapter.ts      // FirmwareAdapter: discovery + canHandle + connect
  protocol.ts     // frame encode/decode, command ids, status, event decode (§3)
  service.ts      // RemapprKeyboardService (implements KeyboardService subset)
  rpc.ts          // seq alloc, request→response correlation, event fan-out
  __tests__/      // protocol round-trip vs the byte layouts in §3
```

### 6.1 Adapter (`adapter.ts`)

```ts
import type { FirmwareAdapter, Probe } from '../adapter'
import type { Transport } from '../transport'

const SERVICE_UUID = '52454d50-5200-4354-4c00-000000000001'
const CONTROL_CHAR = '52454d50-5200-4354-4c00-000000000002'
const EVENT_CHAR   = '52454d50-5200-4354-4c00-000000000003'

export const remapprAdapter: FirmwareAdapter = {
  id: 'remappr',
  displayName: 'Remappr',
  discovery: {
    hid: { vendorIds: [0x1209], usagePage: 0xff00, usage: 0x01 },
    ble: { serviceUuid: SERVICE_UUID, charUuid: CONTROL_CHAR },
  },
  async canHandle(transport: Transport): Promise<Probe> {
    try {
      const rpc = openRpc(transport)               // §6.3
      const info = await rpc.deviceInfo()          // GET_DEVICE_INFO
      return { ok: true, deviceInfo: toDeviceInfo(info) }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  },
  async connect(transport, signal): Promise<KeyboardService> {
    return createRemapprService(transport, signal) // §6.4
  },
}
```

`toDeviceInfo` maps §3.5 → the client `DeviceInfo`:
`{ name: 'Remappr Keyboard', firmware: 'remappr', firmwareVersion: \`${maj}.${min}.${patch}\`, serialNumber, vid, pid }`.

### 6.2 Protocol codec (`protocol.ts`)

Pure functions, fully unit-tested against §3 byte layouts:

```ts
export const CMD = { GET_DEVICE_INFO:0x01, GET_SCHEMA_VERSION:0x02,
  WRITE_BEGIN:0x10, WRITE_CHUNK:0x11, VALIDATE:0x12, COMMIT:0x13,
  ROLLBACK:0x14, READ_CHUNK:0x15, PROFILE_STATUS:0x20, SELECT_PROFILE:0x21,
  CLEAR_PROFILE:0x22, SET_RGB:0x30 } as const
export const EVENT_TAG = 0xe0
export const EVT_INPUT = 0x01
export const FRAME_CAP = 64

export function encodeRequest(cmd:number, seq:number, arg=new Uint8Array(0)): Uint8Array
export function decodeResponse(frame:Uint8Array): { cmd:number; seq:number; status:number; data:Uint8Array }
export function isEvent(frame:Uint8Array): boolean            // frame[0] === 0xE0
export function decodeEvent(frame:Uint8Array): { eventId:number; payload:Uint8Array }
export function decodeInputEvent(rec:Uint8Array): { kind:number; pressed:boolean; seq:number; src:number; inputId:number; ts:number }
export function decodeDeviceInfo(data:Uint8Array): DeviceInfoRaw   // §3.5
```

### 6.3 RPC layer (`rpc.ts`)

- Allocate `seq` (1-byte rolling). Send `encodeRequest`, await the frame whose
  `(cmd,seq)` matches; **skip `isEvent` frames** while waiting (timeout ~1 s).
- On the **USB** transport, response + events share one IN stream → route each
  inbound report: `isEvent` → event bus, else → pending-request resolver.
- On the **BLE** transport, control-char notifications → resolver; event-char
  notifications → event bus (no demux).
- Expose `onEvent(cb)` so the service builds the matrix `Set` from `INPUT` events.

### 6.4 Service (`service.ts`) — capability mapping

Implement only what the firmware backs (§2); leave the rest `undefined`:

```ts
const service: KeyboardService = {
  deviceInfo,
  capabilities,                              // advertise: keymap, keyTest, rgb?
  async getKeymap()  { /* READ_CHUNK loop → decode blob (config-compiler inverse) */ },
  async setKeys(u)   { /* edit in-memory keymap; mark dirty */ },
  async setKey(l,p,a){ /* idem */ },
  async commit()     { /* compile() → BEGIN/CHUNK/VALIDATE/COMMIT */ },
  async discardChanges() { /* ROLLBACK if staging, else drop dirty state */ },
  keyTest: {
    onMatrixState(cb) {
      const pressed = new Set<number>()
      return rpc.onEvent(ev => {
        if (ev.eventId !== EVT_INPUT) return
        const ie = decodeInputEvent(ev.payload)
        ie.pressed ? pressed.add(ie.inputId) : pressed.delete(ie.inputId)
        cb(new Set(pressed))
      })
    },
  },
  rgb: { async setEffect(s){ await rpc.call(CMD.SET_RGB, rgbArg(s)) }, /* … */ },
  // encoders / dynamic / macros / advanced / layerControl: omit (firmware TODO)
}
```

> **Config read/write detail.** The firmware stores a binary TLV blob, not JSON.
> `@remappr/config-compiler` `compile()` does JSON→blob for writes. For
> `getKeymap()` you need the inverse (blob→JSON); add a `decode()` to
> config-compiler (it owns `BLOB_MAGIC`, table ids, keycodes) and reuse it here —
> do **not** re-implement the blob format in the client.

### 6.5 Registration

`src/remappr/index.ts` calls `registerAdapter(remapprAdapter)` at import (the
package is intentionally side-effectful — see its `package.json` note). Add the
barrel import wherever the other firmware barrels are loaded.

---

## 7. Reference appendix

- **VID/PID**: `1209:0001` keyboard, `1209:0002` dongle.
- **HID control IF**: usage page `0xFF00`, usage `0x01`, 64 B reports, no report id.
- **BLE**: service `…0001`, control `…0002` (Write+Notify), event `…0003` (Notify); MTU ≥ 67.
- **Frame cap**: 64 B every transport. Config chunk payload ≤ 60 B.
- **Event tag**: `0xE0`. **INPUT event id**: `0x01`.
- **Blob**: magic `"RMBC"`, header 20 B, `config_version` at byte 8; built by
  `@remappr/config-compiler`.
- Firmware sources: `include/remappr/control.h`, `control_usb.h`, `ble_control.h`,
  `node_proto.h`; transports `subsys/remappr/control_usb`, `subsys/remappr/ble/ble_control.c`;
  host reference CLI `tools/control_cli/` in the firmware repo.

---

## 8. Test plan

- **Unit**: `protocol.ts` round-trips against the literal byte layouts in §3
  (encode→decode, device-info, input-event bit packing). No hardware.
- **Mock transport**: a fake `Transport` that answers `GET_DEVICE_INFO` and emits
  `INPUT` events — exercise the full adapter + service without a device (mirror
  `src/mock`).
- **HIL**: against a node flashed from the firmware repo —
  `python3 tools/control_cli/control_cli.py info | monitor | push` is the
  ground-truth reference for byte-level parity.

---

## 9. Firmware roadmap (what the client cannot do yet)

These are **firmware gaps**, not client work — the adapter should omit the
matching capabilities until the firmware lands them:

1. **Dongle 2.4 GHz bridge** — relay control/INPUT_EVENT over ESB; multi-node
   behind one dongle. (Bridge is stubbed in firmware.)
2. **OTA over the wire** — `lib/ota` + `subsys/remappr/ota` exist; no transport
   binding / signing keys yet (likely mcumgr-SMP as a second USB pipe).
3. **Richer control verbs** — encoders, live tap-dance/combos/overrides/macros,
   advanced debounce/report-rate, hardware layer control, per-key RGB. The control
   command enum is extensible; add commands + handlers, then light up the matching
   optional `KeyboardService` members.
4. **Keymap read decode** — `READ_CONFIG_CHUNK` returns the raw blob; the client
   needs a blob→JSON decoder in `@remappr/config-compiler` (write path exists).
