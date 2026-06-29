import { describe, expect, it } from 'vitest'

import type { CanonCombo, CanonMacro, CanonTapDance } from '../config'

import { remapprCodec } from './codec'
import {
    actionsToMacro,
    comboToEntry,
    entryToTapDance,
    isRichTapDance,
    macroToActions,
    tapDanceToEntry,
} from './dynamicBridge'

// Canonical ids aren't the bare "C"/"LCTRL" strings — parseKeymap maps those to
// catalog ids. The codec packs keycodes as (page<<16)|usage; the app's macro /
// dynamic fields use raw HID usages, so derive ids from packed values and assert
// the masked raw usage (matching dynamicBridge's HID_USAGE_MASK).
const KBD = (usage: number): number => (0x07 << 16) | usage
const canon = (usage: number): string => remapprCodec.decode(KBD(usage))!.canonicalId
const u = (id: string): number => remapprCodec.encode(id)!.value & 0xffff
const C = canon(0x06)
const X = canon(0x1b)
const LCTRL = canon(0xe0)

describe('macroToActions', () => {
    it('maps tap/press/release/wait to the app MacroAction buffer', () => {
        const macro: CanonMacro = {
            id: 'macro_copy',
            params: 0,
            steps: [
                { type: 'press', key: LCTRL },
                { type: 'tap', key: C },
                { type: 'release', key: LCTRL },
                { type: 'wait', ms: 30 },
            ],
        }
        expect(macroToActions(macro)).toEqual([
            { kind: 'down', keycode: u(LCTRL) },
            { kind: 'tap', keycode: u(C) },
            { kind: 'up', keycode: u(LCTRL) },
            { kind: 'delay', ms: 30 },
        ])
    })
})

describe('tapDanceToEntry', () => {
    it('maps the 1- and 2-tap key_press steps into the 4-slot entry', () => {
        const td: CanonTapDance = {
            id: 'multi',
            tappingTermMs: 180,
            taps: [
                { count: 1, action: { type: 'key_press', key: C } },
                { count: 2, action: { type: 'key_press', key: X } },
            ],
        }
        expect(tapDanceToEntry(td)).toEqual({
            onTap: u(C),
            onHold: 0,
            onDoubleTap: u(X),
            onTapHold: 0,
            tappingTerm: 180,
        })
        expect(isRichTapDance(td)).toBe(false)
    })

    it('flags a rich tap-dance (>2 taps or a non-key_press step) as read-only', () => {
        // multitap_cx: 1=C, 2=X, 3=macro "hi" (a nested composite tap).
        const rich: CanonTapDance = {
            id: 'multitap_cx',
            taps: [
                { count: 1, action: { type: 'key_press', key: C } },
                { count: 2, action: { type: 'key_press', key: X } },
                { count: 3, action: { type: 'macro', ref: 'macro_hi' } },
            ],
        }
        expect(isRichTapDance(rich)).toBe(true)
        // still renders the first two taps; the 3rd (macro) drops to 0.
        expect(tapDanceToEntry(rich)).toMatchObject({
            onTap: u(C),
            onDoubleTap: u(X),
        })
    })
})

describe('comboToEntry', () => {
    it('takes the first four positions and the key_press output', () => {
        const combo: CanonCombo = {
            name: 'cx',
            keys: [0, 1, 2],
            action: { type: 'key_press', key: C },
            timeoutMs: 50,
        }
        expect(comboToEntry(combo)).toEqual({
            keys: [0, 1, 2, 0],
            output: u(C),
        })
    })
})

describe('reverse mappers (editing round-trip)', () => {
    it('actionsToMacro is the inverse of macroToActions', () => {
        const macro: CanonMacro = {
            id: 'macro_copy',
            params: 0,
            steps: [
                { type: 'press', key: LCTRL },
                { type: 'tap', key: C },
                { type: 'release', key: LCTRL },
                { type: 'wait', ms: 30 },
            ],
        }
        expect(actionsToMacro('macro_copy', 0, macroToActions(macro))).toEqual(macro)
    })

    it('passes a text macro action straight through for the compiler', () => {
        const m = actionsToMacro('t', 0, [{ kind: 'text', text: 'Hi' }])
        expect(m.steps).toEqual([{ type: 'text', text: 'Hi' }])
    })

    it('entryToTapDance builds a simple 2-tap dance that re-forwards', () => {
        const entry = {
            onTap: u(C),
            onHold: 0,
            onDoubleTap: u(X),
            onTapHold: 0,
            tappingTerm: 150,
        }
        const td = entryToTapDance('td', entry)
        expect(td).toEqual({
            id: 'td',
            tappingTermMs: 150,
            taps: [
                { count: 1, action: { type: 'key_press', key: C } },
                { count: 2, action: { type: 'key_press', key: X } },
            ],
        })
        expect(tapDanceToEntry(td)).toMatchObject({ onTap: u(C), onDoubleTap: u(X) })
    })
})
