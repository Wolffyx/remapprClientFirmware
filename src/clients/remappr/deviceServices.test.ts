// pattern-check: skip vitest cases over the service wiring
//
// The device editor reads and writes a mouse's or a joystick's settings with
// the device's own part list: a joystick's shaping sits on its AXES parts
// (TBL_JOYSTICK v2 + TBL_PART), placed by that list. Without it the service
// writes the legacy v1 table and reads shaping as one AXES part.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceConfigTarget } from './deviceConfig'
import type { DeviceSite } from './deviceServices'
import { Namespace } from './protocol'

const targets: DeviceConfigTarget[] = []
const PARTS = [{ index: 0 }, { index: 1 }]

vi.mock('./deviceConfig', () => ({
    buildDeviceConfigApi: (_rpc: unknown, target: DeviceConfigTarget) => {
        targets.push(target)
        return { personality: target.personality, writable: target.writable }
    },
}))
vi.mock('./inputLayout', () => ({ readInputLayout: async () => undefined }))
vi.mock('./sensor', async (orig) => ({
    ...(await orig<typeof import('./sensor')>()),
    buildSensorApi: () => ({ getSensors: async () => PARTS }),
}))

const { buildJoystickService, buildMouseService } = await import('./deviceServices')

const site = (namespaces: number[]): DeviceSite =>
    ({
        rpc: { onClosed: () => () => undefined },
        discovery: {
            protoMax: 2,
            deviceInfo: { name: 'Bench' },
            personality: { namespaces: namespaces.map((namespace) => ({ namespace })) },
            limits: { maxConfigBytes: 4096 },
        },
        deviceInfo: { name: 'Bench' },
        targetNode: 0,
    }) as unknown as DeviceSite

describe('device services hand the part list to the config API', () => {
    beforeEach(() => {
        targets.length = 0
    })

    it('a joystick that serves SENSOR reads its parts for the config', async () => {
        await buildJoystickService(site([Namespace.JOYSTICK, Namespace.SENSOR]))
        expect(targets).toHaveLength(1)
        expect(targets[0].personality).toBe('joystick')
        expect(await targets[0].sensors?.()).toBe(PARTS)
    })

    it('a mouse that serves SENSOR reads its parts for the config', async () => {
        await buildMouseService(site([Namespace.MOUSE, Namespace.SENSOR]))
        expect(await targets[0].sensors?.()).toBe(PARTS)
    })

    it('a joystick without SENSOR has no part list (legacy v1 table)', async () => {
        await buildJoystickService(site([Namespace.JOYSTICK]))
        expect(targets[0].sensors).toBeUndefined()
    })
})
