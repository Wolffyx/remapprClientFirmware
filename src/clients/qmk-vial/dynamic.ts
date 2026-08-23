// Pattern check: no GoF pattern (-) — rejected — typed codecs over Vial DYNAMIC_ENTRY_OP; no abstraction over four small struct shapes.
// Vial dynamic entries: tap-dance, combo, key-override, alt-repeat-key.
// All keycodes inside dynamic entries are encoded LITTLE-ENDIAN (vial.json convention),
// unlike the layer-keymap path which is big-endian over VIA cmd 0x05.

import type { HidClient } from '@firmware/clients/qmk/hidClient'
import type {
    AltRepeatKeyEntry,
    AltRepeatKeyOptions,
    ComboEntry,
    KeyOverrideEntry,
    KeyOverrideOptions,
    TapDanceEntry,
} from '@firmware/types'

import {
    DYNAMIC_OP,
    type DynamicEntryCount,
    dynamicGetCmd,
    dynamicGetEntryCountCmd,
    dynamicSetCmd,
    parseDynamicEntryCount,
} from './protocol'

export type {
    AltRepeatKeyEntry,
    AltRepeatKeyOptions,
    ComboEntry,
    KeyOverrideEntry,
    KeyOverrideOptions,
    TapDanceEntry,
}

function readU16LE(buf: Uint8Array, off: number): number {
    return ((buf[off] | (buf[off + 1] << 8)) & 0xffff) >>> 0
}

function writeU16LE(buf: Uint8Array, off: number, v: number): void {
    buf[off] = v & 0xff
    buf[off + 1] = (v >> 8) & 0xff
}

// pattern-check: skip — duplicated entry interfaces moved to @firmware/types
export async function getDynamicCounts(
    client: HidClient,
): Promise<DynamicEntryCount> {
    const resp = await client.send(dynamicGetEntryCountCmd())
    return parseDynamicEntryCount(resp)
}

// --- Tap dance ----------------------------------------------------------------

export async function getTapDance(
    client: HidClient,
    idx: number,
): Promise<TapDanceEntry> {
    const resp = await client.send(dynamicGetCmd(DYNAMIC_OP.TAP_DANCE_GET, idx))
    return {
        onTap: readU16LE(resp, 0),
        onHold: readU16LE(resp, 2),
        onDoubleTap: readU16LE(resp, 4),
        onTapHold: readU16LE(resp, 6),
        tappingTerm: readU16LE(resp, 8),
    }
}

export async function setTapDance(
    client: HidClient,
    idx: number,
    entry: TapDanceEntry,
): Promise<void> {
    const payload = new Uint8Array(10)
    writeU16LE(payload, 0, entry.onTap)
    writeU16LE(payload, 2, entry.onHold)
    writeU16LE(payload, 4, entry.onDoubleTap)
    writeU16LE(payload, 6, entry.onTapHold)
    writeU16LE(payload, 8, entry.tappingTerm)
    await client.send(dynamicSetCmd(DYNAMIC_OP.TAP_DANCE_SET, idx, payload))
}

// --- Combo --------------------------------------------------------------------

export async function getCombo(
    client: HidClient,
    idx: number,
): Promise<ComboEntry> {
    const resp = await client.send(dynamicGetCmd(DYNAMIC_OP.COMBO_GET, idx))
    return {
        keys: [
            readU16LE(resp, 0),
            readU16LE(resp, 2),
            readU16LE(resp, 4),
            readU16LE(resp, 6),
        ],
        output: readU16LE(resp, 8),
    }
}

export async function setCombo(
    client: HidClient,
    idx: number,
    entry: ComboEntry,
): Promise<void> {
    const payload = new Uint8Array(10)
    for (let i = 0; i < 4; i++) writeU16LE(payload, i * 2, entry.keys[i])
    writeU16LE(payload, 8, entry.output)
    await client.send(dynamicSetCmd(DYNAMIC_OP.COMBO_SET, idx, payload))
}

// --- Key override -------------------------------------------------------------

const KO_FLAG = {
    activationTriggerDown: 1 << 0,
    activationRequiredModDown: 1 << 1,
    activationNegativeModUp: 1 << 2,
    oneMod: 1 << 3,
    noReregisterTrigger: 1 << 4,
    noUnregisterOnOtherKeyDown: 1 << 5,
    enabled: 1 << 7,
} as const

