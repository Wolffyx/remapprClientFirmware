# Remappr firmware client — protocol & implementation spec

How the **Remappr** firmware adapter inside `@remappr/firmware` talks to Remappr
devices — keyboards, mice, joysticks and the 2.4 GHz dongle — over USB, BLE and
the dongle relay, and what it builds on top: a `KeyboardService` per device,
with the device editor's `ControlsApi` for everything that is not a keyboard.

> Scope: the **Remappr** firmware family only; the zmk / qmk / via / vial /
> keychron adapters are unaffected. The module lives in `src/clients/remappr/`
> and registers a `FirmwareAdapter` like the others.
>
> **Source of truth.** The firmware repo owns the wire format: RUCP
> (`docs/universal-request-response-protocol.md`), the input-layout /
> joystick plan (`docs/input-layout-joystick-plan.md`) and the sensor-settings
> plan (`docs/sensor-settings-plan.md`). This document is the
> client's view of it. Every layout below is byte-locked by tests to the
> firmware's own goldens (§9), so a drift fails a test instead of a device.

---

## 1. Mental model — one protocol, three transports, many nodes

The firmware exposes **one transport-agnostic protocol** with two channels:

| Channel | Direction | Semantics | Use |
|---|---|---|---|
| **Control RPC** | host ⇄ device | request → response, reliable, sequenced | device info, config push/commit, live settings, layouts |
| **Event stream** | device → host | push, fire-and-forget, lossy | live key presses (Key Test) |

The *same frame bytes* travel over every transport; only the carrier differs:

| Transport | Control RPC carrier | Event carrier |
|---|---|---|
| **USB** | vendor-HID OUT/IN reports (64 B) | unsolicited HID IN reports |
| **BLE** | GATT control char (Write + Notify) | GATT event char (Notify) |
| **Dongle 2.4 GHz** | universal frames addressed to a node (`target_node`, §3.2), relayed by the dongle | relayed INPUT_EVENT, tagged by `src` |

Two protocol generations share the wire:

- **Legacy (v1)** — flat `cmd` byte (§3.1, §3.4). Still served, and still how a
  keyboard's keymap is pushed.
- **Universal (v2)** — a 0xE2-tagged frame carrying a namespace, a request id, a
  target node and fragmentation (§3.2). Everything added since — personality
  map, input layout, MOUSE / JOYSTICK / DONGLE verbs, relayed reads — rides it.

A device says what it is with its **personality** (keyboard, mouse, joystick,
dongle; §3.8). The adapter routes on it (§7.2): keyboards get the keymap
editor, every other personality the device editor.

---

## 2. What the client drives today

| Device | Surface | Firmware verbs | Status |
|---|---|---|---|
| Any | Device info, personality, limits | `GET_DEVICE_INFO`, COMMON `GET_PERSONALITY_MAP`, `GET_LIMITS` | ✅ |
| Keyboard | Keymap read / write | `READ_CONFIG_CHUNK`, `WRITE_CONFIG_*` (§3.10) | ✅ |
| Keyboard | Key geometry | KEYBOARD `GET_KEYMAP_BOUNDS`, `GET_KEY_LAYOUT` | ✅ |
| Keyboard | Key Test | event `INPUT` | ✅ |
| Keyboard | RGB, profiles, unicode mode, layer state | `SET_RGB`, `GET/SELECT/CLEAR_PROFILE`, `GET/SET_UNICODE_MODE`, `SET_BASE_LAYER`, `GET_LAYER_STATE` | ✅ where the build serves them |
| Mouse, joystick | Where the controls sit | INPUT `GET_INPUT_LAYOUT` (§4.2) | ✅ |
| Mouse | Settings document, button actions, DPI stages | config blob: TBL_MOUSE, TBL_RADIO, TBL_ACTION_BINDING (§5) | ✅ |
| Mouse | Live DPI / accel / scroll, report rate | MOUSE ns (§4.3), `GET_RATE_LIMITS` / `SET_REPORT_RATE` | ✅ |
| Joystick | Settings document | config blob: TBL_JOYSTICK, TBL_ACTION_BINDING (§5) | ✅ |
| Joystick | Live state, calibration, live axis map / deadzone | JOYSTICK ns (§4.4) — provisional | ✅ |
| Dongle | Roster, pairing, NKRO, link stats | DONGLE ns (§4.5) | ✅ |
| Node behind a dongle | Read-only view (keyboard, mouse, joystick) | relayed universal reads (§4.5) | ✅ reads · writes pending |

Not in the client: OTA, live combos / macros / tap-dance as RPC (they ship in the
config blob), editing through the dongle (§10).

---

## 3. Wire protocol

All integers **little-endian**. Firmware headers: `include/remappr/control.h`,
`control_usb.h`, `node_proto.h`.

### 3.1 Frame layer and demux

One frame = one carrier unit (one HID report, or one GATT Write/Notify). On USB
the host zero-pads each frame to 64 B.

**Legacy request** (host → device):

```
offset  size  field
0       1     cmd
1       1     seq        (host-chosen; echoed)
2       2     arg_len
4       N     arg[arg_len]
```

**Legacy response** (device → host):

```
offset  size  field
0       1     cmd        (echoes the request)
1       1     seq        (echoes the request)
2       1     status     (§3.5)
3       1     _pad (0)
4       2     data_len
6       M     data[data_len]
```

**Legacy event** (device → host, unsolicited):

```
offset  size  field
0       1     tag = 0xE0
1       1     event_id   (0x01 INPUT, §3.7)
2       2     len
4       L     payload[len]
```

> **Demux rule.** Classify every inbound frame by byte 0:
> `0x01..0x7F` legacy response · `0xE0` legacy event · `0xE1` sealed envelope ·
> `0xE2` universal frame. While awaiting a reply, skip anything that is not it.
> Over BLE, events ride their own characteristic.

