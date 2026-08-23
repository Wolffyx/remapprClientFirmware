// Pattern check: no GoF pattern (-) — rejected — pure framing constants and codec helpers; no abstraction warranted.
// Keychron QMK Raw HID command framing (cmd bytes 0xA0-0xAB).
// Spec: keyboards/keychron/common/keychron_raw_hid.{h,c} in QMK firmware.
//
// Note: Keychron commands are layered ON TOP of stock VIA — VIA's
// dynamic-keymap codec (0x01-0x13) still owns keymap reads/writes.
// This module covers only the Keychron-specific 0xA0-series.

import { ProtocolError } from '@firmware/errors'

export const KEYCHRON_PAYLOAD_SIZE = 32
export const KEYCHRON_USAGE_PAGE = 0xff60
export const KEYCHRON_USAGE = 0x61

export const KC_ID = {
    GET_PROTOCOL_VERSION: 0xa0,
    GET_FIRMWARE_VERSION: 0xa1,
    GET_SUPPORT_FEATURE: 0xa2,
    GET_DEFAULT_LAYER: 0xa3,
    MISC_CMD_GROUP: 0xa7,
    KEYCHRON_RGB: 0xa8,
    ANALOG_MATRIX: 0xa9,
    WIRELESS_DFU: 0xaa,
    FACTORY_TEST: 0xab,
} as const

// Sub-cmd byte 1 of MISC_CMD_GROUP (0xA7).
export const MISC_SUB = {
    GET_PROTOCOL_VER: 0x01,
    DFU_INFO_GET: 0x02,
    LANGUAGE_GET: 0x03,
    LANGUAGE_SET: 0x04,
    DEBOUNCE_GET: 0x05,
    DEBOUNCE_SET: 0x06,
    SNAP_CLICK_GET_INFO: 0x07,
    SNAP_CLICK_GET: 0x08,
    SNAP_CLICK_SET: 0x09,
    SNAP_CLICK_SAVE: 0x0a,
    WIRELESS_LPM_GET: 0x0b,
    WIRELESS_LPM_SET: 0x0c,
    REPORT_RATE_GET: 0x0d,
    REPORT_RATE_SET: 0x0e,
    DIP_SWITCH_GET: 0x0f,
    DIP_SWITCH_SET: 0x10,
    FACTORY_RESET: 0x11,
    NKRO_GET: 0x12,
    NKRO_SET: 0x13,
} as const

// Sub-cmd byte 1 of KEYCHRON_RGB (0xA8).
export const RGB_SUB = {
    GET_PROTOCOL_VER: 0x01,
    SAVE: 0x02,
    GET_INDICATORS_CONFIG: 0x03,
    SET_INDICATORS_CONFIG: 0x04,
    GET_LED_COUNT: 0x05,
    GET_LED_IDX: 0x06,
    PER_KEY_GET_TYPE: 0x07,
    PER_KEY_SET_TYPE: 0x08,
    PER_KEY_GET_COLOR: 0x09,
    PER_KEY_SET_COLOR: 0x0a,
    MIXED_GET_REGION: 0x0b,
    MIXED_SET_REGION: 0x0c,
    MIXED_GET_EFFECT: 0x0d,
    MIXED_SET_EFFECT: 0x0e,
    MIXED_GET_LAYER: 0x0f,
} as const

// Feature bits (0xA2 response, byte 1 = lo, byte 2 = hi).
export const FEATURE_BIT = {
    DEFAULT_LAYER: 1 << 0,
    BLUETOOTH: 1 << 1,
    P24G: 1 << 2,
    ANALOG_MATRIX: 1 << 3,
    STATE_NOTIFY: 1 << 4,
    DYNAMIC_DEBOUNCE: 1 << 5,
    SNAP_CLICK: 1 << 6,
    KEYCHRON_RGB: 1 << 7,
    QUICK_START: 1 << 8,
    NKRO: 1 << 9,
} as const

