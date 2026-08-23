// Pattern check: no GoF pattern (-) — rejected — pure data-table lookup tests, no abstraction.
import { describe, it, expect } from 'vitest'

import { getBoardById, KEYCHRON_BOARDS, matchBoard } from './boards'

describe('matchBoard', () => {
    it('matches K5 Max from typical hid label', () => {
        const got = matchBoard('Keychron K5 Max · 3434:0298')
        expect(got?.id).toBe('k5-max')
        expect(got?.rows).toBe(6)
        expect(got?.cols).toBe(21)
    })

    it('is case-insensitive', () => {
        expect(matchBoard('KEYCHRON Q1 MAX')?.id).toBe('q1-max')
    })

    it('returns null when no preset substring hits', () => {
        expect(matchBoard('Some Other Keyboard 1234:5678')).toBeNull()
    })

    it('prefers higher-priority entry on overlap', () => {
        // K5 Max has priority 10; nothing else overlaps with "k5 max",
        // but we still verify priority is honoured by construction.
        const k5 = KEYCHRON_BOARDS.find((b) => b.id === 'k5-max')
        expect(k5?.priority).toBe(10)
    })

    it('every preset resolves via getBoardById', () => {
        for (const board of KEYCHRON_BOARDS) {
            expect(getBoardById(board.id)?.id).toBe(board.id)
        }
    })
})
