// pattern-check: skip — barrel + side-effect registration of mock adapter
import { registerAdapter } from '@firmware/registry'
import { mockAdapter } from './adapter'

registerAdapter(mockAdapter)

export {
    mockAdapter,
    connectMock,
    connectMockWithConfig,
    createMockTransport,
    MOCK_TRANSPORT_LABEL,
} from './adapter'
export { MockKeyboardService } from './service'
export {
    lowerConfigToMock,
    raiseMockToConfig,
    type LowerResult,
} from './configBridge'
export {
    MOCK_KIND_KEYPRESS,
    MOCK_KIND_TRANSPARENT,
    MOCK_KIND_LAYER_MOMENTARY,
    MOCK_KIND_LAYER_TOGGLE,
} from './actions'