function decodeKoOptions(byte: number): KeyOverrideOptions {
    return {
        activationTriggerDown: !!(byte & KO_FLAG.activationTriggerDown),
        activationRequiredModDown: !!(byte & KO_FLAG.activationRequiredModDown),
        activationNegativeModUp: !!(byte & KO_FLAG.activationNegativeModUp),
        oneMod: !!(byte & KO_FLAG.oneMod),
        noReregisterTrigger: !!(byte & KO_FLAG.noReregisterTrigger),
        noUnregisterOnOtherKeyDown: !!(
            byte & KO_FLAG.noUnregisterOnOtherKeyDown
        ),
        enabled: !!(byte & KO_FLAG.enabled),
    }
}

function encodeKoOptions(o: KeyOverrideOptions): number {
    let b = 0
    if (o.activationTriggerDown) b |= KO_FLAG.activationTriggerDown
    if (o.activationRequiredModDown) b |= KO_FLAG.activationRequiredModDown
    if (o.activationNegativeModUp) b |= KO_FLAG.activationNegativeModUp
    if (o.oneMod) b |= KO_FLAG.oneMod
    if (o.noReregisterTrigger) b |= KO_FLAG.noReregisterTrigger
    if (o.noUnregisterOnOtherKeyDown) b |= KO_FLAG.noUnregisterOnOtherKeyDown
    if (o.enabled) b |= KO_FLAG.enabled
    return b & 0xff
}

export async function getKeyOverride(
    client: HidClient,
    idx: number,
): Promise<KeyOverrideEntry> {
    const resp = await client.send(
        dynamicGetCmd(DYNAMIC_OP.KEY_OVERRIDE_GET, idx),
    )
    return {
        trigger: readU16LE(resp, 0),
        replacement: readU16LE(resp, 2),
        layers: readU16LE(resp, 4),
        triggerMods: resp[6] & 0xff,
        negativeModMask: resp[7] & 0xff,
        suppressedMods: resp[8] & 0xff,
        options: decodeKoOptions(resp[9] & 0xff),
    }
}

export async function setKeyOverride(
    client: HidClient,
    idx: number,
    entry: KeyOverrideEntry,
): Promise<void> {
    const payload = new Uint8Array(10)
    writeU16LE(payload, 0, entry.trigger)
    writeU16LE(payload, 2, entry.replacement)
    writeU16LE(payload, 4, entry.layers)
    payload[6] = entry.triggerMods & 0xff
    payload[7] = entry.negativeModMask & 0xff
    payload[8] = entry.suppressedMods & 0xff
    payload[9] = encodeKoOptions(entry.options)
    await client.send(dynamicSetCmd(DYNAMIC_OP.KEY_OVERRIDE_SET, idx, payload))
}

// --- Alt repeat key -----------------------------------------------------------

const ARK_FLAG = {
    defaultToThisAltKey: 1 << 0,
    bidirectional: 1 << 1,
    ignoreModHandedness: 1 << 2,
    enabled: 1 << 3,
} as const

function decodeArkOptions(byte: number): AltRepeatKeyOptions {
    return {
        defaultToThisAltKey: !!(byte & ARK_FLAG.defaultToThisAltKey),
        bidirectional: !!(byte & ARK_FLAG.bidirectional),
        ignoreModHandedness: !!(byte & ARK_FLAG.ignoreModHandedness),
        enabled: !!(byte & ARK_FLAG.enabled),
    }
}

function encodeArkOptions(o: AltRepeatKeyOptions): number {
    let b = 0
    if (o.defaultToThisAltKey) b |= ARK_FLAG.defaultToThisAltKey
    if (o.bidirectional) b |= ARK_FLAG.bidirectional
    if (o.ignoreModHandedness) b |= ARK_FLAG.ignoreModHandedness
    if (o.enabled) b |= ARK_FLAG.enabled
    return b & 0xff
}

export async function getAltRepeatKey(
    client: HidClient,
    idx: number,
): Promise<AltRepeatKeyEntry> {
    const resp = await client.send(
        dynamicGetCmd(DYNAMIC_OP.ALT_REPEAT_KEY_GET, idx),
    )
    return {
        keycode: readU16LE(resp, 0),
        altKeycode: readU16LE(resp, 2),
        allowedMods: resp[4] & 0xff,
        options: decodeArkOptions(resp[5] & 0xff),
    }
}

export async function setAltRepeatKey(
    client: HidClient,
    idx: number,
    entry: AltRepeatKeyEntry,
): Promise<void> {
    const payload = new Uint8Array(6)
    writeU16LE(payload, 0, entry.keycode)
    writeU16LE(payload, 2, entry.altKeycode)
    payload[4] = entry.allowedMods & 0xff
    payload[5] = encodeArkOptions(entry.options)
    await client.send(
        dynamicSetCmd(DYNAMIC_OP.ALT_REPEAT_KEY_SET, idx, payload),
    )
}
