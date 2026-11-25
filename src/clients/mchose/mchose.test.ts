// pattern-check: skip — tests: a fake MCHOSE mouse behind FeatureReports and assertions.
import { describe, expect, it } from 'vitest'
import type { SensorBinding } from '../../devices/types'
import type { FeatureReports, Transport } from '../../transport'
import { mchoseAdapter } from './adapter'
import { bindingOf, configWith, modelFor } from './mouse'
import {
    CONFIG_LEN,
    decodeReply,
    encodeBody,
    LONG,
    MchoseLink,
    parseConfig,
    parseIdentity,
    readConfig,
    SHORT,
    writesBetween,
} from './protocol'
import {
    actionsOf,
    eventsOf,
    macroPackets,
    MacroMode,
    pageFits,
    parseMacro,
} from './macros'
import { MchoseMouseService } from './service'

const hexBytes = (s: string): Uint8Array =>
    Uint8Array.from(s.trim().split(/\s+/), (h) => Number.parseInt(h, 16))

// Read off a real A7X Ultra (receiver 3837:1009, fw 5.30.3.0), decoded.
const A7X_CONFIG = hexBytes(`
00 22 32 02 c8 00 90 01 d0 07 80 0c 00 19 10 a4 06 82 08 02 00 00 00 00 10 00
00 00 20 00 00 00 30 00 00 00 40 00 00 00 50 00 00 00 00 00 00 00 00 00 80 c8
00 90 01 d0 07 80 0c 00 19 10 a4`)
const A7X_IDENTITY = hexBytes(
    '37 38 11 40 1e 05 03 00 09 0e 01 0e 00 00 00 00 00 00 00',
)
const A7X_VERSION = hexBytes('08 35 2e 33 30 2e 33 2e 30 00 00')

const A7X = modelFor(0x3837, 0x1009)
const noWait = (): Promise<void> => Promise.resolve()

/** A mouse as the receiver presents it: it keeps a config block and answers
 *  the vendor commands, 0x42 with its tri-state fields. */