// Misc feature mask (byte 5 of MISC_GET_PROTOCOL_VER response).
export const MISC_FEATURE_BIT = {
    DFU_INFO: 1 << 0,
    LANGUAGE: 1 << 1,
    DEBOUNCE: 1 << 2,
    SNAP_CLICK: 1 << 3,
    WIRELESS_LPM: 1 << 4,
    REPORT_RATE: 1 << 5,
    QUICK_START: 1 << 6,
    NKRO: 1 << 7,
} as const

export interface FeatureFlags {
    defaultLayer: boolean
    bluetooth: boolean
    p24g: boolean
    analogMatrix: boolean
    stateNotify: boolean
    dynamicDebounce: boolean
    snapClick: boolean
    keychronRgb: boolean
    quickStart: boolean
    nkro: boolean
    raw: number
}

export interface MiscFeatureFlags {
    dfuInfo: boolean
    language: boolean
    debounce: boolean
    snapClick: boolean
    wirelessLpm: boolean
    reportRate: boolean
    quickStart: boolean
    nkro: boolean
    raw: number
}

export function makeFrame(id: number, body: number[] = []): Uint8Array {
    if (body.length > KEYCHRON_PAYLOAD_SIZE - 1) {
        throw new ProtocolError(
            `Keychron frame body too large: ${body.length} > ${KEYCHRON_PAYLOAD_SIZE - 1}`,
        )
    }
    const out = new Uint8Array(KEYCHRON_PAYLOAD_SIZE)
    out[0] = id & 0xff
    for (let i = 0; i < body.length; i++) out[i + 1] = body[i] & 0xff
    return out
}

export function makeSubFrame(
    id: number,
    sub: number,
    body: number[] = [],
): Uint8Array {
    return makeFrame(id, [sub, ...body])
}

function isErrorResponse(resp: Uint8Array): boolean {
    return resp[0] === 0xff && resp[1] === 0x00
}

function expectId(resp: Uint8Array, id: number, label: string): void {
    if (resp.length < KEYCHRON_PAYLOAD_SIZE) {
        throw new ProtocolError(
            `Keychron ${label}: short response (${resp.length} bytes)`,
        )
    }
    if (isErrorResponse(resp)) {
        throw new ProtocolError(`Keychron ${label}: device returned 0xFF/0x00`)
    }
    if (resp[0] !== id) {
        throw new ProtocolError(
            `Keychron ${label}: response id 0x${resp[0].toString(16)} != 0x${id.toString(16)}`,
        )
    }
}

function expectSub(
    resp: Uint8Array,
    id: number,
    sub: number,
    label: string,
): void {
    expectId(resp, id, label)
    if (resp[1] !== sub) {
        throw new ProtocolError(
            `Keychron ${label}: sub 0x${resp[1].toString(16)} != 0x${sub.toString(16)}`,
        )
    }
}

// ---------- 0xA0 / 0xA1 / 0xA2 / 0xA3 ----------

export function getProtocolVersionCmd(): Uint8Array {
    return makeFrame(KC_ID.GET_PROTOCOL_VERSION)
}

export interface ProtocolVersionInfo {
    protocolVersion: number
    qmkCommandSet: number
}

export function parseProtocolVersion(resp: Uint8Array): ProtocolVersionInfo {
    expectId(resp, KC_ID.GET_PROTOCOL_VERSION, 'protocol-version')
    return {
        protocolVersion: resp[1] & 0xff,
        qmkCommandSet: resp[3] & 0xff,
    }
}

export function getFirmwareVersionCmd(): Uint8Array {
    return makeFrame(KC_ID.GET_FIRMWARE_VERSION)
}

export function parseFirmwareVersion(resp: Uint8Array): string {
    expectId(resp, KC_ID.GET_FIRMWARE_VERSION, 'firmware-version')
    let end = 1
    while (end < resp.length && resp[end] !== 0) end++
    return new TextDecoder('ascii').decode(resp.slice(1, end)).trim()
}

export function getSupportFeatureCmd(): Uint8Array {
    return makeFrame(KC_ID.GET_SUPPORT_FEATURE)
}

