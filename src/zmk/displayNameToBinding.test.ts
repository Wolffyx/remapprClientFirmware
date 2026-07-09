// pattern-check: skip — table-driven assertions over the multi-variant lookup
import { describe, expect, it } from 'vitest'
import {
    KNOWN_BINDING_PREFIXES,
    displayNameToBinding,
    prettyBehaviorName,
    recognizeSystemName,
} from './displayNameToBinding'

describe('displayNameToBinding', () => {
    it.each([
        ['Key Press', '&kp'],
        ['Modifier', '&kp'],
        ['Mod-Tap', '&mt'],
        ['Mod Tap', '&mt'],
        ['Layer-Tap', '&lt'],
        ['Layer (Momentary)', '&mo'],
        ['Momentary Layer', '&mo'],
        ['Layer', '&mo'],
        ['To Layer', '&to'],
        ['Toggle Layer', '&tog'],
        ['Sticky Layer', '&sl'],
        ['Sticky Key', '&sk'],
        ['Key Toggle', '&kt'],
        ['Transparent', '&trans'],
        ['None', '&none'],
        ['Caps Word', '&caps_word'],
        ['Key Repeat', '&key_repeat'],
        ['Grave Escape', '&gresc'],
        ['Bluetooth', '&bt'],
        ['Output Selection', '&out'],
        ['Outputs', '&out'],
        ['RGB Underglow', '&rgb_ug'],
        ['Underglow', '&rgb_ug'],
        ['Backlight', '&bl'],
        ['External Power', '&ext_power'],
        ['Ext Power', '&ext_power'],
        ['Soft Off', '&soft_off'],
        ['Studio Unlock', '&studio_unlock'],
        ['Reset', '&sys_reset'],
        ['System Reset', '&sys_reset'],
        ['Bootloader', '&bootloader'],
        ['Mouse Button Press', '&mkp'],
        ['Mouse Button', '&mkp'],
        ['Mouse Move', '&mmv'],
        ['Mouse Scroll', '&msc'],
    ])('maps "%s" -> %s', (name, expected) => {
        expect(displayNameToBinding(name)).toBe(expected)
    })

    it('returns empty string for empty input', () => {
        expect(displayNameToBinding('')).toBe('')
    })

    it('falls back to slugified &prefix for unknown display names', () => {
        expect(displayNameToBinding('Some New Behavior')).toBe(
            '&some_new_behavior',
        )
        expect(displayNameToBinding('Foo-Bar')).toBe('&foo_bar')
    })

    it('every known prefix has at least one variant', () => {
        for (const prefix of KNOWN_BINDING_PREFIXES) {
            expect(prefix.startsWith('&')).toBe(true)
            expect(prefix.length).toBeGreaterThan(1)
        }
    })

    // Issue #149: a soft_off behavior surfacing under a node-name label
    // ("z_so_off") must resolve to &soft_off so it classifies as a system
    // behavior (dropdown-visible, assignable) instead of a hidden macro.
    describe('recognizeSystemName', () => {
        it.each([
            ['z_so_off', '&soft_off'],
            ['soft_off', '&soft_off'],
            ['softoff', '&soft_off'],
            ['my_reset', '&sys_reset'],
            ['sys_reset', '&sys_reset'],
            ['boot', '&bootloader'],
            ['zmk_bootloader', '&bootloader'],
            ['studio_unlock', '&studio_unlock'],
        ])('recognises "%s" -> %s', (name, expected) => {
            expect(recognizeSystemName(name)).toBe(expected)
            expect(displayNameToBinding(name)).toBe(expected)
        })

        it('does not misfire on user macros with embedded words', () => {
            expect(recognizeSystemName('reset_layers')).toBeUndefined()
            expect(recognizeSystemName('m_hello')).toBeUndefined()
            expect(displayNameToBinding('m_hello')).toBe('&m_hello')
        })

        it('leaves already-known display names untouched', () => {
            expect(recognizeSystemName('Soft Off')).toBeUndefined()
            expect(recognizeSystemName('Reset')).toBeUndefined()
        })
    })

    describe('prettyBehaviorName', () => {
        it('retitles a recognised node-name to its canonical name', () => {
            expect(prettyBehaviorName('z_so_off')).toBe('Soft Off')
            expect(prettyBehaviorName('my_reset')).toBe('Reset')
        })

        it('passes reported display names through unchanged', () => {
            expect(prettyBehaviorName('Bluetooth')).toBe('Bluetooth')
            expect(prettyBehaviorName('m_hello')).toBe('m_hello')
        })
    })
})
