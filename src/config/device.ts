// pattern-check: skip plain zod wire-DTO schema plus a JSON parse wrapper
//
// The device config document (`kind: "remappr.device"`): the JSON for a Remappr
// device that is not a keyboard. A keyboard is configured by the keymap document
// (`remappr.keymap`, schema.ts); a dongle has no keys or layers, so it gets this
// small document instead. It compiles to an RMBC blob holding TBL_PERSONALITY
// plus the device's own tables (compilers/remappr/device.ts): the dongle's
// TBL_DONGLE, the mouse's TBL_MOUSE, TBL_RADIO (firmware
// docs/device-config-plan.md) and its sensor's TBL_SENSOR (sensor-settings
// plan §4), or the joystick's TBL_JOYSTICK and button
// actions (input-layout plan §4).
//
//   {
//     "schemaVersion": 1,
//     "kind": "remappr.device",
//     "meta": { "name": "Desk dongle" },
//     "personality": "dongle",
//     "dongle": { "nkro": true, "pairWindowMs": 60000, "failsafeMs": 150 }
//   }
//
//   {
//     "schemaVersion": 1,
//     "kind": "remappr.device",
//     "meta": { "name": "Travel mouse" },
//     "personality": "mouse",
//     "mouse": { "cpi": 1600, "invertWheel": true, "buttonMap": [1,0,2,3,4,5,6,7] },
//     "radio": { "keepaliveMs": 60 },
//     "sensor": { "settings": { "liftCutoff": "2mm", "angleSnap": false } }
//   }
//
//   {
//     "schemaVersion": 1,
//     "kind": "remappr.device",
//     "meta": { "name": "Bench stick" },
//     "personality": "joystick",
//     "joystick": { "hatWays": 4, "axes": [{ "input": 1, "out": "y", "invert": true }] }
//   }
//
// Every field is optional: one left out keeps the firmware's default. The
// ranges mirror the firmware decoders (config_blob.h, radio_settings.h), so a
// config that passes here is never refused for a range. A mouse's DPI must also
// sit inside its board's range, which only the device knows (GET_MOTION_CONFIG).
import { z } from 'zod'
import {
    DeviceSensorSchema,
    JoystickSchema,
    MouseSchema,
    RadioSettingsSchema,
} from './schema'

export const DongleSettingsSchema = z
    .object({
        nkro: z
            .boolean()
            .optional()
            .describe(
                'Route keystrokes out the NKRO interface (true) or the boot 6KRO ' +
                    'interface (false, BIOS-safe). A live NKRO switch made after ' +
                    'this config is saved stands until the next config.',
            ),
        pairWindowMs: z
            .number()
            .int()
            .min(5000)
            .max(600000)
            .optional()
            .describe('How long the pairing window stays open, ms (default 30000).'),
        pairDoneReplayMs: z
            .number()
            .int()
            .min(0)
            .max(30000)
            .optional()
            .describe(
                'After a bond, how long a lost PAIR_DONE is replayed to the node, ms ' +
                    '(default 2000).',
            ),
        failsafeMs: z
            .number()
            .int()
            .min(50)
            .max(2000)
            .optional()
            .describe(
                'A node silent this long gets an all-keys-up report, ms (default 100).',
            ),
        rosterLiveMs: z
            .number()
            .int()
            .min(100)
            .max(60000)
            .optional()
            .describe(
                'A node silent this long is listed offline, ms (default 1500). Not ' +
                    'below the failsafe.',
            ),
        hidSubmitTimeoutMs: z
            .number()
            .int()
            .min(0)
            .max(50)
            .optional()
            .describe(
                'How long a USB report waits for the host to read the previous ' +
                    'one before it is held for later, ms (default 2).',
            ),
    })
    .superRefine((d, ctx) => {
        const failsafe = d.failsafeMs ?? 100
        if (d.rosterLiveMs !== undefined && d.rosterLiveMs < failsafe) {
            ctx.addIssue({
                code: 'custom',
                path: ['rosterLiveMs'],
                message: `rosterLiveMs (${d.rosterLiveMs}) must not be below the failsafe (${failsafe} ms)`,
            })
        }
    })
    .describe('2.4 GHz dongle settings (TBL_DONGLE).')

export const DeviceConfigSchema = z
    .object({
        schemaVersion: z.literal(1),
        kind: z.literal('remappr.device'),
        meta: z.object({
            name: z.string(),
            author: z.string().optional(),
            version: z
                .string()
                .optional()
                .describe('Config version for an exported blob (integer string).'),
            description: z.string().optional(),
        }),
        personality: z
            .enum(['dongle', 'mouse', 'joystick'])
            .describe('Which device this config is for; the device refuses any other.'),
        dongle: DongleSettingsSchema.optional(),
        mouse: MouseSchema.optional(),
        radio: RadioSettingsSchema.optional(),
        joystick: JoystickSchema.optional(),
        sensor: DeviceSensorSchema.optional(),
    })
    .superRefine((d, ctx) => {
        // A section another device reads would be silently ignored: refuse it.
        const own: Record<string, string[]> = {
            dongle: ['dongle'],
            mouse: ['mouse', 'radio', 'sensor'],
            joystick: ['joystick'],
        }
        for (const key of ['dongle', 'mouse', 'radio', 'joystick', 'sensor'] as const) {
            if (d[key] !== undefined && !own[d.personality].includes(key)) {
                ctx.addIssue({
                    code: 'custom',
                    path: [key],
                    message: `a ${d.personality} config has no "${key}" section`,
                })
            }
        }
    })
    .describe('Config for a Remappr device that is not a keyboard.')

export type ConfigDevice = z.infer<typeof DeviceConfigSchema>
export type DongleSettings = z.infer<typeof DongleSettingsSchema>
export type ConfigDeviceSensor = z.infer<typeof DeviceSensorSchema>

/** Parse + validate a device config document. Throws a ZodError (or a
 *  SyntaxError for bad JSON) like parseKeymap does. */
export function parseDeviceConfig(src: string): ConfigDevice {
    return DeviceConfigSchema.parse(JSON.parse(src))
}

/** True when @p json is a device config document rather than a keymap. */
export function isDeviceConfig(json: unknown): boolean {
    return (
        typeof json === 'object' &&
        json !== null &&
        (json as { kind?: unknown }).kind === 'remappr.device'
    )
}