export function parseFeatureFlags(resp: Uint8Array): FeatureFlags {
    expectId(resp, KC_ID.GET_SUPPORT_FEATURE, 'support-feature')
    const lo = resp[1] & 0xff
    const hi = resp[2] & 0xff
    const raw = lo | (hi << 8)
    return {
        defaultLayer: (raw & FEATURE_BIT.DEFAULT_LAYER) !== 0,
        bluetooth: (raw & FEATURE_BIT.BLUETOOTH) !== 0,
        p24g: (raw & FEATURE_BIT.P24G) !== 0,
        analogMatrix: (raw & FEATURE_BIT.ANALOG_MATRIX) !== 0,
        stateNotify: (raw & FEATURE_BIT.STATE_NOTIFY) !== 0,
        dynamicDebounce: (raw & FEATURE_BIT.DYNAMIC_DEBOUNCE) !== 0,
        snapClick: (raw & FEATURE_BIT.SNAP_CLICK) !== 0,
        keychronRgb: (raw & FEATURE_BIT.KEYCHRON_RGB) !== 0,
        quickStart: (raw & FEATURE_BIT.QUICK_START) !== 0,
        nkro: (raw & FEATURE_BIT.NKRO) !== 0,
        raw,
    }
}

export function getDefaultLayerCmd(): Uint8Array {
    return makeFrame(KC_ID.GET_DEFAULT_LAYER)
}

export function parseDefaultLayer(resp: Uint8Array): number {
    expectId(resp, KC_ID.GET_DEFAULT_LAYER, 'default-layer')
    return resp[1] & 0xff
}

// ---------- 0xA7 misc ----------

export function getMiscProtocolVersionCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.GET_PROTOCOL_VER)
}

export interface MiscProtocolInfo {
    miscProtocolVersion: number
    miscFeatures: MiscFeatureFlags
}

export function parseMiscProtocolVersion(resp: Uint8Array): MiscProtocolInfo {
    expectSub(
        resp,
        KC_ID.MISC_CMD_GROUP,
        MISC_SUB.GET_PROTOCOL_VER,
        'misc-protocol-version',
    )
    // Bytes: [0xA7, 0x01, 0, lo, hi, mask, ...] — LE16 misc protocol.
    const lo = resp[3] & 0xff
    const hi = resp[4] & 0xff
    const miscProtocolVersion = lo | (hi << 8)
    const mask = resp[5] & 0xff
    return {
        miscProtocolVersion,
        miscFeatures: {
            dfuInfo: (mask & MISC_FEATURE_BIT.DFU_INFO) !== 0,
            language: (mask & MISC_FEATURE_BIT.LANGUAGE) !== 0,
            debounce: (mask & MISC_FEATURE_BIT.DEBOUNCE) !== 0,
            snapClick: (mask & MISC_FEATURE_BIT.SNAP_CLICK) !== 0,
            wirelessLpm: (mask & MISC_FEATURE_BIT.WIRELESS_LPM) !== 0,
            reportRate: (mask & MISC_FEATURE_BIT.REPORT_RATE) !== 0,
            quickStart: (mask & MISC_FEATURE_BIT.QUICK_START) !== 0,
            nkro: (mask & MISC_FEATURE_BIT.NKRO) !== 0,
            raw: mask,
        },
    }
}

export function getWirelessLpmCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.WIRELESS_LPM_GET)
}

export interface WirelessLpmConfig {
    enabled: boolean
    timeoutMs: number
}

export function parseWirelessLpm(resp: Uint8Array): WirelessLpmConfig {
    expectSub(
        resp,
        KC_ID.MISC_CMD_GROUP,
        MISC_SUB.WIRELESS_LPM_GET,
        'wireless-lpm-get',
    )
    // Layout (per wireless_raw_hid_rx in firmware):
    //   resp[2] = enabled flag
    //   resp[3..4] = LE16 timeout in ms (or seconds — firmware-dependent)
    return {
        enabled: (resp[2] & 0xff) !== 0,
        timeoutMs: (resp[3] & 0xff) | ((resp[4] & 0xff) << 8),
    }
}