`0xE1` is the sealed (AEAD) envelope a session uses after the
`CONTROL_AUTH_BEGIN` / `CONTROL_AUTH_FINISH` handshake (`auth.ts`, RUCP §19).
Dev builds have control auth disabled and serve the mutating verbs in
plaintext, which is how the client sends them today.

### 3.2 Universal frame

```
[0xE2][8-byte universal control header][inner legacy request]
```

The inner request is the legacy request of §3.1 with `cmd` = the verb. Header:

```
offset  size  field
0       1     version        (= 2)
1       1     namespace      (§3.3)
2       1     flags          (bit0 RESP, bit1 EVENT, bit2 FRAG_MORE, bit3 FRAG_FIRST)
3       1     request_id     (0xFF = fire-and-forget)
4       2     target_node    (0 = this device; else a node short-id behind a dongle)
6       1     frag_index
7       1     frag_count
```

- A reply larger than a frame arrives fragmented; the client reassembles up to
  **4096 B**, giving up after **2000 ms** between fragments.
- A **relayed** call (`target_node ≠ 0`) is answered by the dongle on the node's
  behalf. Radio loss makes it lossy, so the client retries reads (§4.5).

### 3.3 Namespaces

| ns | Name | Verbs the client uses |
|---|---|---|
| 0x00 | COMMON | device info, personality map, manifest, limits, config chunks, report rate |
| 0x01 | KEYBOARD | 0x42 `GET_KEYMAP_BOUNDS`, 0x43 `GET_KEY_LAYOUT`, unicode mode |
| 0x02 | MOUSE | §4.3 |
| 0x03 | JOYSTICK | §4.4 (provisional, manifest `ns_version` 0) |
| 0x04 | AUDIO | — |
| 0x05 | LIGHTING | 0x33 `HAPTIC_PULSE`, 0x34 `SET_DISPLAY` |
| 0x06 | PROFILES | — |
| 0x07 | DONGLE | §4.5 |
| 0x08 | RADIO | — |
| 0x09 | INPUT | 0x01 `GET_INPUT_LAYOUT` (§4.2) |
| 0x0A | SENSOR | §4.6 (provisional, manifest `ns_version` 0) |

COMMON verbs that exist only on the universal route: 0x04
`GET_PERSONALITY_MAP`, 0x05 `GET_MANIFEST`, 0x06 `GET_LIMITS`, 0x07
`SUBSCRIBE_EVENTS`, 0x08 `UNSUBSCRIBE`, 0x09 `GET_LINK_LIMITS`, 0x16
`QUERY_STAGE_OFFSET`, 0x17 `GET_CONFIG_METADATA`, 0x51 `GET_ERROR_COUNTERS`,
0x54 `GET_CLUSTER_DIAG`.

> **Gate on the namespace list.** A namespace a device does not list in its
> personality map (§3.8) is not served. The client never assumes the
> provisional JOYSTICK or SENSOR namespace, or INPUT; it does assume MOUSE on a
> mouse that predates the list.

### 3.4 Legacy command set

| cmd | Name | Arg → reply |
|---|---|---|
| 0x01 | `GET_DEVICE_INFO` | — → 16 B (§3.6) |
| 0x02 | `GET_SCHEMA_VERSION` | — → `u16` |
| 0x03 | `GET_CAPABILITIES` | — → `u32` Cap bits (§3.8); keyboards only |
| 0x10 | `WRITE_CONFIG_BEGIN` | — (erases the inactive slot) |
| 0x11 | `WRITE_CONFIG_CHUNK` | blob bytes |
| 0x12 | `VALIDATE_CONFIG` | — |
| 0x13 | `COMMIT_CONFIG` | — (atomic slot flip, live activation) |
| 0x14 | `ROLLBACK_CONFIG` | — |
| 0x15 | `READ_CONFIG_CHUNK` | `u32 offset, u16 want` → up to `want` bytes |
| 0x18 | `UNPAIR_RADIO` | — (forget the bonded dongle, re-arm pairing) |
| 0x20 | `GET_PROFILE_STATUS` | — → `u8 count, u8 active, count × u8 flags` |
| 0x21 | `SELECT_PROFILE` | `u8 slot` |
| 0x22 | `CLEAR_PROFILE` | `u8 slot` |
| 0x30 | `SET_RGB` | `u8 effect, hue, sat, val, speed` |
| 0x40 | `SET_BASE_LAYER` | `u8 layer` |
| 0x41 | `GET_LAYER_STATE` | — |
| 0x44 | `GET_UNICODE_MODE` | — |
| 0x45 | `SET_UNICODE_MODE` | `u8 mode` |
| 0x50 | `GET_DIAGNOSTICS` | — |
| 0x52 | `GET_RATE_LIMITS` | — → 8 B (§4.3) |
| 0x53 | `SET_REPORT_RATE` | `u16 hz` → `u16 applied hz` |
| 0x60 | `CONTROL_AUTH_BEGIN` | handshake |
| 0x61 | `CONTROL_AUTH_FINISH` | handshake |

Plaintext without a session: 0x01–0x03, 0x15, 0x20, 0x41, 0x44, 0x50, 0x52,
0x60, 0x61. Everything else is sealed on a product build.

### 3.5 Status codes

| value | name | meaning |
|---|---|---|
| 0 | `OK` | |
| 1 | `ERR_CMD` | unknown / unsupported verb |
| 2 | `ERR_ARG` | malformed args or out of range |
| 3 | `ERR_STATE` | wrong state (staging, calibration step out of turn) |
| 4 | `ERR_STORAGE` | flash I/O failure |
| 5 | `ERR_INVALID` | config failed validation |
| 6 | `ERR_VERSION` | staged `config_version` not newer than active |
| 7 | `ERR_ACTIVATE` | committed blob failed to activate |
| 8 | `ERR_AUTH` | sealed verb without a session |

