// pattern-check: skip — test wiring: drives the shared contract suite for the mock adapter.
import { runContractSuite } from '@firmware/__tests__/contract'
import { createMockTransport, mockAdapter } from './adapter'

runContractSuite('mock', {
    makeAdapter: () => mockAdapter,
    makeMatchingTransport: () => createMockTransport(),
    makeMismatchingTransport: () => ({
        label: 'serial://not-mock',
        abortController: new AbortController(),
        readable: new ReadableStream<Uint8Array>({
            start(c) {
                c.close()
            },
        }),
        writable: new WritableStream<Uint8Array>({
            write() {
                /* discard */
            },
        }),
    }),
    transportKind: 'serial',
    autoUnlock: true,
})
