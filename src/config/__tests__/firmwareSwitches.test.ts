// pattern-check: skip — unit tests for the per-firmware switch tables and feature cards.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    deriveZmkConf,
    FIRMWARE_SWITCHES,
    parseKeymap,
    serializeKeymap,
    setDesignFeature,
    supportsFeature,
} from '../index'
import { resolveQmkFeatures } from '../firmwareConf'
import type { ConfigKeymap } from '../types'

const seed = parseKeymap(
    readFileSync(
        fileURLToPath(
            new URL('../../clients/mock/seed.keymap.json', import.meta.url),
        ),
        'utf8',
    ),
)

const zmk = FIRMWARE_SWITCHES.zmk
const row = (c: ConfigKeymap, id: string, t = zmk) =>
    t.switches(c).find((s) => s.id === id)!

describe('ZMK switches', () => {
    it('keeps the old defaults when no features are picked', () => {
        expect(row(seed, 'ble').on).toBe(false)
        expect(row(seed, 'studio').on).toBe(true)
        expect(row(seed, 'sleep').on).toBe(false)
    })

    it('feature cards turn options on and say so', () => {
        let c = setDesignFeature(seed, 'wireless', true)
        c = setDesignFeature(c, 'battery', true)
        expect(row(c, 'ble')).toMatchObject({
            on: true,
            from: 'Wireless',
            line: 'CONFIG_ZMK_BLE=y',
        })
        expect(row(c, 'sleep').from).toBe('Battery & sleep')
        // Picking features without Edit live turns Studio off.
        expect(row(c, 'studio').on).toBe(false)
        const conf = deriveZmkConf(c)
        expect(conf).toContain('\nCONFIG_ZMK_BLE=y')
        expect(conf).toContain('CONFIG_ZMK_SLEEP=y')
    })

    it('a flip is an override; flipping back drops it', () => {
        const on = zmk.set(seed, 'ble', true)
        expect(on.keyboard.firmwareConfig?.ble).toBe(true)
        expect(row(on, 'ble')).toMatchObject({ on: true, changed: true })
        expect(row(on, 'ble').from).toBeUndefined()
        const back = zmk.set(on, 'ble', false)
        expect(back.keyboard.firmwareConfig?.ble).toBeUndefined()
        expect(row(back, 'ble').changed).toBe(false)
    })

    it('reset drops every ZMK override', () => {
        const c = zmk.set(zmk.set(seed, 'ble', true), 'usbLogging', true)
        const r = zmk.reset(c)
        expect(zmk.switches(r).filter((s) => s.changed)).toHaveLength(0)
    })

    it('Studio over USB keeps the CDC endpoint in step', () => {
        const off = zmk.set(seed, 'studioCdc', false)
        expect(off.keyboard.hardware?.studioAcm).toBeUndefined()
        const on = zmk.set(off, 'studioCdc', true)
        expect(on.keyboard.hardware?.studioAcm).toBe(true)
    })

    it('encoders write the EC11 lines', () => {
        const c = setDesignFeature(seed, 'encoders', true)
        expect(deriveZmkConf(c)).toContain('CONFIG_EC11=y')
    })
})

describe('QMK family switches', () => {
    it('writes keyboard.json features with overrides', () => {
        expect(row(seed, 'nkro', FIRMWARE_SWITCHES.qmk).line).toBe('"nkro": true')
        const c = FIRMWARE_SWITCHES.qmk.set(seed, 'nkro', false)
        expect(resolveQmkFeatures(c).nkro).toBe(false)
        expect(row(c, 'nkro', FIRMWARE_SWITCHES.qmk).changed).toBe(true)
    })

    it('VIA shows its live-edit line as fixed', () => {
        expect(row(seed, 'liveEdit', FIRMWARE_SWITCHES.via)).toMatchObject({
            line: 'VIA_ENABLE = yes',
            fixed: true,
        })
    })

    it('lighting card turns on rgblight', () => {
        const c = setDesignFeature(seed, 'lighting', true)
        expect(resolveQmkFeatures(c).rgblight).toBe(true)
    })
})

describe('feature cards', () => {
    it('each firmware declares what it supports', () => {
        expect(supportsFeature('zmk', 'wireless')).toBe(true)
        expect(supportsFeature('qmk', 'wireless')).toBe(false)
        expect(supportsFeature('via', 'liveEdit')).toBe(true)
        expect(supportsFeature('qmk', 'liveEdit')).toBe(false)
    })

    it('picked features round-trip through the config document', () => {
        const c = setDesignFeature(seed, 'pointing', true)
        expect(parseKeymap(serializeKeymap(c)).keyboard.features).toEqual([
            'pointing',
        ])
    })
})
