import { VISUAL_SYNC_QUEUE_LIMIT, dropVisualSyncOverflow } from './visual-sync.js';

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
    TAP_FIVE_BAND_DYNAMIC_EQ: 14,
    TAP_VINYL_SIMULATOR: 15,
    TAP_FM_RADIO_SIMULATOR: 16,
    TAP_AM_RADIO_SIMULATOR: 17,
    TAP_SW_RADIO_SIMULATOR: 18,
    TAP_TUBE_SIMULATOR: 19,
    TAP_PHASE_SELECT_MAP: 20,
    TAP_TV_AUDIO_SIMULATOR: 25,
    TAP_PITCH_METER: 26,
    TAP_ANALOG_METER: 27,
    TAP_RHYTHM_ANALYZER: 28,
    TAP_TONAL_BALANCE_EQ: 29
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
    constructor({ port = null, warning = defaultWarning, now = () => performance.now(),
        schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
        cancel = timer => globalThis.clearTimeout(timer), queueLimit = VISUAL_SYNC_QUEUE_LIMIT } = {}) {
        this.port = port;
        this.warning = warning;
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.queueLimit = queueLimit;
        this.visualSyncResolver = null;
        this.visualSyncEpoch = 0;
        this.visualSyncQueue = [];
        this.visualSyncTimer = null;
        this.subscribers = new Map();
        this.sources = new Map();
        this.stats = {
            packets: 0,
            frames: 0,
            malformedPackets: 0,
            framesWithDropFlag: 0,
            coreDroppedFrames: 0,
            subscriberErrors: 0,
            returnErrors: 0,
            visualSyncDropped: 0
        };
    }

    setPort(port) {
        this.clearVisualSyncQueue();
        this.port = port;
        this.sources.clear();
    }

    setSources(taps) {
        const sources = new Map();
        for (const [id, tap] of Object.entries(taps)) {
            const tapId = Number(id);
            const previous = this.sources.get(tapId);
            sources.set(tapId, previous && previous.instanceId === tap.instanceId
                ? previous : Object.freeze({ instanceId: tap.instanceId }));
        }
        this.sources = sources;
        const queued = this.visualSyncQueue.length;
        this.visualSyncQueue = this.visualSyncQueue.filter(entry =>
            !entry.frame.source || entry.frame.source === sources.get(entry.frame.tapId));
        if (queued !== this.visualSyncQueue.length) this._scheduleVisualSync();
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
        this.clearVisualSyncQueue();
    }

    clearVisualSyncQueue() {
        this.visualSyncEpoch++;
        this.onVisualSyncReset?.();
        this.visualSyncQueue.length = 0;
        if (this.visualSyncTimer !== null) this.cancel(this.visualSyncTimer);
        this.visualSyncTimer = null;
    }

    setVisualSyncResolver(resolver) {
        this.clearVisualSyncQueue();
        this.visualSyncResolver = resolver;
    }

    resolveDue(tapId, endFrame, ruleKey = tapId, frame, contextFrameOffset) {
        return this.visualSyncResolver?.(tapId, endFrame, ruleKey, frame, contextFrameOffset) ?? null;
    }

    _scheduleVisualSync() {
        if (this.visualSyncTimer !== null) this.cancel(this.visualSyncTimer);
        this.visualSyncTimer = null;
        if (!this.visualSyncQueue.length) return;
        this.visualSyncQueue.sort((a, b) => a.due - b.due);
        this.visualSyncTimer = this.schedule(() => {
            this.visualSyncTimer = null;
            this._dispatchDueVisualSync(this.now());
            this._scheduleVisualSync();
        }, Math.max(0, this.visualSyncQueue[0].due - this.now()));
    }

    _dispatchDueVisualSync(now) {
        while (this.visualSyncQueue.length && this.visualSyncQueue[0].due <= now) {
            const entry = this.visualSyncQueue.shift();
            this._dispatch(entry.frame, entry.sourcePort);
        }
    }

    _receive(frame, sourcePort, endFrame, contextFrameOffset) {
        const highQuality = frame.formatVersion === 2 &&
            (frame.frameType === TelemetryFrameType.TAP_SPECTRUM ||
                frame.frameType === TelemetryFrameType.TAP_SPECTROGRAM_COL);
        if (highQuality && sourcePort !== this.port) return;
        const due = this.resolveDue(frame.tapId, endFrame, frame.tapId, frame, contextFrameOffset);
        const now = this.now();
        if (!Number.isFinite(due) || due <= now) {
            if (this.visualSyncQueue[0]?.due <= now) {
                this._dispatchDueVisualSync(now);
                this._scheduleVisualSync();
            }
            this._dispatch(frame, sourcePort);
            return;
        }
        const payload = new DataView(frame.payload.buffer.slice(frame.payload.byteOffset,
            frame.payload.byteOffset + frame.payload.byteLength));
        if (dropVisualSyncOverflow(this.visualSyncQueue, entry => entry.frame.tapId === frame.tapId &&
            entry.frame.frameType === frame.frameType, this.queueLimit)) {
            this.stats.visualSyncDropped++;
        }
        this.visualSyncQueue.push({ due, sourcePort, frame: Object.freeze({ ...frame, payload }) });
        this._scheduleVisualSync();
    }

    _dispatch(frame, sourcePort) {
        if (frame.source && frame.source !== this.sources.get(frame.tapId)) return;
        const highQuality = frame.formatVersion === 2 &&
            (frame.frameType === TelemetryFrameType.TAP_SPECTRUM ||
                frame.frameType === TelemetryFrameType.TAP_SPECTROGRAM_COL);
        if (highQuality && sourcePort !== this.port) return;
        this.stats.frames += 1;
        if ((frame.flags & 1) !== 0) this.stats.framesWithDropFlag += 1;
        const callbacks = this.subscribers.get(this._key(frame.tapId, frame.frameType));
        if (!callbacks) return;
        for (const callback of [...callbacks]) {
            try {
                if (highQuality) callback(frame, sourcePort);
                else callback(frame);
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

    handleMessage(message, sourcePort = this.port) {
        if (!message || message.type !== 'dspTelemetry') return false;
        const packet = message.packet;
        this.stats.packets += 1;
        if (validUnsigned(message.droppedFrames, 0xffffffff)) {
            this.stats.coreDroppedFrames += message.droppedFrames;
        }
        try {
            const result = parseTelemetryPacket(packet, message.bytes, parsedFrame => {
                const source = this.sources.get(parsedFrame.tapId);
                const frame = source ? Object.freeze({ ...parsedFrame, source }) : parsedFrame;
                if (this.visualSyncResolver) this._receive(frame, sourcePort, message.endFrame, message.contextFrameOffset);
                else this._dispatch(frame, sourcePort);
            });
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
