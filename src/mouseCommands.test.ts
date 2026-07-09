import { describe, it, expect } from 'vitest'
import { MOUSE_COMMANDS } from './mouseCommands'

describe('MOUSE_COMMANDS', () => {
    it('has 13 commands: 5 buttons, 4 move, 4 scroll', () => {
        expect(MOUSE_COMMANDS).toHaveLength(13)
        const count = (t: string): number =>
            MOUSE_COMMANDS.filter((c) => c.canon.type === t).length
        expect(count('mouse_key')).toBe(5)
        expect(count('mouse_move')).toBe(4)
        expect(count('mouse_scroll')).toBe(4)
    })

    it('covers every button and both direction sets', () => {
        const buttons = MOUSE_COMMANDS.flatMap((c) =>
            c.canon.type === 'mouse_key' ? [c.canon.button] : [],
        )
        expect(new Set(buttons)).toEqual(
            new Set(['left', 'right', 'middle', 'mb4', 'mb5']),
        )
        for (const t of ['mouse_move', 'mouse_scroll'] as const) {
            const dirs = MOUSE_COMMANDS.flatMap((c) =>
                c.canon.type === t ? [c.canon.direction] : [],
            )
            expect(new Set(dirs)).toEqual(new Set(['up', 'down', 'left', 'right']))
        }
    })

    it('gives every command a label; only MB4/MB5 lack an icon', () => {
        for (const c of MOUSE_COMMANDS) expect(c.label).toBeTruthy()
        const noIcon = MOUSE_COMMANDS.filter((c) => !c.icon).map((c) => c.label)
        expect(noIcon).toEqual(['MB4', 'MB5'])
    })
})
