// pattern-check: skip pure per-firmware readiness validation, no abstraction
//
// Per-firmware "is this buildable yet?" check for the export surface. Each selected
// firmware (qmk/via/vial/zmk) gets a readiness verdict + a list of blocking errors
// and non-blocking warnings, so the export UI can show a checklist of what's still
// missing (controller, USB ids, matrix pins, Vial UID/unlock) before the user pushes
// the generated project to a build. Pure: inspects the config + resolveController.

import { resolveController } from './controller'
import { resolveZmkConfFlags } from './firmwareConf'
import type { ConfigKeymap } from './types'
import { boardScreen, screenFor } from './compilers/zephyrParts'

export interface ReadinessIssue {
    level: 'error' | 'warn'
    message: string
}

export interface FirmwareReadiness {
    /** Firmware key: 'zmk' | 'qmk' | 'via' | 'vial' | 'keychron'. */
    firmware: string
    label: string
    /** No error-level issues — the generated project should build as-is. */
    ready: boolean
    issues: ReadinessIssue[]
}

const LABELS: Record<string, string> = {
    zmk: 'ZMK',
    qmk: 'QMK',
    via: 'VIA',
    vial: 'Vial',
    keychron: 'Keychron',
    remappr: 'Remappr',
}

/** The firmwares the export should cover: the builder's multi-select, else the
 *  single pinned target, else ZMK. */
export function effectiveFirmware(config: ConfigKeymap): string[] {
    const list = config.keyboard.firmware ?? []
    if (list.length) return list
    if (config.meta.target) return [config.meta.target]
    return ['zmk']
}

/** True when the board carries some scan wiring: friendly row/col pins, per-key
 *  direct pins, or an explicit kscan node. */
function hasWiring(config: ConfigKeymap): boolean {
    const kb = config.keyboard
    return (
        !!(kb.pins?.rows.length && kb.pins?.cols.length) ||
        kb.keys.some((k) => k.pin) ||
        !!kb.hardware?.kscan
    )
}

type Report = (message: string) => void

interface Checks {
    config: ConfigKeymap
    err: Report
    warn: Report
}

const zephyrBoard = ({ config, err }: Checks): void => {
    if (!resolveController(config).board)
        err('Set a controller board (e.g. nice_nano_v2).')
}

function checkZmk(c: Checks): void {
    zephyrBoard(c)
    if (!hasWiring(c.config))
        c.warn('No kscan / pin mapping — set row/col pins or board hardware.')
    // Peripheral feature on, but its hardware pin is unset → can't emit a
    // complete overlay node (only the chosen/conf flag).
    const flags = resolveZmkConfFlags(c.config)
    const hw = c.config.keyboard.hardware
    if (flags.backlight && !hw?.backlightPwm)
        c.warn('Backlight on but no PWM pin set (Hardware pins).')
    if (flags.underglow && !hw?.ws2812)
        c.warn('Underglow on but no WS2812 data pin set (Hardware pins).')
    if (flags.extPower && !hw?.extPowerCtrl)
        c.warn('Ext-power on but no control GPIO set (Hardware pins).')
    if (hw?.battery?.pin && !(hw.battery.outputOhms && hw.battery.fullOhms))
        c.warn('Battery sense pin set but no divider resistor values (Pins).')
    screenCheck(c, 'zmk')
}

/** A screen this firmware can't write. */
function screenCheck(c: Checks, fw: 'zmk' | 'remappr'): void {
    const s = boardScreen(c.config)
    if (s && !screenFor(c.config, fw))
        c.warn(`Screen ${s.display.chip} is not written (no driver or node for it).`)
}

/** Remappr builds a Zephyr shield: a board and the scan pins; its peripherals
 *  come from their pins, so a picked feature without them is flagged. */
function checkRemappr(c: Checks): void {
    zephyrBoard(c)
    if (!hasWiring(c.config))
        c.warn('No matrix pins — set row/col (or per-key) pins.')
    const picked = new Set(c.config.keyboard.features ?? [])
    const board = c.config.board
    if (picked.has('lighting') && !c.config.keyboard.hardware?.ws2812)
        c.warn('Lighting picked but no LED data pin set.')
    if (picked.has('encoders') && !board?.encoders?.length)
        c.warn('Encoders picked but no encoder pins set.')
    if (picked.has('pointing') && !board?.sensor)
        c.warn('Pointing picked but no sensor pins set.')
    screenCheck(c, 'remappr')
}

/** qmk / via / vial / keychron all build through the QMK family. */
function checkQmkFamily(c: Checks): void {
    const ctrl = resolveController(c.config)
    const meta = c.config.meta
    if (!ctrl.developmentBoard && !(ctrl.processor && ctrl.bootloader))
        c.err('Set a QMK processor + bootloader (or a development board).')
    if (!meta.vendorId || !meta.productId)
        c.err('Set a USB vendor + product id.')
    if (!hasWiring(c.config))
        c.warn('No matrix pins — set row/col (or per-key) pins.')
}

function checkVial(c: Checks): void {
    checkQmkFamily(c)
    const v = c.config.keyboard.vial
    if (v?.uid?.length !== 8) c.warn('Generate an 8-byte Vial UID.')
    if (!v?.insecure && !v?.unlockKeys?.length)
        c.warn('Pick a Vial unlock combo (or mark it insecure).')
}

/** Each firmware's own checks; anything else builds through the QMK family. */
const CHECKS: Record<string, (c: Checks) => void> = {
    zmk: checkZmk,
    remappr: checkRemappr,
    vial: checkVial,
}

/** Per-firmware readiness verdicts for the config. */
export function checkCompleteness(config: ConfigKeymap): FirmwareReadiness[] {
    return effectiveFirmware(config).map((fw) => {
        const issues: ReadinessIssue[] = []
        ;(CHECKS[fw] ?? checkQmkFamily)({
            config,
            err: (message) => issues.push({ level: 'error', message }),
            warn: (message) => issues.push({ level: 'warn', message }),
        })
        return {
            firmware: fw,
            label: LABELS[fw] ?? fw,
            ready: !issues.some((i) => i.level === 'error'),
            issues,
        }
    })
}
