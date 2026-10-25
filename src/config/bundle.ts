// Pattern check: no GoF pattern (-) — rejected — pure repo-skeleton file
// generators wrapping the existing compiler Strategy; string templating, no
// abstraction.
//
// Builds a ready-to-push firmware PROJECT bundle (not just the keymap files):
// the full repo skeleton + CI workflow + README the user can drop on GitHub
// (Actions builds the binary) or build locally. This is the Phase-1 zero-dep
// fallback — it never needs the cloud. The keymap/overlay/keymap.c come straight
// from the compilers (getCompiler); this module adds the surrounding scaffolding.

import type { ExportedFile } from '../types'
import type { Diagnostic } from './diagnostics'
import { getCompiler } from './compiler'
import {
    resolveController,
    zmkSplitShields,
    type ZmkSplitShields,
} from './controller'
import { dtsString } from './compilers/zmk/maps'
import { buildQmkKeyboardJson } from './compilers/qmkKeyboardJson'
import { buildViaJson } from './compilers/viaJson'
import { buildVialJson } from './compilers/vialJson'
import {
    deriveQmkConfigH,
    deriveQmkRulesMk,
    deriveZmkConf,
} from './firmwareConf'
import type { ConfigKeymap, Target } from './types'

export interface ProjectBundle {
    /** Files whose `filename` is the path INSIDE the archive. */
    files: ExportedFile[]
    diagnostics: Diagnostic[]
    /** Suggested archive base name (no extension). */
    rootName: string
}

const sanitize = (s: string): string =>
    s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'remappr'

const asText = (c: string | Uint8Array): string =>
    typeof c === 'string' ? c : new TextDecoder().decode(c)

const text = (filename: string, content: string): ExportedFile => ({
    filename,
    mime: 'text/plain',
    content,
})

/* ── ZMK ─────────────────────────────────────────────────────────────────── */

// The ZMK release the exported config builds against. Boards differ between a
// release and `main` (nice_nano_v2 is gone from main), so pin a release; bump
// it here and the workflow, the west manifest and the README all follow.
const ZMK_REVISION = 'v0.3'

const ZMK_BUILD_WORKFLOW = [
    `name: Build ZMK firmware`,
    `on: [push, pull_request, workflow_dispatch]`,
    `jobs:`,
    `  build:`,
    `    uses: zmkfirmware/zmk/.github/workflows/build-user-config.yml@${ZMK_REVISION}`,
    ``,
].join('\n')

const ZMK_WEST_YML = [
    `manifest:`,
    `  remotes:`,
    `    - name: zmkfirmware`,
    `      url-base: https://github.com/zmkfirmware`,
    `  projects:`,
    `    - name: zmk`,
    `      remote: zmkfirmware`,
    `      revision: ${ZMK_REVISION}`,
    `      import: app/west.yml`,
    `  self:`,
    `    path: config`,
    ``,
].join('\n')

// Makes the repo root a Zephyr module so the build finds the shield under the
// top-level boards/ (the layout of zmkfirmware/unified-zmk-config-template).
const ZMK_MODULE_YML = [
    `build:`,
    `  settings:`,
    `    board_root: .`,
    ``,
].join('\n')

const zmkLocalBuild = (board: string, shield: string): string =>
    `west build -s zmk/app -b ${board} -- -DSHIELD=${shield} -DZMK_CONFIG="$(pwd)/config" -DZMK_EXTRA_MODULES="$(pwd)"`

const zmkRepoFiles = (buildYaml: string, readme: string): ExportedFile[] => [
    text(`config/west.yml`, ZMK_WEST_YML),
    text(`zephyr/module.yml`, ZMK_MODULE_YML),
    text(`build.yaml`, buildYaml),
    text(`.github/workflows/build.yml`, ZMK_BUILD_WORKFLOW),
    text(`README.md`, readme),
]

// pattern-check: skip pure string-template generators for a shield dir, no abstraction
// ZMK shield-scaffold generators (Kconfig + metadata) mirroring a real shield dir.
// `ZMK_KEYBOARD_NAME` is capped at 16 chars by ZMK; truncate the display name.
// The symbol is upper-case; shields_list_contains matches the shield name as
// build.yaml / -DSHIELD= spell it (lower-case), and Kconfig keeps whitespace in
// function arguments, so there is no space after the comma.
const kconfigShield = (shieldId: string): string =>
    [
        `config SHIELD_${shieldId.toUpperCase()}`,
        `    def_bool $(shields_list_contains,${shieldId})`,
        ``,
    ].join('\n')

