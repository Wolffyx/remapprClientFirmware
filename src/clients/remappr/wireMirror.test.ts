// The firmware wire items the client now mirrors (later audit PR 6): the HOST
// namespace (L3.10), Cap bits 8–11 and the DISPLAY input class (L3.11),
// GET_MANIFEST and ns_version gating (L3.13), GET_KEYMAP_BOUNDS max_layers
// (L3.13), and chunk sizes from GET_LIMITS (L3.15).
import { describe, expect, it } from 'vitest'
import { establishSession } from './adapter'
import { loadDeviceConfig, readConfigBlob, universalChunk, UNIVERSAL_CHUNK_DEFAULT } from './configRead'
import { type DiscoveryResult, servesNamespace } from './discovery'
import { clearHostValues, getHostKeys, servesHost, setHostInt, setHostText, setHostTime } from './host'
import { inputLayoutModel } from './inputLayout'
import { servesJoystick } from './joystick'
import {
    buildHostNumberArg,
    buildHostTextArgs,
    Cap,
    Feature,
    HOST_DATA_MAX,
    HOST_TEXT_MAX,
    HostKey,
    HostType,
    HostVerb,
    INPUT_NONE,
    InputClass,
    InputForm,
    InputShape,
    KeyboardVerb,
    Namespace,
    parseHostKeys,
    parseManifest,
    Status,
} from './protocol'
import { createRemapprRpc, type RemapprRpc, type UniversalReply } from './rpc'
import { SealedDevice, type Reply } from './sealedDevice.fixture'

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
const ok = (data: Uint8Array = new Uint8Array()): Reply => ({ status: Status.OK, data })

describe('HOST namespace (L3.10)', () => {
    it('builds INT and TIME values as the firmware reads them', () => {
        expect([...buildHostNumberArg(HostKey.CPU, HostType.INT, -2)]).toEqual([
            0x02, 0, 0, 4, 0xfe, 0xff, 0xff, 0xff,
        ])
        expect([...buildHostNumberArg(HostKey.TIME, HostType.TIME, 0x01020304)]).toEqual([
            0x01, 2, 0, 4, 4, 3, 2, 1,
        ])
        expect(() => buildHostNumberArg(0, HostType.INT, 1)).toThrow(/out of range/)
        expect(() => buildHostNumberArg(0x40, HostType.INT, 1)).toThrow(/out of range/)
        expect(() => buildHostNumberArg(1, HostType.TEXT, 1)).toThrow(/not a number/)
    })

    it('splits TEXT into in-order pieces of at most HOST_DATA_MAX bytes', () => {
        const text = 'x'.repeat(45)
        const pieces = buildHostTextArgs(HostKey.MEDIA_TITLE, text)
        expect(pieces.map((p) => [...p.subarray(0, 4)])).toEqual([
            [0x04, 1, 0, 45],
            [0x04, 1, 20, 45],
            [0x04, 1, 40, 45],
        ])
        expect(pieces.map((p) => p.length - 4)).toEqual([HOST_DATA_MAX, HOST_DATA_MAX, 5])
        expect(buildHostTextArgs(0x10, '')).toEqual([Uint8Array.of(0x10, 1, 0, 0)])
    })

    it('cuts TEXT to HOST_TEXT_MAX bytes without splitting a character', () => {
        const text = 'a'.repeat(63) + 'é' // 63 + 2 bytes
        const pieces = buildHostTextArgs(HostKey.NOTIFICATION, text)
        expect(pieces[0][3]).toBe(63) // total: the 2-byte é no longer fits
        const all = buildHostTextArgs(HostKey.NOTIFICATION, 'b'.repeat(100))
        expect(all[0][3]).toBe(HOST_TEXT_MAX)
    })

    it('parses GET_KEYS and refuses a short or newer reply', () => {
        expect(parseHostKeys(Uint8Array.of(1, 2, 0x01, 0x04))).toEqual([0x01, 0x04])
        expect(() => parseHostKeys(Uint8Array.of(1, 3, 1))).toThrow(/lists 3 keys/)
        expect(() => parseHostKeys(Uint8Array.of(2, 0))).toThrow(/version 2/)
    })

    function hostDevice(): { dev: SealedDevice; rpc: RemapprRpc; sets: Uint8Array[] } {
        const sets: Uint8Array[] = []
        const dev = new SealedDevice({
            serve: (ns, cmd, arg) => {
                if (ns !== Namespace.HOST) return { status: Status.ERR_CMD, data: new Uint8Array() }
                if (cmd === HostVerb.GET_KEYS) return ok(Uint8Array.of(1, 2, HostKey.TIME, HostKey.CPU))
                if (cmd === HostVerb.SET_VALUE) sets.push(Uint8Array.from(arg))
                return ok()
            },
        })
        return { dev, rpc: createRemapprRpc(dev.transport), sets }
    }

    it('reads keys in plaintext and seals SET_VALUE and CLEAR once a session is bound', async () => {
        const { dev, rpc, sets } = hostDevice()
        rpc.bindSession({ session: await establishSession(rpc), renew: () => establishSession(rpc) })
        expect(await getHostKeys(rpc)).toEqual([HostKey.TIME, HostKey.CPU])
        await setHostInt(rpc, HostKey.CPU, 42)
        await setHostTime(rpc, HostKey.TIME, 1_800_000_000)
        await setHostText(rpc, HostKey.MEDIA_TITLE, 'y'.repeat(30))
        await clearHostValues(rpc)
        expect(dev.served.map((s) => [s.form, s.cmd])).toEqual([
            ['universal', HostVerb.GET_KEYS],
            ['direct-sealed', HostVerb.SET_VALUE],
            ['direct-sealed', HostVerb.SET_VALUE],
            ['direct-sealed', HostVerb.SET_VALUE],
            ['direct-sealed', HostVerb.SET_VALUE],
            ['direct-sealed', HostVerb.CLEAR],
        ])
        expect(sets.slice(2).map((a) => a[2])).toEqual([0, 20]) // text offsets, in order
        await rpc.close({ abortTransport: true })
    })

    it('goes plaintext to a device with auth off', async () => {
        const { dev, rpc } = hostDevice()
        await setHostInt(rpc, HostKey.VOLUME, 70)
        expect(dev.served.at(-1)).toMatchObject({ form: 'universal', ns: Namespace.HOST })
        await rpc.close({ abortTransport: true })
    })

    it('surfaces a refusal by its status', async () => {
        const rpc = {
            callMutation: async (): Promise<UniversalReply> => ({ status: Status.ERR_STATE, data: new Uint8Array() }),
        } as unknown as RemapprRpc
        await expect(setHostInt(rpc, HostKey.RAM, 1)).rejects.toThrow(/SET_VALUE key 0x3 → ERR_STATE/)
    })
})