function fakeMouse(opts: { dropFirst?: number } = {}) {
    const cfg = A7X_CONFIG.slice()
    const sent: number[][] = []
    // Per slot: the macro byte stream, as the mouse stores it.
    const streams: number[][] = Array.from({ length: 6 }, () => [])
    const names: string[] = []
    let reply: number[] = []
    let drop = opts.dropFirst
    const triState = (bit: number, v: number): void => {
        if (v === 1) cfg[17] |= bit
        if (v === 2) cfg[17] &= ~bit
    }
    const PERF_BITS: Record<number, number> = { 1: 0x00, 2: 0x80, 3: 0xc0 }
    const handlers: Record<number, (b: number[]) => void> = {
        0x06: () => (reply = [0x06, ...A7X_IDENTITY]),
        0x04: () => (reply = [0x04, ...A7X_VERSION]),
        0x67: () => (reply = [0x67, ...cfg]),
        // The long form carries 0xFF and the Y stages after X; the short
        // one writes X onto both axes.
        0x40: (b) => {
            const y = b[17] === 0xff ? 18 : 4
            cfg[1] = (cfg[1] & 0xf0) | b[1]
            cfg[2] = (cfg[2] & 0xf0) | b[2]
            for (let i = 0; i < 12; i++) {
                cfg[4 + i] = b[4 + i]
                cfg[51 + i] = b[y + i]
            }
            cfg[16] = b[16]
        },
        0x41: (b) => (cfg[2] = (b[1] << 4) | (cfg[2] & 0x0f)),
        0x42: (b) => {
            cfg[17] = (cfg[17] & ~0x03) | b[1]
            triState(0x04, b[2])
            triState(0x08, b[3])
            triState(0x10, b[4])
            if (b[7]) cfg[17] = (cfg[17] & 0x3f) | PERF_BITS[b[7]]
            if (b[8] === 1) cfg[49] = b[9]
            if (b[8] === 2) cfg[49] = 0
        },
        0x43: (b) => (cfg[18] = b[1]),
        0x0a: (b) => (cfg[19] = b[2]),
        0x58: (b) => (cfg[0] = b[1]),
        // Like the real mouse: writing a macro binds its button to it.
        0x55: (b) => {
            const off = b[3] | (b[4] << 8)
            if (off === 0) streams[b[1]] = []
            streams[b[1]].splice(off, b[5], ...b.slice(6, 6 + b[5]))
            cfg.set([(b[1] << 4) | 4, 0, 0, 0], 20 + b[1] * 4)
        },
        0x65: (b) => {
            const st = streams[b[1]]
            const off = b[2] * 58
            const page = st.slice(off, off + 58)
            const more = st.length > off + 58 ? 1 : 0
            reply = [
                0x65,
                b[1],
                more,
                off & 0xff,
                off >> 8,
                page.length,
                ...page,
            ]
        },
        0x53: (b) => {
            names[b[1]] = new TextDecoder().decode(
                Uint8Array.from(b.slice(3, 3 + b[2])),
            )
        },
        // ... and binding it to anything else drops the macro.
        0x52: (b) => {
            const at = 20 + b[1] * 4
            if (b[3] !== 4) streams[b[1]] = []
            cfg[at] = (b[1] << 4) | b[3]
            cfg[at + 1] = b[4]
            cfg[at + 2] = b[5]
            cfg[at + 3] = b[6]
        },
    }
    const hid: FeatureReports = {
        send: async (_report, payload) => {
            const body = Array.from(payload, (x) => x ^ 0xff)
            sent.push(body)
            if (drop === body[0]) {
                drop = undefined
                return
            }
            handlers[body[0]]?.(body)
        },
        receive: async (_report, length) => {
            const out = new Uint8Array(length).fill(0xff)
            reply.forEach((x, i) => (out[i] = x ^ 0xff))
            return out
        },
    }
    return {
        cfg,
        sent,
        streams,
        names,
        hid,
        link: new MchoseLink(hid, noWait),
    }
}

describe('MCHOSE frames', () => {
    it('inverts the body and pads with 0xFF', () => {
        const wire = encodeBody(SHORT, [0x06])
        expect(wire.length).toBe(20)
        expect(wire[0]).toBe(0xf9)
        expect(wire.slice(1).every((b) => b === 0xff)).toBe(true)
        expect(encodeBody(LONG, [0x67]).length).toBe(64)
    })

    it('decodes a reply that echoes its command, rejects another', () => {
        const wire = Uint8Array.from([0x06, 0x37, 0x38], (b) => b ^ 0xff)
        expect(Array.from(decodeReply(0x06, wire) ?? [])).toEqual([0x37, 0x38])
        expect(decodeReply(0x67, wire)).toBeNull()
    })
})

