// pattern-check: skip — test wiring for the autocorrect dictionary encoder.
//
// The load-bearing cases are the byte-identity ones: the encoder's output for a
// given dictionary must equal the bytes hard-coded in the FIRMWARE's own suites
// (remappr-firmware/tests/autocorrect/src/test_autocorrect.c). Those tables were
// written against the format spec independently, so matching them proves the two
// sides agree — which no amount of self-consistent round-tripping would.
import { describe, expect, it } from 'vitest'

import {
    AUTOCORRECT_MAX_TYPO,
    encodeAutocorrectDictionary,
} from './autocorrect'

const HDR_MATCH = 0x80

describe('autocorrect dictionary encoder', () => {
    it('matches the firmware suite byte-for-byte: single entry', () => {
        // tests/autocorrect/src/test_autocorrect.c :: dict_teh
        const expected = Uint8Array.from([
            0x00, 0x68, 0x65, 0x74, 0x00, // chain "het" (teh reversed)
            0x81, 0x03, 0x03, 0x74, 0x68, 0x65, 0x00, // match: bs 3, "the"
        ])

        expect(
            encodeAutocorrectDictionary([{ typo: 'teh', correction: 'the' }]),
        ).toEqual(expected)
    })

    it('matches the firmware suite byte-for-byte: nested entries', () => {
        // tests/autocorrect/src/test_autocorrect.c :: dict_nested_encoded.
        //
        // "thte" extends "hte", so the match node also carries a continuation.
        // A single continuation is a one-character CHAIN (3 bytes), not a BRANCH
        // (5) — the firmware suite additionally keeps a hand-written BRANCH-shaped
        // variant of this same dictionary, because both shapes are legal and the
        // decoder has to handle either.
        const expected = Uint8Array.from([
            0x00, 0x65, 0x74, 0x68, 0x00, // chain "eth" (hte reversed)
            0x80, 0x03, 0x03, 0x74, 0x68, 0x65, // match: bs 3, "the"
            0x74, 0x00, // ... continuing with a one-character chain 't'
            0x81, 0x04, 0x04, 0x74, 0x68, 0x61, 0x74, 0x00, // match: bs 4, "that"
        ])

        expect(
            encodeAutocorrectDictionary([
                { typo: 'hte', correction: 'the' },
                { typo: 'thte', correction: 'that' },
            ]),
        ).toEqual(expected)
    })

    it('is order-independent', () => {
        // The trie is a set, so authoring order must not change the bytes —
        // otherwise a reordered JSON file would churn the config version.
        const a = encodeAutocorrectDictionary([
            { typo: 'hte', correction: 'the' },
            { typo: 'thte', correction: 'that' },
        ])
        const b = encodeAutocorrectDictionary([
            { typo: 'thte', correction: 'that' },
            { typo: 'hte', correction: 'the' },
        ])

        expect(a).toEqual(b)
    })

    it('sorts branch children ascending', () => {
        // The firmware's validator rejects an unsorted branch outright, and its
        // lookup stops early on the first character greater than the one sought.
        const bytes = encodeAutocorrectDictionary([
            { typo: 'zq', correction: 'x' },
            { typo: 'aq', correction: 'y' },
        ])
        // Root is a BRANCH over the last characters; both typos end in 'q', so
        // the shared 'q' chains first and the fan-out is on 'a' vs 'z'.
        const branchChars = [...bytes].filter((b) => b === 0x61 || b === 0x7a)

        expect(branchChars.indexOf(0x61)).toBeLessThan(branchChars.indexOf(0x7a))
    })

    it('emits every branch offset forward of its own node', () => {
        // This is what makes the format acyclic; the firmware refuses a
        // dictionary with a backward offset.
        const bytes = encodeAutocorrectDictionary([
            { typo: 'aq', correction: 'x' },
            { typo: 'bq', correction: 'y' },
            { typo: 'cq', correction: 'z' },
        ])
        // Walk the root chain to the branch node, then check its offsets.
        let i = 0
        expect(bytes[i] & 0x01).toBe(0x00) // root is a chain ("q")
        i++
        while (bytes[i] !== 0x00) i++
        i++ // past the terminator: the branch node
        const nodeOff = i

        expect(bytes[nodeOff] & 0x01).toBe(0x01)
        let p = nodeOff + 1
        let seen = 0

        while (bytes[p] !== 0x00) {
            const off = bytes[p + 1] | (bytes[p + 2] << 8)

            expect(off).toBeGreaterThan(nodeOff)
            seen++
            p += 3
        }
        expect(seen).toBe(3)
    })

    it('folds typo case but preserves correction case', () => {
        // A typo is a typo however it was shifted; the replacement is typed
        // literally, so "Teh" -> "The" must keep its capital.
        const lower = encodeAutocorrectDictionary([
            { typo: 'teh', correction: 'The' },
        ])
        const upper = encodeAutocorrectDictionary([
            { typo: 'TEH', correction: 'The' },
        ])

        expect(upper).toEqual(lower)
        expect([...lower]).toContain(0x54) // 'T' survives in the replacement
    })

    it('returns empty for no entries', () => {
        // An empty payload is meaningful on the wire: it clears the device's
        // dictionary without dropping the table.
        expect(encodeAutocorrectDictionary([])).toEqual(new Uint8Array())
    })

    it('never emits a match at the root', () => {
        // The firmware rejects it — it would "correct" the empty string on every
        // keystroke — so an encoder that could produce one is a live hazard.
        const bytes = encodeAutocorrectDictionary([
            { typo: 'a', correction: 'b' },
        ])

        expect(bytes[0] & HDR_MATCH).toBe(0)
    })

    it('rejects a typo longer than the firmware history', () => {
        const tooLong = 'a'.repeat(AUTOCORRECT_MAX_TYPO + 1)

        expect(() =>
            encodeAutocorrectDictionary([{ typo: tooLong, correction: 'x' }]),
        ).toThrow(/could never match/)
    })

    it('rejects characters the keyboard cannot track or type', () => {
        expect(() =>
            encodeAutocorrectDictionary([{ typo: 'te h', correction: 'the' }]),
        ).toThrow(/cannot track/)
        expect(() =>
            encodeAutocorrectDictionary([{ typo: 'teh', correction: 'the!' }]),
        ).toThrow(/cannot type/)
    })

    it('rejects a duplicate typo', () => {
        // Silently keeping one of them would make the shipped dictionary differ
        // from the authored one.
        expect(() =>
            encodeAutocorrectDictionary([
                { typo: 'teh', correction: 'the' },
                { typo: 'teh', correction: 'tea' },
            ]),
        ).toThrow(/duplicate/)
    })
})
