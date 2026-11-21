// L3.7 (behaviors): a binding whose behavior record the canonical form cannot
// hold in full is written back as read on a save, until the user edits it.
import { describe, expect, it } from 'vitest'
import type { ConfigKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import {
    BehaviorFlags,
    BehaviorType,
    MOD,
    MouseOp,
    SystemAction,
    TableId,
} from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'
import { assembleBlob, behaviorBytes, keymapCore, tableOf } from './blobFixtures'

const KEY_A = behaviorBytes({ type: BehaviorType.Key, tap: 0x04 })

function resave(
    records: number[][],
    edit: (c: ConfigKeymap) => ConfigKeymap = (c) => c,
): { device: Uint8Array; out: Uint8Array; errors: string[] } {
    const device = assembleBlob(keymapCore(records))
    const decoded = decodeRemapprBlob(device)
    expect(decoded.code).toBe(DecodeCode.OK)
    const r = buildRemapprBlob(edit(decoded.config!), { configVersion: 2, carryFrom: device })
    const errors = r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
    return { device, out: r.blob, errors }
}

const behaviors = (blob: Uint8Array): number[] => tableOf(blob, TableId.Behavior)!.payload

// Each record the audit lists as lost on the first save, next to a plain key.
const LOST: [string, number[]][] = [
    ['SYSTEM clear_storage', behaviorBytes({ type: BehaviorType.System, tap: SystemAction.clear_storage })],
    ['SYSTEM debug', behaviorBytes({ type: BehaviorType.System, tap: SystemAction.debug_toggle })],
    ['SYSTEM nkro', behaviorBytes({ type: BehaviorType.System, tap: SystemAction.nkro_toggle })],
    ['SYSTEM swap_keys', behaviorBytes({ type: BehaviorType.System, tap: SystemAction.swap_keys })],
    ['mouse dragscroll', behaviorBytes({ type: BehaviorType.Mouse, tap: MouseOp.dragscroll })],
    [
        'multi-mod sticky',
        behaviorBytes({ type: BehaviorType.StickyMod, hold: MOD.LEFT_CTRL | MOD.LEFT_SHIFT }),
    ],
    [
        'multi-mod mod-tap',
        behaviorBytes({ type: BehaviorType.ModTap, tap: 0x05, hold: MOD.LEFT_CTRL | MOD.LEFT_ALT }),
    ],
    [
        'sticky release-after',
        behaviorBytes({ type: BehaviorType.StickyMod, hold: MOD.LEFT_SHIFT, term: 500 }),
    ],
    [
        'mod-tap HOLD_WHILE_UNDECIDED',
        behaviorBytes({
            type: BehaviorType.ModTap,
            tap: 0x05,
            hold: MOD.LEFT_SHIFT,
            flags: BehaviorFlags.HOLD_WHILE_UNDECIDED,
            term: 180,
        }),
    ],
    ['a usage the catalog does not know', behaviorBytes({ type: BehaviorType.Key, tap: 0xf0 })],
]

describe('carry unmodeled behaviors on re-encode (L3.7)', () => {
    it.each(LOST)('keeps %s as read', (_name, record) => {
        const { device, out, errors } = resave([KEY_A, record])
        expect(errors).toEqual([])
        expect(behaviors(out)).toEqual(behaviors(device))
    })

    it('keeps HOLD_WHILE_UNDECIDED on a layer-tap and its current layer index', () => {
        const lt = behaviorBytes({
            type: BehaviorType.LayerTap,
            tap: 0x05,
            hold: 0,
            flags: BehaviorFlags.HOLD_WHILE_UNDECIDED | BehaviorFlags.RETRO_TAP,
        })
        const { device, out } = resave([KEY_A, lt])
        expect(behaviors(out)).toEqual(behaviors(device))
    })

    it('writes an edited binding fresh, without the carried record', () => {
        // The user rebinds the clear_storage key to A, like position 0.
        const record = LOST[0][1]
        const { out } = resave([KEY_A, record], (c) => ({
            ...c,
            layers: [
                {
                    ...c.layers[0],
                    bindings: [c.layers[0].bindings[0], c.layers[0].bindings[0]],
                },
            ],
        }))
        expect(behaviors(out)).toEqual([1, 0, ...KEY_A])
    })
})