const kconfigDefconfig = (SHIELD: string, name: string): string =>
    [
        `if SHIELD_${SHIELD}`,
        ``,
        `config ZMK_KEYBOARD_NAME`,
        `\tdefault "${dtsString(name.slice(0, 16))}"`,
        ``,
        `endif # SHIELD_${SHIELD}`,
        ``,
    ].join('\n')

const shieldMetaYml = (id: string, name: string): string =>
    [`file_format: "1"`, `id: ${id}`, `name: ${name}`, `type: shield`, ``].join(
        '\n',
    )

function zmkBundle(config: ConfigKeymap): ProjectBundle {
    const split = zmkSplitShields(config)
    if (split) return zmkSplitBundle(config, split)
    const ctrl = resolveController(config)
    const shieldId = sanitize(
        ctrl.shield || config.keyboard.id || config.meta.name,
    )
    const board = ctrl.board || 'YOUR_BOARD'
    const { files: compiled, diagnostics } = getCompiler('zmk').compile(config)
    const keymap = compiled.find((f) => f.filename.endsWith('.keymap'))
    const overlay = compiled.find((f) => f.filename.endsWith('.overlay'))

    // The custom shield lives in its own dir so the overlay/Kconfig describe a
    // self-contained board ZMK can discover (boards/shields/<id>/), like the
    // unified zmk-config template. The user's Kconfig flags go in config/,
    // where the build reads them; a .conf in the shield dir is ignored.
    const shieldDir = `boards/shields/${shieldId}`
    const confPath = `config/${shieldId}.conf`

    const buildYaml = [
        `include:`,
        `  - board: ${board}`,
        `    shield: ${shieldId}`,
        ``,
    ].join('\n')

    const readme = [
        `# ${config.meta.name} — ZMK config`,
        ``,
        `Generated by remappr. This is a ready-to-build \`zmk-config\` repo with a`,
        `self-contained shield under \`${shieldDir}/\`.`,
        ``,
        `## Build in the cloud (no toolchain)`,
        `1. Create a new GitHub repository and push these files.`,
        `2. The included workflow (\`.github/workflows/build.yml\`) builds on every push.`,
        `3. Open the Actions run → download the \`firmware\` artifact (\`.uf2\`).`,
        ``,
        `## Build locally`,
        `\`\`\`sh`,
        `west init -l config && west update`,
        zmkLocalBuild(board, shieldId),
        `\`\`\``,
        ``,
        `## Notes`,
        `- Set \`board\` in \`build.yaml\` to your actual controller (currently \`${board}\`).`,
        `- \`${shieldDir}/${shieldId}.overlay\` holds the kscan + matrix-transform +`,
        `  physical-layout; \`${shieldId}.keymap\` the bindings; \`Kconfig.shield\` /`,
        `  \`Kconfig.defconfig\` register the shield. \`${confPath}\` holds the Kconfig flags.`,
        `- Builds against ZMK \`${ZMK_REVISION}\` (\`config/west.yml\` and the workflow).`,
        `  To move, change both refs; boards differ between releases and \`main\`.`,
        `- Re-check the matrix-transform \`RC()\` map against your real kscan wiring —`,
        `  remappr derives it from physical key position, not the electrical matrix.`,
        ``,
    ].join('\n')

    const files: ExportedFile[] = [
        text(
            `${shieldDir}/${shieldId}.keymap`,
            keymap ? asText(keymap.content) : '',
        ),
        text(confPath, deriveZmkConf(config)),
        text(`${shieldDir}/Kconfig.shield`, kconfigShield(shieldId)),
        text(
            `${shieldDir}/Kconfig.defconfig`,
            kconfigDefconfig(shieldId.toUpperCase(), config.meta.name),
        ),
        text(
            `${shieldDir}/${shieldId}.zmk.yml`,
            shieldMetaYml(shieldId, config.meta.name),
        ),
    ]
    if (overlay)
        files.push(
            text(`${shieldDir}/${shieldId}.overlay`, asText(overlay.content)),
        )
    files.push(...zmkRepoFiles(buildYaml, readme))

    return { files, diagnostics, rootName: `${shieldId}-zmk-config` }
}

