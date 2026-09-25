// Pattern check: no GoF pattern (-) — rejected — regression tests for the Vial definition decoder; plain assertions over byte fixtures.
//
// Vial firmware sends its definition as an XZ stream. The client used to
// decode it as raw LZMA1, which misread the XZ header as a size field and
// allocated until the renderer ran out of memory: connecting a real Vial board
// froze the page. The fixture is the definition read off a real board (the
// Aftermarket Keycult TKL build, vial-qmk).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { ProtocolError } from '@firmware/errors'
import { xzStore } from '@firmware/__tests__/xz'
import keycultSource from '@firmware/kle/fixtures/aftermarket-keycult-tkl.vial.json?raw'

import { decompressDef } from './keyboardDef'

const deviceDef = new Uint8Array(
    readFileSync(
        new URL(
            '../../kle/fixtures/aftermarket-keycult-tkl.def.xz',
            import.meta.url,
        ),
    ),
)

describe('decompressDef', () => {
    it('decodes the definition read from a real Vial board', async () => {
        const def = await decompressDef(deviceDef)
        expect(def).toEqual(JSON.parse(keycultSource))
    })

    it('decodes a stored XZ stream', async () => {
        const json = {
            name: 'Fake Vial',
            matrix: { rows: 1, cols: 1 },
            layouts: { keymap: [['0,0']] },
        }
        const def = await decompressDef(
            xzStore(new TextEncoder().encode(JSON.stringify(json))),
        )
        expect(def.matrix).toEqual({ rows: 1, cols: 1 })
    })

    it('rejects raw LZMA1 instead of decoding it', async () => {
        // lzma-alone header: props 0x5d, 64 KiB dictionary, unknown size.
        const lzmaAlone = Uint8Array.from([
            0x5d,
            0x00,
            0x00,
            0x01,
            0x00,
            ...Array(8).fill(0xff),
            0x00,
        ])
        await expect(decompressDef(lzmaAlone)).rejects.toThrow(
            /not an XZ stream/,
        )
    })

    it('rejects a corrupt XZ stream as a protocol error', async () => {
        const corrupt = deviceDef.slice()
        corrupt.fill(0xa5, 24)
        await expect(decompressDef(corrupt)).rejects.toBeInstanceOf(
            ProtocolError,
        )
    })

    it('stops decoding once the output passes the cap', async () => {
        const big = xzStore(new Uint8Array(200_000).fill(0x20))
        await expect(decompressDef(big, 64 * 1024)).rejects.toThrow(
            /exceeds 65536-byte cap/,
        )
    })
})