const discovery = (
    namespaces: number[],
    manifest?: { namespace: number; nsVersion: number }[],
): DiscoveryResult => ({
    protoMax: 2,
    deviceInfo: {
        protoMin: 1,
        protoMax: 2,
        schemaVersion: 3,
        fwMajor: 1,
        fwMinor: 0,
        fwPatch: 0,
        hwRev: 0,
        hasActive: false,
        configVersion: 0,
    },
    personality: {
        role: 0,
        personality: 1,
        protoMajor: 2,
        namespaces: namespaces.map((namespace) => ({ namespace, verbMask: 0 })),
        hwCaps: 0,
    },
    ...(manifest ? { manifest: { namespaces: manifest.map((m) => ({ ...m, verbs: [] })) } } : {}),
})

describe('GET_MANIFEST and ns_version gating (L3.13)', () => {
    it('parses the TLV list: namespace records and the limits', () => {
        const limits = [...le16(48), ...le16(16), ...le16(64), ...le16(16), ...le16(4096), 4, 1, 0x3f, 0x0f, 0, 0]
        const d = Uint8Array.from([
            ...le16(1), ...le16(4 + 8), Namespace.HOST, 1, ...le16(2),
            HostVerb.GET_KEYS, 0, ...le16(0), HostVerb.SET_VALUE, 0x03, ...le16(4),
            ...le16(9), ...le16(2), 0xaa, 0xbb, // an unknown TLV, skipped
            ...le16(2), ...le16(16), ...limits,
        ])
        const m = parseManifest(d)
        expect(m.namespaces).toEqual([
            {
                namespace: Namespace.HOST,
                nsVersion: 1,
                verbs: [
                    { verb: HostVerb.GET_KEYS, flags: 0, minArg: 0 },
                    { verb: HostVerb.SET_VALUE, flags: 3, minArg: 4 },
                ],
            },
        ])
        expect(m.limits?.maxConfigBytes).toBe(4096)
        expect(m.limits?.featureBitmask).toBe(0x0f3f)
    })

    it('refuses a manifest whose TLV runs past the reply', () => {
        expect(() => parseManifest(Uint8Array.from([...le16(1), ...le16(20), 1, 2]))).toThrow(/runs past/)
        expect(() => parseManifest(Uint8Array.from([...le16(1), ...le16(1), 0x0b]))).toThrow(/too short/)
    })

    it('treats a namespace in a newer ns_version as absent', () => {
        // JOYSTICK is provisional (v0): a v1 layout must not be read as v0.
        expect(servesJoystick(discovery([Namespace.JOYSTICK]))).toBe(true)
        expect(servesJoystick(discovery([Namespace.JOYSTICK], [{ namespace: Namespace.JOYSTICK, nsVersion: 0 }]))).toBe(true)
        expect(servesJoystick(discovery([Namespace.JOYSTICK], [{ namespace: Namespace.JOYSTICK, nsVersion: 1 }]))).toBe(false)
        expect(servesHost(discovery([Namespace.HOST], [{ namespace: Namespace.HOST, nsVersion: 2 }]))).toBe(false)
        expect(servesHost(discovery([Namespace.HOST]))).toBe(true)
        expect(servesNamespace(discovery([]), Namespace.HOST)).toBe(false)
    })
})

