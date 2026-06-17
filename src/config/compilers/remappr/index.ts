// Pattern check: Strategy (Tier 1) — extended — concrete `remappr` KeymapCompiler
// registered into the Strategy registry in compiler.ts, alongside zmk/qmk. Picks
// the canonical→RMBC byte lowering uniformly behind the same compile() interface.
//
// The `remappr` target (§44) serializes the canonical ConfigKeymap straight to a
// binary RMBC config blob — the firmware's own wire format (§19). Unlike the
// text targets, the firmware decodes and re-validates this output (§21): a blob
// this emits and lib/config_blob accepts (golden-fixture-locked both sides) is
// the definition of "JSON configures the board".
//
// THIN SLICE (M13 path A): bare key_press / transparent / none only — enough to
// lock the wire end-to-end. Every richer CanonAction (tap_hold, layer, macro, …)
// is an explicit gap that emits a diagnostic and a NONE placeholder so the blob
// still forms. Closing those gaps is the §44.3 roadmap (firmware side first).

import type { ExportedFile } from '../../../types'
import { HID_USAGE_BY_CANONICAL } from '../../../catalog/entries'
import type { DiagnosticBag } from '../../diagnostics'
import {
    runCompile,
    registerCompiler,
    type KeymapCompiler,
} from '../../compiler'
import type { CanonAction, ConfigKeymap } from '../../types'
import {
    BehaviorType,
    BlobBuilder,
    BLOB_READER_VERSION,
    LightingActionCode,
    LightingTargetCode,
    MacroOp,
    MouseButtonCode,
    MouseDirCode,
    MouseOp,
    OUTPUT_NO_PROFILE,
    OutputActionCode,
    SystemAction,
    type BehaviorRecord,
    type ComboRecord,
    type ConditionalRecord,
    type MacroRecord,
    type MacroStep,
} from './blobWriter'
import type { CanonMacro, CanonMacroStep } from '../../types'

const COMBO_ANY_LAYER = 0xff
// HID Keyboard usage page. Consumer/System pages (12, …) are a deferred gap
// (§44.4): the firmware HID layer exposes keyboard usages only for now.
const HID_PAGE_KEYBOARD = 7

const NONE_REC: BehaviorRecord = {
    type: BehaviorType.None,
    flavor: 0,
    flags: 0,
    subCount: 0,
    tap: 0,
    hold: 0,
    tappingTermMs: 0,
    quickTapMs: 0,
    requirePriorIdleMs: 0,
    subIndex: 0,
}

const rec = (p: Partial<BehaviorRecord> & { type: number }): BehaviorRecord => ({
    ...NONE_REC,
    ...p,
})

// Resolve a CanonicalKeyId to its HID keyboard usage, or null with a diagnostic
// for consumer-page / unknown keys (the §44.4 usage-page gap).
function keyUsage(
    keyId: string,
    diag: DiagnosticBag,
    path: (string | number)[],
): number | null {
    const u = HID_USAGE_BY_CANONICAL.get(keyId)
    if (!u) {
        diag.error(`no HID usage for key "${keyId}"`, path)
        return null
    }
    if (u.page !== HID_PAGE_KEYBOARD) {
        diag.error(
            `key "${keyId}" is on HID page ${u.page} (consumer/system not yet ` +
                `on the wire — §44.4)`,
            path,
        )
        return null
    }
    return u.usage
}

/* ── macros (§43.5) ─────────────────────────────────────────────────────── */
// pattern-check: skip pure data-lowering helpers (CanonMacro → wire steps), no abstraction

const HID_LSHIFT = 0xe1

// ASCII char → [keyboard usage, needs-shift]. Letters/digits are computed; this
// covers the punctuation + whitespace a `text` macro typically contains.
const ASCII_PUNCT: Record<string, [number, boolean]> = {
    ' ': [0x2c, false], '\n': [0x28, false], '\t': [0x2b, false],
    '-': [0x2d, false], _: [0x2d, true],
    '=': [0x2e, false], '+': [0x2e, true],
    '[': [0x2f, false], '{': [0x2f, true],
    ']': [0x30, false], '}': [0x30, true],
    '\\': [0x31, false], '|': [0x31, true],
    ';': [0x33, false], ':': [0x33, true],
    "'": [0x34, false], '"': [0x34, true],
    '`': [0x35, false], '~': [0x35, true],
    ',': [0x36, false], '<': [0x36, true],
    '.': [0x37, false], '>': [0x37, true],
    '/': [0x38, false], '?': [0x38, true],
    '!': [0x1e, true], '@': [0x1f, true], '#': [0x20, true], $: [0x21, true],
    '%': [0x22, true], '^': [0x23, true], '&': [0x24, true], '*': [0x25, true],
    '(': [0x26, true], ')': [0x27, true],
}

