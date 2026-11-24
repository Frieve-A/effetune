import { connectAudioEngine, NativeControlClient } from '../../../js/native/engine-connection.js';
import i18n from '../i18n.js';

const CHUNK_SAMPLES = 65536;
const POLL_INTERVAL_MS = 100;

export function getNativeMeasurementDriver(bridge = globalThis.window?.electronAPI?.audioEngine) {
    const driver = bridge?.startupDriver?.();
    return driver === 'wasapi' || driver === 'miniaudio' ? driver : null;
}

export function nativeMeasurementDevice(devices, id) {
    return id && id !== 'default' ? devices.find(device => device.id === id)
        : devices.find(device => device.isDefault) ?? devices[0];
}

export function nativeMeasurementInputIndices(channel, channels) {
    if (channel === 'both') return channels < 2 ? [0] : [0, 1];
    const index = channel === 'left' ? 0 : channel === 'right' ? 1 : Number(channel);
    if (channel != null && channel !== '' && Number.isInteger(index) && index >= 0 && index < channels) return [index];
    throw new Error(i18n.t('error:measurementInputChannelUnavailable'));
}

function deviceError() {
    return new Error(i18n.t('error:measurementDevicesUnavailable'));
}

export class NativeMeasurement {
    constructor(driver, bridge = window.electronAPI.audioEngine, connect = connectAudioEngine) {
        this.driver = driver;
        this.bridge = bridge;
        this.connect = connect;
        this.queue = Promise.resolve();
    }

    async listDevices() {
        const { ok, inputs, outputs } = await this.bridge.list(this.driver);
        if (!ok) throw deviceError();
        const named = device => ({ ...device, label: device.name });
        return { inputs: inputs.filter(device => device.id !== 'system-audio').map(named), outputs: outputs.map(named) };
    }

    enqueue(action) {
        const operation = this.queue.then(action);
        this.queue = operation.catch(() => {});
        return operation;
    }

    open(options, signal) {
        return this.enqueue(async () => {
            const session = await this.openDevices(options, signal);
            this.selection = { options, signal };
            return session;
        });
    }

    async openDevices(options, signal) {
        signal.throwIfAborted();
        try {
            if (!this.client || this.client.lifetime.signal.aborted) {
                const { ports: [control, ...unusedPorts] } = await this.connect(this.driver, { bridge: this.bridge });
                for (const port of unusedPorts) port.close();
                this.client = new NativeControlClient(control);
            }
            signal.throwIfAborted();
            const session = await this.client.request({ type: 'openMeasurement', ...options }, 'measurementState',
                reply => reply.state === 'open' || reply.state === 'failed');
            if (session.state !== 'open') throw new Error(`Native measurement device open failed: ${session.reason}`);
            this.session = session;
            signal.throwIfAborted();
            return session;
        } catch (error) {
            signal.throwIfAborted();
            console.error('Could not open the native measurement devices:', error);
            throw deviceError();
        }
    }

    ensureOpen() {
        return this.enqueue(async () => {
            if (!this.selection) throw deviceError();
            const { options, signal } = this.selection;
            signal.throwIfAborted();
            if (this.session && !this.client.lifetime.signal.aborted) return this.session;
            return this.openDevices(options, signal);
        });
    }

    close() {
        return this.enqueue(() => {
            this.selection = null;
            return this.closeDevices(this.session);
        });
    }

    async closeDevices(session) {
        if (!session || this.session !== session) return;
        this.session = null;
        this.loopActive = false;
        if (!this.client.lifetime.signal.aborted) {
            try {
                await this.client.request({ type: 'closeMeasurement' }, 'measurementState', reply => reply.state === 'closed');
            } catch (error) {
                this.client.close();
                throw error;
            }
        }
    }

    status() {
        const session = this.session;
        if (!session || this.client.lifetime.signal.aborted) return Promise.resolve(null);
        this.statusRequest ??= this.client.request({ type: 'measurementStatus' }, 'measurementStatus')
            .then(status => {
                if (status.status === 'failed' && status.reason === 'deviceLost') {
                    void this.enqueue(() => this.closeDevices(session))
                        .catch(error => console.warn('Could not release interrupted native measurement:', error));
                }
                return status;
            })
            .finally(() => { this.statusRequest = null; });
        return this.statusRequest;
    }

    cancel(session = this.session) {
        return this.enqueue(() => this.session === session && this.cancelPlayback());
    }

    async cancelPlayback() {
        if (this.session && !this.client.lifetime.signal.aborted) {
            this.loopActive = false;
            await this.client.request({ type: 'measurementCancel' }, 'measurementState', reply => reply.state === 'open');
        }
    }