export function setWirelessLpmCmd(cfg: WirelessLpmConfig): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.WIRELESS_LPM_SET, [
        cfg.enabled ? 1 : 0,
        cfg.timeoutMs & 0xff,
        (cfg.timeoutMs >> 8) & 0xff,
    ])
}

export function getNkroCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.NKRO_GET)
}

export function parseNkro(resp: Uint8Array): boolean {
    expectSub(resp, KC_ID.MISC_CMD_GROUP, MISC_SUB.NKRO_GET, 'nkro-get')
    return (resp[2] & 0xff) !== 0
}

export function setNkroCmd(enabled: boolean): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.NKRO_SET, [
        enabled ? 1 : 0,
    ])
}

export function factoryResetCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.FACTORY_RESET)
}

// pattern-check: skip — pure read-only DFU info codec helpers, byte marshalling only
// 0xA7/0x02: read-only metadata about the wireless module (LKBT51 / CKBT51).
// Used by Studio to show firmware revision in the Wireless panel; we do
// NOT expose the full DFU flash flow (0xAA) — that requires vendor spec
// and a rollback plan and risks bricking the module if interrupted.
export function getDfuInfoCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.DFU_INFO_GET)
}

export interface DfuModuleInfo {
    moduleType: number
    versionMajor: number
    versionMinor: number
    versionPatch: number
    raw: Uint8Array
}

export function parseDfuInfo(resp: Uint8Array): DfuModuleInfo {
    expectSub(resp, KC_ID.MISC_CMD_GROUP, MISC_SUB.DFU_INFO_GET, 'dfu-info-get')
    return {
        moduleType: resp[2] & 0xff,
        versionMajor: resp[3] & 0xff,
        versionMinor: resp[4] & 0xff,
        versionPatch: resp[5] & 0xff,
        raw: resp.slice(2),
    }
}

export function dfuModuleLabel(info: DfuModuleInfo): string {
    const name =
        info.moduleType === 1
            ? 'LKBT51'
            : info.moduleType === 2
              ? 'CKBT51'
              : `module-${info.moduleType}`
    return `${name} v${info.versionMajor}.${info.versionMinor}.${info.versionPatch}`
}

export function getDipSwitchCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.DIP_SWITCH_GET)
}

export function parseDipSwitch(resp: Uint8Array): number {
    expectSub(
        resp,
        KC_ID.MISC_CMD_GROUP,
        MISC_SUB.DIP_SWITCH_GET,
        'dip-switch-get',
    )
    return resp[2] & 0xff
}

// ---------- 0xA7 misc: debounce / report-rate / snap-click ----------
// pattern-check: skip — pure MISC sub-cmd codec helpers, byte marshalling only
//
// NOTE: exact byte layouts for these sub-cmds are not in stock QMK master (they
// live in Keychron's launcher firmware fork). The shapes below mirror the LPM
// pattern (data starts at resp[2]) and need confirmation against real hardware.

export interface DebounceConfig {
    /** Debounce algorithm index (e.g. eager-per-key). Raw — enum TBD on HW. */
    mode: number
    /** Response time in ms (the launcher's 10–80 slider). */
    responseMs: number
}

export function getDebounceCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.DEBOUNCE_GET)
}

export function parseDebounce(resp: Uint8Array): DebounceConfig {
    expectSub(resp, KC_ID.MISC_CMD_GROUP, MISC_SUB.DEBOUNCE_GET, 'debounce-get')
    return { mode: resp[2] & 0xff, responseMs: resp[3] & 0xff }
}

export function setDebounceCmd(cfg: DebounceConfig): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.DEBOUNCE_SET, [
        cfg.mode & 0xff,
        cfg.responseMs & 0xff,
    ])
}

export function getReportRateCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.REPORT_RATE_GET)
}

/** Raw report-rate value/divisor (units TBD). The notification variant carries a
 *  0x7F sentinel at byte 4; solicited GET responses do not (see parseNotification). */