// Resolve a single character to [usage, shift], or null if unprintable here.
function charToUsage(ch: string): [number, boolean] | null {
    if (ch >= 'a' && ch <= 'z') return [0x04 + (ch.charCodeAt(0) - 97), false]
    if (ch >= 'A' && ch <= 'Z') return [0x04 + (ch.charCodeAt(0) - 65), true]
    if (ch >= '1' && ch <= '9') return [0x1e + (ch.charCodeAt(0) - 49), false]
    if (ch === '0') return [0x27, false]
    return ASCII_PUNCT[ch] ?? null
}

// Expand a `text` step into tap steps, wrapping shifted chars in Shift hold.
function textToSteps(
    text: string,
    diag: DiagnosticBag,
    path: (string | number)[],
): MacroStep[] {
    const out: MacroStep[] = []
    for (const ch of text) {
        const u = charToUsage(ch)
        if (!u) {
            diag.warn(`macro text char ${JSON.stringify(ch)} unsupported`, path)
            continue
        }
        if (u[1]) {
            out.push({ op: MacroOp.Press, arg: HID_LSHIFT })
            out.push({ op: MacroOp.Tap, arg: u[0] })
            out.push({ op: MacroOp.Release, arg: HID_LSHIFT })
        } else {
            out.push({ op: MacroOp.Tap, arg: u[0] })
        }
    }
    return out
}

// Lower one canonical macro step to zero or more wire steps. Structured tap/
// press/release/wait + text are supported; param/tap_time/pause_for_release are
// §44.3 gaps (advanced macros) and emit a diagnostic.
function lowerMacroStep(
    step: CanonMacroStep,
    diag: DiagnosticBag,
    path: (string | number)[],
): MacroStep[] {
    switch (step.type) {
        case 'tap':
        case 'press':
        case 'release': {
            const usage = keyUsage(step.key, diag, path)
            if (usage === null) return []
            const op =
                step.type === 'tap'
                    ? MacroOp.Tap
                    : step.type === 'press'
                      ? MacroOp.Press
                      : MacroOp.Release
            return [{ op, arg: usage }]
        }
        case 'wait':
            return [{ op: MacroOp.Wait, arg: Math.min(step.ms, 0xffff) }]
        case 'text':
            return textToSteps(step.text, diag, path)
        default:
            diag.error(
                `macro step "${step.type}" not yet on the wire — §44.3 gap`,
                path,
            )
            return []
    }
}

// Encode all macros into wire records and an id→index map for BH_MACRO refs.
function buildMacros(
    macros: CanonMacro[] | undefined,
    diag: DiagnosticBag,
): { records: MacroRecord[]; index: Map<string, number> } {
    const records: MacroRecord[] = []
    const index = new Map<string, number>()
    ;(macros ?? []).forEach((m, mi) => {
        index.set(m.id, mi)
        const steps = m.steps.flatMap((s, si) =>
            lowerMacroStep(s, diag, ['macros', mi, 'steps', si]),
        )
        records.push({ steps })
    })
    return { records, index }
}

// HID modifier usages are 0xE0..0xE7 → modifier-byte bit (1 << usage-0xE0).
// pattern-check: skip tiny pure usage→mod-bit map for sticky/key-toggle behaviors
function usageToModBit(usage: number): number | null {
    return usage >= 0xe0 && usage <= 0xe7 ? 1 << (usage - 0xe0) : null
}

