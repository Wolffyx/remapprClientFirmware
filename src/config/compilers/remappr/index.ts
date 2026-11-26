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
// Side-effect: the sibling `board` module registers the `remappr-board` shield /
// DT target, so loading the remappr compiler brings its full compile surface
// (RMBC blob + board generator) with it — both live in this folder.
import './board'
import { DiagnosticBag, type Diagnostic } from '../../diagnostics'
import {
    runCompile,
    registerCompiler,
    type KeymapCompiler,
} from '../../compiler'
import type {
    CanonAction,
    CanonSemanticAction,
    ConfigClusterSide,
    ConfigKeymap,
} from '../../types'
import {
    BehaviorType,
    BehaviorFlags,
    BlobBuilder,
    BLOB_READER_VERSION,
    Flavor,
    LightingActionCode,
    LightingTargetCode,
    MacroOp,
    MouseButtonCode,
    MouseDirCode,
    MouseOp,
    LockAction,
    NameKind,
    OUTPUT_NO_PROFILE,
    ENCODER_BH_NONE,
    OutputActionCode,
    PeripheralKind,
    SystemAction,
    CFG_ROLE_VALID,
    CFG_ROLE_COORD,
    FWD_MODE_PHYSICAL,
    CLUSTER_MODE_ALONE,
    CLUSTER_MODE_AUTO,
    CLUSTER_POWER_AUTO,
    CLUSTER_POWER_FOLLOW,
    CLUSTER_POWER_OWN,
    FWD_MODE_RESOLVED,
    CLUSTER_UID_MAX,
    LinkProfileId,
    hexToBytes,
    SLIDER_BH_NONE,
    SLIDER_STEPS_MAX,
    SliderKind,
    SliderTarget,
    type SliderRecord,
    type ActionBindingRecord,
    type ClusterNodeRecord,
    type ClusterSideRecord,
    type LinkProfileOverrideRecord,
    type BehaviorRecord,
    type ComboRecord,
    type ConditionalRecord,
    type EncoderRecord,
    type KeyOverrideRecord,
    type LeaderRecord,
    type MacroRecord,
    type MacroStep,
    type NameRecord,
    type PosholdRecord,
} from './blobWriter'
import { AUTOCORRECT_MAX_TYPO, encodeAutocorrectDictionary } from './autocorrect'
import { carryUnmodeledTables } from './carry'
import { displayRecord } from './display'
import { mergeWire } from './wire'
import { powerRecord } from './power'
import { radioRecord } from './radio'
import { mouseRecord } from './mouse'
import { clusterSidesFor } from './boardSides'
import { sensorEntries } from './sensor'
import { Feature } from '../../../clients/remappr/protocol'
import type { CanonicalKeyId } from '../../../catalog/types'
import type {
    CanonHoldTapDef,
    CanonLayer,
    CanonMacro,
    CanonMacroStep,
    CanonModMorph,
    CanonSliderBinding,
    CanonTapDance,
    CanonTapHold,
} from '../../types'
import { MODIFIERS, resolveKeycode, type Modifier } from '../../keycodes'

const COMBO_ANY_LAYER = 0xff
const HID_PAGE_KEYBOARD = 7
// Consumer page (media/volume + AC/AL). The firmware emits these through a
// dedicated Consumer-control HID interface as BH_CONSUMER, so the behavior type
// — not a usage-page tag in the record — disambiguates the page on the wire
// (§44.4). GD System Control (page 1) has no catalog entries yet.
const HID_PAGE_CONSUMER = 12
// GD System Control (page 1): power / sleep / wake → BH_SYS_CTRL. Same shape as
// Consumer — the firmware emits the bare GD usage through its system-control HID
// interface; the record carries no modifier field (§44.4).
const HID_PAGE_SYSTEM = 1

/** Last keyboard usage the firmware sends (REMAPPR_KBD_USAGE_MAX on a build
 *  with the GET_LIMITS KBD_EXT bit). A build without it stops at 0x77, which
 *  config/featureWarnings reports against the device's bits; no build sends
 *  0xA8..0xDF, so a key bound there does nothing. */
export const KBD_USAGE_MAX = 0xa7

/** What a firmware build may hold, where a build can change it. The defaults
 *  are the firmware's. */
export interface RemapprCompileLimits {
    /** Keys in a leader sequence (REMAPPR_BEHAVIOR_LEADER_MAX, 5). */
    leaderMaxKeys?: number
    /** Longest autocorrect typo (REMAPPR_AUTOCORRECT_MAX_TYPO, 24). */
    autocorrectMaxTypo?: number
    /** Key positions the engine tracks (CONFIG_REMAPPR_BEHAVIOR_POSITIONS_MAX, 128). */
    maxPositions?: number
    /** Keys in one combo (CONFIG_REMAPPR_BEHAVIOR_COMBO_KEYS, 8). */
    comboMaxKeys?: number
    /** The keyboard node's config pools (app/remappr src/node/keyboard/kb_config.c):
     *  combo records (cfg_combos, 32), their key positions together
     *  (cfg_combo_pos, 128) and slider bindings (cfg_sliders, 8). */
    combosMax?: number
    comboPositionsMax?: number
    slidersMax?: number
    /** Calls one macro may nest before a warning (CONFIG_REMAPPR_BEHAVIOR_
     *  MACRO_CALL_DEPTH, 4 by default). Only a warning: each build sets its own
     *  limit (0..16) and GET_LIMITS does not report it, so the device decides. */
    macroCallDepth?: number
    /** The device's GET_LIMITS feature bits; a macro call step needs
     *  Feature.MACRO_CALL. Undefined (an export, no device) allows every step. */
    featureBitmask?: number
}
const COMBO_MAX_KEYS = 8
const COMBOS_MAX = 32
const COMBO_POSITIONS_MAX = 128
const SLIDERS_MAX = 8
const LEADER_MAX_KEYS = 5
const POSITIONS_MAX = 128
const MACRO_CALL_DEPTH_MAX = 4
/** Fixed by the wire: the keymap's u8 layer count, the u16 key-override layer
 *  mask, TBL_LINK_PROFILE's override slots (REMAPPR_LINK_PROFILE_OVR_MAX). */
const LAYERS_MAX = 255
const KEY_OVERRIDE_LAYERS = 16
const LINK_PROFILE_OVR_MAX = 8

const isModifierUsage = (u: number): boolean => u >= 0xe0 && u <= 0xe7

/** Warn when keyboard `usage` is past what the firmware sends. */
function warnDeadUsage(
    usage: number,
    diag: DiagnosticBag,
    path: (string | number)[],
    what: string,
): void {
    if (usage <= KBD_USAGE_MAX || isModifierUsage(usage)) return
    diag.warn(
        `${what} is keyboard usage 0x${usage.toString(16)}, past the last one ` +
            `the firmware sends (0x${KBD_USAGE_MAX.toString(16)}): it does nothing`,
        path,
    )
}

/** Behavior types whose `tap` is a keyboard usage. */
const KEYBOARD_TAP_TYPES: ReadonlySet<number> = new Set([
    BehaviorType.Key,
    BehaviorType.KeyMods,
    BehaviorType.ModTap,
    BehaviorType.LayerTap,
    BehaviorType.StickyKey,
    BehaviorType.KeyToggle,
    BehaviorType.AutoShift,
])

const MACRO_KEY_OPS: ReadonlySet<number> = new Set([
    MacroOp.Tap,
    MacroOp.Press,
    MacroOp.Release,
])

function warnDeadMacroUsages(
    steps: readonly MacroStep[],
    diag: DiagnosticBag,
    path: (string | number)[],
): void {
    for (const st of steps) {
        if (MACRO_KEY_OPS.has(st.op)) warnDeadUsage(st.arg, diag, path, 'a macro step')
    }
}

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

// Resolve a CanonicalKeyId to its HID keyboard usage, or null with a diagnostic.
// Consumer / GD-system usages are bindable as standalone keys (BH_CONSUMER /
// BH_SYS_CTRL via the key_press path) but cannot be a macro step, hold-tap tap-
// key, or sequence target — those positions are keyboard-page only.
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
            `key "${keyId}" is on HID page ${u.page} — only keyboard-page ` +
                `usages can be a macro / tap / sequence target (§44.4)`,
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
// press/release/wait + text + pause_for_release + call are supported; param/
// tap_time are step MARKERS handled by lowerMacroSteps and never reach here.
// `index` maps a plain macro's id to its TBL_MACRO record, for calls.
function lowerMacroStep(
    step: CanonMacroStep,
    diag: DiagnosticBag,
    path: (string | number)[],
    index: ReadonlyMap<string, number>,
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
        case 'pause_for_release':
            return [{ op: MacroOp.PauseForRelease, arg: 0 }]
        case 'call': {
            // An unknown or parameterized target is reported by checkMacroCalls.
            const idx = index.get(step.macro)
            return idx === undefined ? [] : [{ op: MacroOp.Call, arg: idx }]
        }
        default:
            diag.error(
                `macro step "${step.type}" not yet on the wire — §44.3 gap`,
                path,
            )
            return []
    }
}