describe('MCHOSE config', () => {
    it('parses a real A7X Ultra block', () => {
        const c = parseConfig(A7X_CONFIG)
        expect(c.raw.length).toBe(CONFIG_LEN)
        expect(c.profile).toBe(0)
        expect(c.stage).toBe(2)
        expect(c.rateIndex).toBe(3)
        expect(c.dpi).toEqual([200, 400, 2000, 3200, 6400, 42000])
        expect(c.sensor).toEqual({
            lod: 2,
            ripple: false,
            angleSnap: false,
            motionSync: false,
            performance: 2,
            rotation: 0,
        })
        expect(c.debounceMs).toBe(8)
        expect(c.sleepMinutes).toBe(2)
    })

    it('parses identity: link, battery, charging', () => {
        const id = parseIdentity(A7X_IDENTITY)
        expect(id).toMatchObject({
            vid: 0x3837,
            pid: 0x4011,
            link: 'p24g',
            connected: true,
            battery: 14,
            charging: true,
        })
    })

    it('maps to the sensor binding and back without change', () => {
        const c = parseConfig(A7X_CONFIG)
        const b = bindingOf(A7X, c)
        expect(b.poll).toBe(2000)
        expect(b.stages).toEqual([200, 400, 2000, 3200, 6400, 42000])
        expect(writesBetween(c, configWith(A7X, c, b))).toEqual([])
    })

    it('writes 0x42 tri-state: 1 = on, 2 = off', () => {
        const c = parseConfig(A7X_CONFIG)
        const b = bindingOf(A7X, c)
        const next = configWith(A7X, c, {
            ...b,
            settings: { ...b.settings, motionSync: true, liftCutoff: 0 },
        })
        expect(writesBetween(c, next)).toEqual([
            { report: SHORT, body: [0x42, 0, 2, 2, 1, 0, 0, 2, 2, 0] },
        ])
    })

    it('keeps stages past the enabled ones and rejects bad values', () => {
        const c = parseConfig(A7X_CONFIG)
        const b = bindingOf(A7X, c)
        const two = configWith(A7X, c, { ...b, stages: [800, 1600], active: 5 })
        expect(two.dpi).toEqual([800, 1600, 2000, 3200, 6400, 42000])
        expect(two.enabledStages).toBe(2)
        expect(two.stage).toBe(1)
        expect(() => configWith(A7X, c, { ...b, stages: [90000] })).toThrow(
            /DPI/,
        )
        expect(() => configWith(A7X, c, { ...b, poll: 3000 })).toThrow(/Hz/)
        const debounce = { ...b.settings, debounceMs: 99 }
        expect(() => configWith(A7X, c, { ...b, settings: debounce })).toThrow(
            /debounce/,
        )
    })

    it('sets the axes apart only when Y differs from X', () => {
        const c = parseConfig(A7X_CONFIG)
        expect(c.dpiY).toEqual(c.dpi)
        expect(bindingOf(A7X, c).stagesY).toBeUndefined()
        const b = bindingOf(A7X, c)
        const apart = configWith(A7X, c, { ...b, stagesY: [200, 400, 1000] })
        expect(apart.dpiY).toEqual([200, 400, 1000, 3200, 6400, 42000])
        expect(bindingOf(A7X, apart).stagesY).toEqual([
            200, 400, 1000, 3200, 6400, 42000,
        ])
        const [w] = writesBetween(c, apart)
        expect(w.report).toBe(LONG)
        expect(w.body.slice(16, 20)).toEqual([6, 0xff, 200, 0])
        expect(w.body.slice(22, 24)).toEqual([1000 & 0xff, 1000 >> 8])
        expect(configWith(A7X, apart, b).dpiY).toEqual(apart.dpi)
    })

    it('identifies models by receiver or mouse PID, else by vendor', () => {
        expect(modelFor(0x3837, 0x1009).name).toBe('MCHOSE A7X Ultra')
        expect(modelFor(0x3837, 0x9999, 0x4150).name).toBe('MCHOSE K7 Ultra')
        expect(modelFor(0x5253).dpiMax).toBe(26000)
    })
})

describe('MCHOSE link', () => {
    it('asks again while the mouse answers empty', async () => {
        const m = fakeMouse()
        let empties = 2
        const hid: FeatureReports = {
            send: m.hid.send,
            receive: async (report, length) => {
                if (empties-- > 0) {
                    const zero = new Uint8Array(length).fill(0xff)
                    zero[0] = 0x67 ^ 0xff
                    return zero
                }
                return m.hid.receive(report, length)
            },
        }
        const c = await readConfig(new MchoseLink(hid, noWait))
        expect(c.dpi[2]).toBe(2000)
        expect(m.sent.filter((b) => b[0] === 0x67)).toHaveLength(3)
    })
})

function service(m: ReturnType<typeof fakeMouse>) {
    return new MchoseMouseService({
        link: m.link,
        model: A7X,
        deviceInfo: { name: A7X.name, firmware: 'mchose' },
        config: parseConfig(m.cfg),
    })
}

