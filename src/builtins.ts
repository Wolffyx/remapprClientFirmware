// pattern-check: skip — barrel of side-effect imports + one marker fn; extends existing Registry bootstrap (config/index.ts)
// Single bootstrap for every built-in firmware. Importing the per-firmware
// barrels registers their adapters (registry.ts), and importing the config
// module registers their keymap compilers (config/compilers/*). Apps call
// `registerBuiltinFirmwares()` once at boot instead of importing each by hand —
// adding a new built-in firmware then means a new line here, nothing in the apps.
//
// External / third-party firmwares need no change here: implement FirmwareAdapter
// + KeymapCompiler in your own module and call registerAdapter() / registerCompiler()
// at boot.
import './zmk'
import './qmk'
import './qmk-vial'
import './keychron'
import './mock'
import './remappr'
import './config'

/**
 * Ensure all built-in firmware adapters and compilers are registered. Idempotent
 * (the registries dedupe by id/target). Exists as an explicit, tree-shake-safe
 * entry point — the side-effect imports above do the actual registration.
 */
export function registerBuiltinFirmwares(): void {
    /* registration happens via the side-effect imports above */
}