// pattern-check: skip split-shield Kconfig templates + bundle assembly, no abstraction
// Kconfig.shield registering both half symbols, keyed by the lowercase shield names.
const kconfigShieldSplit = (s: ZmkSplitShields): string =>
    [
        `config SHIELD_${s.left.toUpperCase()}`,
        `    def_bool $(shields_list_contains,${s.left})`,
        ``,
        `config SHIELD_${s.right.toUpperCase()}`,
        `    def_bool $(shields_list_contains,${s.right})`,
        ``,
    ].join('\n')

// Kconfig.defconfig: name + central role on the left half, split mode on both.
const kconfigDefconfigSplit = (s: ZmkSplitShields, name: string): string =>
    [
        `if SHIELD_${s.left.toUpperCase()}`,
        ``,
        `config ZMK_KEYBOARD_NAME`,
        `\tdefault "${dtsString(name.slice(0, 16))}"`,
        ``,
        `config ZMK_SPLIT_ROLE_CENTRAL`,
        `\tdefault y`,
        ``,
        `endif # SHIELD_${s.left.toUpperCase()}`,
        ``,
        `if SHIELD_${s.left.toUpperCase()} || SHIELD_${s.right.toUpperCase()}`,
        ``,
        `config ZMK_SPLIT`,
        `\tdefault y`,
        ``,
        `endif`,
        ``,
    ].join('\n')

// A ZMK split board ships ONE shield dir with a shared keymap/conf/dtsi base and
// two half overlays; build.yaml builds both halves on the same board.
function zmkSplitBundle(
    config: ConfigKeymap,
    split: ZmkSplitShields,
): ProjectBundle {
    const ctrl = resolveController(config)
    const board = ctrl.board || 'YOUR_BOARD'
    const { files: compiled, diagnostics } = getCompiler('zmk').compile(config)
    const keymap = compiled.find((f) => f.filename.endsWith('.keymap'))
    const dtsi = compiled.find((f) => f.filename.endsWith('.dtsi'))
    const leftOv = compiled.find((f) => f.filename.endsWith('_left.overlay'))
    const rightOv = compiled.find((f) => f.filename.endsWith('_right.overlay'))

    const shieldDir = `boards/shields/${split.base}`
    // ZMK reads config/<base>.conf for both halves (it drops _left/_right).
    const confPath = `config/${split.base}.conf`
    const buildYaml = [
        `include:`,
        `  - board: ${board}`,
        `    shield: ${split.left}`,
        `  - board: ${board}`,
        `    shield: ${split.right}`,
        ``,
    ].join('\n')

    const readme = [
        `# ${config.meta.name} — ZMK config (split)`,
        ``,
        `Generated by remappr. Ready-to-build \`zmk-config\` for a SPLIT keyboard,`,
        `with one shield dir \`${shieldDir}/\` holding both halves.`,
        ``,
        `## Build in the cloud (no toolchain)`,
        `1. Create a new GitHub repository and push these files.`,
        `2. The workflow builds BOTH halves (\`${split.left}\` + \`${split.right}\`).`,
        `3. Flash \`${split.left}\` to one half and \`${split.right}\` to the other.`,
        ``,
        `## Build locally`,
        `\`\`\`sh`,
        `west init -l config && west update`,
        zmkLocalBuild(board, split.left),
        zmkLocalBuild(board, split.right),
        `\`\`\``,
        ``,
        `## Notes`,
        `- \`${split.base}.dtsi\` is the shared base (physical layout, matrix-transform,`,
        `  rows-only kscan, chosen). \`${split.left}.overlay\` / \`${split.right}.overlay\``,
        `  set each half's col-gpios; the right half offsets the transform.`,
        `- Both halves share \`${split.base}.keymap\` and \`${confPath}\`.`,
        `- Builds against ZMK \`${ZMK_REVISION}\` (\`config/west.yml\` and the workflow).`,
        `- Re-check the per-half col-gpios + the matrix-transform \`RC()\` map against`,
        `  your real wiring — remappr derives them from physical key position.`,
        ``,
    ].join('\n')

    const files: ExportedFile[] = [
        text(
            `${shieldDir}/${split.base}.keymap`,
            keymap ? asText(keymap.content) : '',
        ),
        text(confPath, deriveZmkConf(config)),
        text(`${shieldDir}/Kconfig.shield`, kconfigShieldSplit(split)),
        text(
            `${shieldDir}/Kconfig.defconfig`,
            kconfigDefconfigSplit(split, config.meta.name),
        ),
        text(
            `${shieldDir}/${split.base}.zmk.yml`,
            shieldMetaYml(split.base, config.meta.name),
        ),
    ]
    if (dtsi)
        files.push(
            text(`${shieldDir}/${split.base}.dtsi`, asText(dtsi.content)),
        )
    if (leftOv)
        files.push(
            text(`${shieldDir}/${split.left}.overlay`, asText(leftOv.content)),
        )
    if (rightOv)
        files.push(
            text(
                `${shieldDir}/${split.right}.overlay`,
                asText(rightOv.content),
            ),
        )
    files.push(...zmkRepoFiles(buildYaml, readme))

    return { files, diagnostics, rootName: `${split.base}-zmk-config` }
}

