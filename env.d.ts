// The vendored logger reads `import.meta.env.DEV` (Vite/electron-vite inject it).
// In a plain TS/node build `import.meta.env` is absent, so type it as optional —
// the logger already guards access at runtime.
interface ImportMeta {
    readonly env?: {
        readonly DEV?: boolean
        readonly MODE?: string
        readonly [key: string]: unknown
    }
}
