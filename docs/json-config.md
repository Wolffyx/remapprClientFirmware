# Remappr keymap JSON — v2 reference

The keymap JSON is what the builder emits and what the `remappr` compiler turns
into an RMBC blob for the firmware. **v2** is the ergonomic, hand-authorable
surface. It is loaded through a lossless down-migration into the internal v1
surface (`src/config/migrate.ts`), so a v2 document and its verbose v1 spelling
compile to the **exact same bytes** — v2 adds no new wire capability, only easier
authoring.

A document is v2 when its root has `"version": 2` (or `"schemaVersion": 2`).
Anything else is treated as v1 and passes through untouched. Defaults are never
serialized — omit any field you are happy to leave at the firmware default.

`serializeKeymapV2()` writes this compact form (the mirror of the loader): a doc
saved with it and its verbose v1 spelling parse to identical bytes. The legacy
`serializeKeymap()` still emits v1.

> Status: this file tracks what the migration currently accepts. Sections marked
> _(planned)_ are reserved surface not yet wired.

## Skeleton

```jsonc
{
  "version": 2,
  "kind": "remappr.keymap",
  "meta": { "name": "My Board" },
  "defaults": { "tappingTermMs": 180 },
  "layers": [ { "name": "base", "keys": [ /* … */ ] } ]
}
```

`keyboard` geometry is optional: omit it and the position count is taken from the
longest layer's `keys` array (the builder supplies real geometry).

`defaults.quickTapMs` and `defaults.comboTimeoutMs` lower into every tap-hold /
combo that doesn't set its own — quick-tap has no global wire slot, so the
compiler stamps the default onto each record (an explicit per-item value, or an
explicit `quickTapMs: 0` meaning "no quick tap", always wins). `tappingTermMs`
rides the LAYER table's global slot; `defaults.debounce` maps to the §20 tail.

## Layers and the `keys` array

Each layer lists its bindings under `keys` (v1 called this `bindings`; both are
accepted). A binding is a **string** (a key or a compact action) or an
**object** (an explicit action or a tap-hold).

### Bare keys and modified keys

```jsonc
"A", "Space", "␣",            // a key (name, alias, or glyph)
"Ctrl+C", "LGui+Tab"          // a key with modifiers
```

### Keyword actions

| String | Action |
|---|---|
| `___` / `trans` | transparent (fall through) |
| `xxx` / `none` | inert (block fall-through) |
| `capsword` | caps-word |
| `repeat` | repeat last key |
| `altrepeat` | alternate-repeat |
| `bootloader`, `reset`, `softoff` | device actions |
| `graveescape` | grave / escape morph |
| `layerlock` | layer lock |

### `verb:arg` actions

| String | Action |
|---|---|
| `layer:nav` | momentary layer `nav` |
| `layer:game:toggle` | toggle layer (modes: `momentary`, `toggle`, `to`, `sticky`) |
| `mo:nav` / `tog:game` / `to:base` / `sl:sym` | layer mode shorthands |
| `sticky:LShift` (`sk:`) | one-shot modifier / key |
| `macro:email` | run macro `email` |
| `macro:greet(A)` | run one-param macro `greet` with arg `A` |
| `td:esc-caps` | tap-dance `esc-caps` |
| `mm:shift-del` | mod-morph `shift-del` |
| `ht:home-row(LGui,A)` | custom hold-tap `home-row` (hold `LGui`, tap `A`) |
| `mouse:left` | pointer button |
| `move:up` / `scroll:down` | pointer move / scroll |
| `key:<token>` | explicit keypress (escape hatch) |

An unknown verb is left as a raw string so validation reports it against the
real key token rather than silently dropping it.

### Tap-hold objects

```jsonc
{ "tap": "F", "hold": "LGui" }                       // hold a modifier
{ "tap": "Space", "hold": "layer:nav", "term": 200 } // hold a layer, custom term
```

`hold` accepts a friendly modifier name (`LGui` → `LEFT_GUI`) or `layer:<name>`.
Optional `term`/`tappingTermMs`, `quickTap`/`quickTapMs`, `requirePriorIdleMs`,
`retroTap`, `holdTriggerKeyPositions`, `flavor`, `resolve` — all round-trip
through compile + decode (`holdTriggerKeyPositions` rides the §28 poshold table).
`holdTriggerOnRelease` is accepted but has no wire bit yet; the compiler warns and
drops it until the firmware carries the flag (Phase 2).

## Behavior definitions (dictionaries)

Definitions are dictionaries keyed by id (v1 used `{ id, … }` arrays; both work).

### Macros

```jsonc
"macros": {
  "email": [ "text:me@example.com", "wait:50", "Enter" ],
  "greet": [ "H", "param", "!" ]
}
```

