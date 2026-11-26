// pattern-check: skip vitest cases for the screens facade
import { describe, expect, it } from 'vitest'
import type { SensorApi } from '../../service'
import type { SensorInfo } from '../../devices/types'
import { buildScreensApi, screenPanels } from './screens'

const part = (index: number, cls: string, io: SensorInfo['io']): SensorInfo =>
    ({ index, cls, model: 'SH1106', channels: 1, io, settings: [], procedures: [], metrics: [] }) as unknown as SensorInfo

const display = (a: number, b: number) =>
    [{ kind: 'display', output: true, firstChannel: 0, count: 1, a, b }] as const

describe('screens facade', () => {
    it('lists the display parts with their panel size', () => {
        const parts = [part(0, 'matrix', []), part(1, 'display', display(128, 64)), part(2, 'display', display(0, 0))]
        expect(screenPanels(parts).map((p) => [p.part, p.width, p.height])).toEqual([[1, 128, 64]])
    })

    it('reads the parts through the sensor facade, none without one', async () => {
        const sensor = { getSensors: async () => [part(3, 'display', display(128, 32))] } as unknown as SensorApi
        expect((await buildScreensApi(sensor).displays())[0].part).toBe(3)
        expect(await buildScreensApi(undefined).displays()).toEqual([])
    })

    it('names where each value comes from', () => {
        const api = buildScreensApi(undefined)
        expect(api.sources.find((s) => s.name === 'battery')?.from).toBe('device')
        expect(api.sources.find((s) => s.name === 'host.cpu')?.from).toBe('host')
        expect(api.problems([{ part: 0, pages: [{ widgets: [{ kind: 'value', x: 0, y: 0, w: 8, h: 8, source: 'nope' }] }] }])).toHaveLength(1)
    })
})
