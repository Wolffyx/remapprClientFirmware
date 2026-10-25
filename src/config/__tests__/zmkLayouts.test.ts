// pattern-check: skip — unit tests for ZMK physical layouts per builder variant.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getCompiler, parseKeymap } from '../index'
import type { ConfigKeymap } from '../types'

const seed = parseKeymap(
    readFileSync(
        fileURLToPath(
            new URL('../../clients/mock/seed.keymap.json', import.meta.url),
        ),
        'utf8',
    ),
)

/** The seed with `tag(i)` as each key's variant and the given variants. */
function withVariants(
    tag: (i: number) => string | undefined,
    layouts = [
        { id: 'full', name: 'Full' },
        { id: 'small', name: 'Small' },
    ],
): ConfigKeymap {
    return {
        ...seed,
        keyboard: {
            ...seed.keyboard,
            keys: seed.keyboard.keys.map((k, i) => {
                const variant = tag(i)
                return variant ? { ...k, variant } : k
            }),
            layouts,
        },
    }
}

function compile(config: ConfigKeymap): {
    keymap: string
    overlay: string
    warnings: string[]
} {
    const { files, diagnostics } = getCompiler('zmk').compile(config)
    const text = (ext: string): string =>
        String(files.find((f) => f.filename.endsWith(ext))!.content)
    return {
        keymap: text('.keymap'),
        overlay: text('.overlay'),
        warnings: diagnostics.map((d) => d.message),
    }
}

const keysOf = (overlay: string, label: string): number => {
    const node = overlay.split(`${label}: ${label} {`)[1]!.split('};')[0]!
    return (node.match(/key_physical_attrs/g) ?? []).length
}

const firstLayerBindings = (keymap: string): number =>
    (
        keymap
            .split('compatible = "zmk,keymap"')[1]!
            .split('bindings = <')[1]!
            .split('>;')[0]!
            .match(/&/g) ?? []
    ).length

describe('ZMK physical layouts per variant', () => {
    // Keys 0 and 1 only in "full": the "small" layout has 34 keys.
    const config = withVariants((i) => (i < 2 ? 'full' : undefined))
    const { keymap, overlay, warnings } = compile(config)

    it('emits one physical layout and transform per variant; the first is chosen', () => {
        expect(keysOf(overlay, 'physical_layout_full')).toBe(36)
        expect(keysOf(overlay, 'physical_layout_small')).toBe(34)
        expect(overlay).toContain('transform = <&transform_full>;')
        expect(overlay).toContain('transform_small: keymap_transform_1 {')
        expect(overlay).not.toContain('physical_layout_default')
    })

    it('keeps the keys a layout lacks off its end, so the map is complete', () => {
        expect(overlay).toContain('compatible = "zmk,physical-layout-position-map";')
        expect(overlay).toContain('complete;')
        const small = overlay
            .split('physical_layout_small_map {')[1]!
            .match(/positions = <([^>]*)>/)![1]!
        expect(small.split(' ').slice(0, 3)).toEqual(['34', '35', '0'])
    })

    it('writes the keymap in the default layout order', () => {
        expect(firstLayerBindings(keymap)).toBe(36)
        expect(warnings.join(' ')).not.toContain('unknown layout variant')
    })

    it('maps combo positions into the default layout keymap order', () => {
        // Default = "small": keys 0/1 sit off its end (positions 34/35, kept
        // in the keymap), and tab [5,6] moves to [3,4].
        const swapped = compile({
            ...config,
            keyboard: {
                ...config.keyboard,
                layouts: [...config.keyboard.layouts!].reverse(),
            },
        })
        expect(firstLayerBindings(swapped.keymap)).toBe(36)
        expect(swapped.keymap).toContain('key-positions = <3 4>;')
        expect(swapped.keymap).toContain('key-positions = <34 35>;')
        // The default layout comes first (it is the `chosen` one when the
        // board has a kscan).
        expect(swapped.overlay.indexOf('physical_layout_small:')).toBeLessThan(
            swapped.overlay.indexOf('physical_layout_full:'),
        )
    })

    it('warns about a key tagged into an unknown variant and keeps it everywhere', () => {
        const r = compile(withVariants((i) => (i === 0 ? 'ghost' : undefined)))
        expect(r.warnings.join(' ')).toContain('unknown layout variant "ghost"')
        expect(keysOf(r.overlay, 'physical_layout_small')).toBe(36)
    })

    it('leaves the map incomplete when variant-only keys do not fit off the end', () => {
        // "full" has key 0 only, "small" keys 1 and 2: 37 keys in all, room for 36.
        const r = compile(
            withVariants((i) => (i === 0 ? 'full' : i < 3 ? 'small' : undefined)),
        )
        expect(r.overlay).toContain('physical-layout-position-map')
        expect(r.overlay).not.toContain('complete;')
        expect(r.warnings.join(' ')).toContain('do not fit off the end')
    })

    it('a board without variants keeps its single default layout', () => {
        const r = compile(seed)
        expect(r.overlay).toContain('physical_layout_default: physical_layout_default {')
        expect(r.overlay).not.toContain('position-map')
    })
})