describe('caps, features and the DISPLAY input class (L3.11)', () => {
    it('names Cap bits 8–11 and the GET_LIMITS feature bits 6–11', () => {
        expect([Cap.HAPTIC, Cap.DISPLAY, Cap.ERR_COUNTERS, Cap.MOUSE]).toEqual([1 << 8, 1 << 9, 1 << 10, 1 << 11])
        expect([Feature.TBL_SLIDER, Feature.TBL_DISPLAY, Feature.TBL_POWER]).toEqual([1 << 6, 1 << 7, 1 << 8])
        expect([Feature.TBL_SENSOR_V2, Feature.TBL_MOUSE_V3, Feature.UNPAIR_ACTION]).toEqual([1 << 9, 1 << 10, 1 << 11])
    })

    it('draws a display input instead of dropping it', () => {
        const base = { position: INPUT_NONE, x: 0, y: 0, w: 200, h: 100, rot: 0, rotx: 0, roty: 0 }
        const m = inputLayoutModel(
            {
                form: InputForm.MACROPAD,
                entries: [
                    { ...base, cls: InputClass.KEY, shape: InputShape.AUTO, inputId: 0x0100 },
                    { ...base, cls: InputClass.DISPLAY, shape: InputShape.SCREEN, inputId: 0x0a00, x: 300 },
                ],
            },
            { name: 'Pad', fallbackForm: 'macropad' },
        )
        expect(m.controls).toHaveLength(2)
        expect(m.controls[1]).toMatchObject({ kind: 'display', shape: 'screen', name: 'Display' })
    })
})

describe('GET_KEYMAP_BOUNDS max_layers (L3.13)', () => {
    const rpcWithBounds = (maxLayers: number | null) =>
        ({
            callUniversalPlain: async (ns: number, verb: number): Promise<UniversalReply> => {
                if (ns === Namespace.KEYBOARD && verb === KeyboardVerb.GET_KEYMAP_BOUNDS && maxLayers !== null)
                    return { status: Status.OK, data: Uint8Array.of(maxLayers, 1, 0, 0) }
                return { status: Status.ERR_CMD, data: new Uint8Array() }
            },
        }) as unknown as RemapprRpc

    it('takes the layer capacity the device reports', async () => {
        const loaded = await loadDeviceConfig(rpcWithBounds(12), discovery([Namespace.KEYBOARD]))
        expect(loaded.maxLayers).toBe(12)
    })

    it('falls back to the old default where the device does not answer', async () => {
        const loaded = await loadDeviceConfig(rpcWithBounds(null), discovery([Namespace.KEYBOARD]))
        expect(loaded.maxLayers).toBe(16)
    })
})

describe('chunk sizes from GET_LIMITS (L3.15)', () => {
    it('uses max_unsealed_chunk, capped to one unfragmented reply', () => {
        expect(universalChunk(undefined)).toBe(UNIVERSAL_CHUNK_DEFAULT)
        expect(universalChunk(0)).toBe(UNIVERSAL_CHUNK_DEFAULT)
        expect(universalChunk(32)).toBe(32)
        expect(universalChunk(300)).toBe(49)
    })

    it('asks a relayed read for the device chunk', async () => {
        const wants: number[] = []
        const blob = new Uint8Array(70).fill(1)
        const rpc = {
            callUniversalPlain: async (_ns: number, _cmd: number, arg: Uint8Array): Promise<UniversalReply> => {
                const dv = new DataView(arg.buffer, arg.byteOffset)
                const off = dv.getUint32(0, true)
                const want = dv.getUint16(4, true)
                wants.push(want)
                return { status: Status.OK, data: blob.subarray(off, off + want) }
            },
        } as unknown as RemapprRpc
        const got = await readConfigBlob(rpc, true, { targetNode: 3, maxUnsealedChunk: 32 })
        expect(got).toHaveLength(70)
        expect(wants.every((w) => w === 32)).toBe(true)
    })
})