### 3.6 `GET_DEVICE_INFO` (16 B)

```
offset  size  field
0       2     proto_min
2       2     proto_max          (2 on a universal device)
4       2     schema_version     (blob reader version)
6       1     fw_major
7       1     fw_minor
8       1     fw_patch
9       2     hw_rev
11      1     has_active_config  (0/1)
12      4     active_config_version
```

### 3.7 INPUT_EVENT record (6 B) — live input

```
byte 0    : bits 7..4 kind (0 key, 1 encoder, 2 pointer) · bit 3 pressed · bits 2..0 seq
byte 1    : src        (0 = this device; else a node behind a dongle)
byte 2..3 : input_id   (keys: the physical matrix position)
byte 4..5 : timestamp  (16 µs ticks, wraps)
```

Key Test keeps a `Set` of pressed `input_id`s.

### 3.8 Personality map, capabilities, hardware

**COMMON `GET_PERSONALITY_MAP`** (0x04):

```
u8  role
u8  personality
u8  proto_major              (= 2)
u8  ns_count
ns_count × { u8 namespace, u16 verb_mask }   (bit n = opcode n served; the manifest is authoritative past 15)
u32 hw_caps
```

| Role | | Personality | |
|---|---|---|---|
| 0 | NODE | 0 | unknown |
| 1 | DONGLE | 1 | keyboard |
| 2 | RADIO_COPROCESSOR | 2 | mouse |
| 3 | BRIDGE | 3 | recovery |
| 4 | DEVKIT | 4 | dongle |
| | | 5 | joystick |

**`hw_caps`** (u32): USB 0, USB_HID 1, RADIO_2G4 2, BLE 3, BUTTONS 4, MATRIX 5,
ENCODERS 6, SLIDERS 7, TOUCH 8, POINTER 9, IMU 10, RGB 11, LEDS 12, DISPLAY 13,
HAPTIC 14, BATTERY 15, FLASH_STORAGE 16, ANALOG_AXES 17, HID_GAMEPAD 24.
`0` means *not reported* (older firmware), not *nothing*.

**`GET_CAPABILITIES`** Cap bits (u32, legacy, keyboards): CONFIG 0, PROFILES 1,
RGB 2, LAYERS 3, DIAGNOSTICS 4, AUTH 5, KEYMAP 6, PAIRING 7, MOUSE 11,
CLUSTER_DIAG 12, UNICODE 14, JOYSTICK 15, SENSOR 16.

> **Two bit 15s.** `hw_caps` bit 15 is BATTERY; Cap bit 15 is JOYSTICK. They are
> different words.

### 3.9 `GET_LIMITS`

```
u16 max_unsealed_chunk
u16 max_sealed_chunk
u16 frame_cap
u16 blob_align
u16 max_config_bytes        (> 0 ⇒ the device has a config store)
u8  max_outstanding
u8  supports_frag
[u32 feature_bitmask]
```

### 3.10 Config push

```
BEGIN → CHUNK × n → VALIDATE → COMMIT
                             ↘ (on error) ROLLBACK
```

- The blob (§5) is built in this package by `config/compilers/remappr`: the
  keymap compiler for keyboards, `buildRemapprDeviceBlob` for a device
  document. `decode.ts` / `device.ts` read it back.
- `config_version` (blob byte 8) must exceed the device's
  `active_config_version`, or `COMMIT` returns `ERR_VERSION`. The client reads
  the version right before each push and writes `active + 1`.
- The blob is padded to `blob_align` (16 B). A device document is written in
  48 B chunks over the universal route, so each chunk fits one frame.
- `COMMIT` activates the config live, without a reboot. A mouse or joystick
  releases every held button on it, so no press outlives the binding that
  made it.

---

## 4. Devices

### 4.1 Device kind

The adapter derives one `DeviceKind` from discovery:

1. role DONGLE → `dongle`;
2. personality 1 → `keyboard`, 2 → `mouse`, 4 → `dongle`, 5 → `joystick`;
3. anything else, or no personality map → `keyboard`.

### 4.2 Input layout — INPUT `GET_INPUT_LAYOUT` (0x01)

Where each control sits, for every personality. Request: `u16 start` (absent = 0).

```
page header (7 B): u8 version (=1) | u8 form | u16 total | u16 start | u8 count
entry (20 B):      u8 class | u8 shape | u16 input_id | u16 position
                   | u16 x | u16 y | u16 w | u16 h | i16 rot | u16 rot_x | u16 rot_y
```

- Units: 1/100 key-unit, top-left origin; `rot` 1/100 degree clockwise about
  (`rot_x`, `rot_y`).
- `input_id` = `class << 8 | ordinal` (0xFFFF past 255); `position` = the
  binding position (0xFFFF = none).
- Page with `start += count` until `start ≥ total`. A truncated page over the
  relay is re-read.

| Class | | Shape | | Form | |
|---|---|---|---|---|---|
| 0 | KEY | 0 | AUTO | 0 | PERSONALITY |
| 1 | BUTTON | 1 | KEY | 1 | KEYBOARD |
| 2 | ENCODER | 2 | ROUND | 2 | MACROPAD |
| 3 | WHEEL | 3 | PILL | 3 | MOUSE |
| 4 | SENSOR | 4 | STICK | 4 | GAMEPAD |
| 5 | STICK | 5 | DPAD | 5 | FLIGHTSTICK |
| 6 | TRIGGER | 6 | HAT | | |
| 7 | HAT | 7 | TRIGGER | | |
| 8 | AXIS | 8 | TRIGGER_SIDE | | |
| 9 | SLIDER | 9 | WHEEL | | |
| | | 10 | RING | | |
| | | 11 | KNOB | | |
| | | 12 | SENSOR | | |
| | | 13 | MOUSE_LEFT | | |
| | | 14 | MOUSE_RIGHT | | |

