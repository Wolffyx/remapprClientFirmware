export class FirmwareError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message)
        this.name = 'FirmwareError'
    }
}

export class LockedError extends FirmwareError {
    constructor(message = 'Device is locked') {
        super('LOCKED', message)
        this.name = 'LockedError'
    }
}

export class UnsupportedError extends FirmwareError {
    constructor(operation: string) {
        super('UNSUPPORTED', `Operation not supported: ${operation}`)
        this.name = 'UnsupportedError'
    }
}

export class TransportError extends FirmwareError {
    constructor(message: string) {
        super('TRANSPORT', message)
        this.name = 'TransportError'
    }
}

/** A §9.2 FRAG chain arrived with a hole the per-fragment sequence (§4.2)
 * exposed — a fragment was dropped in transit. A TransportError (so existing
 * catch sites still handle it) but distinctly retryable for idempotent reads. */
export class FragmentLostError extends TransportError {
    constructor(message: string) {
        super(message)
        this.name = 'FragmentLostError'
    }
}

export class ProtocolError extends FirmwareError {
    constructor(message: string) {
        super('PROTOCOL', message)
        this.name = 'ProtocolError'
    }
}
