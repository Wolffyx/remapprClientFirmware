// pattern-check: skip — memoized pure converter from the zod KeymapSchema to a
// JSON Schema; single transform reusing the existing schema, no abstraction.
//
// The zod schema (schema.ts) is already the single source of truth for the
// config shape, with `.describe()` on every field. zod v4's z.toJSONSchema turns
// it into a Draft-2020-12 JSON Schema — which the Monaco JSON language service
// consumes for live validation (red squiggles) and Ctrl/Cmd+Space autocomplete
// in the builder's JSON config panel. Generated once and cached: the schema is
// static for the process lifetime.
import { z } from 'zod'
import { DeviceConfigSchema } from './device'
import { KeymapSchema } from './schema'

let cached: Record<string, unknown> | null = null

/** The config JSON Schema (Draft 2020-12), derived from the zod KeymapSchema.
 *  `unrepresentable: 'any'` keeps generation total — any node zod can't express
 *  in JSON Schema (refinements, branded types) becomes an unconstrained `{}`
 *  rather than throwing, so validation stays best-effort but never crashes.
 *  `io: 'input'` describes what a user WRITES (pre-normalize): fields with a
 *  `.default()` (key `w`/`h`/`r`, …) are optional, so the minimized config the
 *  serializer emits — which drops defaulted fields — validates clean instead of
 *  flagging a "missing property" on every key. */
// pattern-check: skip one-option (io:'input') change to existing converter
export function buildConfigJsonSchema(): Record<string, unknown> {
    if (!cached) {
        cached = z.toJSONSchema(KeymapSchema, {
            unrepresentable: 'any',
            io: 'input',
        }) as Record<string, unknown>
    }
    return cached
}

let cachedDevice: Record<string, unknown> | null = null

/** The JSON Schema of the device config document (`kind: "remappr.device"`,
 *  device.ts), generated the same way as buildConfigJsonSchema(). */
// pattern-check: skip second memoized converter, same shape as the one above
export function buildDeviceJsonSchema(): Record<string, unknown> {
    if (!cachedDevice) {
        cachedDevice = z.toJSONSchema(DeviceConfigSchema, {
            unrepresentable: 'any',
            io: 'input',
        }) as Record<string, unknown>
    }
    return cachedDevice
}
