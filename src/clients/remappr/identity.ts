// pattern-check: skip — warm-cache glue over the host secret store; the Strategy
// it feeds is declared in auth.ts (setRemapprIdentityStore).
//
// Durable persistence for the §19 control-auth host identity (a 32-byte X25519
// secret), so it survives app restarts. Without it, auth.ts's defaultStore falls
// back to an in-memory keypair — its localStorage probe is captured at
// module-eval, which is undefined in the app's bundle context — and a fresh
// identity is minted every launch. A keyboard that TOFU-bonded the first
// launch's key then rejects every later reconnect at the FINISH bond gate with
// ERR_AUTH.
//
// This lives in the Remappr client, not the app: the storage KEY, the hex
// encoding and the 32-byte length rule are all Remappr protocol details. The
// host only supplies an anonymous durable string store (see @firmware/hostEnv).
//
// RemapprIdentityStore.load() is synchronous but the host backend is async, so
// the secret is preloaded once into a cache and exposed as a sync facade with
// async write-through. `warmRemapprIdentity` is the adapter's `prepare` hook, so
// the registry awaits it before the first connect.
import { hostSecretStore } from '@firmware/hostEnv'
import { setRemapprIdentityStore } from './auth'

/** Host-store key for the persisted identity (32-byte X25519 secret, hex). */
const IDENTITY_KEY = 'remappr.identity.v1'
/** 32-byte X25519 secret == 64 hex chars. */
const HEX_LEN = 64

const toHex = (u: Uint8Array): string =>
    Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string): Uint8Array =>
    Uint8Array.from(s.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [])

let cached: Uint8Array | null = null
let warmOnce: Promise<void> | null = null

/**
 * Read the persisted identity into the cache and install a sync
 * RemapprIdentityStore over it. Idempotent + memoized, so every connect path can
 * await it cheaply. A missing or corrupt stored value simply leaves the cache
 * null: loadOrCreateIdentity() then mints a fresh identity and save() persists
 * it under the same key for the next launch.
 */
export function warmRemapprIdentity(): Promise<void> {
    if (warmOnce) return warmOnce
    warmOnce = (async () => {
        const host = hostSecretStore()
        try {
            const hex = await host.get(IDENTITY_KEY)
            if (hex && hex.length === HEX_LEN) cached = fromHex(hex)
        } catch {
            /* no stored identity yet — loadOrCreateIdentity() will mint one */
        }
        setRemapprIdentityStore({
            load: () => cached,
            save: (priv) => {
                cached = priv
                void host.set(IDENTITY_KEY, toHex(priv))
            },
        })
    })()
    return warmOnce
}