Step strings: a bare key = a tap; `tap:`/`press:`/`release:<key>`; `wait:<ms>`;
`text:<literal>`; `taptime:<ms>`; `param`; `pause`. Object steps also accepted.
Wrap a step list in `{ "steps": [...], "params": 1 }` to set param arity.

### Tap dances

```jsonc
"tapDances": {
  "esc-caps": { "1": "Esc", "2": "capsword", "timing": { "tappingTermMs": 200 } }
}
```

Numeric keys are tap counts; each value is an action string/object.

### Mod-morphs

```jsonc
"modMorphs": {
  "shift-del": { "on": ["LShift","RShift"], "base": "Backspace",
                 "morphed": "Delete", "keepMods": ["LShift"] }
}
```

### Custom hold-taps

```jsonc
"holdTaps": {
  "home-row": {
    "flavor": "balanced",
    "timing": { "tappingTermMs": 220, "quickTapMs": 150, "requirePriorIdleMs": 125 },
    "flags":  { "retroTap": true, "holdTriggerOnRelease": true },
    "positions": [13, 14, 15, 16]
  }
}
```

`holdTriggerOnRelease` requires a firmware build that carries the flag; older
firmware ignores it. The two inner behaviors default to key-presses.

## Combos and conditional layers

```jsonc
"combos": [ { "keys": [0, 5], "do": "Esc", "timeoutMs": 30, "layers": ["base"] } ],
"conditionalLayers": [ { "if": ["nav", "sym"], "then": "adjust" } ]
```

Combo `keys` are position indices; `do` is the action. _(Key-name resolution in
combos is planned.)_

## Autocorrect

```jsonc
"autocorrect": {
  "entries": [
    { "typo": "teh", "correction": "the" },
    { "typo": "recieve", "correction": "receive" }
  ]
}
```

Compiled into `TBL_AUTOCORRECT` (§5.2-E) as the reversed trie the device walks.
Typos match case-insensitively and may contain `a-z 0-9 ' -`; corrections may
also be capitalised. A typo may be at most 24 characters — the length of the
history the firmware keeps — and, because corrections are replayed through the
same alphabet, they cannot contain spaces.

The section is emitted whenever it is present: `"entries": []` writes an empty
table, which is how a device is told to **drop** a dictionary it already holds.
Omit the section entirely to leave the device's dictionary untouched.

Correction only happens while the `&autocorrect` toggle is on. The device turns
it on by itself when a non-empty dictionary is committed, so pushing a config
with entries is enough; bind `&autocorrect` (`off` / `toggle`) to a key to
control it afterwards.

`DEFAULT_AUTOCORRECT_ENTRIES` (and `defaultAutocorrectEntries()`) export a
starter English list. Note that the matcher has no right-hand word boundary — it
fires as soon as the typed run *ends with* an entry — so a typo that is the tail
of a correctly-spelled word (`wich` inside `sandwich`) will corrupt that word.
The shipped list avoids those; custom entries should too.

## Whole-node config sections

Beyond the keymap, a document can describe the entire node. These sections are
validated and round-trip verbatim (open shape — extra fields are preserved).
They do not affect the keymap blob yet; each is consumed by a later phase.

```jsonc
"node": {                       // per-personality node config
  "personality": "mouse",       // keyboard | mouse | joystick | dongle
  "mouse": { "cpi": 1600 }      // personality-specific settings, preserved
},
"firmware": {                   // per-target firmware settings, by target id
  "remappr": { "storage": "zms" },
  "zmk": { "combosMax": 16 }
},
"board": {                      // build-time board def (DT/Kconfig generator)
  "controller": "nucleo_u5a5zj_q",              // a known Zephyr board id, OR:
  // "controller": { "custom": true, "soc": "stm32u5a5zj", "name": "my_split" },
  "matrix": { "diode": "row2col", "rows": ["PA0"], "cols": ["PB0","PB1"] },
  "split": false, "storage": "zms"
}
```

- `node.personality` picks the node role: `keyboard` and `mouse` are written
  to the blob (TBL_PERSONALITY); a mouse node carries pointer settings. A
  dongle or a standalone mouse is configured by its own device document
  instead (below).
- `node.mouse` is the pointer block (TBL_MOUSE): `cpi`, `autoLayerTimeoutMs`,
  `accel` ([speedIn, multX100] points), and from table version 2 `invertX`,
  `invertY`, `invertWheel`, `invertHwheel`, `swapXY`, `scrollDivisor` (1..16)
  and `buttonMap` (8 entries, 0..7 or `null` to drop a button). The compiler
  writes version 1 unless a version-2 field differs from the default, so older
  firmware still reads it. A keyboard's key-driven pointer uses only the curve.
