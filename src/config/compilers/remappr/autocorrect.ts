// Pattern check: no GoF pattern (-) — rejected — trie builder + two-pass serializer
// with backpatching; algorithmic code behind one entry point, no variant family.
//
// TBL_AUTOCORRECT encoder (§5.2-E): {typo -> correction} pairs to the serialized
// trie the firmware walks. The format is specified in the firmware's
// include/remappr/autocorrect.h — read that first; this file only has to produce
// exactly what it describes:
//
//   u8 header        bit7 = a typo ends here, bit0 = node kind
//   if match:  u8 backspaces, u8 repl_len, u8 repl[repl_len]
//   CHAIN (bit0=0):  u8 chars[], 0x00   — the next node follows the terminator
//   BRANCH (bit0=1): { u8 ch, u16 offset LE }*, terminated by ch == 0x00
//
// Typos are stored REVERSED, because the device matches against the characters
// typed so far and walks newest-character-first.
//
// Three invariants the firmware's validator enforces, so the encoder must too or
// the device silently refuses the dictionary:
//   - branch children sorted ascending by character, no duplicates
//   - every branch offset strictly GREATER than the node it leaves (this is what
//     makes the format acyclic, and it falls out of emitting parents first)
//   - no typo longer than MAX_TYPO characters

/** Longest typo the firmware can match (REMAPPR_AUTOCORRECT_MAX_TYPO). */
export const AUTOCORRECT_MAX_TYPO = 24

const HDR_MATCH = 0x80
const KIND_CHAIN = 0x00
const KIND_BRANCH = 0x01

/** One dictionary entry: type `typo`, get `correction`. */
export interface AutocorrectEntry {
    /** The misspelling, as typed. */
    typo: string
    /** What to leave behind once the typo is deleted. */
    correction: string
}

/**
 * Characters the firmware's usage↔character mapping can both TRACK and TYPE.
 * Anything else would either never match or produce an untypeable replacement,
 * so it is rejected here rather than at the device where the failure is silent.
 */
const TYPO_ALPHABET = /^[a-z0-9'-]+$/
const REPL_ALPHABET = /^[A-Za-z0-9'-]*$/

interface TrieNode {
    children: Map<number, TrieNode>
    /** Set on the node that ends a typo. */
    match?: { backspaces: number; repl: number[] }
}

const newNode = (): TrieNode => ({ children: new Map() })

function buildTrie(entries: AutocorrectEntry[]): TrieNode {
    const root = newNode()

    for (const { typo, correction } of entries) {
        const lower = typo.toLowerCase()

        if (!TYPO_ALPHABET.test(lower)) {
            throw new Error(
                `autocorrect: typo ${JSON.stringify(typo)} has characters the ` +
                    `keyboard cannot track (allowed: a-z 0-9 ' -)`,
            )
        }
        if (!REPL_ALPHABET.test(correction)) {
            throw new Error(
                `autocorrect: correction ${JSON.stringify(correction)} has ` +
                    `characters the keyboard cannot type (allowed: A-Z a-z 0-9 ' -)`,
            )
        }
        if (lower.length > AUTOCORRECT_MAX_TYPO) {
            throw new Error(
                `autocorrect: typo ${JSON.stringify(typo)} is longer than the ` +
                    `${AUTOCORRECT_MAX_TYPO}-character history the firmware keeps, ` +
                    `so it could never match`,
            )
        }
        if (correction.length > 255) {
            throw new Error(
                `autocorrect: correction for ${JSON.stringify(typo)} exceeds 255 bytes`,
            )
        }

        // Reversed: the device walks backwards from the newest character.
        let node = root
        for (let i = lower.length - 1; i >= 0; i--) {
            const ch = lower.charCodeAt(i)
            let next = node.children.get(ch)

            if (next === undefined) {
                next = newNode()
                node.children.set(ch, next)
            }
            node = next
        }
        if (node.match !== undefined) {
            throw new Error(
                `autocorrect: duplicate entry for typo ${JSON.stringify(typo)}`,
            )
        }
        node.match = {
            // Delete the whole typo: the device fires on its last character, so
            // that character is already in the host's buffer too.
            backspaces: lower.length,
            repl: [...correction].map((c) => c.charCodeAt(0)),
        }
    }
    return root
}

/**
 * Walk the single-child, match-free run leaving @p node, returning the
 * characters it consumes and the node it lands on. An empty run means this node
 * is a BRANCH (a fan-out, a leaf, or a single child whose target carries a
 * match — that last one still gets a one-character chain, see below).
 */
function chainRun(node: TrieNode): { chars: number[]; tail: TrieNode } | null {
    if (node.children.size !== 1) return null

    const chars: number[] = []
    let cur = node

    for (;;) {
        if (cur.children.size !== 1) break
        const [ch, next] = [...cur.children.entries()][0]

        chars.push(ch)
        cur = next
        // Intermediate states have no representation in a chain, so the run has
        // to stop at anything that needs one: a match, or a fan-out.
        if (cur.match !== undefined || cur.children.size !== 1) break
    }
    return { chars, tail: cur }
}

/**
 * Serialize the trie. Nodes are emitted parent-first, which is what makes every
 * branch offset point forward — the acyclicity the firmware's validator checks.
 * Branch offsets are backpatched once the child has been placed.
 */
function serialize(root: TrieNode): Uint8Array {
    const out: number[] = []

    const emit = (node: TrieNode): void => {
        const run = chainRun(node)
        const kind = run !== null ? KIND_CHAIN : KIND_BRANCH

        out.push(kind | (node.match !== undefined ? HDR_MATCH : 0))
        if (node.match !== undefined) {
            out.push(node.match.backspaces, node.match.repl.length)
            out.push(...node.match.repl)
        }

        if (run !== null) {
            out.push(...run.chars, 0x00)
            // The chain's target follows immediately — that is how the decoder
            // finds it, and it keeps the run contiguous in memory.
            emit(run.tail)
            return
        }

        // BRANCH: sorted so the device's scan can stop early on a miss, and so a
        // given dictionary has exactly one encoding.
        const kids = [...node.children.entries()].sort((a, b) => a[0] - b[0])
        const patch: { at: number; child: TrieNode }[] = []

        for (const [ch, child] of kids) {
            out.push(ch)
            patch.push({ at: out.length, child })
            out.push(0x00, 0x00) // offset placeholder
        }
        out.push(0x00) // end of list

        for (const { at, child } of patch) {
            const off = out.length

            if (off > 0xffff) {
                throw new Error(
                    'autocorrect: dictionary exceeds the 64 KiB the 16-bit ' +
                        'node offsets can address — split it or drop entries',
                )
            }
            out[at] = off & 0xff
            out[at + 1] = (off >> 8) & 0xff
            emit(child)
        }
    }

    emit(root)
    return Uint8Array.from(out)
}

/**
 * Encode dictionary entries into the TBL_AUTOCORRECT payload.
 *
 * Returns an empty array for no entries, which is meaningful on the wire: an
 * empty table clears the device's dictionary without dropping the table.
 *
 * Throws on anything the device would reject or silently never match —
 * unsupported characters, a typo longer than the firmware's history, a duplicate
 * typo, or a dictionary too large for 16-bit offsets.
 */
export function encodeAutocorrectDictionary(
    entries: AutocorrectEntry[],
): Uint8Array {
    if (entries.length === 0) return new Uint8Array()
    return serialize(buildTrie(entries))
}