    startPlayback(channels, gain, { loop = false, captureFrames = 0, overload, signal } = {}) {
        return this.enqueue(async () => {
            signal?.throwIfAborted();
            const session = this.session;
            if (!session) throw deviceError();
            const { outputChannels, sampleRate } = session;
            const excitationFrames = channels.find(channel => channel)?.length;
            if (!excitationFrames || channels.length !== outputChannels) throw deviceError();
            const chunkFrames = Math.floor(CHUNK_SAMPLES / outputChannels);
            let chunkFailure;
            const checkChunkError = ({ data }) => {
                if (data.type === 'commandRejected' && data.command === 'measurementChunk') chunkFailure = data.reason;
            };
            this.client.port.addEventListener('message', checkChunkError);
            try {
                if (this.loopActive) await this.cancelPlayback();
                await this.client.request({ type: 'measurementBegin', excitationFrames, captureFrames, loop,
                    ...(overload && { overloadPeak: overload.peak,
                        overloadTailFrames: Math.round(overload.tailSeconds * sampleRate) }) },
                'measurementState', reply => reply.state === 'ready');
                for (let offset = 0, chunks = 0; offset < excitationFrames; offset += chunkFrames) {
                    signal?.throwIfAborted();
                    const frames = Math.min(chunkFrames, excitationFrames - offset);
                    const samples = new Float32Array(frames * outputChannels);
                    for (let channel = 0; channel < outputChannels; channel++) {
                        const source = channels[channel];
                        if (!source) continue;
                        for (let frame = 0; frame < frames; frame++) {
                            samples[frame * outputChannels + channel] = source[offset + frame] * gain;
                        }
                    }
                    this.client.send({ type: 'measurementChunk', offset, attachment: samples.buffer });
                    // Stay below the host's pending control budget for long, wide excitations.
                    if (++chunks % 8 === 0) await this.status();
                    if (chunkFailure !== undefined) throw new Error(`Native measurement upload failed: ${chunkFailure}`);
                }
                signal?.throwIfAborted();
                await this.client.request({ type: 'measurementStart' }, 'measurementState', reply => reply.state === 'running');
                if (chunkFailure !== undefined) throw new Error(`Native measurement upload failed: ${chunkFailure}`);
                this.loopActive = loop;
            } catch (error) {
                const release = signal?.aborted ? this.cancelPlayback() : this.closeDevices(session);
                await release.catch(cleanup => console.error('Could not release native measurement playback:', cleanup));
                throw error;
            } finally {
                this.client.port.removeEventListener('message', checkChunkError);
            }
        });
    }

    async record(buffer, gain, overload, signal, onStart) {
        const session = this.session;
        const sampleRate = buffer.sampleRate;
        const captureFrames = buffer.length + sampleRate;
        const duration = captureFrames / sampleRate;
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        await this.startPlayback(channels, gain, { captureFrames, overload, signal });
        let closeSession = false;
        let result;
        try {
            signal.throwIfAborted();
            onStart?.(duration);
            const deadline = performance.now() + (duration * 2 + 2) * 1000;
            do {
                signal.throwIfAborted();
                result = await this.status();
                if (result?.status !== 'running' || performance.now() >= deadline) break;
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            } while (true);
            if (result?.status !== 'complete') throw new Error(`Native measurement stopped: ${result?.reason ?? 'timeout'}`);

            const recording = new Float32Array(captureFrames);
            let timing;
            for (let offset = 0; offset < captureFrames; offset += CHUNK_SAMPLES) {
                signal.throwIfAborted();
                const frames = Math.min(CHUNK_SAMPLES, captureFrames - offset);
                const data = await this.client.request({ type: 'measurementRead', offset, frames }, 'measurementData',
                    reply => reply.offset === offset);
                if (data.frames !== frames || data.attachment?.byteLength !== frames * Float32Array.BYTES_PER_ELEMENT) {
                    throw new Error('Native measurement returned an invalid recording');
                }
                timing ??= { playbackStartFrame: data.playbackStartFrame, captureStartFrame: data.captureStartFrame };
                recording.set(new Float32Array(data.attachment), offset);
            }
            return { recording, sampleRate, ...timing, overloadStopped: result.overloadStopped === true };
        } catch (error) {
            closeSession = !signal.aborted && !(result?.status === 'failed' && result.reason === 'interrupted');
            throw error;
        } finally {
            const release = closeSession ? this.enqueue(() => this.closeDevices(session)) : this.cancel(session);
            await release.catch(error => console.error('Could not release native measurement recording:', error));
        }
    }
}
