// Pattern check: no GoF pattern (-) — rejected — test-only byte writer; one function over the XZ container layout, nothing to abstract.
//
// Minimal XZ writer for tests: one block, one LZMA2 filter, data stored in
// uncompressed LZMA2 chunks. The output is a real .xz stream (any XZ decoder,
// `xz -d` or Python's lzma, reads it), so tests exercise the same decoder as a
// Vial board's definition without shipping a compressor.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        t[n] = c >>> 0
    }
    return t
})()

function crc32(bytes: ArrayLike<number>): number {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    }
    return (c ^ 0xffffffff) >>> 0
}

function u32le(n: number): number[] {
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

function varint(n: number): number[] {
    const out: number[] = []
    while (n >= 0x80) {
        out.push((n & 0x7f) | 0x80)
        n = Math.floor(n / 0x80)
    }
    out.push(n)
    return out
}

function padTo4(bytes: number[]): void {
    while (bytes.length % 4 !== 0) bytes.push(0)
}

/** Wrap `data` in a valid XZ stream (CRC32 check, stored LZMA2 chunks). */
export function xzStore(data: Uint8Array): Uint8Array {
    const streamFlags = [0x00, 0x01] // check type: CRC32
    const out: number[] = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, ...streamFlags]
    out.push(...u32le(crc32(streamFlags)))

    // Block header: size byte, flags (1 filter, no sizes), LZMA2 filter with a
    // 1-byte dictionary property, padding, CRC32.
    const header = [0x00, 0x00, 0x21, 0x01, 0x00]
    while ((header.length + 4) % 4 !== 0) header.push(0)
    header[0] = (header.length + 4) / 4 - 1
    header.push(...u32le(crc32(header)))

    // LZMA2 stored chunks: 0x01 = uncompressed + dictionary reset, 0x02 =
    // uncompressed, then (size - 1) big-endian; 0x00 ends the stream.
    const lzma2: number[] = []
    for (let off = 0; off < data.length; off += 0x10000) {
        const chunk = data.subarray(off, off + 0x10000)
        lzma2.push(off === 0 ? 0x01 : 0x02)
        lzma2.push(((chunk.length - 1) >> 8) & 0xff, (chunk.length - 1) & 0xff)
        for (const b of chunk) lzma2.push(b)
    }
    lzma2.push(0x00)

    const block = [...header, ...lzma2]
    const unpaddedSize = block.length + 4
    padTo4(block)
    block.push(...u32le(crc32(data)))
    for (const b of block) out.push(b) // spread would overflow the stack on big data

    const index = [
        0x00,
        ...varint(1),
        ...varint(unpaddedSize),
        ...varint(data.length),
    ]
    padTo4(index)
    index.push(...u32le(crc32(index)))
    out.push(...index)

    const backward = [...u32le(index.length / 4 - 1), ...streamFlags]
    out.push(...u32le(crc32(backward)), ...backward, 0x59, 0x5a)
    return new Uint8Array(out)
}