Joystick conventions: a STICK's `position` is its click; a HAT's `position` is
*up*, with down, left and right on the next three; stick _n_ reads analog
inputs 2_n_ and 2_n_+1.

### 4.3 Mouse

**MOUSE namespace:**

| Op | Verb | Arg → reply |
|---|---|---|
| 0x01 | `GET_MOTION_CONFIG` | — → `u8 ver(=1) \| u8 rsvd \| u16 dpi_min \| u16 dpi_max \| u16 dpi_step \| u16 dpi \| u8 accel_profile \| u8 scroll_mode` |
| 0x02 | `SET_DPI` | `u16 dpi` (ERR_ARG outside min..max) |
| 0x03 | `SET_ACCEL_PROFILE` | `u8` (0 flat, 1 the config's curve) |
| 0x04 | `SET_SCROLL_MODE` | `u8` (0 normal, 1 inverted) |

The SET verbs are live tweaks: they stand until the next COMMIT replaces them.

**Report rate** (COMMON, legacy numbers):

- `GET_RATE_LIMITS` 0x52 → `u8 ver(=1) | u8 supported_mask | u16 usb_cap_hz | u16 radio_cap_hz | u16 current_hz`.
  Bit _i_ of the mask = 125, 250, 500, 1000, 2000, 4000, 8000 Hz.
- `SET_REPORT_RATE` 0x53, `u16 hz` → `u16 applied hz`.

The rate belongs to the unit, not the config: the firmware keeps it in its own
settings key and a COMMIT never resets it. The client stages a rate change and
applies it on `commit()`; it is not in the device document.

### 4.4 Joystick — JOYSTICK namespace (provisional)

`input` below is the analog input index (0..5), not the report axis.

| Op | Verb | Arg → reply |
|---|---|---|
| 0x01 | `GET_AXIS_STATE` | — → `u8 ver(=1) \| u8 n \| n × {i16 raw, i16 value} \| u32 buttons \| u8 hat` |
| 0x02 | `SET_AXIS_MAP` | `u8 input \| u8 out_axis (0..5 = X Y Z Rx Ry Rz, 0xFF off) \| u8 flags (bit0 invert)` |
| 0x03 | `SET_DEADZONE` | `u8 input \| u8 inner_pct \| u8 outer_pct` (inner + outer < 100) |
| 0x04 | `CALIBRATE` | `u8 input (0xFF = all) \| u8 step` |
| 0x05 | `GET_AXIS_CONFIG` | — → `u8 ver(=1) \| u8 hat_ways \| u8 n \| n × {u8 out, u8 flags, u8 curve, u8 inner, u8 outer, i16 min, i16 centre, i16 max}` |

- `hat`: 0..7 from up, clockwise; 8 = centred. `hat_ways`: 0 = 8.
- `CALIBRATE` steps: BEGIN 0, CENTRE 1, FINISH 2, CANCEL 3, RESET 4. A step out
  of turn, or a FINISH with a sweep under 64 counts either side of centre, is
  `ERR_STATE`; FINISH on all inputs is all-or-none.
- Calibration is stored on the device (its own settings key), never in the
  blob; COMMIT does not touch it. `SET_AXIS_MAP` / `SET_DEADZONE` are live and
  dropped by the next COMMIT.
- The client's live readout polls `GET_AXIS_STATE` every 50 ms (250 ms over the
  relay) while something is listening.

> **Firmware doc drift.** The §4 summary table in `input-layout-joystick-plan.md`
> still shows the pre-build `GET_AXIS_CONFIG` reply (no header, `n × i16`). The
> as-built text there and RUCP §5.5 match the layout above.

### 4.5 Dongle and nodes

**DONGLE namespace:** 0x01 `LIST_NODES`, 0x02 `GET_NODE_INFO`, 0x03
`OPEN_PAIR_WINDOW`, 0x04 `FORGET_NODE`, 0x05 `CLEAR_ALL_BONDS`, 0x06
`GET_MASTER`, 0x07 `SET_NKRO`, 0x08 `GET_LINK_STATS`, 0x09 `GET_PIPE_TABLE`,
0x0A `ENTER_BOOTLOADER`.

**`LIST_NODES` record (15 B):**

```
u16 short_id | u8 personality | u8 pipe | u8 flags (bit0 online, bit1 bonded, bit2 secured, bit3 master)
| u8 hops | i8 rssi | 6 B device_id_tail | u8 battery (0xFF unknown) | u8 node_role
```

> **The kind byte is the node's personality** (RUCP §5.9, `role.h`): KEYBOARD 1,
> MOUSE 2, JOYSTICK 5, and 0 for a config tool. `LIST_NODES`, `GET_NODE_INFO`
> and `GET_MASTER` carry it; only `GET_PIPE_TABLE` keeps the radio's own device
> type (`radio_proto.h`: NONE 0, KEYBOARD 1, MOUSE 2, CONFIG_TOOL 3, JOYSTICK 4).
> The client maps 1 → keyboard, 2 → mouse, 5 → joystick, and nothing else to a
> kind. Dongles from before the joystick could pair wrote the radio type here,
> which agrees for keyboard and mouse, the only nodes they paired.