describe('MCHOSE mouse service', () => {
    it('writes only the settings that moved and confirms them', async () => {
        const m = fakeMouse()
        const s = service(m)
        const b = (await s.controls.getBindings('p0')).sensor as SensorBinding
        await s.controls.setBinding?.('p0', 'sensor', {
            ...b,
            stages: [400, 800, 1600],
            active: 1,
            poll: 1000,
            settings: {
                ...b.settings,
                debounceMs: 4,
                angleSnap: true,
                rotation: -12,
            },
        })
        const now = parseConfig(m.cfg)
        expect(now.dpi.slice(0, 3)).toEqual([400, 800, 1600])
        expect(now.enabledStages).toBe(3)
        expect(now.stage).toBe(1)
        expect(A7X.rates[now.rateIndex]).toBe(1000)
        expect(now.debounceMs).toBe(4)
        expect(now.sensor.angleSnap).toBe(true)
        expect(now.sensor.lod).toBe(2)
        expect(now.sensor.rotation).toBe(-12)
        expect(m.cfg[49]).toBe(0xf4)
        const writes = m.sent
            .map((x) => x[0])
            .filter((c) => c !== 0x67 && c !== 0x06)
        expect(writes).toEqual([0x40, 0x41, 0x42, 0x43])
    })

    it('writes separate X/Y stages and reads them back', async () => {
        const m = fakeMouse()
        const s = service(m)
        expect((await s.controls.getCatalog()).sensor?.separateXY).toBe(true)
        const b = (await s.controls.getBindings('p0')).sensor as SensorBinding
        await s.controls.setBinding?.('p0', 'sensor', {
            ...b,
            stagesY: [100, 400, 1600, 3200, 6400, 42000],
        })
        const now = parseConfig(m.cfg)
        expect(now.dpi[0]).toBe(200)
        expect(now.dpiY.slice(0, 3)).toEqual([100, 400, 1600])
        const back = (await s.controls.getBindings('p0'))
            .sensor as SensorBinding
        expect(back.stagesY?.[2]).toBe(1600)
        await s.controls.setBinding?.('p0', 'sensor', {
            ...back,
            stagesY: undefined,
        })
        expect(parseConfig(m.cfg).dpiY).toEqual(parseConfig(m.cfg).dpi)
    })

    it('sends a dropped command again', async () => {
        const m = fakeMouse({ dropFirst: 0x42 })
        const s = service(m)
        const b = (await s.controls.getBindings('p0')).sensor as SensorBinding
        await s.controls.setBinding?.('p0', 'sensor', {
            ...b,
            settings: { ...b.settings, liftCutoff: 1 },
        })
        expect(parseConfig(m.cfg).sensor.lod).toBe(1)
        expect(m.sent.filter((x) => x[0] === 0x42)).toHaveLength(2)
    })

    it('switches profile on the mouse', async () => {
        const m = fakeMouse()
        const s = service(m)
        await s.controls.selectProfile?.('p2')
        expect(m.cfg[0]).toBe(2)
        expect((await s.controls.getProfiles()).activeId).toBe('p2')
    })

    it('reads battery and link through the wireless status', async () => {
        const s = service(fakeMouse())
        expect(await s.wireless.getStatus()).toEqual({
            transport: 'p24g',
            battery: { level: 14, charging: true },
        })
    })

    it('shows default buttons as what they do natively', async () => {
        const s = service(fakeMouse())
        expect(s.capabilities.saveMode).toBe('automatic')
        const b = await s.controls.getBindings('p0')
        expect(b.lmb).toEqual({ a: 'mchose:1:010000' })
        expect(b.rmb).toEqual({ a: 'mchose:1:020000' })
        expect((b.wheel as { click: string }).click).toBe('mchose:1:040000')
        expect(b.fwd).toEqual({ a: 'mchose:1:100000' })
        expect(b.back).toEqual({ a: 'mchose:1:080000' })
        const catalog = await s.controls.getCatalog()
        expect(catalog.groups.map((g) => g.id)).not.toContain('other')
        const model = await s.controls.getModel()
        expect(model.controls.map((c) => c.id)).not.toContain('dpi')
    })

    it('binds a key to a button with 0x12 0x52', async () => {
        const m = fakeMouse()
        const s = service(m)
        const catalog = await s.controls.getCatalog()
        const a = catalog.actions.find((x) => x.usage === ((7 << 16) | 0x04))
        expect(a?.id).toBe('mchose:2:000400')
        await s.controls.setBinding?.('p0', 'fwd', { a: a!.id })
        expect(Array.from(m.cfg.slice(32, 36))).toEqual([0x32, 0, 4, 0])
        await s.controls.setBinding?.('p0', 'back', { a: null })
        expect(Array.from(m.cfg.slice(36, 40))).toEqual([
            0x49, 0xff, 0xff, 0xff,
        ])
        expect((await s.controls.getBindings('p0')).back).toEqual({ a: null })
    })

    it('refuses to take away the last left click', async () => {
        const m = fakeMouse()
        const s = service(m)
        await expect(
            s.controls.setBinding?.('p0', 'lmb', { a: 'mchose:1:020000' }),
        ).rejects.toThrow(/Left click/)
        expect(m.sent.some((x) => x[0] === 0x52)).toBe(false)
        await s.controls.setBinding?.('p0', 'back', { a: 'mchose:1:010000' })
        await s.controls.setBinding?.('p0', 'lmb', { a: 'mchose:1:020000' })
        expect(m.cfg[20]).toBe(0x01)
    })

    it('lists a slot it does not know, so it still shows', async () => {
        const m = fakeMouse()
        m.cfg.set([0x47, 0, 0, 1], 36) // a vendor function on the rear button
        const s = service(m)
        const b = await s.controls.getBindings('p0')
        const catalog = await s.controls.getCatalog()
        expect(b.back).toEqual({ a: 'mchose:7:000001' })
        expect(
            catalog.actions.find((x) => x.id === 'mchose:7:000001')?.group,
        ).toBe('other')
    })
})

