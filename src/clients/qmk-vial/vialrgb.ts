// Pattern check: Facade (Tier 1) — extended — VialRGB implementation of the
// neutral RgbApi facade, sibling of keychron/rgb.ts and via/rgbMatrix.ts.
//
// VialRGB is Vial's RGB-matrix lighting protocol (vial-qmk quantum/vialrgb.c),
// used by boards whose definition says `"lighting": "vialrgb"`. It rides the
// VIA lighting commands with its own sub-ids:
//   get (0x08): 0x40 info, 0x41 mode, 0x42 supported effects, 0x43 LED count,
//               0x44 LED info
//   set (0x07): 0x41 mode (+ speed + HSV in one frame), 0x42 direct fast-set
//   save (0x09): flush the RGB-matrix settings to EEPROM
// Effects are addressed by VialRGB ids (vialrgb_effects.inc), not by QMK's
// RGB_MATRIX_* enum. The "Direct" effect shows a per-LED colour buffer that
// lives in RAM only and cannot be read back.
import type { HidClient } from '@firmware/clients/qmk/hidClient'
import type { LightingCatalog } from '@firmware/lighting'
import type { HsvColor, RgbApi, RgbEffectState } from '@firmware/service'
import { makeFrame, VIA_PAYLOAD_SIZE } from '@firmware/clients/qmk/protocol'

const LIGHTING_SET = 0x07
const LIGHTING_GET = 0x08
const LIGHTING_SAVE = 0x09

const GET_INFO = 0x40
const GET_MODE = 0x41
const GET_SUPPORTED = 0x42
const GET_NUMBER_LEDS = 0x43
const GET_LED_INFO = 0x44

const SET_MODE = 0x41
const SET_DIRECT_FASTSET = 0x42

/** The one protocol version vialrgb.c has shipped. */
const VIALRGB_PROTOCOL = 1

/** VialRGB effect id of the per-LED "Direct" buffer. */
export const VIALRGB_EFFECT_DIRECT = 1

/** Effect names by VialRGB id (vialrgb_effects.inc, append-only). Spelled like
 *  RGB_MATRIX_EFFECTS so the app's glow engine recognises them. */
export const VIALRGB_EFFECT_NAMES: readonly string[] = [
    'None', // 0 (off)
    'Direct',
    'Solid Color',
    'Alphas Mods',
    'Gradient Up Down',
    'Gradient Left Right',
    'Breathing',
    'Band Sat',
    'Band Val',
    'Band Pinwheel Sat',
    'Band Pinwheel Val',
    'Band Spiral Sat',
    'Band Spiral Val',
    'Cycle All',
    'Cycle Left Right',
    'Cycle Up Down',
    'Rainbow Moving Chevron',
    'Cycle Out In',
    'Cycle Out In Dual',
    'Cycle Pinwheel',
    'Cycle Spiral',
    'Dual Beacon',
    'Rainbow Beacon',
    'Rainbow Pinwheels',
    'Raindrops',
    'Jellybean Raindrops',
    'Hue Breathing',
    'Hue Pendulum',
    'Hue Wave',
    'Typing Heatmap',
    'Digital Rain',
    'Solid Reactive Simple',
    'Solid Reactive',
    'Solid Reactive Wide',
    'Solid Reactive Multiwide',
    'Solid Reactive Cross',
    'Solid Reactive Multicross',
    'Solid Reactive Nexus',
    'Solid Reactive Multinexus',
    'Splash',
    'Multisplash',
    'Solid Splash',
    'Solid Multisplash',
    'Pixel Rain',
    'Pixel Fractal',
]

/** Header [cmd, sub] + first LED (u16) + count leaves 27 bytes: 9 LEDs × HSV. */
export const FASTSET_MAX_LEDS = Math.floor((VIA_PAYLOAD_SIZE - 2 - 3) / 3)

/** get_supported pages: 15 ids per reply; a board has well under 64 pages. */
const MAX_SUPPORTED_PAGES = 64

/** vialrgb.c reads the LED index's high byte as `args[1] >> 8` (always 0), so
 *  LEDs past 255 answer as their low byte. Only the first 256 are mapped. */
const LED_INFO_MAX = 256

/** What the board reported at connect. */
export interface VialRgbInfo {
    /** RGB_MATRIX_MAXIMUM_BRIGHTNESS: the firmware caps every V at this. */
    maxBrightness: number
    /** Supported effects by VialRGB id; index 0 is always "None" (off). */
    effectIds: number[]
    /** LEDs in the Direct buffer; 0 when the build has no Direct effect. */
    ledCount: number
}

/** Matrix position of each layout key, in layout order. */
export type KeyMatrix = () => readonly { row: number; col: number }[]

const u16le = (b: Uint8Array, off: number): number => b[off] | (b[off + 1] << 8)

function getCmd(sub: number, args: number[] = []): Uint8Array {
    return makeFrame(LIGHTING_GET, [sub, ...args])
}

/** Reply bytes after [cmd, sub], or null when the board didn't answer this
 *  sub-command (id_unhandled, or another lighting handler's echo). */
async function query(
    client: HidClient,
    sub: number,
    args: number[] = [],
): Promise<Uint8Array | null> {
    const resp = await client.send(getCmd(sub, args))
    if (resp[0] !== LIGHTING_GET || resp[1] !== sub) return null
    return resp.subarray(2)
}