**Relayed reads.** A node is read by addressing universal COMMON / INPUT /
MOUSE / JOYSTICK / SENSOR reads to its short-id (`target_node`). Reads retry up to 4
times with a 500 ms timeout each. `open(id)` runs discovery against the node
and returns a **read-only** view by its kind: a mouse view, a joystick view, or
a keyboard view (keymap decoded from the node's active blob). Views share the
dongle's RPC and never close it. Writing through the relay (sealed relay
session, `establishNodeSession`) is built but not yet proven on hardware, so
views refuse every change.

### 4.6 Sensor — SENSOR namespace (provisional)

Personality-neutral: a mouse's optical sensor and a keyboard's trackball use
the same verbs. A sensor's **adapter** in the firmware lists what it has —
settings, procedures, readings — and the device describes exactly that; the
client keeps no list of which sensor supports what. Every verb names the
sensor by its index. Reads are plaintext-open and fit the 48-byte unsealed
chunk; `SET_SETTING` and `RUN_PROCEDURE` are mutating (sealed in a product
build, §10). Every reply except `SET_SETTING`'s starts with `u8 ver (= 1)`; a
newer firmware may append, so a reader stops where it knows.

| Op | Verb | Arg → reply |
|---|---|---|
| 0x01 | `GET_SENSORS` | `u8 first` → `ver \| u8 total \| u8 n \| n × {u8 index, u8 class, u16 model_id, u8 settings, u8 procedures, u8 metrics, u8 name_len, name}` (two fit a reply: ask again from `first + n`) |
| 0x02 | `GET_SETTING` | `u8 sensor \| u8 position` → `ver \| u8 id \| u8 type \| u8 flags \| u8 unit \| i32 value \| i32 default`, then INT `i32 min \| i32 max \| i32 step`, ENUM `u8 n \| n × u8 code \| u8 gated_mask \| u8 procedure`, then `u8 name_len \| name` |
| 0x03 | `SET_SETTING` | `u8 sensor \| u8 id \| i32 value` → `i32 applied` (no version byte; snapped to what the hardware holds) |
| 0x04 | `GET_PROCEDURE` | `u8 sensor \| u8 position` → `ver \| u8 id \| u8 phases \| u8 flags \| u8 name_len \| name` |
| 0x05 | `RUN_PROCEDURE` | `u8 sensor \| u8 id \| u8 step` → the status below |
| 0x06 | `GET_PROCEDURE_STATUS` | `u8 sensor \| u8 id` → `ver \| u8 state \| u8 phase \| u16 progress \| u16 total \| u8 result \| u8 flags` (9 B; older firmware stops at 8, no flags) |
| 0x07 | `GET_METRICS` | `u8 sensor` → `ver \| u8 n \| n × {u8 id, i32 value, i32 max}` |

`position` is the place in the sensor's own list (0 .. count − 1 from
`GET_SENSORS`), not a registry id; `SET_SETTING`, `RUN_PROCEDURE` and the
status take the registry id. Names are ASCII, at most 12 bytes: the device's
fallback label for an id the client has no name for.

