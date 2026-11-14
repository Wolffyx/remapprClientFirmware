// pattern-check: skip — test wiring: golden shields for the board generator.
//
// Each `__golden__/<name>.json` is a board as a user writes it. Its generated
// shield is checked in under `__golden__/<name>/`, compared byte for byte, and
// (where cpp, dtc and the Zephyr + firmware trees are present) compiled with
// dtc. A change to the generator that moves any line shows up in review as a
// diff of these files; refresh them with `pnpm vitest run -u` after checking
// the diff is the intended one.
//
// `remappr_bench14.json` is the firmware's bench board. Its golden overlay is
// what boards/shields/remappr_bench14 in the firmware should hold.
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { getCompiler, parseKeymap } from '../../index'
import { dtcCheck, dtcToolchain } from './dtcHarness'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '__golden__')
const TC = dtcToolchain()
const BOARDS = readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()

describe.each(BOARDS)('golden shield %s', (name) => {
    const config = parseKeymap(readFileSync(join(DIR, `${name}.json`), 'utf8'))
    const res = getCompiler('remappr-board').compile(config)

    it('compiles without errors', () => {
        expect(res.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    })

    it.each(res.files.map((f) => [basename(f.filename), f] as const))(
        'matches %s',
        async (file, f) => {
            await expect(String(f.content)).toMatchFileSnapshot(
                join(DIR, name, file),
            )
        },
    )

    it.skipIf(!TC)('builds with dtc', () => {
        const overlay = res.files.find((f) => f.filename.endsWith('.overlay'))!
        const r = dtcCheck(TC!, String(overlay.content))
        expect(r.log).toBe('')
        expect(r.ok).toBe(true)
    })
})

it('has golden boards', () => {
    expect(BOARDS.length).toBeGreaterThanOrEqual(4)
})