export function parseReportRate(resp: Uint8Array): number {
    expectSub(
        resp,
        KC_ID.MISC_CMD_GROUP,
        MISC_SUB.REPORT_RATE_GET,
        'report-rate-get',
    )
    return resp[3] & 0xff
}

export function setReportRateCmd(value: number): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.REPORT_RATE_SET, [
        value & 0xff,
    ])
}

export function getSnapClickCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.SNAP_CLICK_GET)
}

export function parseSnapClick(resp: Uint8Array): boolean {
    expectSub(
        resp,
        KC_ID.MISC_CMD_GROUP,
        MISC_SUB.SNAP_CLICK_GET,
        'snap-click-get',
    )
    return (resp[2] & 0xff) !== 0
}

export function setSnapClickCmd(enabled: boolean): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.SNAP_CLICK_SET, [
        enabled ? 1 : 0,
    ])
}

export function snapClickSaveCmd(): Uint8Array {
    return makeSubFrame(KC_ID.MISC_CMD_GROUP, MISC_SUB.SNAP_CLICK_SAVE)
}

// ---------- 0xA8 RGB ----------

export function getRgbProtocolVersionCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.GET_PROTOCOL_VER)
}

export function parseRgbProtocolVersion(resp: Uint8Array): number {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.GET_PROTOCOL_VER,
        'rgb-protocol-version',
    )
    // LE16 at bytes 2-3 by symmetry with misc proto. Verify on hardware.
    return (resp[2] & 0xff) | ((resp[3] & 0xff) << 8)
}

export function rgbSaveCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.SAVE)
}

export function getLedCountCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.GET_LED_COUNT)
}

export function parseLedCount(resp: Uint8Array): number {
    expectSub(resp, KC_ID.KEYCHRON_RGB, RGB_SUB.GET_LED_COUNT, 'rgb-led-count')
    return resp[2] & 0xff
}

// pattern-check: skip — pure 0xA8/0x06 codec helpers, byte marshalling only
// ---------- 0xA8/0x06 GET_LED_IDX (key → LED index map) ----------
//
// One byte per key: the LED index that lights the key at (start + i), paged by
// (start, count) like PER_KEY_GET_COLOR. 0xFF (NO_LED) marks a key with no LED.
// Lets per-key paint address the correct LED on boards whose LED wiring order
// differs from layout order.
//
// Response layout [0xA8, 0x06, start, count, led0, led1, …] — data at offset 4.
// HW-CONFIRMED on a Keychron K5 V2: painting scattered non-corner keys (D, G,
// up-arrow, numpad-8) lit the matching physical key, so the start+count echo and
// offset=4 are correct. getLedIndexMap() still validates + falls back to identity.
export const NO_LED = 0xff
export const LED_IDX_BATCH_MAX = 16
const LED_IDX_DATA_OFFSET = 4

export function getLedIndexCmd(start: number, count: number): Uint8Array {
    if (count <= 0 || count > LED_IDX_BATCH_MAX) {
        throw new ProtocolError(
            `LED index get count out of range: ${count} (max ${LED_IDX_BATCH_MAX})`,
        )
    }
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.GET_LED_IDX, [
        start & 0xff,
        count & 0xff,
    ])
}

export function parseLedIndexMap(resp: Uint8Array, count: number): number[] {
    expectSub(resp, KC_ID.KEYCHRON_RGB, RGB_SUB.GET_LED_IDX, 'rgb-led-idx')
    const out: number[] = []
    for (let i = 0; i < count; i++) {
        out.push(resp[LED_IDX_DATA_OFFSET + i] & 0xff)
    }
    return out
}

export function getIndicatorsConfigCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.GET_INDICATORS_CONFIG)
}

// OS-lock indicator bitmask bit positions, from keychron_rgb_type.h's os_led_t:
//   bit0 num_lock, bit1 caps_lock, bit2 scroll_lock, bit3 compose, bit4 kana.
export interface IndicatorFlags {
    numLock: boolean
    capsLock: boolean
    scrollLock: boolean
    compose: boolean
    kana: boolean
}

