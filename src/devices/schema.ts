// Pattern check: no GoF pattern (-) — rejected — zod schema + two converters for the device-layout document; the result type is the Tier 0 Result form.
//
// A device layout as a document: what the Builder edits, saves to its library
// and shows as JSON, and what a device remembers as its layout override. It is
// a DeviceModel with a schema header.
import { z } from 'zod'
import type {
    ControlKind,
    ControlShape,
    DeviceForm,
    DeviceKind,
    DeviceModel,
} from './types'

export const CONTROL_KINDS = [
    'button',
    'wheel',
    'stick',
    'trigger',
    'hat',
    'sensor',
    'encoder',
    'axis',
] as const satisfies readonly ControlKind[]

export const CONTROL_SHAPES = [
    'key',
    'round',
    'pill',
    'stick',
    'dpad',
    'hat',
    'trigger',
    'triggerSide',
    'wheel',
    'ring',
    'knob',
    'sensor',
    'mouseL',
    'mouseR',
] as const satisfies readonly ControlShape[]

export const DEVICE_FORMS = [
    'keyboard',
    'macropad',
    'mouse',
    'gamepad',
    'flightstick',
] as const satisfies readonly DeviceForm[]

const DEVICE_KINDS = [
    'keyboard',
    'mouse',
    'joystick',
    'dongle',
] as const satisfies readonly DeviceKind[]

const size = z.number().positive()

const ControlSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.enum(CONTROL_KINDS),
    shape: z.enum(CONTROL_SHAPES),
    x: z.number(),
    y: z.number(),
    w: size,
    h: size,
    r: z.number().optional(),
    glyph: z.string().optional(),
    zone: z.string().optional(),
    edge: z.boolean().optional(),
    back: z.boolean().optional(),
    label: z.enum(['L', 'R']).optional(),
    variant: z
        .string()
        .min(1)
        .optional()
        .describe('Layout variant id this control belongs to (absent = all).'),
})

const VariantSchema = z
    .object({ id: z.string().min(1), name: z.string().min(1) })
    .describe('A layout variant; controls tag in via `variant`.')

const ShellSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('plate'), pad: z.number() }),
    z.object({ type: z.literal('mouse'), pad: z.number(), tail: z.number() }),
    z.object({
        type: z.literal('gamepad'),
        pad: z.number(),
        gripW: z.number(),
        gripAngle: z.number(),
    }),
    z.object({
        type: z.literal('flightstick'),
        pad: z.number(),
        basePad: z.number(),
        shaftW: z.number(),
    }),
])

export const DeviceLayoutSchema = z
    .object({
        schemaVersion: z.literal(1),
        kind: z.literal('remappr.device-layout'),
        name: z.string().min(1),
        deviceKind: z.enum(DEVICE_KINDS),
        form: z.enum(DEVICE_FORMS),
        shell: ShellSchema,
        controls: z.array(ControlSchema).min(1),
        layouts: z
            .array(VariantSchema)
            .optional()
            .describe('Layout variants; the first one is the default.'),
    })
    .superRefine((d, ctx) => {
        const variants = new Set<string>()
        d.layouts?.forEach((v, i) => {
            if (variants.has(v.id)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['layouts', i, 'id'],
                    message: `duplicate variant id "${v.id}"`,
                })
            }
            variants.add(v.id)
        })
        d.controls.forEach((c, i) => {
            if (c.variant === undefined || variants.has(c.variant)) return
            ctx.addIssue({
                code: 'custom',
                path: ['controls', i, 'variant'],
                message: `unknown variant "${c.variant}"`,
            })
        })
        const seen = new Set<string>()
        d.controls.forEach((c, i) => {
            if (seen.has(c.id)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['controls', i, 'id'],
                    message: `duplicate control id "${c.id}"`,
                })
            }
            seen.add(c.id)
        })
    })
    .describe(
        'A device layout: controls in key units and the shell around them.',
    )

export type DeviceLayoutDoc = z.infer<typeof DeviceLayoutSchema>

/** `model` as a layout document. */
export function layoutFromModel(model: DeviceModel): DeviceLayoutDoc {
    return {
        schemaVersion: 1,
        kind: 'remappr.device-layout',
        name: model.name,
        deviceKind: model.kind,
        form: model.form,
        shell: model.shell,
        controls: model.controls.map((c) => ({ ...c })),
        ...(model.layouts?.length
            ? { layouts: model.layouts.map((v) => ({ ...v })) }
            : {}),
    }
}

/** A layout document as a model. A layout someone made is never `defaulted`. */
export function modelFromLayout(doc: DeviceLayoutDoc): DeviceModel {
    return {
        kind: doc.deviceKind,
        form: doc.form,
        name: doc.name,
        shell: doc.shell,
        controls: doc.controls,
        ...(doc.layouts?.length ? { layouts: doc.layouts } : {}),
    }
}

let cachedJsonSchema: Record<string, unknown> | null = null

/** The layout document's JSON Schema (Draft 2020-12), for an editor's live
 *  validation and completion. Generated from DeviceLayoutSchema the same way
 *  as config/jsonSchema.ts: what a user writes (`io: 'input'`), and anything
 *  zod cannot express in JSON Schema (the duplicate-id check) left open. */
export function deviceLayoutJsonSchema(): Record<string, unknown> {
    cachedJsonSchema ??= z.toJSONSchema(DeviceLayoutSchema, {
        unrepresentable: 'any',
        io: 'input',
    }) as Record<string, unknown>
    return cachedJsonSchema
}

export type LayoutParse =
    | { ok: true; model: DeviceModel }
    | { ok: false; error: string }

/** Parse layout JSON; on failure, one line saying what is wrong and where. */
export function parseDeviceLayout(text: string): LayoutParse {
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const r = DeviceLayoutSchema.safeParse(json)
    if (r.success) return { ok: true, model: modelFromLayout(r.data) }
    const issue = r.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    return { ok: false, error: `${where}${issue?.message ?? 'invalid layout'}` }
}

/** Why `next` cannot stand in for `base`'s layout, or null when it can: a
 *  device's inputs are fixed, so a layout may move, resize, rename and
 *  reshape its controls but must keep every control and its kind, and add
 *  none. */
export function layoutFits(
    base: DeviceModel,
    next: DeviceModel,
): string | null {
    const kinds = new Map(base.controls.map((c) => [c.id, c.kind]))
    const extra = next.controls.find((c) => !kinds.has(c.id))
    if (extra) return `"${extra.name}" is not one of this device's inputs`
    const ids = new Set(next.controls.map((c) => c.id))
    const missing = base.controls.find((c) => !ids.has(c.id))
    if (missing) return `"${missing.name}" is missing from the layout`
    const changed = next.controls.find((c) => kinds.get(c.id) !== c.kind)
    if (changed) return `"${changed.name}" must stay a ${kinds.get(changed.id)}`
    return null
}
