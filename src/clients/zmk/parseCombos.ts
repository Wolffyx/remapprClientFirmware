// Pattern check: no GoF pattern (-) — rejected — single-pass devicetree
// fragment parser for ZMK combos { … }; block. The grammar is trivial
// enough that a hand-rolled scanner with brace-balance tracking beats
// pulling in a full devicetree AST library; the caller wants a flat
// list of combo descriptors, not a tree.
//
// Limitations (documented for the sideload UI):
//   - Resolves no #include / preprocessor macros — fed source is read
//     as-is. Real keymaps with `#include <dt-bindings/...>` will lose
//     symbolic keycode names; `bindings` stays raw text.
//   - No expression evaluation — `<(0|1)>` style bitfields are kept as
//     literal strings.
//   - Strips /* */ and // comments before parsing.
//   - Looks for ANY `combos { … };` block (top-level or nested under
//     `/ { … }`); the first one wins. Multi-block keymaps are unusual.

export interface ParsedCombo {
    name: string
    keyPositions: number[]
    bindings: string
    timeoutMs?: number
    layers?: number[]
}

const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const findCombosBlock = (src: string): string | null => {
    const re = /combos\s*\{/g
    const m = re.exec(src)
    if (!m) return null
    let depth = 1
    let i = re.lastIndex
    const start = i
    while (i < src.length && depth > 0) {
        const ch = src[i]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        i++
    }
    if (depth !== 0) return null
    return src.slice(start, i - 1)
}

// Walk top-level `name { … };` nodes inside the combos body. Skip
// property assignments at this level (compatible = "..."; etc.).
const splitNodes = (body: string): { name: string; body: string }[] => {
    const nodes: { name: string; body: string }[] = []
    let i = 0
    while (i < body.length) {
        while (i < body.length && /\s/.test(body[i])) i++
        if (i >= body.length) break
        const nameStart = i
        while (i < body.length && /[A-Za-z0-9_]/.test(body[i])) i++
        const name = body.slice(nameStart, i)
        while (i < body.length && /\s/.test(body[i])) i++
        if (body[i] !== '{') {
            // Property — skip to terminating semicolon.
            const semi = body.indexOf(';', i)
            if (semi === -1) break
            i = semi + 1
            continue
        }
        i++ // consume '{'
        const innerStart = i
        let depth = 1
        while (i < body.length && depth > 0) {
            if (body[i] === '{') depth++
            else if (body[i] === '}') depth--
            i++
        }
        const innerEnd = i - 1
        // consume trailing ';' (and any whitespace).
        while (i < body.length && /[\s;]/.test(body[i])) i++
        if (name) {
            nodes.push({ name, body: body.slice(innerStart, innerEnd) })
        }
    }
    return nodes
}

const numberList = (s: string): number[] => {
    const out: number[] = []
    for (const tok of s.split(/\s+/)) {
        if (!tok) continue
        const n = Number(tok)
        if (Number.isFinite(n)) out.push(n)
    }
    return out
}

const propPattern = (key: string): RegExp =>
    new RegExp(`${key}\\s*=\\s*<([^>]*)>\\s*;`)

const parseNode = (name: string, body: string): ParsedCombo | null => {
    const kp = body.match(propPattern('key-positions'))
    const bind = body.match(/bindings\s*=\s*<([^>]*)>\s*;/)
    if (!kp || !bind) return null
    const timeout = body.match(propPattern('timeout-ms'))
    const layers = body.match(propPattern('layers'))
    return {
        name,
        keyPositions: numberList(kp[1]),
        bindings: bind[1].trim(),
        timeoutMs: timeout ? Number(timeout[1].trim()) : undefined,
        layers: layers ? numberList(layers[1]) : undefined,
    }
}

export function parseZmkCombos(source: string): ParsedCombo[] {
    const cleaned = stripComments(source)
    const block = findCombosBlock(cleaned)
    if (!block) return []
    const nodes = splitNodes(block)
    const combos: ParsedCombo[] = []
    for (const n of nodes) {
        const c = parseNode(n.name, n.body)
        if (c) combos.push(c)
    }
    return combos
}
