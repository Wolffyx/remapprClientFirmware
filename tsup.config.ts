import { defineConfig } from 'tsup'

// One bundled ESM entry per importable subpath. esbuild inlines imported JSON
// and resolves the internal @firmware/@/@shared aliases from tsconfig `paths`.
// `splitting` dedupes shared code into chunks. Keys become the dist file paths,
// which the package.json `./*` wildcard export maps onto.
export default defineConfig({
    entry: {
        index: 'src/index.ts',
        builtins: 'src/builtins.ts',
        registry: 'src/registry.ts',
        service: 'src/service.ts',
        types: 'src/types.ts',
        codec: 'src/codec.ts',
        adapter: 'src/adapter.ts',
        mouseCommands: 'src/mouseCommands.ts',
        legendIcons: 'src/legendIcons.ts',
        paramLabel: 'src/paramLabel.ts',
        lighting: 'src/lighting.ts',
        config: 'src/config/index.ts',
        catalog: 'src/catalog/index.ts',
        'catalog/types': 'src/catalog/types.ts',
        'catalog/pages': 'src/catalog/pages.ts',
        zmk: 'src/zmk/index.ts',
        'zmk/index': 'src/zmk/index.ts',
        'zmk/codec': 'src/zmk/codec.ts',
        'zmk/displayNameToBinding': 'src/zmk/displayNameToBinding.ts',
        'zmk/parseCombos': 'src/zmk/parseCombos.ts',
        'zmk/paramLabel': 'src/zmk/paramLabel.ts',
        qmk: 'src/qmk/index.ts',
        'qmk/codec': 'src/qmk/codec.ts',
        'qmk/layoutSideload': 'src/qmk/layoutSideload.ts',
        'qmk/viaRegistry': 'src/qmk/viaRegistry.ts',
        'qmk-vial': 'src/qmk-vial/index.ts',
        keychron: 'src/keychron/index.ts',
        mock: 'src/mock/index.ts',
        'mock/codec': 'src/mock/codec.ts',
        'mock/service': 'src/mock/service.ts',
        remappr: 'src/remappr/index.ts',
        'remappr/protocol': 'src/remappr/protocol.ts',
        'remappr/auth': 'src/remappr/auth.ts',
        'remappr/actions': 'src/remappr/actions.ts',
        'remappr/configEditing': 'src/remappr/configEditing.ts',
        'via/lightingMenu': 'src/via/lightingMenu.ts',
    },
    format: ['esm'],
    target: 'es2022',
    platform: 'neutral',
    splitting: true,
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    // Copy raw .json (catalog hid-pages, usage tables, seed) into dist so the
    // `./*.json` export resolves for consumers importing them directly.
    onSuccess:
        "rsync -a --prune-empty-dirs --include='*/' --include='*.json' --exclude='*' src/ dist/",
})