describe('MCHOSE adapter', () => {
    const transport = (feature?: FeatureReports): Transport =>
        ({
            label: 'MCHOSE A7X Ultra · 3837:1009',
            abortController: new AbortController(),
            readable: new ReadableStream(),
            writable: new WritableStream(),
            ...(feature ? { feature } : {}),
        }) as Transport

    it('declines a transport without feature reports', async () => {
        expect((await mchoseAdapter.canHandle(transport())).ok).toBe(false)
    })

    it('declines another vendor without asking it', async () => {
        const m = fakeMouse()
        const t = { ...transport(m.hid), label: 'Other · 1209:0001' }
        expect((await mchoseAdapter.canHandle(t as Transport)).ok).toBe(false)
        expect(m.sent).toHaveLength(0)
    })
})

// Pages read off a real A7X Ultra holding 20 events (10 key taps, A..J).
const HW_PAGES = [
    hexBytes(`04 01 00 00 3a 01 01 00 00 00 14 00 81 04 00 00 01 04 00 00 81 05 00
        00 01 05 00 00 81 06 00 00 01 06 00 00 81 07 00 00 01 07 00 00 81 08 00
        00 01 08 00 00 81 09 00 00 01 09 00 00 81 0a 00`),
    hexBytes(`04 00 3a 00 1c 00 01 0a 00 00 81 0b 00 00 01 0b 00 00 81 0c 00 00 01
        0c 00 00 81 0d 00 00 01 0d 00 00`),
]