// Lower one macro's canonical steps to wire steps. Two step MARKERS shape the
// lowering rather than emit steps themselves:
//  - `tap_time` (ZMK &macro_tap_time): every LATER `tap` lowers to
//    press / wait(tap_time) / release so the host sees the key held that long.
//  - `param` (ZMK &macro_param_1to1): the NEXT key step takes the BINDING's
//    argument (@substKey) instead of its own key. The wire has no parameter
//    slot, so a parameterized macro is CLONED per distinct argument at compile
//    time — "host clone-per-instance" (§44.3); substKey is that instance's
//    argument, undefined while lowering a plain (non-template) macro.
// `index` maps each plain macro's id to its record, for `call` steps.
function lowerMacroSteps(
    m: CanonMacro,
    mi: number,
    diag: DiagnosticBag,
    opts: { index: ReadonlyMap<string, number>; substKey?: CanonicalKeyId },
): MacroStep[] {
    const { index, substKey } = opts
    let tapMs = 0
    let pendingParam = false
    const steps: MacroStep[] = []
    m.steps.forEach((s, si) => {
        const path = ['macros', mi, 'steps', si]
        if (s.type === 'tap_time') {
            tapMs = Math.min(Math.max(s.ms, 0), 0xffff)
            return
        }
        if (s.type === 'param') {
            if ((s.from ?? 1) !== 1 || (s.to ?? 1) !== 1) {
                diag.error(
                    `multi-parameter macros (param ${s.from ?? 1}→${s.to ?? 1}) ` +
                        `are not supported — only the one-param 1→1 form`,
                    path,
                )
                return
            }
            if (substKey === undefined) {
                // Defensive: templates are only lowered with an argument.
                diag.error(
                    `macro "${m.id}" takes a parameter — bind it with an argument`,
                    path,
                )
                return
            }
            pendingParam = true
            return
        }
        const keyStep =
            s.type === 'tap' || s.type === 'press' || s.type === 'release'
        const step =
            keyStep && pendingParam && substKey !== undefined
                ? { ...s, key: substKey }
                : s
        if (keyStep) pendingParam = false
        if (step.type === 'tap' && tapMs > 0) {
            const usage = keyUsage(step.key, diag, path)
            if (usage !== null)
                steps.push(
                    { op: MacroOp.Press, arg: usage },
                    { op: MacroOp.Wait, arg: tapMs },
                    { op: MacroOp.Release, arg: usage },
                )
            return
        }
        steps.push(...lowerMacroStep(step, diag, path, index))
    })
    if (pendingParam)
        diag.warn(
            `macro "${m.id}": trailing param marker has no following key step`,
            ['macros', mi, 'steps'],
        )
    return steps
}

// pattern-check: skip — plain compile-context DTO (records + lookup maps),
// same idiom as the other wire-DTO interfaces in this compiler.
// Macro compile context: plain macros are encoded up front (records + id→index
// for BH_MACRO refs); macros containing a `param` marker are TEMPLATES — they
// get no record of their own and are instantiated (cloned with the argument
// substituted) per distinct (ref, param) binding, deduped via `instances`.
interface MacroCtx {
    records: MacroRecord[]
    index: Map<string, number>
    templates: Map<string, { m: CanonMacro; mi: number }>
    instances: Map<string, number>
    instanceNames: NameRecord[]
}

const isTemplate = (m: CanonMacro): boolean =>
    m.steps.some((s) => s.type === 'param')

// The call rules the device enforces on push (ERR_REFERENCE): the image runs
// calls at all, every call names a plain macro, calls never loop (errors), and
// no macro nests more than the depth limit (A calls B = depth 1). Depth is only
// a warning: the build's limit is not reported, so the device has the say.
function checkMacroCalls(
    macros: CanonMacro[],
    diag: DiagnosticBag,
    limits: RemapprCompileLimits,
): void {
    const maxDepth = limits.macroCallDepth ?? MACRO_CALL_DEPTH_MAX
    const canCall =
        limits.featureBitmask === undefined ||
        (limits.featureBitmask & Feature.MACRO_CALL) !== 0
    const byId = new Map(macros.map((m) => [m.id, m]))
    const depth = new Map<string, number>()
    const onPath = new Set<string>()
    const visit = (m: CanonMacro, mi: number): number => {
        const done = depth.get(m.id)
        if (done !== undefined) return done
        onPath.add(m.id)
        let d = 0
        m.steps.forEach((s, si) => {
            if (s.type !== 'call') return
            const path = ['macros', mi, 'steps', si]
            if (!canCall)
                return diag.error(
                    `macro "${m.id}" calls "${s.macro}", but this keyboard's firmware cannot ` +
                        'run one macro from another — remove the call, or update the firmware',
                    path,
                )
            const t = byId.get(s.macro)
            if (!t) return diag.error(`macro "${m.id}" calls unknown macro "${s.macro}"`, path)
            if (isTemplate(t))
                return diag.error(
                    `macro "${m.id}" calls "${s.macro}", which takes a parameter — a call cannot pass one`,
                    path,
                )
            if (onPath.has(t.id))
                return diag.error(
                    `macro "${m.id}" calls "${s.macro}", which calls back into it — macro calls cannot loop`,
                    path,
                )
            d = Math.max(d, 1 + visit(t, macros.indexOf(t)))
        })
        onPath.delete(m.id)
        depth.set(m.id, d)
        return d
    }
    macros.forEach((m, mi) => {
        const d = visit(m, mi)
        if (d > maxDepth)
            diag.warn(
                `macro "${m.id}" nests calls ${d} deep; default firmware allows ${maxDepth}, ` +
                    'so the keyboard may refuse it unless its build allows more',
                ['macros', mi],
            )
    })
}

// Encode all plain macros into wire records; collect parameterized templates.
function buildMacros(
    macros: CanonMacro[] | undefined,
    diag: DiagnosticBag,
    limits: RemapprCompileLimits,
): MacroCtx {
    const ctx: MacroCtx = {
        records: [],
        index: new Map(),
        templates: new Map(),
        instances: new Map(),
        instanceNames: [],
    }
    const all = macros ?? []
    // Index every plain macro up front: a call may name one defined later.
    all.filter((m) => !isTemplate(m)).forEach((m, i) => ctx.index.set(m.id, i))
    checkMacroCalls(all, diag, limits)
    all.forEach((m, mi) => {
        if (isTemplate(m)) {
            ctx.templates.set(m.id, { m, mi })
            return
        }
        // A private macro read off a device came back with its steps blanked;
        // writing it as read would store an empty macro in its place.
        if (m._redacted && m.steps.length === 0) {
            diag.error(
                `macro "${m.id}" is private: the device does not return its steps, ` +
                    'so enter them again before saving',
                ['macros', mi],
            )
        }
        const steps = lowerMacroSteps(m, mi, diag, { index: ctx.index })
        warnDeadMacroUsages(steps, diag, ['macros', mi])
        ctx.records.push({
            steps,
            ...(m.private ? { private: true } : {}),
        })
    })
    return ctx
}

// HID modifier usages are 0xE0..0xE7 → modifier-byte bit (1 << usage-0xE0).
// pattern-check: skip tiny pure usage→mod-bit map for sticky/key-toggle behaviors
function usageToModBit(usage: number): number | null {
    return usage >= 0xe0 && usage <= 0xe7 ? 1 << (usage - 0xe0) : null
}

// Modifier[] → HID modifier mask. MODIFIERS index == REMAPPR_MOD_* bit
// (LEFT_CTRL=0 … RIGHT_GUI=7), so the mask is a direct OR of `1 << index`.
// pattern-check: skip tiny pure Modifier[]→mask reduce for KEY_MODS
function modsToMask(mods: Modifier[]): number {
    let mask = 0
    for (const m of mods) mask |= 1 << MODIFIERS.indexOf(m)
    return mask & 0xff
}

// §F: pack a CanonSemanticAction into the 8-byte {kind, code, arg0, arg1} wire
// record — mirrors the inline constructors in the firmware's action.h so the two
// sides pack identically. The numeric fields are already raw wire values.
// pattern-check: skip tiny pure semantic-action→wire-record packer, mirrors action.h
function lowerSemanticAction(a: CanonSemanticAction): {
    kind: number
    code: number
    arg0: number
    arg1: number
} {
    switch (a.kind) {
        case 'none':
            return { kind: 0, code: 0, arg0: 0, arg1: 0 }
        case 'keyboard':
            return { kind: 1, code: a.usage, arg0: a.mods ?? 0, arg1: 0 }
        case 'consumer':
            return { kind: 2, code: a.usage, arg0: 0, arg1: 0 }
        case 'pointer':
            return {
                kind: 3,
                code: a.op,
                arg0: a.code ?? 0,
                arg1: a.magnitude ?? 0,
            }
        case 'system':
            return { kind: 4, code: a.action, arg0: 0, arg1: 0 }
        case 'output':
            return {
                kind: 5,
                code: a.action,
                arg0: a.profile ?? OUTPUT_NO_PROFILE,
                arg1: 0,
            }
        case 'lighting':
            return {
                kind: 6,
                code: a.action | (a.target << 8),
                arg0: a.hue ?? 0,
                arg1: (a.sat ?? 0) | ((a.val ?? 0) << 8),
            }
        case 'device':
            return { kind: 7, code: a.action, arg0: a.value ?? 0, arg1: 0 }
    }
}

