// Pattern check: no GoF pattern (-) — rejected — runtime VIA def lookup against the-via/keyboards + Keychron/keyboards via GitHub trees + raw endpoints; progress reported through onStatus callback.
//
// Strategy: VIA-format defs are GPL-3.0 — we never bundle them. At runtime, on
// keyboard connect, the renderer kicks off `findDef(vid, pid, onStatus)` which:
//   1. Hits the Trees API once per repo (cached 24h in localStorage) to list
//      every v3/**/*.json blob.
//   2. Narrows by a VID → vendor-folder hint table when possible (Keychron VID
//      0x3434 → "keychron" folder, etc.) so we only fetch ~50 raw files
//      instead of ~2000.
//   3. Fetches matching blobs via raw.githubusercontent.com in batches and
//      stops at the first VID/PID match.
//   4. Parses through the shared KLE parser. Result cached in localStorage.

import {
    type ParsedKeyboardDef,
    parseKeyboardDef,
    validateDef,
} from '@firmware/kle/parser'
import { createLogger } from '@shared/logger'

const log = createLogger('viaRegistry')

// pattern-check: skip — config DTO with predicate fn, plain data
interface Source {
    repo: string
    branch: string
    keep: (path: string) => boolean
    onlyVid?: number
}

const SOURCES: Source[] = [
    {
        repo: 'the-via/keyboards',
        branch: 'master',
        keep: (p) => p.startsWith('v3/') && p.endsWith('.json'),
    },
    {
        repo: 'Keychron/keyboards',
        branch: 'master',
        keep: (p) => p.startsWith('v3/') && p.endsWith('.json'),
    },
    {
        repo: 'Keychron/qmk_firmware',
        branch: '2025q3',
        keep: (p) => /^keyboards\/keychron\/.+\/via_json\/.+\.json$/.test(p),
        onlyVid: 0x3434,
    },
    {
        repo: 'Keychron/qmk_firmware',
        branch: 'wls_2025q1',
        keep: (p) => /^keyboards\/keychron\/.+\/via_json\/.+\.json$/.test(p),
        onlyVid: 0x3434,
    },
]

const TREE_API = (repo: string, branch: string): string =>
    `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`
const RAW = (repo: string, branch: string, p: string): string =>
    `https://raw.githubusercontent.com/${repo}/${branch}/${p}`
const TREE_CACHE_KEY = 'qmk-via-tree:v2:'
const TREE_TTL_MS = 24 * 60 * 60 * 1000
const PARALLEL = 6
const TIMEOUT_MS = 8000

// Narrow the v3/-style path scan by VID-prefix → likely vendor folder(s).
const VID_VENDOR_HINTS: Record<number, string[]> = {
    0x3434: ['keychron'],
    0x445a: ['drop', 'massdrop'],
    0xfeed: ['1upkeyboards', 'feed'],
}

export type LookupStatus =
    | { phase: 'cache-hit' }
    | { phase: 'listing'; repo: string; branch: string }
    | {
          phase: 'scanning'
          repo: string
          branch: string
          processed: number
          total: number
      }
    | { phase: 'hit'; repo: string; branch: string; path: string; name: string }
    | { phase: 'miss' }
    | { phase: 'error'; message: string }

type StatusCb = (s: LookupStatus) => void

interface TreeEntry {
    path: string
    type: 'blob' | 'tree'
}

interface TreeCacheEntry {
    v: 1
    ts: number
    paths: string[]
}

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function treeCacheKey(repo: string, branch: string): string {
    return `${TREE_CACHE_KEY}${repo}@${branch}`
}

function readTreeCache(repo: string, branch: string): string[] | null {
    const store = getStorage()
    if (!store) return null
    const text = store.getItem(treeCacheKey(repo, branch))
    if (!text) return null
    try {
        const entry = JSON.parse(text) as TreeCacheEntry
        if (entry.v !== 1) return null
        if (Date.now() - entry.ts > TREE_TTL_MS) return null
        return entry.paths
    } catch {
        return null
    }
}

function writeTreeCache(repo: string, branch: string, paths: string[]): void {
    const store = getStorage()
    if (!store) return
    const entry: TreeCacheEntry = { v: 1, ts: Date.now(), paths }
    try {
        store.setItem(treeCacheKey(repo, branch), JSON.stringify(entry))
    } catch {
        /* ignore quota */
    }
}

async function fetchWithTimeout(
    url: string,
    init?: RequestInit,
): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
        return await fetch(url, { ...init, signal: ctrl.signal })
    } finally {
        clearTimeout(timer)
    }
}

