// Pattern check: no GoF pattern (-) — rejected — zod surface-schema definitions + a cross-reference validation pass; declarative data, no GoF abstraction.
//
// The SURFACE schema — what a user writes in remappr.keymap.json. It is
// permissive on spelling (bare-string keys, mod_tap/layer_tap presets, "Ctrl+C"
// combo strings, a `layer` umbrella) and validates structure + cross-references.
// `normalizeKeymap` (normalize.ts) lowers a parsed surface doc into the single
// canonical form (types.ts) that the rest of the pipeline consumes.
//
// Every field carries .describe() — those strings are the single source for the
// code editor's hover tooltips (Phase B), read off the schema at build time.

import { z } from 'zod'
import { MODIFIERS, isKnownKeycode, isKnownKeyToken } from './keycodes'

/* ── leaf vocabularies ─────────────────────────────────────────────────── */

export const ModifierSchema = z.enum(MODIFIERS)

export const ResolveSchema = z
    .enum(['timeout', 'prefer-hold', 'prefer-tap'])
    .describe(
        'Tap/hold interrupt policy. timeout = decide by timer; prefer-hold = hold if another key is pressed in-window; prefer-tap = tap unless held past the timer uninterrupted.',
    )

export const FlavorSchema = z
    .enum([
        'hold-preferred',
        'balanced',
        'tap-preferred',
        'tap-unless-interrupted',
    ])
    .describe('Hold-tap interrupt flavor (ZMK devicetree value).')

export const LightingTargetSchema = z
    .enum(['underglow', 'backlight', 'per_key'])
    .describe('Lighting axis — firmware-gated (per_key is QMK/Keychron only).')

export const LightingActionSchema = z.enum([
    'toggle',
    'on',
    'off',
    'brightness_up',
    'brightness_down',
    'hue_up',
    'hue_down',
    'saturation_up',
    'saturation_down',
    'effect_next',
    'effect_previous',
    'speed_up',
    'speed_down',
    'cycle',
    'color',
    'set',
])

export const OutputActionSchema = z
    .enum([
        'usb',
        'bluetooth',
        'bluetooth_clear',
        'bluetooth_next',
        'bluetooth_prev',
        'bluetooth_disconnect',
        'toggle',
        'none',
    ])
    .describe('Output routing. Wireless (bluetooth*) needs a BLE backend.')

export const PowerActionSchema = z
    .enum(['toggle', 'on', 'off'])
    .describe('External-power control (e.g. gating peripheral power / LEDs).')

export const LockActionSchema = z
    .enum(['off', 'on', 'toggle'])
    .describe('Lock toggle shared by gui_lock / secure / autocorrect.')

export const PeripheralKindSchema = z
    .enum([
        'encoder',
        'dipswitch',
        'haptic',
        'audio',
        'joystick',
        'midi',
        'steno',
        'sequencer',
        'wpm',
        'rawhid',
    ])
    .describe('Hardware-peripheral verb family (peripheral catch-all).')

export const MouseButtonSchema = z
    .enum(['left', 'right', 'middle', 'mb4', 'mb5'])
    .describe('Pointer button to click.')

export const DirectionSchema = z
    .enum(['up', 'down', 'left', 'right'])
    .describe('Pointer move / scroll direction.')

export const LayerModeSchema = z
    .enum(['momentary', 'toggle', 'to', 'sticky'])
    .describe(
        'momentary = active while held; toggle = flip on/off; to = switch to this layer; sticky = active for the next key only.',
    )

/** A single keycode token: "A", "Space", "KC_BSPC", or a canonical id. */
export const KeycodeSchema = z
    .string()
    .min(1)
    .superRefine((s, ctx) => {
        if (!isKnownKeycode(s)) {
            ctx.addIssue({ code: 'custom', message: `unknown keycode "${s}"` })
        }
    })
    .describe('A keycode by friendly name, firmware alias, or canonical id.')