export interface IndicatorsConfig {
    supported: IndicatorFlags
    disabled: IndicatorFlags
    color: HSV
    raw: Uint8Array
}

function indicatorFlagsFromMask(m: number): IndicatorFlags {
    return {
        numLock: (m & (1 << 0)) !== 0,
        capsLock: (m & (1 << 1)) !== 0,
        scrollLock: (m & (1 << 2)) !== 0,
        compose: (m & (1 << 3)) !== 0,
        kana: (m & (1 << 4)) !== 0,
    }
}

export function indicatorMask(f: IndicatorFlags): number {
    return (
        (f.numLock ? 1 << 0 : 0) |
        (f.capsLock ? 1 << 1 : 0) |
        (f.scrollLock ? 1 << 2 : 0) |
        (f.compose ? 1 << 3 : 0) |
        (f.kana ? 1 << 4 : 0)
    )
}

export function parseIndicatorsConfig(resp: Uint8Array): IndicatorsConfig {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.GET_INDICATORS_CONFIG,
        'rgb-indicators-get',
    )
    // GET payload (after [id, sub]): [unused, supportedMask, disableMask, h, s, v]
    // — keychron_rgb.c get_indicators_config(). Confirmed on a K5 V2 (00 01 00
    // ff 00 ff = num-lock supported, none disabled, white). Note the SET payload
    // is *different* ([disableMask, h, s, v]); build it with buildIndicatorsPayload.
    // Missing bytes (shorter board payloads) are treated as 0.
    const raw = resp.slice(2)
    return {
        raw,
        supported: indicatorFlagsFromMask(raw[1] ?? 0),
        disabled: indicatorFlagsFromMask(raw[2] ?? 0),
        color: { h: raw[3] ?? 0, s: raw[4] ?? 0, v: raw[5] ?? 0 },
    }
}

/** SET payload [disableMask, h, s, v] — keychron_rgb.c set_indicators_config().
 *  Firmware clamps v to ≥128. */
export function buildIndicatorsPayload(
    disabled: IndicatorFlags,
    color: HSV,
): Uint8Array {
    return new Uint8Array([
        indicatorMask(disabled),
        color.h & 0xff,
        color.s & 0xff,
        color.v & 0xff,
    ])
}

export function setIndicatorsConfigCmd(payload: Uint8Array): Uint8Array {
    if (payload.length > KEYCHRON_PAYLOAD_SIZE - 2) {
        throw new ProtocolError(
            `indicators payload too large: ${payload.length}`,
        )
    }
    return makeSubFrame(
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.SET_INDICATORS_CONFIG,
        Array.from(payload),
    )
}

// pattern-check: skip — additional codec helpers for 0xA8 sub-cmds, pure data marshalling

// ---------- 0xA8 RGB per-key & mixed-effect ----------

export interface HSV {
    h: number
    s: number
    v: number
}

export function getPerKeyTypeCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.PER_KEY_GET_TYPE)
}

export function parsePerKeyType(resp: Uint8Array): number {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.PER_KEY_GET_TYPE,
        'rgb-per-key-get-type',
    )
    return resp[2] & 0xff
}

export function setPerKeyTypeCmd(type: number): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.PER_KEY_SET_TYPE, [
        type & 0xff,
    ])
}

export const PER_KEY_RGB_BATCH_MAX = 9

export function getPerKeyColorCmd(startLed: number, count: number): Uint8Array {
    if (count <= 0 || count > PER_KEY_RGB_BATCH_MAX) {
        throw new ProtocolError(
            `per-key RGB get count out of range: ${count} (max ${PER_KEY_RGB_BATCH_MAX})`,
        )
    }
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.PER_KEY_GET_COLOR, [
        startLed & 0xff,
        count & 0xff,
    ])
}