/* ── QMK ─────────────────────────────────────────────────────────────────── */

const QMK_BUILD_WORKFLOW = [
    `name: Build QMK firmware`,
    `on: [push, pull_request, workflow_dispatch]`,
    `jobs:`,
    `  build:`,
    `    uses: qmk/.github/workflows/qmk_userspace_build.yml@main`,
    `    with:`,
    `      qmk_repo: qmk/qmk_firmware`,
    `      qmk_ref: master`,
    ``,
].join('\n')

function qmkBundle(config: ConfigKeymap, target: Target): ProjectBundle {
    const kb = sanitize(config.keyboard.id || config.meta.name)
    const km = 'remappr'
    const { files: compiled, diagnostics } = getCompiler(target).compile(config)
    const keymapC = compiled.find((f) => f.filename.endsWith('.c'))
    const kbDir = `keyboards/${kb}`
    const base = `${kbDir}/keymaps/${km}`
    const { json: keyboardJson, diagnostics: kbDiag } =
        buildQmkKeyboardJson(config)

    // VIA / Vial both build through the QMK family and need VIA support compiled
    // in; when targeted, enable VIA in the keymap and ship the VIA definition the
    // app loads in its Authoring/Design tab (the matrix-annotated KLE keymap).
    const wantsVia = (config.keyboard.firmware ?? []).some(
        (f) => f === 'via' || f === 'vial',
    )
    const { json: viaJson, diagnostics: viaDiag } = wantsVia
        ? buildViaJson(config)
        : { json: null, diagnostics: [] as Diagnostic[] }

    // Vial layers its security (UID + unlock combo) on top of VIA: it ships its own
    // matrix-annotated `vial.json` in the keymap and adds VIAL_ENABLE + a config.h.
    const wantsVial = (config.keyboard.firmware ?? []).includes('vial')
    const vial = wantsVial
        ? buildVialJson(config)
        : { json: null, configH: '', diagnostics: [] as Diagnostic[] }

    const rulesMk = deriveQmkRulesMk(config, wantsVia, wantsVial)
    // Vial's UID/unlock defines go in the keymap config.h alongside board overrides.
    const configH = wantsVial
        ? deriveQmkConfigH(config) + '\n' + vial.configH
        : deriveQmkConfigH(config)

    const qmkJson = JSON.stringify(
        { userspace_version: '1.1', build_targets: [[kb, km]] },
        null,
        2,
    )

    const readme = [
        `# ${config.meta.name} — QMK keyboard + userspace`,
        ``,
        `Generated by remappr as a \`qmk_userspace\` tree with a complete`,
        `keyboard definition (\`${kbDir}/keyboard.json\`).`,
        ``,
        `## Build in the cloud`,
        `1. Push these files to a GitHub repo (a fork of \`qmk/qmk_userspace\` works).`,
        `2. The included workflow builds the keymap on every push.`,
        `3. Download the firmware artifact from the Actions run.`,
        ``,
        `## Build locally`,
        `\`\`\`sh`,
        `qmk userspace-compile`,
        `# or: qmk compile -kb ${kb} -km ${km}`,
        `\`\`\``,
        ``,
        `## Notes`,
        `- \`${kbDir}/keyboard.json\` is the data-driven keyboard definition`,
        `  (matrix pins, diode direction, MCU/USB identity, features, layout).`,
        `- Verify the pin names + processor/bootloader against your hardware before`,
        `  flashing — remappr fills them from the builder's Controller panel.`,
        ...(wantsVia
            ? [
                  ``,
                  `## VIA`,
                  `- \`VIA_ENABLE = yes\` is set in \`${base}/rules.mk\`, so the built`,
                  `  firmware supports VIA / Vial.`,
                  `- \`via/${kb}.json\` is the VIA keyboard definition — load it in the`,
                  `  VIA app's Authoring/Design tab (the \`vendorId\`/\`productId\` must`,
                  `  match the firmware).`,
              ]
            : []),
        ...(wantsVial
            ? [
                  ``,
                  `## Vial`,
                  `- \`VIAL_ENABLE = yes\` is set in \`${base}/rules.mk\` and`,
                  `  \`${base}/vial.json\` is the Vial definition the firmware embeds.`,
                  `- \`${base}/config.h\` carries \`VIAL_KEYBOARD_UID\` + the unlock combo.`,
                  `  Generate a unique UID and pick unlock keys in the builder before`,
                  `  shipping (a placeholder/insecure build still compiles).`,
              ]
            : []),
        ``,
    ].join('\n')

    const files: ExportedFile[] = [
        text(
            `${kbDir}/keyboard.json`,
            JSON.stringify(keyboardJson, null, 4) + '\n',
        ),
        text(`${base}/keymap.c`, keymapC ? asText(keymapC.content) : ''),
        text(`${base}/rules.mk`, rulesMk),
        text(`${base}/config.h`, configH),
        text(`qmk.json`, qmkJson + '\n'),
        text(`.github/workflows/build_binaries.yml`, QMK_BUILD_WORKFLOW),
        text(`README.md`, readme),
    ]
    if (viaJson)
        files.push(
            text(`via/${kb}.json`, JSON.stringify(viaJson, null, 4) + '\n'),
        )
    if (vial.json)
        files.push(
            text(
                `${base}/vial.json`,
                JSON.stringify(vial.json, null, 4) + '\n',
            ),
        )

    return {
        files,
        diagnostics: [
            ...diagnostics,
            ...kbDiag,
            ...viaDiag,
            ...vial.diagnostics,
        ],
        rootName: `${kb}-qmk-userspace`,
    }
}