/** Ask the board for VialRGB. Null when it doesn't speak protocol 1. */
export async function probeVialRgb(
    client: HidClient,
): Promise<VialRgbInfo | null> {
    const info = await query(client, GET_INFO)
    if (!info || u16le(info, 0) !== VIALRGB_PROTOCOL) return null
    const maxBrightness = info[2] || 0xff

    // get_supported lists ids greater than the one sent, 0xFFFF-padded.
    const effectIds = [0]
    for (let page = 0; page < MAX_SUPPORTED_PAGES; page++) {
        const last = effectIds[effectIds.length - 1]
        const reply = await query(client, GET_SUPPORTED, [
            last & 0xff,
            last >> 8,
        ])
        if (!reply) break
        let added = 0
        for (let off = 0; off + 1 < reply.length; off += 2) {
            const id = u16le(reply, off)
            if (id === 0xffff) break
            if (id > effectIds[effectIds.length - 1]) {
                effectIds.push(id)
                added++
            }
        }
        if (added === 0) break
    }

    // Answered only when the build has the Direct effect; otherwise the args
    // come back as sent (zero).
    const leds = effectIds.includes(VIALRGB_EFFECT_DIRECT)
        ? await query(client, GET_NUMBER_LEDS)
        : null
    return {
        maxBrightness,
        effectIds,
        ledCount: leds ? u16le(leds, 0) : 0,
    }
}

export function createVialRgbFacade(
    client: HidClient,
    info: VialRgbInfo,
    keyMatrix: KeyMatrix,
): RgbApi {
    const { maxBrightness, effectIds, ledCount } = info
    // The app works in 0–255; the firmware clamps V at maxBrightness. Scale so
    // the whole slider range means something, the way VIA's own channel does.
    const toDevice = (v: number): number =>
        Math.round((Math.max(0, Math.min(255, v)) * maxBrightness) / 255)
    const fromDevice = (v: number): number =>
        Math.min(255, Math.round((v * 255) / maxBrightness))

    const effectCatalog: LightingCatalog = {
        kind: 'rgb_matrix',
        effects: effectIds.map(
            (id) => VIALRGB_EFFECT_NAMES[id] ?? `Effect ${id}`,
        ),
        hasColor: true,
        hasSpeed: true,
    }

    // LED → matrix position, read once (one round trip per LED).
    let ledMatrix: Promise<Map<string, number>> | null = null
    const readLedMatrix = async (): Promise<Map<string, number>> => {
        const byPos = new Map<string, number>()
        for (let led = 0; led < Math.min(ledCount, LED_INFO_MAX); led++) {
            const r = await query(client, GET_LED_INFO, [led & 0xff, led >> 8])
            // [x, y, flags, row, col]; 0xFF row/col = not under a key.
            if (!r || r[3] === 0xff || r[4] === 0xff) continue
            const pos = `${r[3]},${r[4]}`
            // Two LEDs can share a key (a long spacebar); the first one wins.
            if (!byPos.has(pos)) byPos.set(pos, led)
        }
        return byPos
    }

    const api: RgbApi = {
        effectCatalog,
        async getLedCount(): Promise<number> {
            return ledCount
        },
        async getEffect(): Promise<RgbEffectState> {
            const r = await query(client, GET_MODE)
            if (!r)
                throw new Error('VialRGB: the board did not report its mode')
            const mode = Math.max(0, effectIds.indexOf(u16le(r, 0)))
            const brightness = fromDevice(r[5])
            return {
                mode,
                speed: r[2],
                brightness,
                color: { h: r[3], s: r[4], v: brightness },
            }
        },
        async setEffect(state: RgbEffectState): Promise<void> {
            const id = effectIds[state.mode] ?? 0
            await client.send(
                makeFrame(LIGHTING_SET, [
                    SET_MODE,
                    id & 0xff,
                    id >> 8,
                    state.speed & 0xff,
                    state.color.h & 0xff,
                    state.color.s & 0xff,
                    toDevice(state.brightness),
                ]),
            )
        },
        async save(): Promise<void> {
            await client.send(makeFrame(LIGHTING_SAVE))
        },
    }

    const directIdx = effectIds.indexOf(VIALRGB_EFFECT_DIRECT)
    if (directIdx < 0 || ledCount === 0) return api

    return {
        ...api,
        perKeyVolatile: true,
        async getPerKeyEffectMode(): Promise<number | null> {
            return directIdx
        },
        async setPerKeyColors(
            startLed: number,
            colors: HsvColor[],
        ): Promise<void> {
            for (let i = 0; i < colors.length; i += FASTSET_MAX_LEDS) {
                const first = startLed + i
                if (first < 0 || first >= ledCount) continue
                const batch = colors
                    .slice(i, i + FASTSET_MAX_LEDS)
                    .slice(0, ledCount - first)
                await client.send(
                    makeFrame(LIGHTING_SET, [
                        SET_DIRECT_FASTSET,
                        first & 0xff,
                        first >> 8,
                        batch.length,
                        ...batch.flatMap((c) => [
                            c.h & 0xff,
                            c.s & 0xff,
                            toDevice(c.v),
                        ]),
                    ]),
                )
            }
        },
        async getLedIndexMap(keyCount: number): Promise<number[]> {
            ledMatrix ??= readLedMatrix().catch((err: unknown) => {
                ledMatrix = null // try again next time
                throw err
            })
            const byPos = await ledMatrix
            const keys = keyMatrix()
            return Array.from({ length: keyCount }, (_, i) => {
                const k = keys[i]
                return (k && byPos.get(`${k.row},${k.col}`)) ?? -1
            })
        },
    }
}