- `node.radio` holds the node's own 2.4 GHz link settings and is written to
  the blob (TBL_RADIO, id 26). Every field is optional; one left out keeps the
  firmware default, and an empty section writes no table. On a split board the
  main MCU forwards them to the radio chip.

  ```jsonc
  "node": {
    "radio": {
      "autoPair": true,       // arm pairing while unbonded (default on)
      "inputRepeats": 3,      // sends per input change, 1..8 (default 3)
      "keepaliveMs": 40,      // idle re-send period, 20..1000 (default 40)
      "beaconLossMs": 600     // no dongle beacon this long = link lost,
                              // 200..10000 (default 600)
    }
  }
  ```

  Keep `keepaliveMs` below the dongle's `failsafeMs` with room for one lost
  frame, or the dongle releases a key held without change. The two live on
  different devices, so the compiler cannot check that for you.
- `node.sensor.defaults` holds the product's defaults for the node's motion
  sensor, by registry name (the Remappr sensor registry,
  `include/dt-bindings/remappr/sensor.h`, mirrored in
  `src/clients/remappr/sensorRegistry.ts`). A BOOL takes a boolean, an INT a
  number, an ENUM its option name or code. A name the registry does not have
  is refused; an id with no name yet is written in hex (`"0x16": 1`).

  ```jsonc
  "node": {
    "personality": "mouse",
    "sensor": {
      "defaults": {
        "liftCutoff": "2mm",          // 1mm | 2mm | calibrated
        "angleSnap": false,
        "angleTune": -5,              // degrees
        "performanceMode": "corded",  // high | lowPower | office | corded
        "stayAwake": true
      }
    }
  }
  ```

  They reach the device twice. The `remappr-board` compiler builds them into
  the sensor's devicetree node as `remappr,setting-defaults` (with
  `board.sensor`, below), where they become the defaults the device reports
  and the app's Reset goes back to. The keymap compiler also writes them into
  TBL_SENSOR (id 29) for the first sensor, so firmware not built from this
  JSON runs them too. The device checks TBL_SENSOR strictly: a setting its
  sensor does not have, or a value out of its range, refuses the whole config.
  Which settings a sensor has is the device's to say (the SENSOR namespace);
  no list of them lives here.
- `firmware.<target>` namespaces settings so every registered firmware target's
  knobs are reachable. _(consumed per-target in a later phase)_
- `board` feeds the DT/Kconfig generator; `controller` accepts a known Zephyr
  board id or a custom board on any Zephyr-supported SoC. The `remappr-board`
  compiler emits a Zephyr shield from it — `boards/shields/<id>/<id>.overlay`
  (`remappr,kbd-matrix` + `input-keymap` + `remappr,keymap`) plus
  `Kconfig.shield`/`Kconfig.defconfig` (defaults `CONFIG_INPUT` + the settings
  backend from `storage`). `matrix.rows`/`cols` take raw `&gpioN pin FLAGS`
  specs (or friendly labels on a known controller); the matrix cells prefer an
  explicit `keyboard.hardware.transform` and warn when derived from geometry.
  Get it via `getCompiler('remappr-board')` or `buildProjectBundle(config,
  'remappr-board')`.
- `board.sensor` puts a motion sensor on an SPI bus of the board: `part` is its
  devicetree compatible, `bus` the bus's node label, `motion` (and optionally
  `cs`, `reset`) its pins, as raw `&gpioN pin FLAGS` specs or friendly labels;
  `spiMaxHz` defaults to 8 MHz. The shield gets the sensor's node with
  `node.sensor.defaults` as `remappr,setting-defaults`; its driver turns on
  from devicetree.

  ```jsonc
  "board": {
    "sensor": {
      "part": "pixart,paw3395",
      "bus": "arduino_spi",
      "cs": "&gpio1 12 GPIO_ACTIVE_LOW",   // leave out if the bus lists it first
      "motion": "&gpio1 10 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)",
      "reset": "&gpio1 11 GPIO_ACTIVE_LOW"
    }
  }
  ```

## Device documents (non-keyboard devices)

A device that is not a keyboard has no keys or layers, so it is configured by a
separate, smaller document, `kind: "remappr.device"` (`src/config/device.ts`).
It covers the 2.4 GHz dongle and the standalone mouse. Each personality takes
only its own sections; another device's section is refused.

```jsonc
{
  "schemaVersion": 1,
  "kind": "remappr.device",
  "meta": { "name": "Desk dongle" },
  "personality": "dongle",      // the device refuses a config for another one
  "dongle": {                   // every field optional: absent = firmware default
    "nkro": true,               // NKRO interface (true) or boot 6KRO (false)
    "pairWindowMs": 60000,      // 5000..600000, default 30000
    "pairDoneReplayMs": 2000,   // 0..30000
    "failsafeMs": 150,          // 50..2000, default 100: silent node -> keys up
    "rosterLiveMs": 2500,       // 100..60000, default 1500, not below failsafe
    "hidSubmitTimeoutMs": 2     // 0..50
  }
}
```