/* ── Remappr shield ──────────────────────────────────────────────────────── */

// zephyr/module.yml — makes THIS project a Zephyr module whose board_root exposes
// its boards/shields/, so the generated shield resolves without copying it into a
// firmware checkout. (The remappr,* drivers come from the firmware module.)
const REMAPPR_MODULE_YML = [
    `# Exposes this project's boards/shields/ to the build (board_root), so the`,
    `# generated shield resolves as-is. The remappr,* drivers/bindings come from`,
    `# the remappr-firmware module pulled by west.yml.`,
    `build:`,
    `  settings:`,
    `    board_root: .`,
    ``,
].join('\n')

// A standalone west manifest: this project becomes the manifest repo, pulling
// Zephyr (via NCS, which also carries nrfxlib for the 2.4GHz radio) + the firmware
// as a module. Revisions mirror the firmware's own west.yml; the host URL + pin
// are FIXME because they depend on where the user keeps remappr-firmware.
const remapprWestYml = (selfPath: string): string =>
    [
        `# Standalone west workspace for a remappr shield. FIXME: set the \`remappr\``,
        `# remote url-base to the host of your remappr-firmware checkout and pin its`,
        `# revision, then run:  west init -l <this-dir> && west update`,
        `manifest:`,
        `  remotes:`,
        `    - name: ncs`,
        `      url-base: https://github.com/nrfconnect`,
        `    - name: zephyrproject`,
        `      url-base: https://github.com/zephyrproject-rtos`,
        `    - name: remappr`,
        `      url-base: https://github.com/your-org`,
        `  projects:`,
        `    - name: sdk-nrf`,
        `      remote: ncs`,
        `      repo-path: sdk-nrf`,
        `      revision: v3.3.0`,
        `      import:`,
        `        name-allowlist:`,
        `          - zephyr`,
        `          - nrfxlib`,
        `          - cmsis`,
        `          - cmsis_6`,
        `          - hal_nordic`,
        `          - mcuboot`,
        `          - mbedtls`,
        `          - oberon-psa-crypto`,
        `          - segger`,
        `          - zcbor`,
        `          - picolibc`,
        `          - littlefs`,
        `    # Only when targeting an STM32 controller — NCS omits hal_stm32.`,
        `    - name: hal_stm32`,
        `      remote: zephyrproject`,
        `      path: modules/hal/stm32`,
        `      revision: e05bb4707857ecf4344c29a9407aaa4227407546`,
        `    - name: remappr-firmware`,
        `      remote: remappr`,
        `      revision: main`,
        `  self:`,
        `    path: ${selfPath}`,
        ``,
    ].join('\n')