// Lower one canonical binding to a behavior record. Unsupported actions emit a
// diagnostic and fall back to NONE so the blob still forms (thin slice).
function lowerAction(
    action: CanonAction,
    diag: DiagnosticBag,
    path: (string | number)[],
    macroIndex: Map<string, number>,
    layerIndex: Map<string, number>,
): BehaviorRecord {
    switch (action.type) {
        case 'key_press': {
            if (action.mods?.length) {
                diag.error(
                    `modded key_press ("${action.key}" + mods) not yet on the ` +
                        `wire — §44.3 (extend BH_KEY / macro)`,
                    path,
                )
                return rec({ type: BehaviorType.None })
            }
            const usage = keyUsage(action.key, diag, path)
            if (usage === null) return rec({ type: BehaviorType.None })
            return rec({ type: BehaviorType.Key, tap: usage })
        }
        case 'transparent':
            return rec({ type: BehaviorType.Trans })
        case 'none':
            return rec({ type: BehaviorType.None })
        case 'macro': {
            const idx = macroIndex.get(action.ref)
            if (idx === undefined) {
                diag.error(`unknown macro ref "${action.ref}"`, path)
                return rec({ type: BehaviorType.None })
            }
            if (action.param !== undefined) {
                diag.error(
                    `parametrized macro "${action.ref}" not yet on the wire ` +
                        `(§44.3 gap)`,
                    path,
                )
            }
            return rec({ type: BehaviorType.Macro, tap: idx })
        }
        case 'layer': {
            const li = layerIndex.get(action.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            const t =
                action.mode === 'momentary'
                    ? BehaviorType.Momentary
                    : action.mode === 'to'
                      ? BehaviorType.To
                      : action.mode === 'toggle'
                        ? BehaviorType.ToggleLayer
                        : BehaviorType.StickyLayer // 'sticky'
            return rec({ type: t, hold: li })
        }
        case 'sticky_key': {
            const usage = keyUsage(action.key, diag, path)
            if (usage === null) return rec({ type: BehaviorType.None })
            const bit = usageToModBit(usage)
            if (bit === null) {
                diag.error(
                    `sticky_key "${action.key}" is not a modifier (one-shot ` +
                        `non-mod keys not yet on the wire — §44.3)`,
                    path,
                )
                return rec({ type: BehaviorType.None })
            }
            return rec({ type: BehaviorType.StickyMod, hold: bit })
        }
        case 'key_toggle': {
            const usage = keyUsage(action.key, diag, path)
            if (usage === null) return rec({ type: BehaviorType.None })
            return rec({ type: BehaviorType.KeyToggle, tap: usage })
        }
        case 'key_repeat':
            // Zero-field: firmware replays the last emitted key+mods at runtime.
            return rec({ type: BehaviorType.KeyRepeat })
        case 'caps_word':
            // Zero-field: firmware auto-shifts letters until a word boundary.
            return rec({ type: BehaviorType.CapsWord })
        case 'reset':
        case 'bootloader':
        case 'soft_off':
            // Device action fired on press via the engine's system callback;
            // the action code rides in `tap`.
            return rec({
                type: BehaviorType.System,
                tap: SystemAction[action.type],
            })
        case 'mouse_key':
            // op in `tap`, button code in `hold`; engine reports press/release
            // edges, the app drives the mouse driver.
            return rec({
                type: BehaviorType.Mouse,
                tap: MouseOp.key,
                hold: MouseButtonCode[action.button],
            })
        case 'mouse_move':
            return rec({
                type: BehaviorType.Mouse,
                tap: MouseOp.move,
                hold: MouseDirCode[action.direction],
            })
        case 'mouse_scroll':
            return rec({
                type: BehaviorType.Mouse,
                tap: MouseOp.scroll,
                hold: MouseDirCode[action.direction],
            })
        case 'output':
            // action in `tap`, BLE profile in `hold` (0xFF = unspecified).
            return rec({
                type: BehaviorType.Output,
                tap: OutputActionCode[action.action],
                hold: action.profile ?? OUTPUT_NO_PROFILE,
            })
        case 'lighting':
            // action in `tap`, target in `hold`; COLOR packs hue/sat/val and
            // SET packs the level into the spare term/quick/prior slots.
            return rec({
                type: BehaviorType.Lighting,
                tap: LightingActionCode[action.action],
                hold: LightingTargetCode[action.target],
                tappingTermMs:
                    action.action === 'color' ? (action.hue ?? 0) : 0,
                quickTapMs:
                    action.action === 'color' ? (action.saturation ?? 0) : 0,
                requirePriorIdleMs:
                    action.action === 'color'
                        ? (action.brightness ?? 0)
                        : action.action === 'set'
                          ? (action.level ?? 0)
                          : 0,
            })
        default:
            diag.error(
                `action "${action.type}" not yet supported by the remappr ` +
                    `target (§44.3 gap)`,
                path,
            )
            return rec({ type: BehaviorType.None })
    }
}

function emitBlob(config: ConfigKeymap, diag: DiagnosticBag): ExportedFile[] {
    const numLayers = config.layers.length
    const numPositions = config.keyboard.keys.length

    if (numLayers === 0) diag.error('keymap has no layers', ['layers'])
    if (numPositions === 0) diag.error('keyboard has no keys', ['keyboard', 'keys'])

    // Macros first: BH_MACRO cells reference them by index.
    const { records: macroRecords, index: macroIndex } = buildMacros(
        config.macros,
        diag,
    )
    const layerIndex = new Map(config.layers.map((l, i) => [l.name, i]))

    // De-duplicated behavior table; bindings index into it.
    const behaviors: BehaviorRecord[] = []
    const behaviorKey = new Map<string, number>()
    const getOrAdd = (r: BehaviorRecord): number => {
        const k = JSON.stringify(r)
        const existing = behaviorKey.get(k)
        if (existing !== undefined) return existing
        const idx = behaviors.length
        behaviorKey.set(k, idx)
        behaviors.push(r)
        return idx
    }

    // Cells: layer-major (layer 0 positions 0..N-1, then layer 1, …). Each
    // layer's bindings must align 1:1 with physical positions (§44.7 invariant).
    const cells: number[] = []
    config.layers.forEach((layer, li) => {
        if (layer.bindings.length !== numPositions) {
            diag.error(
                `layer "${layer.name}" has ${layer.bindings.length} bindings ` +
                    `but the keyboard has ${numPositions} keys`,
                ['layers', li, 'bindings'],
            )
        }
        for (let pos = 0; pos < numPositions; pos++) {
            const action = layer.bindings[pos]
            const r = action
                ? lowerAction(
                      action,
                      diag,
                      ['layers', li, 'bindings', pos],
                      macroIndex,
                      layerIndex,
                  )
                : rec({ type: BehaviorType.None })
            cells.push(getOrAdd(r))
        }
    })

    // Combos (optional). Output is a bare behavior; positions index physical keys.
    const combos: ComboRecord[] = (config.combos ?? []).map((c, ci) => ({
        positions: c.keys,
        timeoutMs: c.timeoutMs ?? 40,
        layer:
            c.layers && c.layers.length === 1
                ? config.layers.findIndex((l) => l.name === c.layers![0])
                : COMBO_ANY_LAYER,
        outputIndex: getOrAdd(
            lowerAction(
                c.action,
                diag,
                ['combos', ci, 'action'],
                macroIndex,
                layerIndex,
            ),
        ),
    }))

    // Conditional (tri-)layers (optional). Layer names resolve to indices.
    const resolveLayer = (name: string, ci: number): number => {
        const i = layerIndex.get(name)
        if (i === undefined) {
            diag.error(`unknown layer "${name}"`, ['conditionalLayers', ci])
            return 0
        }
        return i
    }
    const conditionals: ConditionalRecord[] = (
        config.conditionalLayers ?? []
    ).map((cl, ci) => ({
        ifLayers: cl.ifLayers.map((n) => resolveLayer(n, ci)),
        thenLayer: resolveLayer(cl.thenLayer, ci),
    }))

    const defaultTermMs = config.defaults?.tappingTermMs ?? 200
    const releaseMs = 0

    const builder = new BlobBuilder()
        .layerTable(numLayers, numPositions, defaultTermMs, releaseMs)
        .behaviorTable(behaviors)
        .bindingTable(cells)
    if (macroRecords.length > 0) builder.macroTable(macroRecords)
    if (combos.length > 0) builder.comboTable(combos)
    if (conditionals.length > 0) builder.conditionalTable(conditionals)

    const bytes = builder.finalize(config.schemaVersion, BLOB_READER_VERSION, 1)

    return [
        {
            filename: `${config.keyboard.id || config.keyboard.name}.rmbc`,
            mime: 'application/octet-stream',
            content: bytes,
        },
    ]
}

export const remapprCompiler: KeymapCompiler = {
    target: 'remappr',
    compile: (config) => runCompile(config, emitBlob),
}

registerCompiler(remapprCompiler)
