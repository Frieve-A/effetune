import { getAndroidBridge, bytesToBase64, base64ToBytes } from './bridge.js';
import { createEssCapturePlan } from '../utils/measurement-dsp/ess.js';

export function configureAndroidMeasurementOutput({ audioOutputId, outputChannelCount }, bridge = getAndroidBridge()) {
    return bridge.request('measurement.output', {
        outputDeviceId: !audioOutputId || audioOutputId === 'default' ? 0 : Number(audioOutputId),
        channelCount: outputChannelCount || 2
    });
}

export function validateAndroidMeasurementChannels(indices, width) {
    if (!Number.isInteger(width) || width < 2 || width > 16 ||
        indices.some(index => !Number.isInteger(index) || index < 0 || index >= width)) {
        throw new RangeError('Choose an available output channel.');
    }
}

export async function startAndroidNoise(buffer, { levelDb, outputDeviceId, channel = 'all', outputChannelCount = 2, effectPipeline = false,
    isCurrent = () => true, bridge = getAndroidBridge() } = {}) {
    const check = () => { if (!isCurrent()) throw new DOMException('Test signal cancelled', 'AbortError'); };
    check();
    const selected = channel === 'left' ? 0 : channel === 'right' ? 1 : Number(channel);
    validateAndroidMeasurementChannels(Number.isNaN(selected) ? [] : [selected], outputChannelCount);
    await bridge.request('measurement.noise.begin', { frames: buffer.length, sampleRate: buffer.sampleRate,
        levelDb, effectPipeline, outputDeviceId: !outputDeviceId || outputDeviceId === 'default' ? 0 : Number(outputDeviceId) });
    const chunkFrames = Math.floor(65536 / outputChannelCount);
    for (let start = 0; start < buffer.length; start += chunkFrames) {
        check();
        const frames = Math.min(chunkFrames, buffer.length - start);
        const samples = new Float32Array(frames * outputChannelCount);
        for (let ch = 0; ch < outputChannelCount; ch++) {
            if (Number.isInteger(selected) && ch !== selected) continue;
            if (effectPipeline && Number.isNaN(selected) && buffer.numberOfChannels === 1 && ch >= 2) continue;
            const source = buffer.getChannelData(buffer.numberOfChannels === 1 ? 0 : ch);
            for (let frame = 0; frame < frames; frame++) samples[frame * outputChannelCount + ch] = source[start + frame];
        }
        await bridge.request('measurement.noise.chunk', { offset: start * outputChannelCount * 4, data: bytesToBase64(new Uint8Array(samples.buffer)) });
    }
    check();
    await bridge.request('measurement.noise.start');
}

// Native input channel shared by the level meter and the capture: 0 left, 1 right, 2 average.
export function androidInputChannel(channel) {
    return channel === 'right' ? 1 : channel === 'both' ? 2 : 0;
}

// overload ({ peak, tailSeconds }) ends the capture early once the selected input reaches peak.
export async function captureAndroidSweep(sweep, { repetitions, levelDb, channel = 'left', effectPipeline = false, overload, signal, onCaptureStart,
    outputChannelCount = Math.max(2, sweep.channels.length), bridge = getAndroidBridge() } = {}) {
    const inputChannel = androidInputChannel(channel);
    const plan = createEssCapturePlan(sweep, repetitions);
    const preRoll = Math.round(sweep.sampleRate * 0.5);
    const frames = preRoll * 2 + plan.playbackSamples;
    validateAndroidMeasurementChannels([], outputChannelCount);
    const gain = 10 ** (levelDb / 20);
    const chunkFrames = Math.floor(65536 / outputChannelCount);
    try {
        signal?.throwIfAborted();
        await bridge.request('measurement.begin', { sampleRate: sweep.sampleRate,
            captureFrames: frames, excitationFrames: frames, inputChannel, effectPipeline,
            ...(overload && { overloadPeak: overload.peak,
                overloadTailFrames: Math.round(overload.tailSeconds * sweep.sampleRate) }) });
        for (let start = 0; start < frames; start += chunkFrames) {
            signal?.throwIfAborted();
            const end = Math.min(frames, start + chunkFrames);
            const excitation = new Float32Array((end - start) * outputChannelCount);
            for (let repeat = Math.max(0, Math.floor((start - preRoll) / plan.intervalSamples)); repeat < repetitions; repeat++) {
                const from = preRoll + repeat * plan.intervalSamples;
                if (from >= end) break;
                const last = Math.min(end, from + sweep.length);
                for (let ch = 0; ch < outputChannelCount; ch++) {
                    const source = sweep.channels[ch];
                    if (!source) continue;
                    for (let i = Math.max(start, from); i < last; i++)
                        excitation[(i - start) * outputChannelCount + ch] = source[i - from] * gain;
                }
            }
            await bridge.request('measurement.chunk', { offset: start * outputChannelCount * 4,
                data: bytesToBase64(new Uint8Array(excitation.buffer)) });
        }
        await bridge.request('measurement.start');
        signal?.throwIfAborted();
        onCaptureStart?.(frames / sweep.sampleRate);
        const deadline = performance.now() + frames / sweep.sampleRate * 1000 + 10000;
        let state;
        for (;;) {
            signal?.throwIfAborted();
            state = await bridge.request('measurement.status');
            if (state.status === 'complete') break;
            if (state.status === 'clipped') throw Object.assign(new Error('Measurement output clipped'), { code: 'pipelineClipping' });
            if (state.status !== 'running' || performance.now() > deadline) throw new Error('The measurement was interrupted');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const recording = new Float32Array(frames);
        let offset = 0;
        while (offset < frames * 8) {
            signal?.throwIfAborted();
            const block = await bridge.request('measurement.read', { offset, length: 256 * 1024 });
            if (block.frames !== frames || block.channels !== 2 || block.sampleRate !== sweep.sampleRate) {
                throw new Error('The measurement format changed');
            }
            const data = base64ToBytes(block.data);
            if (data.length === 0 || data.length % 8 || offset + data.length > frames * 8) throw new Error('The recording is incomplete');
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            for (let byte = 0; byte < data.length; byte += 8) {
                const left = view.getFloat32(byte, true);
                const right = view.getFloat32(byte + 4, true);
                recording[(offset + byte) / 8] = inputChannel === 1 ? right : inputChannel === 2 ? (left + right) / 2 : left;
            }
            offset += data.length;
        }
        return { recording, preRoll, sampleRate: sweep.sampleRate, overloadStopped: state.overloadStopped === true };
    } finally {
        await bridge.request('measurement.cancel').catch(error => console.warn('Android measurement cleanup failed:', error));
    }
}

// Plays a prepared signal buffer ({channels, length, sampleRate}) and returns the recording
// aligned to the buffer start.
export async function captureAndroidBuffer(buffer, options) {
    const capture = await captureAndroidSweep({ ...buffer, tailSamples: 0 }, options);
    return { recording: capture.recording.slice(capture.preRoll, capture.preRoll + buffer.length),
        sampleRate: capture.sampleRate, overloadStopped: capture.overloadStopped };
}
