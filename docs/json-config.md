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
  dongle is configured by its own device document instead (below).
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

## Device documents (non-keyboard devices)

A device that is not a keyboard has no keys or layers, so it is configured by a
separate, smaller document, `kind: "remappr.device"` (`src/config/device.ts`).
Today it covers the 2.4 GHz dongle; the mouse joins it later.

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

## Reserved / planned sections

- `lighting.perKey` — per-key colors (position → `"#rrggbb"`). Decoded from the
  RGB table today; the compile-side emit is planned (Phase 4c).
