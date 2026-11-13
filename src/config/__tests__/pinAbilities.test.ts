// pattern-check: skip — unit tests for the pin ability table and role-aware suggestion.
import { describe, expect, it } from 'vitest'
import { boardPinLabels, reservedPins, suggestPinsByRole } from '../index'

describe('suggestPinsByRole', () => {
    it('gives analog needs the nice!nano’s real analog pins only', () => {
        const free = boardPinLabels('nice_nano_v2')!
        const picks = suggestPinsByRole(
            'nice_nano_v2',
            [1, 2, 3, 4].map((i) => ({ id: `x${i}`, role: 'adc' as const })),
            free,
        )
        expect(Object.values(picks).sort()).toEqual(['P19', 'P20', 'P21'])
        expect(picks.x4).toBeUndefined()
    })

    it('leaves the bus, the analog pins and the NFC pads for last', () => {
        const free = boardPinLabels('nice_nano_v2')!
        const needs = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, role: 'gpio' as const }))
        const picks = Object.values(
            suggestPinsByRole('nice_nano_v2', [...needs, { id: 'cs', role: 'gpio', bus: 'spi' }], free),
        )
        for (const p of ['P14', 'P15', 'P16', 'P19', 'P20', 'P21', 'P10'])
            expect(picks).not.toContain(p)
    })

    it('reserves the board’s default SPI only when something rides it', () => {
        expect(reservedPins('sparkfun_pro_micro_rp2040', [{ id: 'a', role: 'gpio' }])).toEqual({})
        expect(reservedPins('seeeduino_xiao_ble', [{ id: 'cs', role: 'gpio', bus: 'spi' }])).toEqual({
            D8: 'SPI SCK',
            D10: 'SPI MOSI',
            D9: 'SPI MISO',
        })
    })

    it('still suggests in board order on a board it has no facts for', () => {
        expect(suggestPinsByRole('mystery', [{ id: 'a', role: 'gpio' }], ['X1'])).toEqual({ a: 'X1' })
    })
})
