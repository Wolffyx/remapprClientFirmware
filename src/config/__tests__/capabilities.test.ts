import { describe, expect, it } from 'vitest'
import { resolveAllowedTargets } from '../index'

// resolveAllowedTargets returns the DOWNLOAD-BUNDLE families (what
// buildProjectBundle accepts), so the editor's Download modal offers a project
// .zip per target. `remappr` rides along here (it aliases the remappr-board
// shield bundle) — previously it was only offered in the builder.
describe('resolveAllowedTargets', () => {
    it('offers every download-bundle family in demo (no device)', () => {
        expect(resolveAllowedTargets(null)).toEqual([
            'zmk',
            'qmk',
            'keychron',
            'remappr',
        ])
        // undefined (no arg) behaves like the demo case too
        expect(resolveAllowedTargets()).toContain('remappr')
    })

    it('narrows to a connected remappr device', () => {
        expect(resolveAllowedTargets('remappr')).toEqual(['remappr'])
        // a more specific family string still resolves to remappr
        expect(resolveAllowedTargets('remappr-board')).toEqual(['remappr'])
    })

    it('narrows to a connected device family without bleeding remappr in', () => {
        expect(resolveAllowedTargets('zmk')).toEqual(['zmk'])
        expect(resolveAllowedTargets('qmk-vial')).toEqual(['qmk'])
        expect(resolveAllowedTargets('keychron')).toEqual(['keychron'])
    })
})