// ZMK hold-tap flavor string → remappr_th_flavor. When no flavor is set, fall
// back to the coarser `resolve` hint, else Balanced.
// pattern-check: skip tiny pure flavor→enum resolver for tap_hold
function flavorCode(a: CanonTapHold): number {
    switch (a.flavor) {
        case 'hold-preferred':
            return Flavor.HoldPreferred
        case 'balanced':
            return Flavor.Balanced
        case 'tap-preferred':
            return Flavor.TapPreferred
        case 'tap-unless-interrupted':
            return Flavor.TapUnlessInterrupted
    }
    if (a.resolve === 'prefer-hold') return Flavor.HoldPreferred
    if (a.resolve === 'prefer-tap') return Flavor.TapPreferred
    return Flavor.Balanced
}

// hold_tap flavor — the def has no coarse `resolve` hint (unlike CanonTapHold).
// pattern-check: skip — tiny pure flavor enum resolver for custom hold-taps
function holdTapFlavorCode(flavor: CanonHoldTapDef['flavor']): number {
    switch (flavor) {
        case 'hold-preferred':
            return Flavor.HoldPreferred
        case 'tap-preferred':
            return Flavor.TapPreferred
        case 'tap-unless-interrupted':
            return Flavor.TapUnlessInterrupted
        default:
            return Flavor.Balanced
    }
}

// Resolve a ZMK keycode token ("LSHIFT", "A", …) to its HID keyboard usage, or
// null. Reuses the canonical keycode resolver + the catalog usage map.
// pattern-check: skip — pure token→usage lookup for hold-tap params
function tokenUsage(token: string): number | null {
    const canon = resolveKeycode(token)
    if (!canon) return null
    const u = HID_USAGE_BY_CANONICAL.get(canon)
    return u && u.page === HID_PAGE_KEYBOARD ? u.usage : null
}

// Lower a custom `zmk,behavior-hold-tap` reference to MOD_TAP / LAYER_TAP — the
// only tap-hold shapes the firmware represents. bindings[0] is the hold behavior,
// bindings[1] the tap behavior (ZMK order); holdParam/tapParam are their args. The
// tap side must be &kp <key>; the hold side is &kp/&sk <modifier> (→ MOD_TAP) or
// &mo <layer> (→ LAYER_TAP, a momentary hold). Anything else, &to/&tog holds
// included, is a wire gap. requirePriorIdle,
// retro-tap, and §28 positions are emitted faithfully and restored by the decoder
// onto a plain inline tap_hold (a def decodes back as inline); hold-trigger-on-
// release has no wire bit yet (Phase 2) and is warned + dropped.
function lowerHoldTap(
    action: Extract<CanonAction, { type: 'hold_tap' }>,
    def: CanonHoldTapDef,
    diag: DiagnosticBag,
    path: (string | number)[],
    layerIndex: Map<string, number>,
    quickTapDefault?: number,
): BehaviorRecord {
    const holdTok = def.bindings[0].replace(/^&/, '')
    const tapTok = def.bindings[1].replace(/^&/, '')

    if (tapTok !== 'kp') {
        diag.error(
            `hold_tap "${action.ref}" tap behavior "${def.bindings[1]}" is not ` +
                `&kp — a firmware hold-tap taps a single key`,
            path,
        )
        return rec({ type: BehaviorType.None })
    }
    const tap = tokenUsage(action.tapParam)
    if (tap === null) {
        diag.error(
            `hold_tap "${action.ref}" tap key "${action.tapParam}" is not a ` +
                `keyboard usage`,
            path,
        )
        return rec({ type: BehaviorType.None })
    }
    const common = {
        flavor: holdTapFlavorCode(def.flavor),
        tap,
        tappingTermMs: def.tappingTermMs ?? 0,
        quickTapMs: def.quickTapMs ?? quickTapDefault ?? 0,
        requirePriorIdleMs: def.requirePriorIdleMs ?? 0,
        // BHF bit4 hold-trigger-on-release resolves an interrupted hold on the
        // interrupter's release (roll-through taps); honored by fw since #58.
        flags:
            (def.retroTap ? BehaviorFlags.RETRO_TAP : 0) |
            (def.holdTriggerOnRelease
                ? BehaviorFlags.HOLD_TRIGGER_ON_RELEASE
                : 0),
        // §28 positional hold: rides the record into TBL_POSHOLD (annotation,
        // not part of the 16-byte record).
        ...(def.holdTriggerKeyPositions?.length
            ? { posHold: [...def.holdTriggerKeyPositions] }
            : {}),
    }

    if (holdTok === 'kp' || holdTok === 'sk') {
        const u = tokenUsage(action.holdParam)
        const bit = u !== null ? usageToModBit(u) : null
        if (bit === null) {
            diag.error(
                `hold_tap "${action.ref}" hold "${action.holdParam}" is not a ` +
                    `modifier — only mod or layer holds are on the wire`,
                path,
            )
            return rec({ type: BehaviorType.None })
        }
        return rec({ type: BehaviorType.ModTap, ...common, hold: bit })
    }
    if (holdTok === 'to' || holdTok === 'tog') {
        diag.error(
            `hold_tap "${action.ref}" hold "${def.bindings[0]}" is not on the wire ` +
                `(a firmware layer hold is momentary: use &mo)`,
            path,
        )
        return rec({ type: BehaviorType.None })
    }
    if (holdTok === 'mo') {
        const li =
            layerIndex.get(action.holdParam) ??
            (/^\d+$/.test(action.holdParam)
                ? Number(action.holdParam)
                : undefined)
        if (li === undefined) {
            diag.error(
                `hold_tap "${action.ref}" hold layer "${action.holdParam}" is unknown`,
                path,
            )
            return rec({ type: BehaviorType.None })
        }
        return rec({ type: BehaviorType.LayerTap, ...common, hold: li })
    }
    diag.error(
        `hold_tap "${action.ref}" hold behavior "${def.bindings[0]}" is not on ` +
            `the wire (firmware hold is a modifier or a layer only)`,
        path,
    )
    return rec({ type: BehaviorType.None })
}

/* ── composite behaviors (mod-morph 9, tap-dance 10; §43.3) ──────────────────
 * MOD_MORPH and TAP_DANCE carry their inner behaviors in the separate SUBS table
 * (id 12, same 16-byte record framing as BEHAVIOR); the composite record points
 * at a contiguous slice via sub_index/sub_count. The encoder lowers each
 * definition's inner CanonActions into that pool the first time a `ref` is seen,
 * memoizing the produced record so repeated references share one sub-slice (and
 * dedupe down to a single behavior-table entry). */
interface CompCtx {
    // pattern-check: skip — adding a def-lookup field to an existing context struct
    subs: BehaviorRecord[]
    tapDanceById: Map<string, CanonTapDance>
    modMorphById: Map<string, CanonModMorph>
    holdTapById: Map<string, CanonHoldTapDef>
    /** ref-key ("td:id" / "mm:id") → already-lowered composite record. */
    memo: Map<string, BehaviorRecord>
    /** ref-keys currently being lowered, to break a self-referential cycle. */
    inProgress: Set<string>
    /** TBL_NAMES entries (§24) collected as composites are first lowered, keyed
     *  by the assigned sub_index so the firmware/app see the real name. */
    names: NameRecord[]
    /** `defaults.quickTapMs` lowered into every tap-hold record that has no
     *  explicit quickTap (quickTap has no global wire slot, so the default must
     *  ride each record). Undefined = leave records at 0 (firmware default). */
    quickTapDefault?: number
}

// Memoize a composite record by ref-key and guard against a definition that
// references itself (which would recurse forever). `build` returns null for an
// unknown/invalid ref; the NONE fallback keeps the blob well-formed.
function withComposite(
    key: string,
    comp: CompCtx,
    diag: DiagnosticBag,
    path: (string | number)[],
    build: () => BehaviorRecord | null,
): BehaviorRecord {
    const memoed = comp.memo.get(key)
    if (memoed) return memoed
    if (comp.inProgress.has(key)) {
        diag.error(`composite "${key}" references itself`, path)
        return rec({ type: BehaviorType.None })
    }
    comp.inProgress.add(key)
    const built = build() ?? rec({ type: BehaviorType.None })
    comp.inProgress.delete(key)
    comp.memo.set(key, built)
    return built
}

// Lower one canonical binding to a behavior record. Unsupported actions emit a
// diagnostic and fall back to NONE so the blob still forms (thin slice).
// A decoded binding carrying `_wire` (wire.ts) writes back what its canonical
// form could not hold, so a save does not change what an untouched key does.
function lowerAction(
    action: CanonAction,
    diag: DiagnosticBag,
    path: (string | number)[],
    macroCtx: MacroCtx,
    layerIndex: Map<string, number>,
    comp: CompCtx,
): BehaviorRecord {
    const lowered = lowerCanonAction(action, diag, path, macroCtx, layerIndex, comp)
    const r = action._wire ? mergeWire(lowered, action._wire) : lowered
    if (KEYBOARD_TAP_TYPES.has(r.type)) warnDeadUsage(r.tap, diag, path, 'the key')
    return r
}