| Field | Values |
|---|---|
| class | POINTER 1, TOUCH 2, IMU 3, ANALOG 4 |
| type | BOOL 1 (0 / 1), INT 2 (`min + k × step`), ENUM 3 (up to 8 option codes) |
| unit | none 0, ms 1, µs 2, degrees 3, cpi 4, % 5 |
| setting flags | ADVANCED 1 (folded away), NEEDS_PROCEDURE 2, PERSONALITY 4 (driven by the personality's own feature; not set as a sensor setting) |
| `gated_mask` | bit _i_ = option _i_ needs a stored result of `procedure` first |
| procedure flags | HAS_RESULT 1 (a finished run leaves a result the unit keeps) |
| step | BEGIN 0, NEXT 1 (end the phase in hand), CANCEL 2, RESET 3 (forget the stored result) |
| state | IDLE 0, RUNNING 1, DONE 2, FAILED 3; `phase` 1.. while running; `progress` / `total` 0 / 0 for a phase that does not count |
| result | OK 0, FAILED 1 |
| status flags | HAS_RESULT 1 (a result is stored now, so the options it gates are accepted; one restored at boot reads IDLE with it set; RESET clears it, CANCEL keeps it) |

**Registry** (`include/dt-bindings/remappr/sensor.h`, append-only and
wire-frozen once shipped; mirrored by the client for names and labels only):

| Id | Name | Type | Options / unit |
|---|---|---|---|
| 0x01 | `resolution` | INT, PERSONALITY | cpi (the mouse's DPI drives it) |
| 0x02 | `readPeriod` | INT, PERSONALITY | µs (the report rate drives it) |
| 0x10 | `liftCutoff` | ENUM | 10 `1mm`, 20 `2mm`, 0 `calibrated` (gated by `liftCalibration`) |
| 0x11 | `angleSnap` | BOOL | |
| 0x12 | `angleTune` | INT | degrees |
| 0x13 | `performanceMode` | ENUM | 0 `high`, 1 `lowPower`, 2 `office`, 3 `corded` |
| 0x14 | `stayAwake` | BOOL | rest modes off |
| 0x15 | `motionSync` | BOOL | reads synced to the host (no adapter yet) |
| 0x20–0x25 | `runDownshiftMs`, `rest1PeriodMs`, `rest1DownshiftMs`, `rest2PeriodMs`, `rest2DownshiftMs`, `rest3PeriodMs` | INT | ms |

Procedure 0x01 `liftCalibration` (2 phases: move over the whole surface, NEXT
ends it; keep moving while phase 2 counts to its total and ends by itself).
Metrics 0x01 `surfaceQuality`, 0x02 `lifted` (0 / 1), 0x03 `shutter`, 0x04
`brightness`. An id the client does not know keys as its hex (`0x16`) in
bindings and documents.

- **Live until COMMIT.** `SET_SETTING` changes the sensor now and holds until
  the next COMMIT, which applies the new config's TBL_SENSOR (§5.6) or, with
  none, every default. Nothing is stored by the SET itself.
- **What is in force**, lowest first: the hardware at settle, the board's
  devicetree `remappr,setting-defaults` (together they are what `default`
  reports), TBL_SENSOR, a live SET.
- **Errors.** `ERR_ARG`: unknown sensor, setting, procedure or option, or a
  value out of range. `ERR_STATE`: the sensor is not up yet, a gated option
  before its procedure has a stored result, a PERSONALITY setting, a step out
  of turn; `GET_METRICS` while a procedure holds the sensor (calibration phase
  1).
- **Procedure results** belong to the unit: stored in the device's own
  settings (`remappr/sensor/<index>/<procedure>`), restored at boot, never in
  a config. RESET forgets one and drops an option that needed it to its
  default. The status's HAS_RESULT flag says one is stored (the client's
  `hasResult`; absent when older firmware sends no flags byte).
- **Client.** `buildSensorApi` (`sensor.ts`) gives `service.sensor`
  (§7.3), speaking names: `getSensors()` describes every sensor (one
  `GET_SETTING` / `GET_PROCEDURE` per entry, plus `GET_METRICS`) with the
  values in force. Over the dongle the reads are relayed with retries and
  every change is refused. The mouse's device editor offers the pointer
  sensor's non-PERSONALITY settings (`catalog.sensor.settings`); a change is
  previewed with `SET_SETTING` (the snapped value shown), staged in the
  document's `sensor` section, written by `commit()` and put back by
  `discardChanges()`.

---

## 5. Config blob

### 5.1 Header and tables

```
offset  size  field
0       4     magic = 0x43424D52 ("RMBC")
4       2     schema
6       2     min_reader
8       4     config_version
12      4     body_len
16      4     crc32(body)
20      …     tables: { u16 id | u16 version | u32 len | len bytes }…
```

Table ids: Layer 1, Layout 2, Binding 3, Behavior 4, Combo 5, Macro 6, Rgb 7,
**Mouse 8**, Profile 9, Alias 10, Security 11, Subs 12, Conditional 13,
KeyOverride 14, Leader 15, **Personality 16**, **ActionBinding 17**, Poshold 18,
Names 19, Encoder 20, Cluster 21, ClusterSec 22, LinkProfile 23, Autocorrect
24, **Dongle 25**, **Radio 26**, (27 reserved, TBL_UPDATE), **Joystick 28**,
**Sensor 29**.

A device document's blob holds, in order: PERSONALITY, then DONGLE, or MOUSE +
ACTION_BINDING + RADIO + SENSOR, or JOYSTICK + ACTION_BINDING.

### 5.2 TBL_PERSONALITY (16) v1

`u8 personality | u8 role_flags (VALID 0x01, COORD 0x02) | u8 fwd_mode (0 resolved, 1 physical) | u8 rsvd`

### 5.3 TBL_MOUSE (8)

```
v1: u16 cpi | u16 auto_layer_ms | u8 n | u8 flags | n × {u16 speed_in, u16 mult_x100}
v2: + u8 scroll_div | u8 rsvd | u8 button_map[8]   (button_map 0xFF = off)
v3: + u8 stage_count | u8 stage | u16 stages[5]    (DPI stages; cpi = stages[stage])
```

`flags` is 0 in a v1 table; from v2 it carries invertX 1, invertY 2,
invertWheel 4, invertHwheel 8, swapXY 16. The compiler writes the lowest
version the fields need; the decoder reads v1–v3.

### 5.4 TBL_JOYSTICK (28) v1

```
u8 hat_ways (0 = 8) | u8 axis_count
axis_count × { u8 input | u8 out_axis (0xFF off) | u8 flags (bit0 invert)
               | u8 curve (0 linear, 1 aggressive, 2 relaxed, 3 precise)
               | u8 inner | u8 outer | u16 rsvd }
```

Emitted only when something differs from the defaults.

### 5.5 TBL_ACTION_BINDING (17) v1 and action kinds

```
u16 count | u16 num_positions | count × { u16 position | u8 kind | u8 rsvd | u16 code | u16 arg0 | u16 arg1 }
```

`num_positions` is 8 on a mouse and 40 on a joystick.

| kind | Name | Fields |
|---|---|---|
| 0 | NONE | |
| 1 | KEYBOARD | code = usage, arg0 = mods |
| 2 | CONSUMER | code = usage |
| 3 | POINTER | code, arg1 = magnitude |
| 4 | SYSTEM | code |
| 5 | OUTPUT | arg0 = profile (0xFF none) |
| 6 | LIGHTING | code = action \| target << 8, arg1 = sat \| val << 8 |
| 7 | DEVICE | code: 1 DPI_CYCLE, 2 DPI_UP, 3 DPI_DOWN, 4 DPI_SET (arg0 = dpi), 5 SNIPER (arg0 = dpi while held). Mouse only. |
| 16 | GAMEPAD_BUTTON | code = button 1..32 |
| 17 | GAMEPAD_HAT | code = direction 0..7 |
| 18 | GAMEPAD_AXIS | code = axis 0..5, arg0 = i16 value |

19–23 are reserved for gamepad, 24–31 for audio. The keymap decoder reads kinds
≥ 8 back as `none`: they belong to device documents, not keymaps.

### 5.6 TBL_SENSOR (29) v1

```
u8 count | u8 rsvd
count × { u8 sensor | u8 id | u16 rsvd | i32 value }
```

- `id` is the registry id (§4.6); BOOL 0 / 1, ENUM its option code.
- **Validated strictly** at `VALIDATE_CONFIG`: an entry for a sensor the
  device does not have, a setting its adapter does not list, a PERSONALITY
  setting, a value out of range or a duplicate refuses the whole config. A
  gated option (`calibrated`) passes, so a config stays portable; on a unit
  with no stored result it falls back to the default when applied.
- Absent table = every setting on its default. The client writes the table
  only when the document names a value.
- **Compiler.** `compilers/remappr/sensor.ts` turns names (or hex keys) and
  option names into entries. Given the device's own description
  (`DeviceConfigTarget.sensors`, which the mouse's `service.device.write`
  passes), an entry the device would refuse is left out and the document keeps
  it. A keymap's `node.sensor.defaults` (product defaults, by name) is written
  as TBL_SENSOR for sensor 0 in the keymap blob too, and the board compiler
  builds it into the sensor's devicetree node as `remappr,setting-defaults =
  <ID VALUE …>` (`board.sensor`).
- Golden: firmware `tests/config_blob/src/test_sensor_decode.c` (sensor 0:
  lift 2 mm, angle snap on, angle tune −5).

### 5.7 The `remappr.device` document

The JSON a non-keyboard device's blob is compiled from (`config/device.ts`):

```json
{ "schemaVersion": 1, "kind": "remappr.device", "meta": { "name": "…" },
  "personality": "mouse" | "joystick" | "dongle",
  "mouse": {…}, "radio": {…}, "sensor": {…}, "joystick": {…}, "dongle": {…} }
```

`sensor` (mouse) is `{ index?, settings: { <name>: value } }`: the values the
user set, by registry name (a BOOL as a boolean, an INT as a number, an ENUM as
its code or option name); one left out stays on the device's default. Read
back, an option comes back as its code. A name the client does not know is kept
and never compiled.

Every field is optional; a section that belongs to another personality is
rejected. Field-by-field reference: the docs site's *Device document* page
(`docs/reference/config/device-document.md` in the app repo).

---

## 6. Transport bindings

### 6.1 USB — vendor HID

| Property | Value |
|---|---|
| VID | `0x1209` (pid.codes) |
| PID | `0x0001` keyboard · `0x0002` dongle · `0x0003` mouse · `0x0004` joystick |
| Product string | `Remappr Keyboard` / `Remappr Dongle` / `Remappr Mouse` / `Remappr Joystick` |
| Control interface | vendor HID, usage page `0xFF00`, usage `0x01`, 64 B reports, no report id |

The adapter claims any `0x1209` device on usage page `0xFF00` (priority 100)
and lets discovery decide what it is; it does not filter on the PID. A device
also exposes its normal HID interface (keyboard, mouse, or a gamepad with 32
buttons, an 8-way hat and six 16-bit axes); pick the `0xFF00` one for control.

- **WebHID**: `requestDevice({ filters: [{ vendorId: 0x1209, usagePage: 0xFF00 }] })`.
- **node-hid**: on Linux/macOS write `[0x00, ...frame64]` (report-id byte).

### 6.2 BLE — GATT service

| Item | UUID |
|---|---|
| Service | `52454d50-5200-4354-4c00-000000000001` |
| Control char (Write + Notify) | `52454d50-5200-4354-4c00-000000000002` |
| Event char (Notify) | `52454d50-5200-4354-4c00-000000000003` |

Negotiate ATT MTU ≥ 67 so a 64 B frame rides one Write/Notify (the firmware
offers 247). Subscribe to both characteristics before the first write.

### 6.3 Dongle 2.4 GHz

The dongle (PID `0x0002`) is both a device (DONGLE namespace) and a relay:
universal frames with `target_node ≠ 0` go to that node over ESB, and replies
and node INPUT events come back through it (§4.5).

---

## 7. Client implementation — `src/clients/remappr/`

### 7.1 Module map

| File | Role |
|---|---|
| `index.ts` | Side-effect `registerAdapter(remapprAdapter)` + barrel |
| `adapter.ts` | Discovery descriptors, probe, connect by kind (§7.2) |
| `protocol.ts` | Enums, frame build/parse, every reply parser (byte-locked) |
| `rpc.ts` | seq / request-id allocation, demux, fragments, timeouts (1500 ms default), relay retries |
| `auth.ts`, `identity.ts` | Control-auth handshake and the sealed session |
| `discovery.ts`, `deviceKind.ts` | Device info → personality map → limits; the kind (§4.1) |
| `service.ts`, `configRead.ts`, `configBridge.ts`, `geometry.ts` | `RemapprKeyboardService`: keymap read/write, key layout |
| `inputLayout.ts` | `GET_INPUT_LAYOUT` paging → `DeviceModel` |
| `deviceConfig.ts` | `DeviceConfigApi`: read / write a device document |
| `mouse.ts`, `reportRate.ts`, `mouseControls.ts`, `mouseService.ts` | MOUSE verbs, report rate, catalog, `RemapprMouseService` |
| `joystick.ts`, `joystickControls.ts`, `joystickService.ts` | JOYSTICK verbs, catalog, `RemapprJoystickService` |
| `sensor.ts`, `sensorRegistry.ts` | SENSOR verbs and `buildSensorApi`; the registry mirror (names, labels, option names, devicetree macros) |
| `nodes.ts`, `nodeView.ts` | DONGLE verbs; `NodesApi` (roster, read-only node views) |
| `clusterView.ts`, `unicode.ts`, `unicodeView.ts`, `dynamicBridge.ts` | Cluster diag, unicode mode, dynamic entries |

### 7.2 Connect

`probe` opens an RPC and runs discovery (legacy `GET_DEVICE_INFO` with a 400 ms
timeout, else universal COMMON; personality map and limits when `proto_max ≥
2`; a `LIST_NODES` fallback for old dongles). `connect` then builds by kind:

| Kind | Service | Notes |
|---|---|---|
| keyboard | `RemapprKeyboardService` | auth handshake, keymap load, `GET_CAPABILITIES` |
| mouse | `RemapprMouseService` | `device` when the device has a config store; `motion` when MOUSE is served; `sensor` when SENSOR is listed; layout when INPUT is listed |
| joystick | `RemapprJoystickService` | `device` when it has a config store; `joystick` when JOYSTICK is listed; layout when INPUT is listed |
| dongle | dongle service (`buildDongleService`) | `nodes` facade, dongle settings |

### 7.3 Services and facades

The mouse and joystick services extend `KeylessServiceBase`: `kind` set,
`saveMode: 'manual'`, one **Default** profile, export as
`remappr.device.json`. They hold one staged document (`device.draft`);
`commit()` validates it and writes it with `DeviceConfigApi.write`.

| Facade | Members |
|---|---|
| `DeviceConfigApi` | `personality`, `writable`, `read()` → `{config, configVersion, stored}`, `write(cfg)` → new version, `draft?` |
| `MouseMotionApi` | `writable`, `getConfig`, `setDpi`, `setAccelProfile`, `setScrollMode` |
| `JoystickApi` | `writable`, `getState`, `getConfig`, `calibrate(step, input?)`, `setAxisMap`, `setDeadzone` |
| `SensorApi` | `writable`, `getSensors()` → `SensorInfo[]`, `setSetting(sensor, name, value)` → applied, `runProcedure(sensor, name, step)` / `getProcedureStatus` → status, `getMetrics(sensor)` |
| `ControlsApi` | `getModel`, `getCatalog`, `getProfiles`, `getBindings`, `setBinding?`, `onChanged`, `onInput?`, `layout?` |
| `NodesApi` | `list`, `open(id)`, `openPairWindow`, `forgetNode`, … |

A facade that is absent (or `writable: false`) is how the UI learns a device
cannot do something; there is no separate capability list.

**Control ids.** Mouse: `lmb rmb wheel back fwd btn5..btn7` and `sensor`
(its binding: `stages`, `active`, `poll`, and `settings` — the sensor values the
user set, by name; a dropped key is a reset);
catalog actions `dev:<action>[:dpi]` for DPI actions. Joystick: `btn:<pos>`,
`stick:<n>`, `hat:<n>`; catalog actions `pad:btn:N`, `pad:hat:D`,
`pad:axis:<axis>:<value>`.

---

## 8. Reference appendix

- **VID/PID**: `1209:0001` keyboard · `0002` dongle · `0003` mouse · `0004` joystick.
- **HID control IF**: usage page `0xFF00`, usage `0x01`, 64 B, no report id.
- **BLE**: service `…0001`, control `…0002`, event `…0003`; MTU ≥ 67.
- **Frame tags**: `0xE0` event · `0xE1` sealed · `0xE2` universal.
- **Universal header**: 8 B, version 2; fragments ≤ 4096 B, 2000 ms gap.
- **Blob**: magic `RMBC`, 20 B header, `config_version` at byte 8, 16 B alignment.
- **Firmware**: `include/remappr/control.h`, `control_usb.h`, `node_proto.h`,
  `action.h`, `role.h`, `sensor.h` (+ `dt-bindings/remappr/sensor.h`, the
  registry); `subsys/remappr/control/` (incl. `control_joystick.c`,
  `control_sensor.c`), `subsys/remappr/sensor/`, `lib/sensors/settings/`; host
  CLI `tools/control_cli/` (`control_cli.py` incl. `sensors`, `sensor-get`,
  `sensor-set`, `sensor-cal`, `sensor-metrics`; `make_mouse_blob.py
  --sensor`, `make_joystick_blob.py`).

---

## 9. Test plan

- **Byte-locked codecs.** Every reply parser in `protocol.ts` is tested against
  the firmware control suite's golden bytes; the blob writers (TBL_MOUSE v3,
  TBL_JOYSTICK, TBL_ACTION_BINDING) against `make_mouse_blob.py` /
  `make_joystick_blob.py` output and the firmware decode goldens. A change on
  either side breaks both.
- **Fake RPC.** Discovery, device-document read/write, node views and the
  services run against a fake `RemapprRpc` that answers from real blobs built by
  the compilers, so the paths are covered end to end without hardware.
- **SENSOR goldens.** `sensor.test.ts` mirrors the firmware's
  `tests/sensor_settings/src/test_wire.c` replies; `remappr.sensor.test.ts`
  the TBL_SENSOR golden of `test_sensor_decode.c`.
- **Hardware.** Against a device flashed from the firmware repo,
  `control_cli.py info | get-inputs | joy-state | sensors | push` is the
  byte-level reference. The client's own stack runs on a DK without a browser
  through a Node `/dev/hidraw` transport (`remapprAdapter.connect`): the SENSOR
  path was checked that way on the PAW3395 mouse (live preview, discard, save,
  reset, gated refusal, lift calibration, readings).

---

## 10. Firmware and client gaps

1. **Editing through the dongle** — the sealed relay session exists in the
   client; it needs hardware proof before node views become writable.
2. **JOYSTICK namespace** — provisional (`ns_version` 0). It has run on
   hardware, over USB and through a dongle; the layouts are not frozen yet.
3. **Sealing** — mutating verbs go plaintext while control auth is
   dev-disabled; a product build seals them (RUCP §19).
4. **OTA over the wire** — not bound to a transport yet.
5. **Live combos / macros / tap-dance RPC** — they ship in the blob; no live
   verbs.
6. **SENSOR namespace** — provisional (`ns_version` 0) until the layouts
   freeze; the TBL_SENSOR layout is versioned like every table.
