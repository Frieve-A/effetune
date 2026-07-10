export const TELEMETRY_HEADER_BYTES = 16;

export const TelemetryFrameType = Object.freeze({
    TAP_LEVEL: 1,
    TAP_GAIN_REDUCTION: 2,
    TAP_SCOPE_SNAPSHOT: 3,
    TAP_SPECTRUM: 4,
    TAP_SPECTROGRAM_COL: 5,
    TAP_STEREO_FIELD: 6,
    TAP_LOUDNESS_LEVELS: 7,
    TAP_TRANSIENT_GAIN: 8,
    TAP_CHANNEL_COUNT: 9,
    TAP_MULTI_CHANNEL_LEVELS: 10,
    TAP_DSD64_IMD: 11,
    TAP_POWER_AMP_SAG: 12,
    TAP_MULTIBAND_DYNAMICS: 13,
    TAP_FIVE_BAND_DYNAMIC_EQ: 14
});

function defaultWarning(message) {
    if (globalThis.console?.warn) {
        globalThis.console.warn(message);
    }
}

function packetView(packet) {
    if (packet instanceof ArrayBuffer) {
        return { buffer: packet, byteOffset: 0, byteLength: packet.byteLength };
    }
    if (ArrayBuffer.isView(packet)) {
        return {
            buffer: packet.buffer,
            byteOffset: packet.byteOffset,
            byteLength: packet.byteLength
        };
    }
    return null;
}

function failure(error, frames = 0) {
    return { ok: false, error, frames, bytesRead: 0 };
}

function validUnsigned(value, maximum) {
    return Number.isInteger(value) && value >= 0 && value <= maximum;
}

export function parseTelemetryPacket(packet, bytes, onFrame = null) {
    const source = packetView(packet);
    if (!source) return failure('packet must be an ArrayBuffer or typed-array view');
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > source.byteLength) {
        return failure('packet byte count is out of range');
    }
    if (bytes === 0) return { ok: true, frames: 0, bytesRead: 0 };

    const view = new DataView(source.buffer, source.byteOffset, bytes);
    const descriptors = [];
    let offset = 0;
    while (offset < bytes) {
        if (bytes - offset < TELEMETRY_HEADER_BYTES) {
            return failure('truncated telemetry frame header');
        }

        const payloadBytes = view.getUint16(offset + 12, true);
        const unpaddedBytes = TELEMETRY_HEADER_BYTES + payloadBytes;
        const frameBytes = (unpaddedBytes + 3) & ~3;
        if (frameBytes < TELEMETRY_HEADER_BYTES || frameBytes > bytes - offset) {
            return failure('truncated telemetry frame payload');
        }

        descriptors.push({
            offset,
            frameBytes,
            payloadBytes,
            frameType: view.getUint16(offset, true),
            formatVersion: view.getUint16(offset + 2, true),
            tapId: view.getUint32(offset + 4, true),
            sequence: view.getUint32(offset + 8, true),
            flags: view.getUint16(offset + 14, true)
        });
        offset += frameBytes;
    }

    if (offset !== bytes) return failure('telemetry packet has trailing bytes');
    if (typeof onFrame === 'function') {
        for (const descriptor of descriptors) {
            const payloadOffset = descriptor.offset + TELEMETRY_HEADER_BYTES;
            onFrame(Object.freeze({
                frameType: descriptor.frameType,
                formatVersion: descriptor.formatVersion,
                tapId: descriptor.tapId,
                sequence: descriptor.sequence,
                payloadBytes: descriptor.payloadBytes,
                flags: descriptor.flags,
                byteOffset: source.byteOffset + descriptor.offset,
                byteLength: descriptor.frameBytes,
                payload: new DataView(
                    source.buffer,
                    source.byteOffset + payloadOffset,
                    descriptor.payloadBytes
                )
            }));
        }
    }
    return { ok: true, frames: descriptors.length, bytesRead: bytes };
}

export class TelemetryHub {
    constructor({ port = null, warning = defaultWarning } = {}) {
        this.port = port;
        this.warning = warning;
        this.subscribers = new Map();
        this.stats = {
            packets: 0,
            frames: 0,
            malformedPackets: 0,
            framesWithDropFlag: 0,
            coreDroppedFrames: 0,
            subscriberErrors: 0,
            returnErrors: 0
        };
    }

    setPort(port) {
        this.port = port;
    }

    _key(tapId, frameType) {
        return `${tapId}:${frameType}`;
    }

    subscribe(tapId, frameType, callback) {
        if (!validUnsigned(tapId, 0xffffffff)) throw new TypeError('tapId must be a uint32');
        if (!validUnsigned(frameType, 0xffff)) throw new TypeError('frameType must be a uint16');
        if (typeof callback !== 'function') throw new TypeError('Telemetry callback must be a function');

        const key = this._key(tapId, frameType);
        let callbacks = this.subscribers.get(key);
        if (!callbacks) {
            callbacks = new Set();
            this.subscribers.set(key, callbacks);
        }
        callbacks.add(callback);
        return () => this.unsubscribe(tapId, frameType, callback);
    }

    unsubscribe(tapId, frameType, callback) {
        const key = this._key(tapId, frameType);
        const callbacks = this.subscribers.get(key);
        if (!callbacks) return false;
        const removed = callbacks.delete(callback);
        if (callbacks.size === 0) this.subscribers.delete(key);
        return removed;
    }

    clearSubscriptions() {
        this.subscribers.clear();
    }

    _dispatch(frame) {
        this.stats.frames += 1;
        if ((frame.flags & 1) !== 0) this.stats.framesWithDropFlag += 1;
        const callbacks = this.subscribers.get(this._key(frame.tapId, frame.frameType));
        if (!callbacks) return;
        for (const callback of [...callbacks]) {
            try {
                callback(frame);
            } catch (error) {
                this.stats.subscriberErrors += 1;
                this.warning(`[dsp-wasm] telemetry subscriber failed: ${error?.message || String(error)}`);
            }
        }
    }

    _returnPacket(packet) {
        if (!(packet instanceof ArrayBuffer) || !this.port || typeof this.port.postMessage !== 'function') {
            return;
        }
        try {
            this.port.postMessage({ type: 'dspTelemetryReturn', packet }, [packet]);
        } catch (error) {
            this.stats.returnErrors += 1;
            this.warning(`[dsp-wasm] telemetry packet return failed: ${error?.message || String(error)}`);
        }
    }

    handleMessage(message) {
        if (!message || message.type !== 'dspTelemetry') return false;
        const packet = message.packet;
        this.stats.packets += 1;
        if (validUnsigned(message.droppedFrames, 0xffffffff)) {
            this.stats.coreDroppedFrames += message.droppedFrames;
        }
        try {
            const result = parseTelemetryPacket(packet, message.bytes, frame => this._dispatch(frame));
            if (!result.ok) {
                this.stats.malformedPackets += 1;
                this.warning(`[dsp-wasm] ignored malformed telemetry packet: ${result.error}`);
            }
        } catch (error) {
            this.stats.malformedPackets += 1;
            this.warning(`[dsp-wasm] ignored malformed telemetry packet: ${error?.message || String(error)}`);
        } finally {
            this._returnPacket(packet);
        }
        return true;
    }

    getStats() {
        return { ...this.stats };
    }

    resetStats() {
        for (const key of Object.keys(this.stats)) this.stats[key] = 0;
    }
}
