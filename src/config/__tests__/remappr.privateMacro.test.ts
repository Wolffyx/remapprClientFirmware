// L3.18: §17 private (write-only) macros can be authored, are written as
// TBL_MACRO v2, survive decode → encode, and a private macro whose steps the
// device blanked on read-back is never saved back as an empty macro.
import { describe, expect, it } from 'vitest'
import { parseKeymap } from '../index'
import { buildRemapprBlob } from '../compilers/remappr'
import { MacroOp, TableId } from '../compilers/remappr/blobWriter'
import { DecodeCode, decodeRemapprBlob } from '../compilers/remappr/decode'
import { assembleBlob, blobTables, keymapCore, type RawTable, tableOf, u16 } from './blobFixtures'

// count 1: num_steps 2, flags PRIVATE, reserved, then tap A, tap B.
const PRIVATE_MACRO: RawTable = {
    id: TableId.Macro,
    version: 2,
    payload: [...u16(1), ...u16(2), 1, 0, MacroOp.Tap, 0, ...u16(4), MacroOp.Tap, 0, ...u16(5)],
}

/** The blob as READ_CONFIG_CHUNK returns it: the private steps zeroed under the
 *  CRC the device computed over the real bytes (decode_macros.c). */
function redacted(blob: Uint8Array, table: number, from: number, to: number): Uint8Array {
    const out = blob.slice()
    const frames = blobTables(blob)
    let off = 20
    for (const t of frames) {
        if (t.id === table) {
            out.fill(0, off + 8 + from, off + 8 + to)
            break
        }
        off += 8 + t.payload.length
    }
    return out
}

const errors = (r: ReturnType<typeof buildRemapprBlob>): string[] =>
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)

const config = (priv: boolean) =>
    parseKeymap(`{
        "version": 2, "kind": "remappr.keymap",
        "meta": { "name": "Priv" },
        "keyboard": { "id": "p", "name": "Priv", "keys": [{"x":0,"y":0},{"x":1,"y":0}] },
        "layers": [{ "name": "base", "keys": [{ "type": "macro", "ref": "pw" }, "A"] }],
        "macros": [{ "id": "pw", ${priv ? '"private": true,' : ''}
            "steps": [{ "type": "tap", "key": "A" }, { "type": "tap", "key": "B" }] }]
    }`)

describe('private macros (L3.18)', () => {
    it('writes an authored private macro as TBL_MACRO v2 with the PRIVATE flag', () => {
        const { blob } = buildRemapprBlob(config(true), { configVersion: 1 })
        const t = tableOf(blob, TableId.Macro)!
        expect(t.version).toBe(2)
        expect(t.payload.slice(0, 6)).toEqual([...u16(1), ...u16(2), 1, 0])
    })

    it('keeps a blob without private macros on TBL_MACRO v1', () => {
        const { blob } = buildRemapprBlob(config(false), { configVersion: 1 })
        expect(tableOf(blob, TableId.Macro)!.version).toBe(1)
    })

    it('decodes the flag and re-encodes the same table', () => {
        const device = assembleBlob([...keymapCore(), PRIVATE_MACRO])
        const decoded = decodeRemapprBlob(device)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.macros![0]).toMatchObject({ private: true })
        expect(decoded.config!.macros![0].steps).toHaveLength(2)
        const { blob } = buildRemapprBlob(decoded.config!, { configVersion: 2 })
        expect(tableOf(blob, TableId.Macro)).toEqual(PRIVATE_MACRO)
    })

    it('reads a device blob whose private steps were blanked under its CRC', () => {
        const device = assembleBlob([...keymapCore(), PRIVATE_MACRO])
        const read = redacted(device, TableId.Macro, 6, 14)
        const decoded = decodeRemapprBlob(read)
        expect(decoded.code).toBe(DecodeCode.OK)
        expect(decoded.config!.macros![0]).toMatchObject({
            private: true,
            _redacted: true,
            steps: [],
        })
    })

    it('refuses to save a blanked private macro back as an empty one', () => {
        const read = redacted(assembleBlob([...keymapCore(), PRIVATE_MACRO]), TableId.Macro, 6, 14)
        const decoded = decodeRemapprBlob(read)
        const out = buildRemapprBlob(decoded.config!, { configVersion: 2, carryFrom: read })
        expect(errors(out).join()).toMatch(/private/)
    })

    it('saves a blanked private macro once its steps are entered again', () => {
        const read = redacted(assembleBlob([...keymapCore(), PRIVATE_MACRO]), TableId.Macro, 6, 14)
        const c = decodeRemapprBlob(read).config!
        const steps = config(true).macros![0].steps
        const out = buildRemapprBlob(
            { ...c, macros: [{ ...c.macros![0], steps }] },
            { configVersion: 2, carryFrom: read },
        )
        expect(errors(out)).toEqual([])
        expect(tableOf(out.blob, TableId.Macro)).toEqual(PRIVATE_MACRO)
    })

    it('reads a device blob whose cluster key was blanked, and refuses to save it', () => {
        const key = Array.from({ length: 16 }, (_, i) => 0xa0 + i)
        const device = assembleBlob([
            ...keymapCore(),
            { id: TableId.ClusterSec, version: 1, payload: key },
        ])
        const read = redacted(device, TableId.ClusterSec, 0, 16)
        const decoded = decodeRemapprBlob(read)
        expect(decoded.code).toBe(DecodeCode.OK)
        const out = buildRemapprBlob(decoded.config!, { configVersion: 2, carryFrom: read })
        expect(errors(out).join()).toMatch(/cluster key/)
    })

    it('still refuses a damaged blob that holds a private macro', () => {
        const bad = assembleBlob([...keymapCore(), PRIVATE_MACRO])
        bad[20 + 8] ^= 0xff // num_layers: real damage, not a redaction
        expect(decodeRemapprBlob(bad).code).toBe(DecodeCode.CRC)
    })
})