function lowerCanonAction(
    action: CanonAction,
    diag: DiagnosticBag,
    path: (string | number)[],
    macroCtx: MacroCtx,
    layerIndex: Map<string, number>,
    comp: CompCtx,
): BehaviorRecord {
    switch (action.type) {
        case 'key_press': {
            const u = HID_USAGE_BY_CANONICAL.get(action.key)
            if (!u) {
                diag.error(`no HID usage for key "${action.key}"`, path)
                return rec({ type: BehaviorType.None })
            }
            if (u.page === HID_PAGE_CONSUMER) {
                // BH_CONSUMER (37): a Consumer-page (media/volume/AC/AL) usage.
                // The firmware asserts it on press and releases it on the up
                // edge via the consumer HID interface; the record has no
                // modifier field, so any mods on the binding are dropped.
                if (action.mods?.length) {
                    diag.warn(
                        `consumer key "${action.key}" carries modifiers — ` +
                            `dropped (BH_CONSUMER emits a bare Consumer usage)`,
                        path,
                    )
                }
                return rec({ type: BehaviorType.Consumer, tap: u.usage })
            }
            if (u.page === HID_PAGE_SYSTEM) {
                // BH_SYS_CTRL (38): a GD System Control usage (power/sleep/wake).
                // Like BH_CONSUMER it is asserted on press and released (usage 0)
                // on the up edge via the system-control HID interface; the record
                // has no modifier field, so any mods on the binding are dropped.
                if (action.mods?.length) {
                    diag.warn(
                        `system-control key "${action.key}" carries modifiers — ` +
                            `dropped (BH_SYS_CTRL emits a bare GD usage)`,
                        path,
                    )
                }
                return rec({ type: BehaviorType.SysCtrl, tap: u.usage })
            }
            if (u.page !== HID_PAGE_KEYBOARD) {
                diag.error(
                    `key "${action.key}" is on HID page ${u.page} (not yet on ` +
                        `the wire — §44.4)`,
                    path,
                )
                return rec({ type: BehaviorType.None })
            }
            if (action.mods?.length) {
                // KEY_MODS (22): a modded key_press (e.g. Ctrl+C). tap = usage,
                // hold = modifier mask; the firmware emits the mods + usage as
                // one chord and retracts both on release. (§5.2, no longer a gap.)
                return rec({
                    type: BehaviorType.KeyMods,
                    tap: u.usage,
                    hold: modsToMask(action.mods),
                })
            }
            return rec({ type: BehaviorType.Key, tap: u.usage })
        }
        case 'tap_hold': {
            // MOD_TAP (3) when hold is a modifier; LAYER_TAP (4) when hold is a
            // layer. tap = tap-key usage, hold = mod mask | layer index, plus
            // flavor + timings. (mod-tap-of-a-modded-key isn't on the wire.)
            const tapUsage = keyUsage(action.tap.key, diag, [...path, 'tap'])
            if (tapUsage === null) return rec({ type: BehaviorType.None })
            if (action.tap.mods?.length) {
                diag.warn(
                    `tap_hold tap "${action.tap.key}" carries modifiers — ` +
                        `dropped (firmware MOD_TAP tap is a single usage)`,
                    [...path, 'tap'],
                )
            }
            const common = {
                flavor: flavorCode(action),
                tap: tapUsage,
                tappingTermMs: action.tappingTermMs ?? 0,
                // Explicit per-action quickTap wins (including an explicit 0 =
                // "no quick tap"); else the config default; else 0 = fw default.
                quickTapMs: action.quickTapMs ?? comp.quickTapDefault ?? 0,
                requirePriorIdleMs: action.requirePriorIdleMs ?? 0,
                // BHF bit4 hold-trigger-on-release (fw honors since #58); mirrors
                // lowerHoldTap.
                flags:
                    (action.retroTap ? BehaviorFlags.RETRO_TAP : 0) |
                    (action.holdTriggerOnRelease
                        ? BehaviorFlags.HOLD_TRIGGER_ON_RELEASE
                        : 0),
                // §28 positional hold rides the record into TBL_POSHOLD (an
                // annotation, not part of the 16-byte record); mirrors lowerHoldTap.
                ...(action.holdTriggerKeyPositions?.length
                    ? { posHold: [...action.holdTriggerKeyPositions] }
                    : {}),
            }
            if (action.hold.type === 'modifier') {
                return rec({
                    type: BehaviorType.ModTap,
                    ...common,
                    hold: 1 << MODIFIERS.indexOf(action.hold.modifier),
                })
            }
            const li = layerIndex.get(action.hold.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.hold.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return rec({ type: BehaviorType.LayerTap, ...common, hold: li })
        }
        case 'transparent':
            return rec({ type: BehaviorType.Trans })
        case 'none':
            return rec({ type: BehaviorType.None })
        case 'macro': {
            // pattern-check: skip — case-body extension of the existing
            // lowerAction switch; functional clone + memo map, no new type.
            // A parameterized macro (one with a `param` marker) is a TEMPLATE:
            // clone it per distinct (ref, argument) pair — the wire has no
            // parameter slot (§44.3 host clone-per-instance). Identical
            // bindings share one clone via the instances map.
            const tpl = macroCtx.templates.get(action.ref)
            if (tpl) {
                if (action.param === undefined) {
                    diag.error(
                        `macro "${action.ref}" takes a parameter — ` +
                            `bind it with an argument`,
                        path,
                    )
                    return rec({ type: BehaviorType.None })
                }
                const ikey = `${action.ref} ${action.param}`
                let idx = macroCtx.instances.get(ikey)
                if (idx === undefined) {
                    idx = macroCtx.records.length
                    const steps = lowerMacroSteps(tpl.m, tpl.mi, diag, {
                        index: macroCtx.index,
                        substKey: action.param,
                    })
                    warnDeadMacroUsages(steps, diag, path)
                    macroCtx.records.push({
                        steps,
                        ...(tpl.m.private ? { private: true } : {}),
                    })
                    macroCtx.instances.set(ikey, idx)
                    // §24 display name: the template's id plus the argument, so
                    // a round-trip shows which instance a key is bound to.
                    macroCtx.instanceNames.push({
                        kind: NameKind.Macro,
                        ref: idx,
                        name: `${action.ref}(${action._paramSrc ?? action.param})`,
                    })
                }
                return rec({ type: BehaviorType.Macro, tap: idx })
            }
            const idx = macroCtx.index.get(action.ref)
            if (idx === undefined) {
                diag.error(`unknown macro ref "${action.ref}"`, path)
                return rec({ type: BehaviorType.None })
            }
            if (action.param !== undefined) {
                diag.warn(
                    `macro "${action.ref}" has no param step — ` +
                        `binding argument ignored`,
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
            if (action.releaseAfterMs && t !== BehaviorType.StickyLayer) {
                diag.warn(
                    `releaseAfterMs applies to a sticky layer only — ignored`,
                    path,
                )
            }
            // A sticky layer's tapping_term_ms is its release-after (0 = the
            // keymap's sticky default).
            const releaseAfter =
                t === BehaviorType.StickyLayer ? (action.releaseAfterMs ?? 0) : 0
            return rec({ type: t, hold: li, tappingTermMs: releaseAfter })
        }
        case 'sticky_key': {
            const usage = keyUsage(action.key, diag, path)
            if (usage === null) return rec({ type: BehaviorType.None })
            const bit = usageToModBit(usage)
            // A modifier one-shot rides the sticky-mod path; any other usage is
            // a one-shot key (BH_STICKY_KEY: held until the next key releases).
            // tapping_term_ms is the one-shot's release-after (0 = the keymap's
            // sticky default).
            const tappingTermMs = action.releaseAfterMs ?? 0
            return bit !== null
                ? rec({ type: BehaviorType.StickyMod, hold: bit, tappingTermMs })
                : rec({ type: BehaviorType.StickyKey, tap: usage, tappingTermMs })
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
        case 'battery_show':
            // Device action fired on press via the engine's system callback;
            // the action code rides in `tap`.
            return rec({
                type: BehaviorType.System,
                tap: SystemAction[action.type],
            })
        case 'studio_unlock':
            // Not a keymap behavior on remappr: device unlock is a RUCP control
            // op (the app holds an authenticated session), not a key binding.
            // Reject cleanly instead of silently emitting NONE.
            diag.error(
                'studio_unlock is not a remappr keymap action — device unlock ' +
                    'is handled by the RUCP control channel, not a key binding',
                path,
            )
            return rec({ type: BehaviorType.None })
        case 'ext_power':
            // EXT_POWER toggle / on / off → BH_SYSTEM with the matching system
            // action code; the keyboard_node sink drives the board's ext_power
            // GPIO (toggle relative, on/off absolute). §44.3, §5.2-I.
            return rec({
                type: BehaviorType.System,
                tap:
                    action.action === 'on'
                        ? SystemAction.ext_power_on
                        : action.action === 'off'
                          ? SystemAction.ext_power_off
                          : SystemAction.ext_power_toggle,
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
        // pattern-check: skip — §5.2 behavior_type 20..36 lowering cases
        case 'auto_shift': {
            // tap = key usage, hold = mod mask added on a hold past the term.
            const usage = keyUsage(action.key, diag, path)
            if (usage === null) return rec({ type: BehaviorType.None })
            // Runs the tap-hold machinery: term = the shift timeout, plus
            // quick-tap and prior-idle like a mod-tap (0 = defaults).
            return rec({
                type: BehaviorType.AutoShift,
                tap: usage,
                hold: modsToMask(action.mods),
                tappingTermMs: action.timeoutMs ?? 0,
                quickTapMs: action.quickTapMs ?? 0,
                requirePriorIdleMs: action.requirePriorIdleMs ?? 0,
            })
        }
        case 'alt_repeat':
            return rec({ type: BehaviorType.AltRepeat })
        case 'layer_lock':
            return rec({ type: BehaviorType.LayerLock })
        case 'layer_mod': {
            // hold = layer index, tap = mod mask held while the layer is active.
            const li = layerIndex.get(action.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return rec({
                type: BehaviorType.LayerMod,
                hold: li,
                tap: modsToMask(action.mods),
            })
        }
        case 'tap_toggle': {
            const li = layerIndex.get(action.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return rec({
                type: BehaviorType.LayerTapToggle,
                hold: li,
                tappingTermMs: action.tappingTermMs ?? 0,
            })
        }
        case 'set_base_saved': {
            const li = layerIndex.get(action.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return rec({ type: BehaviorType.ToSaved, hold: li })
        }
        case 'auto_layer': {
            const li = layerIndex.get(action.layer)
            if (li === undefined) {
                diag.error(`unknown layer "${action.layer}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return rec({ type: BehaviorType.AutoLayer, hold: li })
        }
        case 'gui_lock':
            return rec({
                type: BehaviorType.GuiLock,
                tap: LockAction[action.action],
            })
        case 'secure':
            return rec({
                type: BehaviorType.Secure,
                tap: LockAction[action.action],
            })
        case 'autocorrect':
            return rec({
                type: BehaviorType.Autocorrect,
                tap: LockAction[action.action],
            })
        case 'tune_tap_term':
            return rec({ type: BehaviorType.TuneTerm, tap: action.ms })
        case 'unicode':
            return rec({ type: BehaviorType.Unicode, tap: action.codepoint })
        case 'macro_record':
            return rec({ type: BehaviorType.MacroRecord, tap: action.slot })
        case 'macro_play':
            return rec({ type: BehaviorType.MacroPlay, tap: action.slot })
        case 'leader':
            return rec({ type: BehaviorType.Leader, tap: action.windowMs ?? 0 })
        case 'peripheral':
            return rec({
                type: BehaviorType.Peripheral,
                tap: PeripheralKind[action.kind],
                hold: action.code,
            })
        case 'hold_tap': {
            const def = comp.holdTapById.get(action.ref)
            if (!def) {
                diag.error(`unknown hold_tap "${action.ref}"`, path)
                return rec({ type: BehaviorType.None })
            }
            return lowerHoldTap(action, def, diag, path, layerIndex, comp.quickTapDefault)
        }
        case 'tap_dance':
            return withComposite(`td:${action.ref}`, comp, diag, path, () => {
                const def = comp.tapDanceById.get(action.ref)
                if (!def) {
                    diag.error(`unknown tap_dance "${action.ref}"`, path)
                    return null
                }
                if (def.hold)
                    diag.warn(
                        `tap_dance "${action.ref}" hold target is not on the ` +
                            `wire (firmware TAP_DANCE is tap-count only) — dropped`,
                        path,
                    )
                // sub[i] fires on (i+1) taps; counts past sub_count clamp to the
                // last. Index by count so sparse authoring stays aligned.
                const maxCount = Math.max(...def.taps.map((t) => t.count))
                const slots: BehaviorRecord[] = Array.from(
                    { length: maxCount },
                    () => rec({ type: BehaviorType.None }),
                )
                const filled = new Array<boolean>(maxCount).fill(false)
                for (const tap of def.taps) {
                    slots[tap.count - 1] = lowerAction(
                        tap.action,
                        diag,
                        [...path, 'taps', tap.count],
                        macroCtx,
                        layerIndex,
                        comp,
                    )
                    filled[tap.count - 1] = true
                }
                for (let i = 0; i < maxCount; i++)
                    if (!filled[i])
                        diag.warn(
                            `tap_dance "${action.ref}" has no action for ` +
                                `${i + 1} tap(s) — emits none`,
                            path,
                        )
                const subIndex = comp.subs.length
                comp.subs.push(...slots)
                comp.names.push({
                    kind: NameKind.TapDance,
                    ref: subIndex,
                    name: action.ref,
                })
                return rec({
                    type: BehaviorType.TapDance,
                    subCount: maxCount,
                    subIndex,
                    tappingTermMs: def.tappingTermMs ?? 0,
                })
            })
        case 'mod_morph':
            return withComposite(`mm:${action.ref}`, comp, diag, path, () => {
                const def = comp.modMorphById.get(action.ref)
                if (!def) {
                    diag.error(`unknown mod_morph "${action.ref}"`, path)
                    return null
                }
                // sub[0] = unmorphed binding, sub[1] = morphed binding.
                const sub0 = lowerAction(
                    def.bindings[0],
                    diag,
                    [...path, 'bindings', 0],
                    macroCtx,
                    layerIndex,
                    comp,
                )
                const sub1 = lowerAction(
                    def.bindings[1],
                    diag,
                    [...path, 'bindings', 1],
                    macroCtx,
                    layerIndex,
                    comp,
                )
                const subIndex = comp.subs.length
                comp.subs.push(sub0, sub1)
                comp.names.push({
                    kind: NameKind.ModMorph,
                    ref: subIndex,
                    name: action.ref,
                })
                // ZMK keep-mods: trigger mods are suppressed from the morphed
                // report unless kept. A partial keep list rides the explicit
                // suppress mask in `tap` (trigger & ~kept); tap = 0 keeps the
                // legacy whole-trigger suppression so old blobs are unchanged.
                const trig = modsToMask(def.mods)
                const keep = modsToMask(def.keepMods ?? [])
                const suppress = trig & ~keep
                return rec({
                    type: BehaviorType.ModMorph,
                    hold: trig,
                    subCount: 2,
                    subIndex,
                    flags: suppress ? BehaviorFlags.MORPH_SUPPRESS_MODS : 0,
                    tap: suppress !== 0 && suppress !== trig ? suppress : 0,
                })
            })
        case 'grave_escape':
            // QMK KC_GESC: Esc normally; with any Shift or GUI held it becomes
            // grave/backtick. A MOD_MORPH under ANY-mod semantics; the trigger
            // mods stay in the report (Shift+` must still type ~).
            return withComposite('gesc:', comp, diag, path, () => {
                const subIndex = comp.subs.length
                comp.subs.push(
                    rec({ type: BehaviorType.Key, tap: 0x29 }), // Escape
                    rec({ type: BehaviorType.Key, tap: 0x35 }), // ` / ~
                )
                return rec({
                    type: BehaviorType.ModMorph,
                    // LSHIFT|RSHIFT|LGUI|RGUI (REMAPPR_MOD_* bits 1,5,3,7)
                    hold: 0xaa,
                    subCount: 2,
                    subIndex,
                    flags: BehaviorFlags.MORPH_ANY_MOD,
                })
            })
        default: {
            // Exhaustive over the CanonAction union; this guards against a new
            // action type being added without a lowering arm.
            const unhandled = action as { type?: string }
            diag.error(
                `action "${unhandled.type ?? 'unknown'}" not yet supported by ` +
                    `the remappr target (§44.3 gap)`,
                path,
            )
            return rec({ type: BehaviorType.None })
        }
    }
}

/* ── sliders (TBL_SLIDER, slider part design §4b) ───────────────────────── */

const SLIDER_STEPS_DEFAULT = 20

type LowerFn = (a: CanonAction, path: (string | number)[]) => number

/** A stepping map's two behaviors (up, down), or null when it has none. */
const STEP_ACTIONS: Readonly<
    Record<
        'volume' | 'mouse_wheel' | 'custom',
        (s: CanonSliderBinding) => [CanonAction, CanonAction | undefined] | null
    >
> = {
    volume: () => [
        { type: 'key_press', key: 'media.volume_increment' as CanonicalKeyId },
        { type: 'key_press', key: 'media.volume_decrement' as CanonicalKeyId },
    ],
    mouse_wheel: () => [
        { type: 'mouse_scroll', direction: 'up' },
        { type: 'mouse_scroll', direction: 'down' },
    ],
    custom: (s) => (s.action ? [s.action, s.downAction] : null),
}

const LEVEL_TARGETS: Readonly<Record<'brightness' | 'hue', number>> = {
    brightness: SliderTarget.rgbBrightness,
    hue: SliderTarget.rgbHue,
}

function levelEntry(
    s: CanonSliderBinding & { map: 'brightness' | 'hue' },
    diag: DiagnosticBag,
    path: (string | number)[],
): Omit<SliderRecord, 'slider' | 'layer'> | null {
    const min = s.min ?? 0
    const max = s.max ?? 255
    const inRange = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 255
    if (!inRange(min) || !inRange(max)) {
        diag.error(`a ${s.map} slider's min and max are 0..255`, path)
        return null
    }
    return {
        kind: SliderKind.level,
        arg: LEVEL_TARGETS[s.map],
        min,
        max,
        up: SLIDER_BH_NONE,
        down: SLIDER_BH_NONE,
    }
}

function stepsEntry(
    s: CanonSliderBinding & { map: 'volume' | 'mouse_wheel' | 'custom' },
    diag: DiagnosticBag,
    path: (string | number)[],
    lower: LowerFn,
): Omit<SliderRecord, 'slider' | 'layer'> | null {
    const actions = STEP_ACTIONS[s.map](s)
    if (!actions) {
        diag.error(`a custom slider needs an action`, path)
        return null
    }
    if (s.min !== undefined || s.max !== undefined)
        diag.warn(`min / max apply to a brightness or hue slider — ignored`, path)
    const steps = s.steps ?? SLIDER_STEPS_DEFAULT
    if (!Number.isInteger(steps) || steps < 1 || steps > SLIDER_STEPS_MAX) {
        diag.error(`a slider takes 1..${SLIDER_STEPS_MAX} steps`, path)
        return null
    }
    const [up, down] = actions
    return {
        kind: SliderKind.steps,
        arg: steps,
        min: 0,
        max: 0,
        up: lower(up, [...path, 'action']),
        down: down ? lower(down, [...path, 'downAction']) : SLIDER_BH_NONE,
    }
}

const isLevelMap = (
    s: CanonSliderBinding,
): s is CanonSliderBinding & { map: 'brightness' | 'hue' } =>
    s.map === 'brightness' || s.map === 'hue'

/**
 * layers[].sliderBindings -> TBL_SLIDER entries. A binding is keyed by the key
 * position of an `element: "slider"` key; the wire names the slider by its
 * rank among those keys (the device's SLIDER parts in order).
 */
function lowerSliders(
    keys: ConfigKeymap['keyboard']['keys'],
    layers: readonly CanonLayer[],
    diag: DiagnosticBag,
    lower: LowerFn,
): SliderRecord[] {
    const rank = new Map<number, number>()
    keys.forEach((k, pos) => {
        if (k.element === 'slider') rank.set(pos, rank.size)
    })
    const out: SliderRecord[] = []
    layers.forEach((layer, li) => {
        for (const [key, s] of Object.entries(layer.sliderBindings ?? {})) {
            const path = ['layers', li, 'sliderBindings', key]
            const slider = rank.get(Number(key))
            if (slider === undefined) {
                diag.error(`key ${key} is not a slider (element "slider")`, path)
                continue
            }
            const entry = isLevelMap(s)
                ? levelEntry(s, diag, path)
                : stepsEntry(
                      s as CanonSliderBinding & { map: 'volume' | 'mouse_wheel' | 'custom' },
                      diag,
                      path,
                      lower,
                  )
            if (entry) out.push({ slider, layer: li, ...entry })
        }
    })
    return out
}

/**
 * Errors for what the device's config pools cannot hold: it refuses the whole
 * blob (VALIDATE ERR_BOUNDS) with no reason. A combo on several layers takes
 * one record, and its keys again, per layer.
 */
function checkPools(
    combos: readonly ComboRecord[],
    sliders: readonly SliderRecord[],
    limits: RemapprCompileLimits,
    diag: DiagnosticBag,
): void {
    const maxKeys = limits.comboMaxKeys ?? COMBO_MAX_KEYS
    if (combos.some((c) => c.positions.length > maxKeys))
        diag.error(`a combo takes at most ${maxKeys} keys`, ['combos'])
    const positions = combos.reduce((n, c) => n + c.positions.length, 0)
    const pools: [number, number, string, string][] = [
        [combos.length, limits.combosMax ?? COMBOS_MAX, 'combo records (one per layer)', 'combos'],
        [positions, limits.comboPositionsMax ?? COMBO_POSITIONS_MAX, 'combo key slots', 'combos'],
        [sliders.length, limits.slidersMax ?? SLIDERS_MAX, 'slider bindings', 'layers'],
    ]
    for (const [n, max, what, at] of pools) {
        if (n <= max) continue
        diag.error(`the config takes ${n} ${what}; a device holds ${max}`, [at])
    }
}

// Pure encoder: ConfigKeymap → RMBC blob bytes. Shared by the export `compile()`
// path (version from meta) and the live-device commit path (version = active+1).
// Does NOT 16-byte-pad — the golden artifact is unpadded; flash-alignment padding
// is applied at push time by the control service, not baked into the blob.
function encodeBlob(
    config: ConfigKeymap,
    diag: DiagnosticBag,
    configVersion: number,
    limits: RemapprCompileLimits = {},
): Uint8Array {
    const numLayers = config.layers.length
    // numPositions is the physical key count. Prefer the declared geometry, but a
    // device with no stored geometry (a fresh/default config) leaves
    // keyboard.keys empty while the per-layer bindings already carry one entry
    // per position (§44.7 invariant). Fall back to the binding count so the LAYER
    // table never emits num_positions=0 — the firmware rejects that with
    // ERR_BOUNDS in decode_keymap, surfacing to the app as COMMIT_CONFIG →
    // ERR_ACTIVATE.
    const numPositions =
        config.keyboard.keys.length || config.layers[0]?.bindings.length || 0

    if (numLayers === 0) diag.error('keymap has no layers', ['layers'])
    if (numPositions === 0) diag.error('keyboard has no keys', ['keyboard', 'keys'])
    if (numLayers > LAYERS_MAX)
        diag.error(`keymap has ${numLayers} layers; the firmware holds ${LAYERS_MAX}`, [
            'layers',
        ])
    const maxPositions = limits.maxPositions ?? POSITIONS_MAX
    if (numPositions > maxPositions)
        diag.error(
            `keyboard has ${numPositions} keys; the firmware tracks ${maxPositions}`,
            ['keyboard', 'keys'],
        )

    // Macros first: BH_MACRO cells reference them by index.
    const macroCtx = buildMacros(
        config.macros,
        diag,
        limits,
    )
    const layerIndex = new Map(config.layers.map((l, i) => [l.name, i]))

    // Composite (mod-morph / tap-dance) lowering context: definition lookups +
    // the shared SUBS pool the composite records point into.
    const subs: BehaviorRecord[] = []
    const comp: CompCtx = {
        subs,
        tapDanceById: new Map((config.tapDances ?? []).map((t) => [t.id, t])),
        modMorphById: new Map((config.modMorphs ?? []).map((m) => [m.id, m])),
        holdTapById: new Map((config.holdTaps ?? []).map((h) => [h.id, h])),
        memo: new Map(),
        inProgress: new Set(),
        names: [],
        quickTapDefault: config.defaults?.quickTapMs,
    }

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
                      macroCtx,
                      layerIndex,
                      comp,
                  )
                : rec({ type: BehaviorType.None })
            cells.push(getOrAdd(r))
        }
    })

    // Combos (optional). Output is a bare behavior; positions index physical keys.
    // A combo record names one layer (0xFF = any), so a combo on several layers
    // becomes one record per layer; the decoder merges them back.
    const combos: ComboRecord[] = (config.combos ?? []).flatMap((c, ci) => {
        const base = {
            positions: c.keys,
            // Per-combo timeout wins; else the config default; else 40 ms.
            timeoutMs: c.timeoutMs ?? config.defaults?.comboTimeoutMs ?? 40,
            outputIndex: getOrAdd(
                lowerAction(
                    c.action,
                    diag,
                    ['combos', ci, 'action'],
                    macroCtx,
                    layerIndex,
                    comp,
                ),
            ),
        }
        if (!c.layers?.length) return [{ ...base, layer: COMBO_ANY_LAYER }]
        return c.layers.flatMap((name) => {
            const li = layerIndex.get(name)
            if (li === undefined) {
                diag.error(`unknown layer "${name}"`, ['combos', ci, 'layers'])
                return []
            }
            return [{ ...base, layer: li }]
        })
    })

    // Encoders (optional, §4a). Slot-array form: layer.encoders[slot] is
    // index-aligned to keyboard.encoders[], so the slot ordinal is the firmware
    // encoder_index. cw/ccw/press each lower to a behavior index (cw/ccw are
    // required; an absent press is ENCODER_BH_NONE). The keyed encoderBindings
    // builder form is not yet on the wire — warn rather than silently drop.
    const encoders: EncoderRecord[] = []
    config.layers.forEach((layer, li) => {
        layer.encoders?.forEach((binding, slot) => {
            if (!binding) return
            const lower = (
                action: CanonAction | undefined,
                dir: string,
            ): number =>
                action
                    ? getOrAdd(
                          lowerAction(
                              action,
                              diag,
                              ['layers', li, 'encoders', slot, dir],
                              macroCtx,
                              layerIndex,
                              comp,
                          ),
                      )
                    : ENCODER_BH_NONE
            encoders.push({
                encoderIndex: slot,
                layer: li,
                cwIndex: lower(binding.cw, 'cw'),
                ccwIndex: lower(binding.ccw, 'ccw'),
                pressIndex: lower(binding.press, 'press'),
            })
        })
        if (layer.encoderBindings) {
            diag.warn(
                `keyed encoderBindings are not yet lowered to the wire — use ` +
                    `the slot-array layer.encoders[] form`,
                ['layers', li, 'encoderBindings'],
            )
        }
    })

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

    // Key overrides (§43.5; QMK key_overrides) — self-contained 8-byte records;
    // the layer set folds to a bitmask (0 = any layer).
    const keyOverrides: KeyOverrideRecord[] = (config.keyOverrides ?? []).map(
        (ko, i) => {
            const p = ['keyOverrides', i]
            // The mask is a u16 (0 = any layer): a layer past 15 cannot be
            // named, and dropping it would widen the override to every layer.
            const layersMask = (ko.layers ?? []).reduce((mask, ln) => {
                const li = layerIndex.get(ln)
                if (li === undefined) {
                    diag.error(`unknown layer "${ln}"`, [...p, 'layers'])
                    return mask
                }
                if (li >= KEY_OVERRIDE_LAYERS) {
                    diag.error(
                        `layer "${ln}" is layer ${li}; a key override can name ` +
                            `layers 0..${KEY_OVERRIDE_LAYERS - 1} only`,
                        [...p, 'layers'],
                    )
                    return mask
                }
                return mask | (1 << li)
            }, 0)
            const trigger = keyUsage(ko.trigger, diag, [...p, 'trigger']) ?? 0
            const replacement = ko.replacement
                ? (keyUsage(ko.replacement, diag, [...p, 'replacement']) ?? 0)
                : 0
            warnDeadUsage(trigger, diag, [...p, 'trigger'], 'the trigger')
            warnDeadUsage(replacement, diag, [...p, 'replacement'], 'the replacement')
            return {
                trigger,
                triggerMods: modsToMask(ko.triggerMods),
                negativeMods: modsToMask(ko.negativeMods ?? []),
                suppressedMods: modsToMask(ko.suppressedMods ?? []),
                replacement,
                replacementMods: modsToMask(ko.replacementMods ?? []),
                layers: layersMask,
            }
        },
    )

    // Leader sequences (§43.5) — `output` references the (deduped) BEHAVIOR table.
    const leaders: LeaderRecord[] = (config.leaderSequences ?? []).map(
        (ls, i) => {
            const p = ['leaderSequences', i]
            const usages = ls.sequence.map((k, ki) => {
                const u = keyUsage(k, diag, [...p, 'sequence', ki]) ?? 0
                warnDeadUsage(u, diag, [...p, 'sequence', ki], 'a sequence key')
                return u
            })
            const maxKeys = limits.leaderMaxKeys ?? LEADER_MAX_KEYS
            if (usages.length > maxKeys)
                diag.error(
                    `leader sequence ${i} has ${usages.length} keys (max ${maxKeys})`,
                    p,
                )
            return {
                usages: usages.slice(0, maxKeys),
                outputIndex: getOrAdd(
                    lowerAction(
                        ls.action,
                        diag,
                        [...p, 'action'],
                        macroCtx,
                        layerIndex,
                        comp,
                    ),
                ),
            }
        },
    )

    const sliders = lowerSliders(config.keyboard.keys, config.layers, diag, (a, path) =>
        getOrAdd(lowerAction(a, diag, path, macroCtx, layerIndex, comp)),
    )

    const defaultTermMs = config.defaults?.tappingTermMs ?? 200
    const releaseMs = config.defaults?.releaseDebounceMs ?? 0

    const builder = new BlobBuilder()
        .layerTable(numLayers, numPositions, defaultTermMs, releaseMs, {
            pressDebounceMs: config.defaults?.pressDebounceMs,
            matrixPressDebounceMs: config.defaults?.matrixPressDebounceMs,
            matrixReleaseDebounceMs: config.defaults?.matrixReleaseDebounceMs,
            capsWordIdleMs: config.defaults?.capsWordIdleMs,
            stickyReleaseDefaultMs: config.defaults?.stickyReleaseDefaultMs,
            macroDefaultWaitMs: config.defaults?.macroDefaultWaitMs,
            macroDefaultTapMs: config.defaults?.macroDefaultTapMs,
            matrixPollPeriodMs: config.defaults?.matrixPollPeriodMs,
        })
        .behaviorTable(behaviors)
        .bindingTable(cells)
    // SUBS table (composite sub-behaviors) only when a mod-morph / tap-dance was
    // lowered; absent otherwise so existing composite-free goldens are unchanged.
    // TBL_POSHOLD patches BEHAVIOR records only, so a positional hold-tap nested
    // inside a composite loses its list — surface that instead of silence.
    subs.forEach((s, si) => {
        if (s.posHold) {
            diag.warn(
                `positional hold inside a composite is not on the wire — dropped`,
                ['subs', si],
            )
            delete s.posHold
        }
    })
    if (subs.length > 0) builder.subsTable(subs)
    // §28 positional hold-trigger lists, one entry per annotated BEHAVIOR record.
    const posholds: PosholdRecord[] = behaviors.flatMap((b, i) =>
        b.posHold?.length ? [{ behaviorIndex: i, positions: b.posHold }] : [],
    )
    if (posholds.length > 0) builder.posholdTable(posholds)
    // macroCtx.records includes any per-argument clones of parameterized
    // templates appended while bindings lowered above (§44.3).
    if (macroCtx.records.length > 0) builder.macroTable(macroCtx.records)
    checkPools(combos, sliders, limits, diag)
    if (combos.length > 0) builder.comboTable(combos)
    if (encoders.length > 0) builder.encoderTable(encoders)
    // TBL_SLIDER (slider part design §4b): layers[].sliderBindings, by the key
    // position of an `element: "slider"` key. STEPS name BEHAVIOR indices, so
    // they were lowered (lowerSliders) before the BEHAVIOR table was written.
    if (sliders.length > 0) builder.sliderTable(sliders)
    // TBL_DISPLAY (display part design §3): what each display shows.
    const display = config.node?.display
        ? displayRecord(config.node.display, diag)
        : undefined
    if (display) builder.displayTable(display)
    // TBL_MOUSE (§4b): pointer settings from the v2 node.mouse block. Emitted
    // when the node declares any pointer intent; version 2 only when it uses an
    // inverts / swap / scroll divisor / button-map field (compilers/remappr/
    // mouse.ts). Old firmware skips the unknown table.
    const mouseRec = config.node?.mouse ? mouseRecord(config.node.mouse) : undefined
    if (mouseRec) builder.mouseTable(mouseRec)
    // TBL_SENSOR (sensor-settings plan §4b): the product's sensor defaults from
    // node.sensor.defaults, for the part node.sensor.part names (default 0),
    // so firmware not built from this JSON runs them too.
    const sensor = sensorEntries(
        config.node?.sensor?.defaults,
        config.node?.sensor?.part ?? 0,
    )
    for (const skip of sensor.skipped) {
        diag.warn(`sensor default "${skip.key}" left out: ${skip.reason}`, [
            'node',
            'sensor',
            'defaults',
            skip.key,
        ])
    }
    if (sensor.entries.length > 0) builder.sensorTable(sensor.entries)
    // TBL_RGB (§4c): per-key static colors from keyboard.lighting.perKey, emitted
    // as a flat (non-per-layer) RGB888 map over every physical position; unset
    // positions stay black (0,0,0). The firmware LED sink renders it locally.
    const perKey = config.keyboard.lighting?.perKey
    if (perKey && Object.keys(perKey).length > 0) {
        const colors = new Uint8Array(numPositions * 3)
        for (const [posStr, hex] of Object.entries(perKey)) {
            const pos = Number(posStr)
            if (!Number.isInteger(pos) || pos < 0 || pos >= numPositions) {
                diag.warn(`per-key RGB position ${posStr} is out of range`, [
                    'keyboard',
                    'lighting',
                    'perKey',
                ])
                continue
            }
            const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
            if (!m) {
                diag.warn(`per-key RGB color '${hex}' is not #rrggbb`, [
                    'keyboard',
                    'lighting',
                    'perKey',
                ])
                continue
            }
            const n = parseInt(m[1], 16)
            colors[pos * 3] = (n >> 16) & 0xff
            colors[pos * 3 + 1] = (n >> 8) & 0xff
            colors[pos * 3 + 2] = n & 0xff
        }
        builder.rgbTable({
            mode: 1, // REMAPPR_RGB_MODE_PER_KEY
            perLayer: false,
            numLayers: 1,
            numPositions,
            colors,
        })
    }
    // TBL_PERSONALITY (§4c): the declared node identity. Only keyboard/mouse take
    // a keymap blob; a joystick or a dongle is configured by its device document
    // (config/device.ts), so they warn instead of emitting a lossy identity.
    // pattern-check: skip — data-lowering emit of node identity/role/fwd + cluster
    // map, additive to the existing table emits; no new abstraction.
    // Emit TBL_PERSONALITY when the node declares ANY of a firmware personality
    // (byte 0), a node-bus role (byte 1, §N4b), or mode-A forwarding (byte 2,
    // §N4c) — a role-only follower still needs the table, so a null personality
    // rides byte 0 = 0 (unknown). Only keyboard/mouse have a firmware identity.
    const nodeCfg = config.node
    const personality = nodeCfg?.personality
    const personalityCode = personality
        ? ({ keyboard: 1, mouse: 2 } as Record<string, number>)[personality]
        : undefined
    if (personality && personalityCode === undefined) {
        diag.warn(
            `node personality '${personality}' is configured by a device document, not a keymap — not emitted`,
            ['node', 'personality'],
        )
    }
    const role = nodeCfg?.role
    const roleFlags = role
        ? CFG_ROLE_VALID | (role === 'coordinator' ? CFG_ROLE_COORD : 0)
        : 0
    const fwdMode =
        nodeCfg?.forwardMode === 'physical' ? FWD_MODE_PHYSICAL : FWD_MODE_RESOLVED
    const clusterMode = nodeCfg?.clusterMode === 'alone' ? CLUSTER_MODE_ALONE : CLUSTER_MODE_AUTO
    const clusterPower = {
        auto: CLUSTER_POWER_AUTO,
        follow: CLUSTER_POWER_FOLLOW,
        own: CLUSTER_POWER_OWN,
    }[nodeCfg?.clusterPower ?? 'auto']
    // Skip the table when nothing but defaults would ride it, so a plain config
    // (no personality/role, resolved forwarding, automatic cluster mode) stays
    // byte-stable.
    if (
        personalityCode !== undefined ||
        roleFlags !== 0 ||
        fwdMode !== FWD_MODE_RESOLVED ||
        clusterMode !== CLUSTER_MODE_AUTO ||
        clusterPower !== CLUSTER_POWER_AUTO
    ) {
        builder.personalityTable(
            personalityCode ?? 0,
            roleFlags,
            fwdMode,
            clusterMode,
            clusterPower,
        )
    }
    // TBL_CLUSTER (§N4c mode-A): the coordinator's UID→address map. Each uid is a
    // hex string; a uid over the 16-byte wire field is truncated with a warning.
    const clusterNodes = nodeCfg?.cluster ?? []
    const sides = clusterSideRecords(clusterSidesFor(config, diag), diag)
    if (clusterNodes.length > 0 || sides.length > 0) {
        const records: ClusterNodeRecord[] = clusterNodes.map((c, i) => {
            const uid = hexToBytes(c.uid)
            if (uid.length > CLUSTER_UID_MAX)
                diag.warn(
                    `cluster node ${i} uid is ${uid.length} bytes — truncated to ${CLUSTER_UID_MAX}`,
                    ['node', 'cluster', i],
                )
            return {
                uid: uid.subarray(0, CLUSTER_UID_MAX),
                positionBase: c.positionBase,
                rows: c.rows,
                cols: c.cols,
                encoderBase: c.encoderBase ?? 0,
                pointerBase: c.pointerBase ?? 0,
            }
        })
        builder.clusterTable(records, sides)
    }
    // TBL_LINK_PROFILE (§8 N6): the node-bus link/latency profile — a base
    // profile + per-knob overrides (USART baud, §6 election cadence, power tier).
    // Skip the table for the trivial balanced / no-override case so a plain config
    // resolves bit-identically to a pre-N6 blob (the default-equivalence invariant).
    const linkProfile = nodeCfg?.linkProfile
    if (linkProfile) {
        const overrides: LinkProfileOverrideRecord[] = (
            linkProfile.overrides ?? []
        ).map((o) => ({ knob: o.knob, value: o.value >>> 0 }))
        if (overrides.length > LINK_PROFILE_OVR_MAX)
            diag.error(
                `link profile has ${overrides.length} overrides; the firmware ` +
                    `takes ${LINK_PROFILE_OVR_MAX}`,
                ['node', 'linkProfile', 'overrides'],
            )
        const profileId = LinkProfileId[linkProfile.profile]
        if (profileId !== LinkProfileId.balanced || overrides.length > 0) {
            builder.linkProfileTable(profileId, overrides)
        }
    }
    // TBL_RADIO (device-config plan, step 2): the node's 2.4 GHz link settings.
    // A section that sets nothing emits no table, which already means defaults.
    const radio = nodeCfg?.radio ? radioRecord(nodeCfg.radio) : undefined
    if (radio) builder.radioTable(radio)
    // TBL_POWER (sleep-wake design): idle / sleep / off timeouts on battery.
    const power = nodeCfg?.power ? powerRecord(nodeCfg.power) : undefined
    if (power) builder.powerTable(power)
    if (conditionals.length > 0) builder.conditionalTable(conditionals)
    if (keyOverrides.length > 0) builder.keyOverrideTable(keyOverrides)
    if (leaders.length > 0) builder.leaderTable(leaders)
    // §F semantic action bindings (TBL_ACTION_BINDING id 17): a flat position →
    // action map, additive to the layer bindings. Drop out-of-range positions —
    // the firmware rejects them with ERR_REFERENCE.
    const actionBindings: ActionBindingRecord[] = (config.actionBindings ?? [])
        .filter((b) => {
            if (b.position < numPositions) return true
            diag.warn(
                `action binding position ${b.position} >= ${numPositions} positions — dropped`,
                ['actionBindings'],
            )
            return false
        })
        .map((b, i) => {
            if (b.action.kind === 'keyboard')
                warnDeadUsage(b.action.usage, diag, ['actionBindings', i], 'the action')
            return { position: b.position, ...lowerSemanticAction(b.action) }
        })
    if (actionBindings.length > 0)
        builder.actionBindingTable(numPositions, actionBindings)
    // AUTOCORRECT (§5.2-E, TBL_AUTOCORRECT): the serialized dictionary trie. The
    // section is emitted whenever it is PRESENT, empty entry list included —
    // that empty table is the only way to tell a device to drop the dictionary
    // it already holds. The encoder throws on anything the device would reject;
    // report it and ship the rest of the blob rather than failing the compile,
    // since a bad dictionary costs corrections, not a working keyboard.
    if (config.autocorrect !== undefined) {
        try {
            builder.autocorrectTable(
                encodeAutocorrectDictionary(
                    config.autocorrect.entries,
                    limits.autocorrectMaxTypo ?? AUTOCORRECT_MAX_TYPO,
                ),
            )
        } catch (e) {
            diag.error(
                `autocorrect dictionary not encodable: ${e instanceof Error ? e.message : String(e)}`,
                ['autocorrect'],
            )
        }
    }
    // NAMES (§24): real labels for the macros + composites this blob emits, so a
    // device round-trip (decode → edit → re-commit) keeps the names the app shows.
    // Macros are keyed by their table index; composites by sub_index (collected in
    // comp.names as each was lowered). Emitted last; absent when there are none.
    const names: NameRecord[] = [
        ...[...macroCtx.index].map(
            ([name, ref]): NameRecord => ({ kind: NameKind.Macro, ref, name }),
        ),
        ...macroCtx.instanceNames,
        ...comp.names,
    ]
    if (names.length > 0) builder.namesTable(names)

    return builder.finalize(
        config.schemaVersion,
        BLOB_READER_VERSION,
        configVersion,
    )
}

// Export `config_version`: a monotonic u32 the firmware uses to reject stale
// commits. The exported artifact has no live device to compare against, so it
// defaults to 1 (a clean integer in `meta.version` overrides). The live-device
// commit path supplies `active + 1` via buildRemapprBlob instead.
function exportConfigVersion(config: ConfigKeymap): number {
    const v = config.meta.version
    if (v === undefined) return 1
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * Pure ConfigKeymap → RMBC blob entry point for callers outside the compile
 * pipeline (the live-device commit path). Returns the blob bytes plus the
 * diagnostics raised while lowering. `configVersion` must be `active + 1` so the
 * firmware accepts the commit (§21 ERR_VERSION rejects ≤ active).
 */
export function buildRemapprBlob(
    config: ConfigKeymap,
    opts: {
        configVersion: number
        /** The blob read off the device. Its tables the config does not model
         *  (and the compile does not write) are carried over byte for byte, so
         *  a save does not drop them; one that cannot be carried is an error. */
        carryFrom?: Uint8Array
        /** What the target firmware build holds (defaults: the firmware's). */
        limits?: RemapprCompileLimits
    },
): { blob: Uint8Array; diagnostics: readonly Diagnostic[] } {
    const diag = new DiagnosticBag()
    const compiled = encodeBlob(config, diag, opts.configVersion, opts.limits)
    const blob = opts.carryFrom
        ? carryUnmodeledTables(compiled, opts.carryFrom, diag)
        : compiled
    return { blob, diagnostics: diag.all }
}

function emitBlob(config: ConfigKeymap, diag: DiagnosticBag): ExportedFile[] {
    const bytes = encodeBlob(config, diag, exportConfigVersion(config))
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

// pattern-check: skip one lowering helper beside the TBL_CLUSTER emit
/** The §5.3 side map as TBL_CLUSTER v2 side entries. The firmware sums the
 *  spans in order, so the sides must ascend with no repeat. */
function clusterSideRecords(
    sides: readonly ConfigClusterSide[] | undefined,
    diag: DiagnosticBag,
): ClusterSideRecord[] {
    const out: ClusterSideRecord[] = []
    for (const [i, s] of (sides ?? []).entries()) {
        if (i > 0 && s.side <= out[i - 1].side) {
            diag.error(`cluster side ${s.side} must come after side ${out[i - 1].side}`, [
                'node',
                'clusterSides',
                i,
            ])
            return []
        }
        out.push({
            side: s.side,
            rows: s.rows,
            cols: s.cols,
            encoders: s.encoders ?? 0,
            sliders: s.sliders ?? 0,
        })
    }
    return out
}