describe('MCHOSE macros', () => {
    it('reads a two-page macro off the mouse', () => {
        const m = parseMacro(HW_PAGES)
        expect(m.condition).toBe(MacroMode.ONCE)
        expect(m.events).toHaveLength(20)
        const steps = actionsOf(m.events)
        expect(steps).toHaveLength(10)
        expect(steps[0]).toEqual({ kind: 'tap', keycode: 0x04 })
        expect(steps[9]).toEqual({ kind: 'tap', keycode: 0x0d })
    })

    it('pages a long macro the way the mouse takes it', () => {
        const events = eventsOf(
            Array.from({ length: 10 }, (_, i) => ({
                kind: 'tap' as const,
                keycode: 0x04 + i,
            })),
        )
        const packets = macroPackets(4, { ...parseMacro([]), events })
        expect(packets.map((p) => p.length)).toEqual([64, 34])
        expect(packets[0].slice(0, 6)).toEqual([0x55, 4, 1, 0, 0, 58])
        expect(packets[1].slice(0, 6)).toEqual([0x55, 4, 0, 58, 0, 28])
    })

    it('encodes keys, mouse buttons and delays; refuses text', () => {
        expect(
            eventsOf([
                { kind: 'down', keycode: (9 << 16) | 1 },
                { kind: 'delay', ms: 70000 },
                { kind: 'up', keycode: (9 << 16) | 5 },
            ]),
        ).toEqual([
            [0, 0x88, 0x01, 0],
            [0, 0x0f, 0xff, 0xff],
            [0, 0x0f, 0x71, 0x11],
            [0, 0x08, 0x10, 0],
        ])
        expect(() => eventsOf([{ kind: 'text', text: 'hi' }])).toThrow(/text/)
        expect(() =>
            eventsOf([{ kind: 'tap', keycode: (0x0c << 16) | 0xe9 }]),
        ).toThrow(/keyboard keys/)
        const many = Array.from({ length: 101 }, () => ({
            kind: 'tap' as const,
            keycode: 4,
        }))
        expect(() => eventsOf(many)).toThrow(/200/)
    })

    it('writes a macro, which binds its button, and reads it back', async () => {
        const m = fakeMouse()
        const s = service(m)
        expect(s.macros.getCount()).toBe(5)
        expect(s.macros.listNames?.()[0]).toBe('Side · front')
        expect(await s.macros.getMacro(0)).toEqual([])
        const steps = [
            { kind: 'tap' as const, keycode: 0x04 },
            { kind: 'delay' as const, ms: 30 },
            { kind: 'down' as const, keycode: (9 << 16) | 1 },
            { kind: 'up' as const, keycode: (9 << 16) | 1 },
        ]
        await s.macros.setMacro?.(0, steps)
        expect(m.names[3]).toBe('Remappr · Side · front')
        expect(m.cfg[32]).toBe(0x34)
        expect((await s.controls.getBindings('p0')).fwd).toEqual({
            a: 'mchose:4:000000',
        })
        expect(await s.macros.getMacro(0)).toEqual([
            steps[0],
            steps[1],
            { kind: 'tap', keycode: (9 << 16) | 1 },
        ])
        await expect(s.macros.getMacro(5)).rejects.toThrow(/No macro/)
    })

    it('asks again when the waking mouse answers an empty page', async () => {
        const m = fakeMouse()
        const s = service(m)
        await s.macros.setMacro?.(0, [{ kind: 'tap', keycode: 0x05 }])
        let empty = 1
        const hid: FeatureReports = {
            send: m.hid.send,
            receive: async (report, length) => {
                const last = m.sent[m.sent.length - 1]
                if (last[0] !== 0x65 || empty-- <= 0) {
                    return m.hid.receive(report, length)
                }
                const zero = new Uint8Array(length).fill(0xff)
                zero.set([0x65 ^ 0xff, 3 ^ 0xff])
                return zero
            },
        }
        const s2 = new MchoseMouseService({
            link: new MchoseLink(hid, noWait),
            model: A7X,
            deviceInfo: { name: A7X.name, firmware: 'mchose' },
            config: parseConfig(m.cfg),
        })
        expect(await s2.macros.getMacro(0)).toEqual([
            { kind: 'tap', keycode: 0x05 },
        ])
    })

    it('reads and writes how a macro plays', async () => {
        const m = fakeMouse()
        const s = service(m)
        expect(s.macros.playModes).toEqual([
            'once',
            'whileHeld',
            'toggle',
            'untilAnyKey',
        ])
        expect(await s.macros.getPlayMode?.(0)).toBe('once')
        const steps = [{ kind: 'tap' as const, keycode: 0x05 }]
        await s.macros.setMacro?.(0, steps, 'toggle')
        expect(m.streams[3].slice(0, 3)).toEqual([1, 0x01, 0x40])
        expect(await s.macros.getPlayMode?.(0)).toBe('toggle')
        await s.macros.setMacro?.(0, steps) // no mode: keeps toggle
        expect(await s.macros.getPlayMode?.(0)).toBe('toggle')
        await s.macros.setMacro?.(0, steps, 'untilAnyKey')
        expect(m.streams[3].slice(1, 3)).toEqual([0x01, 0x60])
    })

    it('refuses a page garbled by the name write, accepts a real one', () => {
        // Read off the A7X right after a name write: header, then name bytes.
        const garbled = hexBytes(`03 00 00 00 16 61 70 70 72 20 c2 b7 20 53 69
            64 65 20 c2 b7 20 66 72 6f 6e 74`)
        const good = hexBytes(`03 00 00 00 16 01 01 00 00 00 04 00 81 0b 00 00
            01 0b 00 00 81 0c 00 00 01 0c 00 00`)
        expect(pageFits(garbled, 3, 0)).toBe(false)
        expect(pageFits(good, 3, 0)).toBe(true)
        expect(pageFits(good, 4, 0)).toBe(false)
        expect(pageFits(HW_PAGES[0], 4, 0)).toBe(true)
        expect(pageFits(HW_PAGES[1], 4, 1)).toBe(true)
    })

    it('sends a macro again when the mouse drops it', async () => {
        const m = fakeMouse({ dropFirst: 0x55 })
        const s = service(m)
        await s.macros.setMacro?.(0, [{ kind: 'tap', keycode: 0x05 }], 'toggle')
        expect(m.sent.filter((b) => b[0] === 0x55)).toHaveLength(2)
        expect(await s.macros.getMacro(0)).toEqual([
            { kind: 'tap', keycode: 0x05 },
        ])
    })

    it('clearing a macro puts its button back to default', async () => {
        const m = fakeMouse()
        const s = service(m)
        await s.macros.setMacro?.(1, [{ kind: 'tap', keycode: 0x05 }])
        expect(m.cfg[36]).toBe(0x44)
        await s.macros.setMacro?.(1, [])
        expect(m.cfg[36]).toBe(0x40)
        expect(await s.macros.getMacro(1)).toEqual([])
    })

    it('keeps how a macro plays when its steps change', async () => {
        const m = fakeMouse()
        const s = service(m)
        m.cfg[36] = 0x44
        m.streams[4] = [1, 0x01, 0x20, 0, 0, 0] // while held, no steps
        await s.macros.setMacro?.(1, [{ kind: 'tap', keycode: 0x05 }])
        expect(m.streams[4].slice(0, 6)).toEqual([1, 0x01, 0x20, 0, 0, 2])
    })

    it('will not make the only left click a macro', async () => {
        const m = fakeMouse()
        const s = service(m)
        await expect(
            s.macros.setMacro?.(4, [{ kind: 'tap', keycode: 0x05 }]),
        ).rejects.toThrow(/Left click/)
        expect(m.sent.some((b) => b[0] === 0x55)).toBe(false)
    })

    it('offers Macro only where a button holds one', async () => {
        const m = fakeMouse()
        const s = service(m)
        let catalog = await s.controls.getCatalog()
        expect(catalog.groups.map((g) => g.id)).not.toContain('macro')
        await expect(
            s.controls.setBinding?.('p0', 'rmb', { a: 'mchose:4:000000' }),
        ).rejects.toThrow(/Macros/)
        await s.macros.setMacro?.(0, [{ kind: 'tap', keycode: 0x05 }])
        catalog = await s.controls.getCatalog()
        const macro = catalog.actions.find((a) => a.id === 'mchose:4:000000')
        expect(macro).toMatchObject({ group: 'macro', label: 'Macro' })
    })
})
