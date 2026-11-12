// pattern-check: skip vitest cases, one group per behavior
import { describe, expect, it } from 'vitest'
import { buildRemapprDeviceBlob, decodeRemapprDeviceBlob, parseDeviceConfig, parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr/index'
import { decodeRemapprBlob, DecodeCode, readBlobFrames } from '../compilers/remappr/decode'
import { encodeDisplays, readDisplayTable } from '../compilers/remappr/display'
import { TableId } from '../compilers/remappr/blobWriter'
import type { ConfigDisplay } from '../types'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

// The page the nucleo rig drew in the host-sync HW check (relay-tools/
// hostsync.py built these bytes by hand; firmware accepted and drew them).
const HOSTSYNC: ConfigDisplay[] = [
    {
        part: 0,
        pages: [
            {
                default: true,
                widgets: [
                    { kind: 'text', x: 0, y: 0, w: 128, h: 9, text: 'Host sync', invert: true, align: 'centre' },
                    { kind: 'clock', x: 0, y: 11, w: 128, h: 16, font: 'large', format: 'hms', align: 'centre' },
                    { kind: 'clock', x: 0, y: 28, w: 128, h: 8, format: 'date', align: 'centre' },
                    { kind: 'text', x: 0, y: 40, w: 24, h: 8, text: 'CPU' },
                    { kind: 'value', x: 26, y: 40, w: 24, h: 8, source: 'host.cpu' },
                    { kind: 'bar', x: 52, y: 40, w: 76, h: 8, source: 'host.cpu', max: 100 },
                    { kind: 'value', x: 0, y: 54, w: 128, h: 8, source: 'host.user0' },
                ],
            },
        ],
    },
]
const HOSTSYNC_HEX =
    '01070c0000000000000007010103000080090000000009000502000b80100101000000000502001c800800020000000001000028180800000900030002001a281808004200000000030034284c08004200006400020000368008005000000000486f73742073796e63435055'

describe('TBL_DISPLAY', () => {
    it('writes the bytes the firmware drew on the rig', () => {
        const { payload, problems } = encodeDisplays(HOSTSYNC)
        expect(problems).toEqual([])
        expect(hex(payload!)).toBe(HOSTSYNC_HEX)
    })

    it('reads back what it writes', () => {
        const smile = Buffer.from([0x3c, 0x42, 0xa5, 0x81, 0xa5, 0x99, 0x42, 0x3c]).toString('base64')
        const displays: ConfigDisplay[] = [
            ...HOSTSYNC,
            {
                part: 3,
                pages: [
                    { widgets: [{ kind: 'image', x: 1, y: 2, w: 8, h: 8, image: { width: 8, height: 8, data: smile } }] },
                    { widgets: [{ kind: 'rect', x: 0, y: 0, w: 10, h: 4, frame: true }, { kind: 'text', x: 0, y: 8, w: 30, h: 8, text: 'CPU' }] },
                ],
            },
        ]
        const { payload } = encodeDisplays(displays)
        expect(readDisplayTable(payload!, 0, payload!.length)).toEqual(displays)
        // "CPU" is stored once.
        expect(payload![2] | (payload![3] << 8)).toBe(12)
    })

    it('names what it cannot write', () => {
        const bad: ConfigDisplay[] = [
            {
                part: 0,
                pages: [
                    {
                        widgets: [
                            { kind: 'value', x: 0, y: 0, w: 8, h: 8, source: 'nope' },
                            { kind: 'image', x: 0, y: 0, w: 8, h: 8, image: { width: 8, height: 2, data: 'AA==' } },
                        ],
                    },
                ],
            },
        ]
        const { payload, problems } = encodeDisplays(bad)
        expect(payload).toBeUndefined()
        expect(problems.map((p) => p.path)).toEqual([
            [0, 'pages', 0, 'widgets', 0],
            [0, 'pages', 0, 'widgets', 1],
        ])
        const many: ConfigDisplay[] = [
            { part: 0, pages: [{ widgets: Array.from({ length: 65 }, () => ({ kind: 'rect' as const, x: 0, y: 0, w: 1, h: 1 })) }] },
        ]
        expect(encodeDisplays(many).problems[0].message).toMatch(/65 widgets.*holds 64/)
    })

    it('rides a keymap blob as node.displays', () => {
        const config = parseKeymap(
            JSON.stringify({
                schemaVersion: 1,
                kind: 'remappr.keymap',
                meta: { name: 'Tiny', target: 'remappr' },
                keyboard: { id: 't', name: 'T', keys: [{ x: 0, y: 0 }] },
                layers: [{ name: 'base', bindings: ['A'] }],
                node: { displays: HOSTSYNC },
            }),
        )
        const { blob, diagnostics } = buildRemapprBlob(config, { configVersion: 1 })
        expect(diagnostics).toEqual([])
        const t = readBlobFrames(blob).frames.find((f) => f.id === TableId.Display)!
        expect(hex(blob.subarray(t.start, t.end))).toBe(HOSTSYNC_HEX)
        const decoded = decodeRemapprBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.node?.displays).toEqual(HOSTSYNC)
    })

    it('reports a bad display in a keymap as an error', () => {
        const config = parseKeymap(
            JSON.stringify({
                schemaVersion: 1,
                kind: 'remappr.keymap',
                meta: { name: 'Tiny', target: 'remappr' },
                keyboard: { id: 't', name: 'T', keys: [{ x: 0, y: 0 }] },
                layers: [{ name: 'base', bindings: ['A'] }],
                node: { displays: [{ part: 0, pages: [{ widgets: [{ kind: 'value', x: 0, y: 0, w: 8, h: 8, source: 'nope' }] }] }] },
            }),
        )
        const { diagnostics } = buildRemapprBlob(config, { configVersion: 1 })
        expect(diagnostics[0].path).toEqual(['node', 'displays', 0, 'pages', 0, 'widgets', 0])
    })

    it('rides a mouse document and reads back', () => {
        const doc = parseDeviceConfig(
            JSON.stringify({
                schemaVersion: 1,
                kind: 'remappr.device',
                meta: { name: 'M' },
                personality: 'mouse',
                displays: HOSTSYNC,
            }),
        )
        const blob = buildRemapprDeviceBlob(doc, { configVersion: 1 })
        const decoded = decodeRemapprDeviceBlob(blob)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.displays).toEqual(HOSTSYNC)
    })

    it('needs what each kind draws', () => {
        expect(() =>
            parseDeviceConfig(
                JSON.stringify({
                    schemaVersion: 1,
                    kind: 'remappr.device',
                    meta: { name: 'M' },
                    personality: 'mouse',
                    displays: [{ part: 0, pages: [{ widgets: [{ kind: 'bar', x: 0, y: 0, w: 8, h: 8, source: 'battery' }] }] }],
                }),
            ),
        ).toThrow(/a bar widget needs/)
    })
})