export function parsePerKeyColor(resp: Uint8Array, count: number): HSV[] {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.PER_KEY_GET_COLOR,
        'rgb-per-key-get-color',
    )
    const out: HSV[] = []
    for (let i = 0; i < count; i++) {
        const off = 3 + i * 3
        out.push({
            h: resp[off] & 0xff,
            s: resp[off + 1] & 0xff,
            v: resp[off + 2] & 0xff,
        })
    }
    return out
}

export function setPerKeyColorCmd(startLed: number, colors: HSV[]): Uint8Array {
    if (colors.length === 0 || colors.length > PER_KEY_RGB_BATCH_MAX) {
        throw new ProtocolError(
            `per-key RGB set count out of range: ${colors.length} (max ${PER_KEY_RGB_BATCH_MAX})`,
        )
    }
    const body: number[] = [startLed & 0xff, colors.length & 0xff]
    for (const c of colors) {
        body.push(c.h & 0xff, c.s & 0xff, c.v & 0xff)
    }
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.PER_KEY_SET_COLOR, body)
}

export function getMixedRegionsCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.MIXED_GET_REGION)
}

export function parseMixedRegions(resp: Uint8Array): Uint8Array {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.MIXED_GET_REGION,
        'rgb-mixed-get-regions',
    )
    return resp.slice(2)
}

export function setMixedRegionsCmd(payload: Uint8Array): Uint8Array {
    if (payload.length > KEYCHRON_PAYLOAD_SIZE - 2) {
        throw new ProtocolError(
            `mixed regions payload too large: ${payload.length}`,
        )
    }
    return makeSubFrame(
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.MIXED_SET_REGION,
        Array.from(payload),
    )
}

export function getMixedEffectCmd(): Uint8Array {
    return makeSubFrame(KC_ID.KEYCHRON_RGB, RGB_SUB.MIXED_GET_EFFECT)
}

export function parseMixedEffect(resp: Uint8Array): Uint8Array {
    expectSub(
        resp,
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.MIXED_GET_EFFECT,
        'rgb-mixed-get-effect',
    )
    return resp.slice(2)
}

export function setMixedEffectCmd(payload: Uint8Array): Uint8Array {
    if (payload.length > KEYCHRON_PAYLOAD_SIZE - 2) {
        throw new ProtocolError(
            `mixed effect payload too large: ${payload.length}`,
        )
    }
    return makeSubFrame(
        KC_ID.KEYCHRON_RGB,
        RGB_SUB.MIXED_SET_EFFECT,
        Array.from(payload),
    )
}

// ---------- 0xAA wireless DFU (stub) ----------

export function isWirelessDfuFrame(frame: Uint8Array): boolean {
    return frame[0] === KC_ID.WIRELESS_DFU
}

// ---------- State-notify push frame parsers ----------

export type KeychronNotification =
    | { kind: 'default-layer'; layer: number }
    | { kind: 'factory-reset' }
    | { kind: 'report-rate'; divisor: number }
    | { kind: 'unknown'; frame: Uint8Array }

// Identify firmware-pushed frames by shape. State-notify always uses
// well-known cmd-byte tuples; the report-rate push uses byte 4 = 0x7F as a
// sentinel to distinguish from REPORT_RATE_GET responses.
export function parseNotification(frame: Uint8Array): KeychronNotification {
    if (frame.length < KEYCHRON_PAYLOAD_SIZE) {
        return { kind: 'unknown', frame }
    }
    if (frame[0] === KC_ID.GET_DEFAULT_LAYER) {
        return { kind: 'default-layer', layer: frame[1] & 0xff }
    }
    if (frame[0] === KC_ID.MISC_CMD_GROUP) {
        const sub = frame[1] & 0xff
        if (sub === MISC_SUB.FACTORY_RESET) {
            return { kind: 'factory-reset' }
        }
        if (sub === MISC_SUB.REPORT_RATE_GET && (frame[4] & 0xff) === 0x7f) {
            return { kind: 'report-rate', divisor: frame[3] & 0xff }
        }
    }
    return { kind: 'unknown', frame }
}