// pattern-check: skip — shield-file passthrough + manifest/README templates, no abstraction
function remapprBoardBundle(config: ConfigKeymap): ProjectBundle {
    const { files: shield, diagnostics } =
        getCompiler('remappr-board').compile(config)
    const slug = sanitize(config.keyboard.id || config.meta.name)
    const rootName = `${slug}-remappr-shield`
    const readme = [
        `# ${config.meta.name} — Remappr shield`,
        ``,
        `Generated by remappr — a self-contained Zephyr shield for the remappr`,
        `firmware, wired as a standalone west workspace.`,
        ``,
        `## Build (standalone west workspace)`,
        `1. Host this project on git, then in \`west.yml\` set the \`remappr\` remote`,
        `   \`url-base\` to your remappr-firmware host and pin its \`revision\` (both`,
        `   marked FIXME).`,
        `2. Initialize the workspace and pull Zephyr + the firmware:`,
        `\`\`\`sh`,
        `west init -l <this-project>`,
        `west update`,
        `\`\`\``,
        `3. Build the keyboard-node app with this shield:`,
        `\`\`\`sh`,
        `west build -p -s remappr-firmware/app/keyboard_node -b <your_board> -- -DSHIELD=${slug}`,
        `\`\`\``,
        `\`zephyr/module.yml\` exposes \`boards/shields/${slug}/\` (board_root); the`,
        `firmware module provides the app + the \`remappr,*\` drivers.`,
        ``,
        `## Or: drop into a firmware checkout`,
        `Copy \`boards/shields/${slug}/\` into a \`remappr-firmware\` checkout (its`,
        `\`board_root\` already covers that path) and build from there:`,
        `\`\`\`sh`,
        `west build -p -s app/keyboard_node -b <your_board> -- -DSHIELD=${slug}`,
        `\`\`\``,
        ``,
        `## Notes`,
        `- \`${slug}.overlay\` holds the kscan matrix + input-keymap + remappr,keymap`,
        `  (physical layout + a default keymap), plus any RGB / encoder nodes.`,
        `  \`Kconfig.shield\` / \`Kconfig.defconfig\` register the shield and default`,
        `  its Kconfig.`,
        `- The default keymap is a bootstrap; the app's config blob (pushed from`,
        `  remappr over USB / BLE / 2.4GHz) is authoritative for bindings.`,
        `- Verify the row/col (and any RGB / encoder) GPIO specs against your wiring`,
        `  before flashing.`,
        ``,
    ].join('\n')
    return {
        files: [
            ...shield.map((f) => text(f.filename, asText(f.content))),
            text(`west.yml`, remapprWestYml(rootName)),
            text(`zephyr/module.yml`, REMAPPR_MODULE_YML),
            text(`README.md`, readme),
        ],
        diagnostics,
        rootName,
    }
}

/** Build the full project bundle for a target. ZMK → zmk-config skeleton;
 *  QMK/Keychron → qmk_userspace skeleton; remappr-board → Zephyr shield dir.
 *  `remappr` (the builder firmware id / `meta.target`) aliases `remappr-board`
 *  so the editor's Download surface — which offers the pinned meta.target
 *  verbatim — resolves the shield without the pre-mapping BuilderExportModal
 *  does in its own compilerTargets(). */
// pattern-check: skip one-line alias branch in existing dispatch, no abstraction
export function buildProjectBundle(
    config: ConfigKeymap,
    target: Target,
): ProjectBundle {
    if (target === 'zmk') return zmkBundle(config)
    if (target === 'remappr-board' || target === 'remappr')
        return remapprBoardBundle(config)
    return qmkBundle(config, target)
}
