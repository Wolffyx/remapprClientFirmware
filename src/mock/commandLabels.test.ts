// Pattern check: no GoF pattern (-) — rejected — unit tests for the mock
// command-behavior param legends (demo coverage of Wolffyx/remappr#147).
import { describe, expect, it } from 'vitest'
import {
    buildMockActionTypes,
    buildMockKeyAction,
    MOCK_KIND_BLUETOOTH,
    MOCK_KIND_MOUSE_BUTTON,
    MOCK_KIND_MOUSE_MOVE,
    MOCK_KIND_RGB,
} from './actions'

const paramText = (kind: string, params: number[]): string | undefined =>
    buildMockKeyAction(kind, params, []).label.paramText

describe('mock command behaviors — param legends', () => {
    it('&bt BT_SEL 0 → "BT 0", BT_CLR → "Clr" (no profile)', () => {
        expect(paramText(MOCK_KIND_BLUETOOTH, [3, 0])).toBe('BT 0')
        expect(paramText(MOCK_KIND_BLUETOOTH, [5, 2])).toBe('Disc 2')
        expect(paramText(MOCK_KIND_BLUETOOTH, [0])).toBe('Clr')
    })

    it('&rgb_ug RGB_HUI → "Hue+"', () => {
        expect(paramText(MOCK_KIND_RGB, [3])).toBe('Hue+')
    })

    it('&mkp MB1 → "MB1"', () => {
        expect(paramText(MOCK_KIND_MOUSE_BUTTON, [0x01])).toBe('MB1')
    })

    it('&mmv MOVE_UP → "↑"', () => {
        expect(paramText(MOCK_KIND_MOUSE_MOVE, [0x00010000])).toBe('↑')
    })
})

describe('mock action-type catalog exposes the command behaviors', () => {
    const types = buildMockActionTypes(8)
    const ids = types.map((t) => t.id)

    it('lists &bt / &rgb_ug / &mkp / &mmv so the demo picker can place them', () => {
        expect(ids).toEqual(
            expect.arrayContaining([
                MOCK_KIND_BLUETOOTH,
                MOCK_KIND_RGB,
                MOCK_KIND_MOUSE_BUTTON,
                MOCK_KIND_MOUSE_MOVE,
            ]),
        )
    })

    it('&bt gates its profile slot on BT_SEL / BT_DISC', () => {
        const bt = types.find((t) => t.id === MOCK_KIND_BLUETOOTH)
        expect(bt?.slots[0].kind).toBe('enum')
        expect(bt?.slots[1].kind).toBe('number')
        expect(bt?.slots[1].enabledFor).toEqual([3, 5])
    })
})
