import { describe, expect, it } from 'vitest'

import { parseZmkCombos } from './parseCombos'

describe('parseZmkCombos', () => {
    it('returns empty array on source with no combos block', () => {
        expect(parseZmkCombos('/ { keymap { /* nope */ }; };')).toEqual([])
    })

    it('parses minimal combo with key-positions + bindings', () => {
        const src = `
            / {
                combos {
                    compatible = "zmk,combos";
                    combo_esc {
                        timeout-ms = <50>;
                        key-positions = <0 1>;
                        bindings = <&kp ESC>;
                    };
                };
            };
        `
        const out = parseZmkCombos(src)
        expect(out).toEqual([
            {
                name: 'combo_esc',
                keyPositions: [0, 1],
                bindings: '&kp ESC',
                timeoutMs: 50,
                layers: undefined,
            },
        ])
    })

    it('parses optional layers list', () => {
        const src = `
            combos {
                combo_tab {
                    key-positions = <2 3>;
                    bindings = <&kp TAB>;
                    layers = <0 2>;
                };
            };
        `
        const [c] = parseZmkCombos(src)
        expect(c.layers).toEqual([0, 2])
    })

    it('strips block and line comments', () => {
        const src = `
            // before
            combos {
                /* inside */
                combo_a {
                    key-positions = <1 2>; // trailing
                    bindings = <&kp A>;
                };
            };
        `
        const [c] = parseZmkCombos(src)
        expect(c.name).toBe('combo_a')
        expect(c.keyPositions).toEqual([1, 2])
    })

    it('parses multiple combos under one block', () => {
        const src = `
            combos {
                combo_a {
                    key-positions = <0 1>;
                    bindings = <&kp A>;
                };
                combo_b {
                    key-positions = <2 3>;
                    bindings = <&kp B>;
                };
            };
        `
        const out = parseZmkCombos(src)
        expect(out.map((c) => c.name)).toEqual(['combo_a', 'combo_b'])
    })

    it('skips child nodes missing required props', () => {
        const src = `
            combos {
                bogus { compatible = "x"; };
                combo_real {
                    key-positions = <0 1>;
                    bindings = <&kp X>;
                };
            };
        `
        const out = parseZmkCombos(src)
        expect(out).toHaveLength(1)
        expect(out[0].name).toBe('combo_real')
    })

    it('handles bindings with multiple tokens', () => {
        const src = `
            combos {
                combo_mt {
                    key-positions = <0 1>;
                    bindings = <&mt LSHIFT A>;
                };
            };
        `
        const [c] = parseZmkCombos(src)
        expect(c.bindings).toBe('&mt LSHIFT A')
    })
})
