import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Mirror the tsconfig `paths` so tests run against src with the same aliases the
// firmware folder used inside the original app.
export default defineConfig({
    resolve: {
        alias: {
            '@firmware': r('./src'),
            '@shared': r('./src/_app/shared'),
            '@': r('./src/_app'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        server: {
            deps: {
                // Its ESM build imports without file extensions; let Vite
                // resolve them instead of Node.
                inline: ['@zmkfirmware/zmk-studio-ts-client'],
            },
        },
    },
})
