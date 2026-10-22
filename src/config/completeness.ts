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

/** Per-firmware readiness verdicts for the config. */
export function checkCompleteness(config: ConfigKeymap): FirmwareReadiness[] {
    const ctrl = resolveController(config)
    const meta = config.meta
    const usbOk = !!meta.vendorId && !!meta.productId
    const wired = hasWiring(config)
    const qmkMcu =
        !!ctrl.developmentBoard || (!!ctrl.processor && !!ctrl.bootloader)

    return effectiveFirmware(config).map((fw) => {
        const issues: ReadinessIssue[] = []
        const err = (message: string): void => {
            issues.push({ level: 'error', message })
        }
        const warn = (message: string): void => {
            issues.push({ level: 'warn', message })
        }

        if (fw === 'zmk') {
            if (!ctrl.board) err('Set a controller board (e.g. nice_nano_v2).')
            if (!wired)
                warn(
                    'No kscan / pin mapping — set row/col pins or board hardware.',
                )
            // Peripheral feature on, but its hardware pin is unset → can't emit a
            // complete overlay node (only the chosen/conf flag).
            const flags = resolveZmkConfFlags(config)
            const hw = config.keyboard.hardware
            if (flags.backlight && !hw?.backlightPwm)
                warn('Backlight on but no PWM pin set (Hardware pins).')
            if (flags.underglow && !hw?.ws2812)
                warn('Underglow on but no WS2812 data pin set (Hardware pins).')
            if (flags.extPower && !hw?.extPowerCtrl)
                warn('Ext-power on but no control GPIO set (Hardware pins).')
        } else {
            // qmk / via / vial / keychron all build through the QMK family.
            if (!qmkMcu)
                err(
                    'Set a QMK processor + bootloader (or a development board).',
                )
            if (!usbOk) err('Set a USB vendor + product id.')
            if (!wired) warn('No matrix pins — set row/col (or per-key) pins.')
        }

        if (fw === 'vial') {
            const v = config.keyboard.vial
            if (v?.uid?.length !== 8) warn('Generate an 8-byte Vial UID.')
            if (!v?.insecure && !v?.unlockKeys?.length)
                warn('Pick a Vial unlock combo (or mark it insecure).')
        }

        return {
            firmware: fw,
            label: LABELS[fw] ?? fw,
            ready: !issues.some((i) => i.level === 'error'),
            issues,
        }
    })
}
