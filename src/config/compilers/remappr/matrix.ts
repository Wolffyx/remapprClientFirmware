// Pattern check: no GoF pattern (-) — rejected — pure mapping functions between keymap defaults and MATRIX part TBL_PART entries, one data shape.
//
// A keyboard's matrix scan timing is its MATRIX parts' own settings (firmware
// docs/part-wire-v1.md §4): scan period, press and release debounce. A
// config keeps them as `defaults.matrix*`. With the device's part list at
// hand, each field a matrix part lists is written as a TBL_PART entry for
// every matrix part that lists it, and as 0 (= none) in TBL_LAYER's timing
// tail. Without the part list the tail carries them as before: firmware with
// matrix parts still reads the tail as their lowest config layer for one
// release, and older firmware only reads the tail. Reading back, a TBL_PART
// entry for a scan setting wins over the tail, as on the device.
import { sensorSettingId } from '../../../clients/remappr/sensorRegistry'
import type { SensorInfo } from '../../../devices/types'
import type { ConfigDefaults } from '../../types'
import type { SensorTableEntry } from './blobWriter'
import { type SensorSkip, sensorEntries } from './sensor'

/** A `defaults` matrix field ↔ the MATRIX part setting that holds it. */
export const MATRIX_SETTINGS = {
    matrixPollPeriodMs: 'scanPeriodMs',
    matrixPressDebounceMs: 'debouncePressMs',
    matrixReleaseDebounceMs: 'debounceReleaseMs',
} as const satisfies Partial<Record<keyof ConfigDefaults, string>>

export type MatrixField = keyof typeof MATRIX_SETTINGS

export const MATRIX_FIELDS = Object.keys(MATRIX_SETTINGS) as MatrixField[]

const FIELD_BY_SETTING = new Map<string, MatrixField>(
    MATRIX_FIELDS.map((f) => [MATRIX_SETTINGS[f], f]),
)

const MATRIX_SETTING_IDS: Readonly<Record<MatrixField, number>> =
    Object.fromEntries(
        MATRIX_FIELDS.map((f) => {
            const id = sensorSettingId(MATRIX_SETTINGS[f])
            if (id === undefined) {
                throw new Error(`no registry id for ${MATRIX_SETTINGS[f]}`)
            }
            return [f, id]
        }),
    ) as Record<MatrixField, number>

/** What the compiler does with a config's matrix timing on one device. */
export interface MatrixFold {
    /** TBL_PART entries, one per matrix part and set field it lists. */
    entries: SensorTableEntry[]
    /** The fields a matrix part holds: the tail carries 0 for them. */
    folded: ReadonlySet<MatrixField>
    /** A value the device would refuse, by `defaults` field. */
    skipped: SensorSkip[]
}

/** One matrix part's values for the fields it holds, by setting name; adds
 *  those fields to `folded`. */
function partValues(
    part: SensorInfo,
    defaults: ConfigDefaults | undefined,
    folded: Set<MatrixField>,
): Record<string, number> {
    const values: Record<string, number> = {}
    for (const s of part.settings) {
        const field = FIELD_BY_SETTING.get(s.name)
        // A setting the personality drives (firmware before the fold) is
        // not the config's to set in TBL_PART: the tail keeps it.
        if (!field || s.personality) continue
        folded.add(field)
        const v = defaults?.[field] ?? 0
        if (v > 0) values[s.name] = v
    }
    return values
}

/**
 * `defaults`' matrix timing -> TBL_PART entries for the device's matrix
 * `parts` (its described part list). 0 / absent = the board's own value: no
 * entry. A value a part would refuse (out of its range) is skipped.
 */
export function matrixPartEntries(
    defaults: ConfigDefaults | undefined,
    parts: readonly SensorInfo[],
): MatrixFold {
    const entries: SensorTableEntry[] = []
    const folded = new Set<MatrixField>()
    const skipped: SensorSkip[] = []
    for (const part of parts) {
        if (part.cls !== 'matrix') continue
        const r = sensorEntries(
            partValues(part, defaults, folded),
            part.index,
            parts,
        )
        entries.push(...r.entries)
        for (const s of r.skipped) {
            skipped.push({
                key: FIELD_BY_SETTING.get(s.key) ?? s.key,
                reason: s.reason,
            })
        }
    }
    return { entries, folded, skipped }
}

/**
 * TBL_PART entries -> the matrix timing they set, by `defaults` field: the
 * first channel-0 entry for each scan setting (the compiler writes the same
 * value to every matrix part). A field without an entry is left out.
 */
export function matrixDefaultsFromParts(
    entries: readonly SensorTableEntry[],
): Partial<Record<MatrixField, number>> {
    const out: Partial<Record<MatrixField, number>> = {}
    for (const f of MATRIX_FIELDS) {
        const e = entries.find(
            (x) => x.id === MATRIX_SETTING_IDS[f] && (x.ch ?? 0) === 0,
        )
        if (e && e.value > 0) out[f] = e.value
    }
    return out
}
