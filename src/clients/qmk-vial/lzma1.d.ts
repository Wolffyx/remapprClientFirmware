declare module 'lzma1' {
    export function decompress(
        data: Uint8Array | number[],
    ): Uint8Array | number[]

    export function decompressString(data: Uint8Array | number[]): string

    export function compress(data: Uint8Array, mode?: number): Uint8Array

    export function compressString(data: string, mode?: number): Uint8Array
}
