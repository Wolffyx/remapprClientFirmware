// Pattern check: Strategy (Tier 1) — extended — the host's durable secret
// backend as a pluggable strategy, injected once at boot; same seam idiom as
// remappr/auth.ts's setRemapprIdentityStore, hoisted to be firmware-neutral.
//
// Services a firmware client can only get from its host application. A client
// cannot know whether it is running in Electron (OS keychain over IPC), a
// browser (localStorage) or a test (memory) — but several clients DO need
// somewhere durable to keep a bonded identity, a paired key, a token.
//
// So the app injects the backend once and every client draws on it. The split is
// deliberate: the HOST owns storage; the CLIENT owns its key names, its value
// encoding and when to read them. Nothing firmware-specific belongs here.

/** Durable string key/value storage supplied by the host application. Keys are
 *  namespaced by the client that owns them (e.g. `'remappr.identity.v1'`).
 *  Reads resolve null when nothing is stored. */
export interface HostSecretStore {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
}

/** Process-memory fallback so Node, tests and any host that never injects a
 *  backend still work — just without durability across restarts. */
function memoryStore(): HostSecretStore {
    const mem = new Map<string, string>()
    return {
        async get(key) {
            return mem.get(key) ?? null
        },
        async set(key, value) {
            mem.set(key, value)
        },
    }
}

let store: HostSecretStore = memoryStore()

/** Install the host's durable secret backend. Call once at boot, before any
 *  connect path runs. */
export function setHostSecretStore(next: HostSecretStore): void {
    store = next
}

/** The installed backend, or the memory fallback if the host never injected one. */
export function hostSecretStore(): HostSecretStore {
    return store
}