- `parseDeviceConfig(json)` validates it (the ranges match the firmware, so a
  config that parses is never refused by the dongle); `isDeviceConfig(json)`
  tells it apart from a keymap; `buildDeviceJsonSchema()` feeds the editor.
- `buildRemapprDeviceBlob(config, { configVersion })` writes TBL_PERSONALITY
  (dongle = 4) plus TBL_DONGLE (id 25). Push it to the dongle itself (target
  0) with the usual WRITE / VALIDATE / COMMIT verbs.
- `decodeRemapprDeviceBlob(bytes)` reads one back; it returns `DEVICE` for a
  blob made for another device and `MISSING` for one that names none.
- A live NKRO switch (DONGLE `SET_NKRO`) made after a config is saved stands
  until the next config that sets `nkro`.

A mouse document carries the pointer block (the same fields as `node.mouse`
above) and the radio block (as `node.radio`):

```jsonc
{
  "schemaVersion": 1,
  "kind": "remappr.device",
  "meta": { "name": "Travel mouse" },
  "personality": "mouse",
  "mouse": {
    "cpi": 1600,                // within the board's range (GET_MOTION_CONFIG)
    "accel": [[0, 100], [8, 150], [16, 200]],
    "invertWheel": true,
    "scrollDivisor": 2,
    "buttonMap": [1, 0, 2, 3, 4, 5, 6, null]  // swap left/right, drop button 8
  },
  "radio": { "keepaliveMs": 60 },
  "sensor": { "settings": { "liftCutoff": "2mm", "angleSnap": true } }
}
```

- `buildRemapprDeviceBlob` writes TBL_PERSONALITY (mouse = 2), TBL_MOUSE,
  TBL_RADIO and TBL_SENSOR; `decodeRemapprDeviceBlob` returns `personality`,
  `mouse`, `radio` and `sensor`. Push it to the mouse over USB, or through the
  dongle relay.
- `sensor.settings` holds the values the user set for the sensor, by registry
  name as `node.sensor.defaults` does; a setting left out stays on the
  device's default. `sensor.index` picks another of the device's sensors
  (default 0). Given the device's description of its sensors
  (`buildRemapprDeviceBlob(config, { configVersion, sensors })`; the mouse's
  `service.device.write` passes it), a setting the device would refuse is
  left out of the blob. A name nobody registered is kept in the document but
  never compiled. Read back, an option comes back as its code.
- The mouse's DPI range is the board's; the device refuses a `cpi` outside it.
- The MOUSE verbs (`SET_DPI`, `SET_ACCEL_PROFILE`, `SET_SCROLL_MODE`) are live
  tweaks that stand until a different config becomes active.
- The mouse firmware holds at most 8 curve points (`MOUSE_ACCEL_POINTS_MAX`)
  and refuses a config with more at VALIDATE.

From a connected service (the app's dongle and mouse pages):

- `service.device` reads the active document back (`read()`; a device with no
  stored config reads as a document with no settings) and pushes a new one
  (`write(config)`: validated, then WRITE / VALIDATE / COMMIT as universal
  frames at the next config_version). Present on a dongle or mouse with a
  config store.
- `service.motion` holds the live MOUSE verbs and `getConfig()` (DPI range and
  the values in force). Present on a mouse.
- `service.sensor` (SENSOR namespace, provisional) describes each sensor
  (`getSensors()`: its settings with type, range or options, unit, default
  and the value in force; its procedures and readings), sets a setting live
  (`setSetting`, until the next saved config), runs a procedure step by step
  (`runProcedure`, e.g. the lift calibration, whose result the unit keeps)
  and reads the readings (`getMetrics`). Present when the device lists the
  namespace. The mouse's device editor offers exactly the settings the
  sensor describes (`catalog.sensor.settings`) and previews each change
  live; a discard puts the previewed ones back.
- A mouse connected over USB comes up as `kind: 'mouse'`. A mouse opened from
  the dongle's roster is a read-only view: both facades read through the relay
  and every write rejects.
- `DONGLE_FIELDS`, `RADIO_FIELDS`, `MOUSE_SCROLL_DIVISOR_FIELD` and
  `MOUSE_BUTTON_NAMES` (`src/config/deviceFields.ts`) give editors each
  setting's range, unit and firmware default.

## Reserved / planned sections

- `lighting.perKey` — per-key colors (position → `"#rrggbb"`). Decoded from the
  RGB table today; the compile-side emit is planned (Phase 4c).