async function listSourcePaths(src: Source): Promise<string[]> {
    const cached = readTreeCache(src.repo, src.branch)
    if (cached) {
        log.info(
            `tree cache hit ${src.repo}@${src.branch}: ${cached.length} paths`,
        )
        return cached
    }
    log.info(`fetching tree ${src.repo}@${src.branch}…`)
    const res = await fetchWithTimeout(TREE_API(src.repo, src.branch), {
        headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
        throw new Error(`tree ${src.repo}@${src.branch}: HTTP ${res.status}`)
    }
    const body = (await res.json()) as { tree?: TreeEntry[] }
    const paths = (body.tree ?? [])
        .filter((n) => n.type === 'blob' && src.keep(n.path))
        .map((n) => n.path)
    log.info(`tree ${src.repo}@${src.branch}: ${paths.length} candidate paths`)
    writeTreeCache(src.repo, src.branch, paths)
    return paths
}

function narrowV3ByVendorHint(paths: string[], vid: number): string[] {
    const hints = VID_VENDOR_HINTS[vid]
    if (!hints || hints.length === 0) return paths
    const lower = hints.map((h) => `v3/${h}/`)
    return paths.filter((p) => lower.some((prefix) => p.startsWith(prefix)))
}

// pattern-check: skip — token-expansion + scored narrowing heuristic
const STOP_TOKENS = new Set([
    'keychron',
    'keyboard',
    'rgb',
    'white',
    'ansi',
    'iso',
    'jis',
    'mac',
    'win',
    'wired',
    'wireless',
    'bt',
])

function productTokens(productName: string): string[] {
    const raw = productName
        .toLowerCase()
        .replace(/[_\-/.]+/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 1 && /^[a-z0-9]+$/.test(t))
        .filter((t) => !STOP_TOKENS.has(t))
    const out = new Set<string>()
    for (const t of raw) {
        if (t.length < 2) continue
        out.add(t)
        const m = t.match(/^([a-z]+)(\d+)$/)
        if (m) {
            const [, prefix, digits] = m
            out.add(digits)
            if (prefix === 'v') {
                out.add(`version_${digits}`)
                out.add(`version${digits}`)
            }
        }
    }
    return [...out]
}

const MAX_CANDIDATES = 12

function narrowByProductTokens(
    paths: string[],
    productName: string | undefined,
): string[] {
    if (!productName) return paths
    const tokens = productTokens(productName)
    if (tokens.length === 0) return paths
    const scored = paths.map((p) => {
        const lower = p.toLowerCase()
        let score = 0
        for (const t of tokens) if (lower.includes(t)) score += 1
        return { p, score }
    })
    const positive = scored.filter((s) => s.score > 0)
    // No path matches any product token — this source is unlikely to contain
    // the connected board. Skip it entirely instead of fetching random files.
    if (positive.length === 0) return []
    positive.sort((a, b) => b.score - a.score)
    return positive.slice(0, MAX_CANDIDATES).map((s) => s.p)
}

function hexId(n: number): string {
    return `0x${n.toString(16).padStart(4, '0').toLowerCase()}`
}

function matchesVidPid(json: unknown, vid: number, pid: number): boolean {
    if (!json || typeof json !== 'object') return false
    const obj = json as Record<string, unknown>
    const vidStr = (obj.vendorId as string | undefined)?.toLowerCase()
    const pidStr = (obj.productId as string | undefined)?.toLowerCase()
    return vidStr === hexId(vid) && pidStr === hexId(pid)
}

// pattern-check: skip — same shape as before, takes Source instead of bare repo
async function fetchAndMatch(
    src: Source,
    p: string,
    vid: number,
    pid: number,
): Promise<unknown | null> {
    let res: Response
    try {
        res = await fetchWithTimeout(RAW(src.repo, src.branch, p), {
            headers: { Accept: 'application/json' },
        })
    } catch {
        return null
    }
    if (!res.ok) return null
    let json: unknown
    try {
        json = await res.json()
    } catch {
        return null
    }
    return matchesVidPid(json, vid, pid) ? json : null
}

// pattern-check: skip — same shape as before, takes Source instead of bare repo
async function scanSource(
    src: Source,
    vid: number,
    pid: number,
    productName: string | undefined,
    onStatus: StatusCb,
): Promise<unknown | null> {
    onStatus({ phase: 'listing', repo: src.repo, branch: src.branch })
    const allPaths = await listSourcePaths(src)
    const vendorNarrowed = allPaths[0]?.startsWith('v3/')
        ? narrowV3ByVendorHint(allPaths, vid)
        : allPaths
    const candidates = narrowByProductTokens(vendorNarrowed, productName)
    log.info(
        `${src.repo}@${src.branch}: ${vendorNarrowed.length} vendor-narrowed → ${candidates.length} after product tokens`,
    )
    if (candidates.length === 0) {
        // Surface the empty-scan so the banner moves off 'listing' immediately.
        onStatus({
            phase: 'scanning',
            repo: src.repo,
            branch: src.branch,
            processed: 0,
            total: 0,
        })
        return null
    }
    let processed = 0
    for (let i = 0; i < candidates.length; i += PARALLEL) {
        const batch = candidates.slice(i, i + PARALLEL)
        const results = await Promise.all(
            batch.map((p) =>
                fetchAndMatch(src, p, vid, pid).then((j) => ({ p, j })),
            ),
        )
        processed += batch.length
        onStatus({
            phase: 'scanning',
            repo: src.repo,
            branch: src.branch,
            processed,
            total: candidates.length,
        })
        const hit = results.find((r) => r.j)
        if (hit) {
            const name =
                ((hit.j as Record<string, unknown>).name as string) ?? 'Unknown'
            onStatus({
                phase: 'hit',
                repo: src.repo,
                branch: src.branch,
                path: hit.p,
                name,
            })
            return hit.j
        }
    }
    return null
}

// pattern-check: skip — same iteration as before, replaces REPOS loop with SOURCES
export async function findDef(
    vid: number,
    pid: number,
    productName: string | undefined,
    onStatus: StatusCb = () => undefined,
): Promise<ParsedKeyboardDef | null> {
    try {
        for (const src of SOURCES) {
            if (src.onlyVid !== undefined && src.onlyVid !== vid) continue
            const json = await scanSource(src, vid, pid, productName, onStatus)
            if (json) {
                try {
                    return parseKeyboardDef(validateDef(json))
                } catch (err) {
                    onStatus({
                        phase: 'error',
                        message: `parse failed: ${(err as Error).message}`,
                    })
                    return null
                }
            }
        }
        onStatus({ phase: 'miss' })
        return null
    } catch (err) {
        onStatus({
            phase: 'error',
            message: (err as Error).message ?? 'unknown error',
        })
        return null
    }
}