/** A bare-string binding: a single key OR a "Ctrl+Shift+C" combo string. */
export const KeyTokenSchema = z
    .string()
    .min(1)
    .superRefine((s, ctx) => {
        if (!isKnownKeyToken(s)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown key or modifier in "${s}"`,
            })
        }
    })

/* ── sub-targets ───────────────────────────────────────────────────────── */

export const KeyPressSchema = z
    .object({
        type: z.literal('key_press'),
        key: KeycodeSchema,
        mods: z.array(ModifierSchema).optional(),
    })
    .describe('A plain (optionally modified) keypress.')

/** Tap target of a tap_hold/preset: a bare key string or an explicit key_press. */
export const TapTargetSchema = z.union([KeyTokenSchema, KeyPressSchema])

export const HoldTargetSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('modifier'), modifier: ModifierSchema }),
    z.object({ type: z.literal('layer'), layer: z.string() }),
])

const tapHoldTimings = {
    tappingTermMs: z.number().int().positive().optional(),
    quickTapMs: z.number().int().nonnegative().optional(),
    resolve: ResolveSchema.optional(),
    flavor: FlavorSchema.optional(),
}

/* ── the surface action union ──────────────────────────────────────────── */

export const ActionObjectSchema = z.discriminatedUnion('type', [
    KeyPressSchema,

    z
        .object({
            type: z.literal('tap_hold'),
            tap: TapTargetSchema,
            hold: HoldTargetSchema,
            ...tapHoldTimings,
        })
        .describe('General tap/hold: tap does one thing, hold another.'),

    // Friendly presets — both lower to tap_hold.
    z
        .object({
            type: z.literal('mod_tap'),
            tap: TapTargetSchema,
            mod: ModifierSchema,
            ...tapHoldTimings,
        })
        .describe('Mod-Tap preset: tap = key, hold = a modifier.'),
    z
        .object({
            type: z.literal('layer_tap'),
            tap: TapTargetSchema,
            layer: z.string(),
            ...tapHoldTimings,
        })
        .describe('Layer-Tap preset: tap = key, hold = a layer.'),

    z
        .object({
            type: z.literal('layer'),
            mode: LayerModeSchema,
            layer: z.string(),
        })
        .describe('Layer switch (mode picks momentary/toggle/to/sticky).'),

    z
        .object({ type: z.literal('sticky_key'), key: KeycodeSchema })
        .describe('One-shot key: applies to the next keypress only.'),

    z.object({ type: z.literal('caps_word') }).describe('Caps for one word.'),
    z
        .object({ type: z.literal('transparent') })
        .describe('Fall through to the layer below.'),
    z
        .object({ type: z.literal('none') })
        .describe('Explicitly inert — blocks fall-through.'),

    z
        .object({
            type: z.literal('output'),
            action: OutputActionSchema,
            profile: z.number().int().nonnegative().optional(),
        })
        .describe(
            'Output routing. profile is valid only with action "bluetooth".',
        ),

    z.object({
        type: z.literal('lighting'),
        target: LightingTargetSchema,
        action: LightingActionSchema,
        hue: z.number().int().min(0).max(360).optional(),
        saturation: z.number().int().min(0).max(100).optional(),
        brightness: z.number().int().min(0).max(100).optional(),
        level: z.number().int().min(0).max(100).optional(),
    }),

    z
        .object({ type: z.literal('bootloader') })
        .describe('Reboot into bootloader.'),
    z.object({ type: z.literal('reset') }).describe('Reset the keyboard.'),

    z
        .object({
            type: z.literal('macro'),
            ref: z.string(),
            param: KeycodeSchema.optional(),
        })
        .describe('Run a named macro; `param` feeds a one-param macro.'),
    z
        .object({ type: z.literal('tap_dance'), ref: z.string() })
        .describe('Run a named tap-dance.'),
    z
        .object({ type: z.literal('mod_morph'), ref: z.string() })
        .describe(
            'Run a named mod-morph (sends one binding, or another while a modifier is held).',
        ),
    z
        .object({
            type: z.literal('hold_tap'),
            ref: z.string(),
            holdParam: z.string(),
            tapParam: z.string(),
        })
        .describe(
            'Invoke a named custom hold-tap; holdParam/tapParam feed its two inner bindings.',
        ),

    z
        .object({ type: z.literal('soft_off') })
        .describe('Power off until a hardware reset / dedicated on key.'),
    z
        .object({ type: z.literal('studio_unlock') })
        .describe('Unlock the keyboard for ZMK Studio live editing.'),
    z
        .object({ type: z.literal('grave_escape') })
        .describe('Esc normally; Shift/GUI + this sends grave/tilde.'),
    z
        .object({ type: z.literal('key_repeat') })
        .describe('Repeat the previously pressed key.'),
    z
        .object({ type: z.literal('key_toggle'), key: KeycodeSchema })
        .describe('Toggle a key: press once to latch down, again to release.'),
    z
        .object({ type: z.literal('ext_power'), action: PowerActionSchema })
        .describe('Control external/peripheral power.'),
    z
        .object({ type: z.literal('mouse_key'), button: MouseButtonSchema })
        .describe('Click a pointer button.'),
    z
        .object({ type: z.literal('mouse_move'), direction: DirectionSchema })
        .describe('Move the pointer.'),
    z
        .object({ type: z.literal('mouse_scroll'), direction: DirectionSchema })
        .describe('Scroll the pointer wheel.'),
    // pattern-check: skip — §5.2 vocabulary arms, mechanical discriminated-union extension
    z
        .object({
            type: z.literal('auto_shift'),
            key: KeycodeSchema,
            mods: z.array(ModifierSchema),
        })
        .describe('Tap the key; hold past the term adds the modifiers.'),
    z
        .object({ type: z.literal('alt_repeat') })
        .describe('Emit the directional opposite of the last key.'),
    z
        .object({ type: z.literal('layer_lock') })
        .describe('Pin the current top layer until re-pressed.'),
    z
        .object({
            type: z.literal('layer_mod'),
            layer: z.string(),
            mods: z.array(ModifierSchema),
        })
        .describe('Momentary layer with the given modifiers held.'),
    z
        .object({ type: z.literal('tap_toggle'), layer: z.string() })
        .describe('Tap toggles the layer; hold makes it momentary.'),
    z
        .object({ type: z.literal('set_base_saved'), layer: z.string() })
        .describe('Switch the base layer and persist it across reboot.'),
    z
        .object({ type: z.literal('auto_layer'), layer: z.string() })
        .describe('Toggle a temporary layer while the pointer is active.'),
    z
        .object({ type: z.literal('gui_lock'), action: LockActionSchema })
        .describe('Mask the GUI/Win modifiers (gaming lock).'),
    z
        .object({ type: z.literal('secure'), action: LockActionSchema })
        .describe('Swallow input until the keyboard is unlocked.'),
    z
        .object({ type: z.literal('autocorrect'), action: LockActionSchema })
        .describe('Toggle on-device autocorrect.'),
    z
        .object({
            type: z.literal('tune_tap_term'),
            ms: z.number().int().nonnegative(),
        })
        .describe('Live-tune the tap/hold term (ms; 0 = keymap default).'),
    z
        .object({
            type: z.literal('unicode'),
            codepoint: z.number().int().min(0).max(0xffff),
        })
        .describe('Emit a BMP Unicode codepoint.'),
    z
        .object({
            type: z.literal('macro_record'),
            slot: z.number().int().nonnegative(),
        })
        .describe('Toggle recording into a dynamic-macro slot.'),
    z
        .object({
            type: z.literal('macro_play'),
            slot: z.number().int().nonnegative(),
        })
        .describe('Replay a recorded dynamic-macro slot.'),
    z
        .object({
            type: z.literal('leader'),
            windowMs: z.number().int().nonnegative().optional(),
        })
        .describe('Start a leader sequence (capture window in ms).'),
    z
        .object({
            type: z.literal('peripheral'),
            kind: PeripheralKindSchema,
            code: z.number().int().nonnegative(),
        })
        .describe('Fire a hardware-peripheral verb (kind + code).'),
])

export const ActionSchema = z.union([KeyTokenSchema, ActionObjectSchema])

/* ── structure ─────────────────────────────────────────────────────────── */

export const GeometrySchema = z.object({
    // x/y default to 0 so a config can omit them (a key at the origin, or in
    // row/col 0): normalize fills them back. See firmware/config/defaults.ts.
    x: z.number().default(0),
    y: z.number().default(0),
    w: z.number().positive().default(1),
    h: z.number().positive().default(1),
    r: z.number().default(0),
    rx: z.number().optional(),
    ry: z.number().optional(),
    matrix: z
        .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
        .optional()
        .describe(
            'Electrical matrix position [row, col]; authoritative when set, else derived from geometry on export.',
        ),
    variant: z
        .string()
        .optional()
        .describe(
            'Physical-layout variant id this key belongs to ("" = common).',
        ),
    pin: z
        .string()
        .optional()
        .describe('Optional per-key direct GPIO pin label (builder metadata).'),
    element: z
        .enum(['encoder', 'slider'])
        .optional()
        .describe('Input element type (absent = key); builder metadata.'),
    option: z
        .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
        .optional()
        .describe(
            'VIA/Vial layout-option tag [group, choice]; key exists only for that choice.',
        ),
})

export const EncoderSchema = z.object({ x: z.number(), y: z.number() })

export const EncoderBindingSchema = z.object({
    cw: ActionSchema,
    ccw: ActionSchema,
    press: ActionSchema.optional(),
})

export const SliderBindingSchema = z.object({
    map: z.enum(['volume', 'brightness', 'mouse_wheel', 'custom']),
    min: z.number().optional(),
    max: z.number().optional(),
    action: ActionSchema.optional(),
})

export const LayerSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    bindings: z.array(ActionSchema),
    encoders: z.array(EncoderBindingSchema).optional(),
    encoderBindings: z.record(z.string(), EncoderBindingSchema).optional(),
    sliderBindings: z.record(z.string(), SliderBindingSchema).optional(),
})

export const ComboSchema = z.object({
    name: z.string(),
    keys: z.array(z.number().int().nonnegative()).min(2),
    action: ActionSchema,
    timeoutMs: z.number().int().positive().optional(),
    layers: z.array(z.string()).optional(),
})

export const TapDanceSchema = z.object({
    id: z.string(),
    description: z.string().optional(),
    tappingTermMs: z.number().int().positive().optional(),
    taps: z
        .array(
            z.object({
                count: z.number().int().positive(),
                action: ActionSchema,
            }),
        )
        .min(1),
    hold: HoldTargetSchema.optional(),
})

export const MacroStepSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('tap'), key: KeycodeSchema }),
    z.object({ type: z.literal('press'), key: KeycodeSchema }),
    z.object({ type: z.literal('release'), key: KeycodeSchema }),
    z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }),
    z.object({ type: z.literal('text'), text: z.string() }),
    z
        .object({
            type: z.literal('param'),
            from: z.union([z.literal(1), z.literal(2)]).optional(),
            to: z.union([z.literal(1), z.literal(2)]).optional(),
        })
        .describe(
            'Forward a macro argument to the next behavior (&macro_param_<from>to<to>); defaults 1→1.',
        ),
    z
        .object({
            type: z.literal('tap_time'),
            ms: z.number().int().positive(),
        })
        .describe('Override how long tapped behaviors are held.'),
    z
        .object({ type: z.literal('pause_for_release') })
        .describe('Wait for the triggering key to be released.'),
])

export const MacroSchema = z.object({
    id: z.string(),
    description: z.string().optional(),
    params: z
        .union([z.literal(0), z.literal(1), z.literal(2)])
        .optional()
        .describe('Binding-cells: 0 = plain, 1 = one-param, 2 = two-param.'),
    steps: z.array(MacroStepSchema).min(1),
})

export const HoldTapDefSchema = z
    .object({
        id: z.string(),
        description: z.string().optional(),
        flavor: FlavorSchema.optional(),
        tappingTermMs: z.number().int().positive().optional(),
        quickTapMs: z.number().int().nonnegative().optional(),
        requirePriorIdleMs: z.number().int().nonnegative().optional(),
        holdTriggerKeyPositions: z
            .array(z.number().int().nonnegative())
            .optional(),
        holdTriggerOnRelease: z.boolean().optional(),
        retroTap: z.boolean().optional(),
        bindings: z.tuple([z.string(), z.string()]),
    })
    .describe(
        'Custom hold-tap: bindings are the two inner behavior tokens (e.g. "&kp", "&mo").',
    )

export const ModMorphSchema = z
    .object({
        id: z.string(),
        description: z.string().optional(),
        mods: z.array(ModifierSchema).min(1),
        keepMods: z.array(ModifierSchema).optional(),
        bindings: z.tuple([ActionSchema, ActionSchema]),
    })
    .describe(
        'Mod-morph: bindings[0] normally, bindings[1] while any `mods` modifier is held.',
    )

export const ConditionalLayerSchema = z
    .object({
        ifLayers: z.array(z.string()).min(1),
        thenLayer: z.string(),
    })
    .describe(
        'Activate thenLayer while every layer in ifLayers is simultaneously active.',
    )

/* ── board hardware (kscan wiring + electrical transform) ──────────────── */

/** A raw devicetree GPIO phandle+specifier, kept verbatim. */
export const GpioSpecSchema = z
    .string()
    .min(1)
    .describe(
        'Devicetree GPIO spec, e.g. "&gpio0 4 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)".',
    )

export const KscanSchema = z
    .discriminatedUnion('type', [
        z.object({
            type: z.literal('matrix'),
            diodeDirection: z.enum(['row2col', 'col2row']),
            rowGpios: z.array(GpioSpecSchema).min(1),
            colGpios: z.array(GpioSpecSchema).min(1),
            debouncePressMs: z.number().int().nonnegative().optional(),
            debounceReleaseMs: z.number().int().nonnegative().optional(),
        }),
        z.object({
            type: z.literal('direct'),
            inputGpios: z.array(GpioSpecSchema).min(1),
            debouncePressMs: z.number().int().nonnegative().optional(),
            debounceReleaseMs: z.number().int().nonnegative().optional(),
        }),
    ])
    .describe(
        'Key-scan wiring: matrix (row/col GPIOs) or direct (one per key).',
    )

export const MatrixTransformSchema = z
    .object({
        rows: z.number().int().positive(),
        columns: z.number().int().positive(),
        map: z
            .array(
                z.tuple([
                    z.number().int().nonnegative(),
                    z.number().int().nonnegative(),
                ]),
            )
            .min(1),
    })
    .describe(
        'Real electrical matrix-transform: [row, col] per key in binding order.',
    )

// pattern-check: skip declarative zod schemas mirroring config DTOs, no abstraction
export const BacklightPwmSchema = z
    .object({
        instance: z.string(),
        channel: z.number().int().nonnegative(),
        pin: z.string(),
        inverted: z.boolean().optional(),
        periodMs: z.number().positive().optional(),
    })
    .describe('Backlight PWM peripheral (drives zmk,backlight).')

export const Ws2812Schema = z
    .object({
        spi: z.string(),
        dataPin: z.string(),
        chainLength: z.number().int().positive(),
        colorOrder: z.enum(['GRB', 'RGB', 'BGR', 'RGBW', 'GRBW']).optional(),
        spiMaxFrequency: z.number().int().positive().optional(),
    })
    .describe(
        'WS2812 underglow strip on an SPI peripheral (drives zmk,underglow).',
    )

export const ExtPowerCtrlSchema = z
    .object({
        controlGpio: z.string(),
        activeLow: z.boolean().optional(),
        initDelayMs: z.number().int().nonnegative().optional(),
    })
    .describe('zmk,ext-power-generic control GPIO (drives zmk,ext-power).')

export const HardwareSchema = z
    .object({
        board: z.string().optional(),
        shield: z.string().optional(),
        kscan: KscanSchema.optional(),
        transform: MatrixTransformSchema.optional(),
        backlightPwm: BacklightPwmSchema.optional(),
        ws2812: Ws2812Schema.optional(),
        extPowerCtrl: ExtPowerCtrlSchema.optional(),
        studioAcm: z.boolean().optional(),
    })
    .describe(
        'Board hardware (kscan + electrical transform + peripheral pins + target) for a flashable export.',
    )

export const FirmwareConfigSchema = z
    .object({
        usb: z.boolean().optional(),
        ble: z.boolean().optional(),
        studio: z.boolean().optional(),
        studioLocking: z.boolean().optional(),
        studioUsbCdc: z.boolean().optional(),
        softOff: z.boolean().optional(),
        extPower: z.boolean().optional(),
        pointing: z.boolean().optional(),
        backlight: z.boolean().optional(),
        underglow: z.boolean().optional(),
        usbLogging: z.boolean().optional(),
        kconfig: z.string().optional(),
        configH: z.string().optional(),
        rulesMk: z.string().optional(),
    })
    .describe(
        'Firmware feature toggles (tri-state: undefined = auto-derive) + free-text .conf/config.h overrides.',
    )

export const ControllerSchema = z
    .object({
        board: z.string().optional(),
        shield: z.string().optional(),
        processor: z.string().optional(),
        bootloader: z.string().optional(),
        developmentBoard: z.string().optional(),
        deviceVersion: z.string().optional(),
    })
    .describe(
        'Controller / MCU identity: ZMK board/shield · QMK processor/bootloader/board/development_board · USB device version.',
    )

export const VialSchema = z
    .object({
        uid: z
            .array(z.number().int().min(0).max(255))
            .length(8)
            .optional()
            .describe('8-byte Vial keyboard UID.'),
        unlockKeys: z
            .array(
                z.tuple([
                    z.number().int().nonnegative(),
                    z.number().int().nonnegative(),
                ]),
            )
            .optional()
            .describe('Matrix positions [row, col] of the unlock combo.'),
        insecure: z.boolean().optional(),
    })
    .describe(
        'Vial security identity: keyboard UID + unlock combo (emitted to the vial keymap config.h).',
    )

/* ── builder board metadata (lighting + layout variants) ───────────────── */

export const LightingSchema = z
    .object({
        underglow: z
            .object({
                effect: z.string().optional(),
                hue: z.number().int().min(0).max(360).optional(),
                brightness: z.number().int().min(0).max(100).optional(),
            })
            .optional(),
        backlight: z
            .object({
                brightness: z.number().int().min(0).max(100).optional(),
                breathing: z.boolean().optional(),
            })
            .optional(),
    })
    .describe(
        'Board-level lighting config from the builder (export-only metadata).',
    )

export const LayoutSchema = z
    .object({ id: z.string(), name: z.string() })
    .describe('A named physical-layout variant; keys tag in via `variant`.')

export const LayoutOptionSchema = z
    .object({
        label: z.string(),
        choices: z.array(z.string()).optional(),
    })
    .describe(
        'A VIA/Vial layout option (boolean toggle, or multi-choice when `choices` is set).',
    )

const BaseKeymapSchema = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('remappr.keymap'),
    meta: z.object({
        name: z.string(),
        author: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        target: z.enum(['zmk', 'qmk', 'keychron']).nullable().default(null),
        vendorId: z
            .string()
            .optional()
            .describe('USB vendor id, hex string e.g. "0xFEED".'),
        productId: z
            .string()
            .optional()
            .describe('USB product id, hex string e.g. "0x0001".'),
    }),
    defaults: z
        .object({
            tappingTermMs: z.number().int().positive().optional(),
            quickTapMs: z.number().int().nonnegative().optional(),
            comboTimeoutMs: z.number().int().positive().optional(),
        })
        .optional(),
    keyboard: z.object({
        id: z.string(),
        name: z.string(),
        keys: z.array(GeometrySchema).min(1),
        encoders: z.array(EncoderSchema).optional(),
        matrix: z
            .object({
                rows: z.number().int().positive(),
                cols: z.number().int().positive(),
                diodeDirection: z.enum(['row2col', 'col2row']).optional(),
                mode: z.enum(['matrix', 'direct']).optional(),
            })
            .optional()
            .describe(
                'Board matrix descriptor: dimensions + diode direction + scan mode.',
            ),
        controller: ControllerSchema.optional(),
        vial: VialSchema.optional(),
        hardware: HardwareSchema.optional(),
        pins: z
            .object({
                rows: z.array(z.string()),
                cols: z.array(z.string()),
            })
            .optional()
            .describe(
                'Friendly row/column GPIO labels (e.g. "GP4"), index-aligned to the transform.',
            ),
        firmware: z
            .array(z.string())
            .optional()
            .describe(
                'Raw builder firmware targets (qmk/via/vial/zmk); via/vial compile via QMK.',
            ),
        lighting: LightingSchema.optional(),
        firmwareConfig: FirmwareConfigSchema.optional(),
        layouts: z.array(LayoutSchema).optional(),
        layoutOptions: z.array(LayoutOptionSchema).optional(),
        split: z
            .boolean()
            .optional()
            .describe('Two-piece / split keyboard (builder capability flag).'),
    }),
    layers: z.array(LayerSchema).min(1),
    combos: z.array(ComboSchema).optional(),
    tapDances: z.array(TapDanceSchema).optional(),
    macros: z.array(MacroSchema).optional(),
    modMorphs: z.array(ModMorphSchema).optional(),
    holdTaps: z.array(HoldTapDefSchema).optional(),
    conditionalLayers: z.array(ConditionalLayerSchema).optional(),
})

/* ── cross-reference + structural checks ───────────────────────────────── */

type SurfaceAction = z.infer<typeof ActionSchema>

export const KeymapSchema = BaseKeymapSchema.superRefine((km, ctx) => {
    const layerNames = new Set(km.layers.map((l) => l.name))
    const macroIds = new Set((km.macros ?? []).map((m) => m.id))
    const danceIds = new Set((km.tapDances ?? []).map((t) => t.id))
    const morphIds = new Set((km.modMorphs ?? []).map((m) => m.id))
    const holdTapIds = new Set((km.holdTaps ?? []).map((h) => h.id))
    const keyCount = km.keyboard.keys.length
    const encCount = km.keyboard.encoders?.length ?? 0

    // Pattern check: no GoF pattern (-) — rejected — declarative cross-reference
    // checks appended to the existing superRefine; data validation, no abstraction.
    // hardware: the electrical transform must cover every key, its RC() indices
    // must fit the declared matrix size, and (for a matrix kscan) that size must
    // agree with the GPIO counts.
    const hw = km.keyboard.hardware
    if (hw?.transform) {
        const { rows, columns, map } = hw.transform
        if (map.length !== keyCount) {
            ctx.addIssue({
                code: 'custom',
                message: `matrix-transform map has ${map.length} entries but the board has ${keyCount} keys`,
                path: ['keyboard', 'hardware', 'transform', 'map'],
            })
        }
        map.forEach(([r, c], i) => {
            if (r >= rows || c >= columns) {
                ctx.addIssue({
                    code: 'custom',
                    message: `matrix-transform entry RC(${r},${c}) is out of range for ${rows}×${columns}`,
                    path: ['keyboard', 'hardware', 'transform', 'map', i],
                })
            }
        })
        if (hw.kscan?.type === 'matrix') {
            if (hw.kscan.rowGpios.length !== rows) {
                ctx.addIssue({
                    code: 'custom',
                    message: `matrix-transform declares ${rows} rows but kscan has ${hw.kscan.rowGpios.length} row GPIOs`,
                    path: ['keyboard', 'hardware', 'transform', 'rows'],
                })
            }
            if (hw.kscan.colGpios.length !== columns) {
                ctx.addIssue({
                    code: 'custom',
                    message: `matrix-transform declares ${columns} columns but kscan has ${hw.kscan.colGpios.length} column GPIOs`,
                    path: ['keyboard', 'hardware', 'transform', 'columns'],
                })
            }
        }
    }
    if (
        hw?.kscan?.type === 'direct' &&
        hw.kscan.inputGpios.length !== keyCount
    ) {
        ctx.addIssue({
            code: 'custom',
            message: `direct kscan has ${hw.kscan.inputGpios.length} input GPIOs but the board has ${keyCount} keys`,
            path: ['keyboard', 'hardware', 'kscan', 'inputGpios'],
        })
    }

    const layerRef = (name: string, path: (string | number)[]): void => {
        if (!layerNames.has(name)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown layer "${name}"`,
                path,
            })
        }
    }

    const checkAction = (b: SurfaceAction, p: (string | number)[]): void => {
        if (typeof b === 'string') return // bare key/combo — no refs to check
        if (b.type === 'tap_hold' && b.hold.type === 'layer') {
            layerRef(b.hold.layer, [...p, 'hold', 'layer'])
        }
        if (b.type === 'layer_tap') layerRef(b.layer, [...p, 'layer'])
        if (b.type === 'layer') layerRef(b.layer, [...p, 'layer'])
        if (b.type === 'macro' && !macroIds.has(b.ref)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown macro "${b.ref}"`,
                path: [...p, 'ref'],
            })
        }
        if (b.type === 'tap_dance' && !danceIds.has(b.ref)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown tap dance "${b.ref}"`,
                path: [...p, 'ref'],
            })
        }
        if (b.type === 'mod_morph' && !morphIds.has(b.ref)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown mod-morph "${b.ref}"`,
                path: [...p, 'ref'],
            })
        }
        if (b.type === 'hold_tap' && !holdTapIds.has(b.ref)) {
            ctx.addIssue({
                code: 'custom',
                message: `unknown hold-tap "${b.ref}"`,
                path: [...p, 'ref'],
            })
        }
        if (
            b.type === 'output' &&
            b.action !== 'bluetooth' &&
            b.action !== 'bluetooth_disconnect' &&
            b.profile !== undefined
        ) {
            ctx.addIssue({
                code: 'custom',
                message: `profile is only valid with action "bluetooth" or "bluetooth_disconnect"`,
                path: [...p, 'profile'],
            })
        }
        if (b.type === 'lighting') {
            // 'color' needs an HSB triple; 'set' needs a level (done here rather
            // than on the object schema, which must stay a plain discriminated
            // union member).
            if (
                b.action === 'color' &&
                (b.hue === undefined ||
                    b.saturation === undefined ||
                    b.brightness === undefined)
            ) {
                ctx.addIssue({
                    code: 'custom',
                    message:
                        'lighting action "color" requires hue, saturation and brightness',
                    path: [...p, 'action'],
                })
            }
            if (b.action === 'set' && b.level === undefined) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'lighting action "set" requires a level',
                    path: [...p, 'action'],
                })
            }
        }
    }

    km.layers.forEach((layer, li) => {
        // A layer may UNDER-specify bindings: trailing transparents are dropped
        // on serialize and padded back on normalize, so fewer-than-keyCount is
        // valid (the gap is implicitly transparent). Only MORE than keyCount —
        // bindings with no key to land on — is an error.
        if (layer.bindings.length > keyCount) {
            ctx.addIssue({
                code: 'custom',
                message: `layer "${layer.name}" has ${layer.bindings.length} bindings but the board has only ${keyCount} keys`,
                path: ['layers', li, 'bindings'],
            })
        }
        if (layer.encoders && layer.encoders.length !== encCount) {
            ctx.addIssue({
                code: 'custom',
                message: `layer "${layer.name}" has ${layer.encoders.length} encoder bindings but the board has ${encCount} encoders`,
                path: ['layers', li, 'encoders'],
            })
        }
        layer.bindings.forEach((b, bi) =>
            checkAction(b, ['layers', li, 'bindings', bi]),
        )
        layer.encoders?.forEach((e, ei) => {
            checkAction(e.cw, ['layers', li, 'encoders', ei, 'cw'])
            checkAction(e.ccw, ['layers', li, 'encoders', ei, 'ccw'])
            if (e.press)
                checkAction(e.press, ['layers', li, 'encoders', ei, 'press'])
        })
        Object.entries(layer.encoderBindings ?? {}).forEach(([k, e]) => {
            const ki = Number(k)
            if (!Number.isInteger(ki) || ki < 0 || ki >= keyCount) {
                ctx.addIssue({
                    code: 'custom',
                    message: `layer "${layer.name}" has an encoder binding for key ${k}, out of range 0..${keyCount - 1}`,
                    path: ['layers', li, 'encoderBindings', k],
                })
                return
            }
            checkAction(e.cw, ['layers', li, 'encoderBindings', k, 'cw'])
            checkAction(e.ccw, ['layers', li, 'encoderBindings', k, 'ccw'])
            if (e.press)
                checkAction(e.press, [
                    'layers',
                    li,
                    'encoderBindings',
                    k,
                    'press',
                ])
        })
        Object.entries(layer.sliderBindings ?? {}).forEach(([k, s]) => {
            const ki = Number(k)
            if (!Number.isInteger(ki) || ki < 0 || ki >= keyCount) {
                ctx.addIssue({
                    code: 'custom',
                    message: `layer "${layer.name}" has a slider binding for key ${k}, out of range 0..${keyCount - 1}`,
                    path: ['layers', li, 'sliderBindings', k],
                })
                return
            }
            if (s.min !== undefined && s.max !== undefined && s.min > s.max) {
                ctx.addIssue({
                    code: 'custom',
                    message: `slider binding for key ${k} has min ${s.min} > max ${s.max}`,
                    path: ['layers', li, 'sliderBindings', k, 'min'],
                })
            }
            if (s.action)
                checkAction(s.action, [
                    'layers',
                    li,
                    'sliderBindings',
                    k,
                    'action',
                ])
        })
    })
    ;(km.combos ?? []).forEach((combo, ci) => {
        combo.keys.forEach((k, ki) => {
            if (k >= keyCount) {
                ctx.addIssue({
                    code: 'custom',
                    message: `combo "${combo.name}" references key ${k}, out of range 0..${keyCount - 1}`,
                    path: ['combos', ci, 'keys', ki],
                })
            }
        })
        checkAction(combo.action, ['combos', ci, 'action'])
        ;(combo.layers ?? []).forEach((ln, lni) =>
            layerRef(ln, ['combos', ci, 'layers', lni]),
        )
    })
    ;(km.tapDances ?? []).forEach((td, ti) => {
        td.taps.forEach((t, tj) =>
            checkAction(t.action, ['tapDances', ti, 'taps', tj, 'action']),
        )
    })
    ;(km.modMorphs ?? []).forEach((mm, mi) => {
        mm.bindings.forEach((b, bi) =>
            checkAction(b, ['modMorphs', mi, 'bindings', bi]),
        )
    })
    ;(km.conditionalLayers ?? []).forEach((cl, ci) => {
        cl.ifLayers.forEach((ln, li) =>
            layerRef(ln, ['conditionalLayers', ci, 'ifLayers', li]),
        )
        layerRef(cl.thenLayer, ['conditionalLayers', ci, 'thenLayer'])
    })
})

/* ── types + helpers ───────────────────────────────────────────────────── */

export type SurfaceKeymap = z.infer<typeof KeymapSchema>
export type { SurfaceAction }

/** Surface action `type` names for the editor palette (bare keys map to key_press). */
export const ACTION_TYPES = [
    'key_press',
    ...ActionObjectSchema.options.map((o) => o.shape.type.value),
] as const

/**
 * Migrate a raw (pre-validation) object to the current schema version. Stub
 * today (only v1 exists); the seam keeps future bumps additive.
 */
export function migrate(raw: unknown): unknown {
    return raw
}

/** Parse + validate JSON source into a validated SURFACE doc. Throws on invalid. */
export function parseSurface(source: string): SurfaceKeymap {
    return KeymapSchema.parse(migrate(JSON.parse(source)))
}

/** Non-throwing variant — returns the SafeParse result for UI error surfacing. */
export function safeParseSurface(
    source: string,
): z.ZodSafeParseResult<SurfaceKeymap> {
    let raw: unknown
    try {
        raw = migrate(JSON.parse(source))
    } catch (e) {
        return {
            success: false,
            error: new z.ZodError([
                {
                    code: 'custom',
                    message: `JSON parse error: ${(e as Error).message}`,
                    path: [],
                    input: source,
                },
            ]),
        } as z.ZodSafeParseResult<SurfaceKeymap>
    }
    return KeymapSchema.safeParse(raw)
}
