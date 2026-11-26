// pattern-check: skip — test wiring over a parsed config fixture; no abstraction
// The app's macro editor round-trip: get → set with no edits must give back the
// same canonical macro (pause, call, consumer keys, key spelling, extra fields),
// and a macro the editor can't show is refused instead of losing steps.
import { describe, expect, it } from 'vitest'

import { parseKeymap } from '../../config'

import { actionsToMacro, isRichMacro, macroToActions } from './dynamicBridge'
import { Feature } from './protocol'
import type { RemapprRpc } from './rpc'
import { RemapprKeyboardService, type RemapprServiceDeps } from './service'

const CONFIG = parseKeymap(`{
    "schemaVersion": 1, "kind": "remappr.keymap",
    "meta": { "name": "MacroEdit", "target": "zmk" },
    "keyboard": { "id": "me", "name": "MacroEdit", "keys": [{"x":0,"y":0}] },
    "layers": [ { "name": "base", "bindings": ["A"] } ],
    "macros": [
        { "id": "m_full", "description": "every editable step", "steps": [
            { "type": "press", "key": "LCTRL" }, { "type": "tap", "key": "C" },
            { "type": "release", "key": "LCTRL" }, { "type": "wait", "ms": 30 },
            { "type": "text", "text": "hi" }, { "type": "pause_for_release" },
            { "type": "tap", "key": "ac.ac_open" }, { "type": "call", "macro": "m_hi" } ] },
        { "id": "m_hi", "steps": [ { "type": "tap", "key": "H" } ] },
        { "id": "m_param", "params": 1, "steps": [
            { "type": "param" }, { "type": "tap", "key": "A" } ] },
        { "id": "m_tap_time", "steps": [
            { "type": "tap_time", "ms": 40 }, { "type": "tap", "key": "A" } ] }
    ]
}`)

const stubRpc = {
    onClosed: () => () => undefined,
    subscribeInput: () => () => undefined,
    close: async () => undefined,
} as unknown as RemapprRpc

function makeService(featureBitmask: number): RemapprKeyboardService {
    const deps: RemapprServiceDeps = {
        rpc: stubRpc,
        deviceInfo: { name: 'MacroEdit', firmware: 'remappr' },
        config: CONFIG,
        configVersion: 1,
        layouts: [],
        activeLayoutId: 0,
        maxLayers: 8,
        readOnly: false,
        limits: { featureBitmask } as RemapprServiceDeps['limits'],
    }
    return new RemapprKeyboardService(deps)
}

const macros = CONFIG.macros!

describe('macro editor round-trip', () => {
    it('get → set with no edits gives back every editable macro unchanged', () => {
        for (const m of macros.filter((x) => !isRichMacro(x))) {
            expect(actionsToMacro(m, macroToActions(m))).toEqual(m)
        }
    })

    it('maps pause and call to their own editor actions', () => {
        expect(macroToActions(macros[0]).slice(5)).toEqual([
            { kind: 'pause' },
            expect.objectContaining({ kind: 'tap' }),
            { kind: 'call', macro: 'm_hi' },
        ])
    })

    it('keeps a consumer key instead of masking it into a keyboard key', () => {
        const vol = macros[0].steps[6]
        const back = actionsToMacro(macros[0], macroToActions(macros[0])).steps[6]
        expect(back).toEqual(vol)
    })

    it('flags param and tap_time macros as not editable here', () => {
        expect(macros.map(isRichMacro)).toEqual([false, false, true, true])
    })

    it('shows the steps it cannot change as locked rows instead of dropping them', () => {
        expect(macroToActions(macros[2])).toEqual([
            {
                kind: 'locked',
                label: 'Use the key’s value',
                value: 'parameter 1 to 1',
                phrase: 'uses a value from the key it is on',
            },
            expect.objectContaining({ kind: 'tap' }),
        ])
        expect(macroToActions(macros[3])[0]).toMatchObject({ kind: 'locked', value: '40 ms' })
    })
})

describe('Remappr macros facade', () => {
    it('saves an unedited macro back as the same canonical macro', async () => {
        const svc = makeService(Feature.MACRO_CALL)
        const actions = await svc.macros!.getMacro(0)
        await svc.macros!.setMacro!(0, actions)
        expect(svc['withEdits'](CONFIG).macros![0]).toEqual(macros[0])
    })

    it('refuses to save a macro whose steps the editor cannot show', async () => {
        const svc = makeService(Feature.MACRO_CALL)
        const actions = await svc.macros!.getMacro(2)
        await expect(svc.macros!.setMacro!(2, actions)).rejects.toThrow(/edit it as JSON/)
        await expect(svc.macros!.setMacro!(3, [])).rejects.toThrow(/edit it as JSON/)
    })

    it('offers Call only when the device has the macro-call feature bit', () => {
        expect(makeService(Feature.MACRO_CALL).macros!.actionKinds).toContain('call')
        expect(makeService(0).macros!.actionKinds).not.toContain('call')
        expect(makeService(0).macros!.actionKinds).toContain('pause')
    })

    it('offers as call targets only macros that are not itself, parameterized or looping back', () => {
        const api = makeService(Feature.MACRO_CALL).macros!
        // m_full already calls m_hi, so m_hi calling m_full would loop.
        expect(api.callTargets!(1)).toEqual(['m_tap_time'])
        expect(api.callTargets!(0)).toEqual(['m_hi', 'm_tap_time'])
        expect(api.excludedCallTargets!(1)).toEqual([
            {
                macro: 'm_full',
                reason: 'already runs this macro, so they would run each other forever.',
            },
            { macro: 'm_hi', reason: 'is this macro.' },
            { macro: 'm_param', reason: 'needs a value from the key it’s on.' },
        ])
    })

    it('returns the macro’s own description', () => {
        const api = makeService(Feature.MACRO_CALL).macros!
        expect(api.description!(0)).toBe('every editable step')
        expect(api.description!(1)).toBeUndefined()
    })

    it('says up front which macros the editor cannot edit', () => {
        const api = makeService(Feature.MACRO_CALL).macros!
        expect([0, 1, 2, 3].map((i) => api.editBlockedReason!(i) !== null)).toEqual([
            false,
            false,
            true,
            true,
        ])
        expect(api.editBlockedReason!(2)).toBe(
            'Step 1 uses a value from the key the macro is on. This editor can show it ' +
                'but can’t change it yet, so the whole macro is view only to keep it safe.',
        )
    })
})
