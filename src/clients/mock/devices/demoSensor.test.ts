// pattern-check: skip — unit tests for the demo sensor.
import { describe, expect, it } from 'vitest'
import { DEMO_SENSOR } from './catalog'
import { DemoSensor } from './demoSensor'
import { MockDeviceService } from './MockDeviceService'
import { HALO_M2 } from './haloM2'
import { VECTOR_PAD } from './vectorPad'

function make() {
    let t = 0
    const sensor = new DemoSensor(DEMO_SENSOR, () => t, () => 0.5)
    return {
        sensor,
        at: (ms: number) => {
            t = ms
        },
    }
}

describe('DemoSensor', () => {
    it('describes the demo catalog sensor with its defaults in force', async () => {
        const [s] = await make().sensor.getSensors()
        expect(s).toMatchObject({ index: 0, cls: 'pointer' })
        expect(s!.settings.map((x) => x.name)).toEqual(
            DEMO_SENSOR.settings.map((x) => x.name),
        )
        expect(s!.settings[0]).toMatchObject({ value: 10, personality: false })
    })

    it('snaps an INT and refuses a gated option before its procedure', async () => {
        const { sensor } = make()
        expect(await sensor.setSetting(0, 'angleTune', 99)).toBe(30)
        await expect(sensor.setSetting(0, 'liftCutoff', 0)).rejects.toThrow(
            'lift-off calibration',
        )
    })

    it('runs a two-phase procedure: Next ends phase 1, phase 2 counts', async () => {
        const { sensor, at } = make()
        expect(
            await sensor.runProcedure(0, 'liftCalibration', 'begin'),
        ).toMatchObject({ state: 'running', phase: 1, total: 0 })
        await expect(sensor.getMetrics()).rejects.toThrow('calibrating')
        at(1000)
        await sensor.runProcedure(0, 'liftCalibration', 'next')
        at(2500)
        expect(
            await sensor.getProcedureStatus(0, 'liftCalibration'),
        ).toMatchObject({ state: 'running', phase: 2, progress: 1500, total: 3000 })
        at(4000)
        expect(
            await sensor.getProcedureStatus(0, 'liftCalibration'),
        ).toMatchObject({ state: 'done', ok: true })
        expect(await sensor.setSetting(0, 'liftCutoff', 0)).toBe(0)
        expect((await sensor.getMetrics())[0]).toMatchObject({
            name: 'surfaceQuality',
            max: 182,
        })
    })

    it('forgets a result on reset and drops the option that needed it', async () => {
        const { sensor, at } = make()
        await sensor.runProcedure(0, 'liftCalibration', 'begin')
        await sensor.runProcedure(0, 'liftCalibration', 'next')
        at(5000)
        await sensor.getProcedureStatus(0, 'liftCalibration')
        await sensor.setSetting(0, 'liftCutoff', 0)
        await sensor.runProcedure(0, 'liftCalibration', 'reset')
        const [s] = await sensor.getSensors()
        expect(s!.settings[0]!.value).toBe(10)
        await expect(sensor.setSetting(0, 'liftCutoff', 0)).rejects.toThrow()
    })

    it('refuses a step out of turn', async () => {
        const { sensor } = make()
        await expect(
            sensor.runProcedure(0, 'liftCalibration', 'next'),
        ).rejects.toThrow('Nothing is running')
        await sensor.runProcedure(0, 'liftCalibration', 'begin')
        await expect(
            sensor.runProcedure(0, 'liftCalibration', 'begin'),
        ).rejects.toThrow('already running')
        expect(
            await sensor.runProcedure(0, 'liftCalibration', 'cancel'),
        ).toMatchObject({ state: 'idle' })
    })

    it('is on the demo mouse only', () => {
        expect(new MockDeviceService(HALO_M2).sensor).toBeDefined()
        expect(new MockDeviceService(VECTOR_PAD).sensor).toBeUndefined()
    })
})
