import { getAndroidBridge, bytesToBase64, base64ToBytes } from './bridge.js';
import { createEssCapturePlan } from '../utils/measurement-dsp/ess.js';

export async function startAndroidNoise(buffer, { levelDb, outputDeviceId, channel = 'all',
    isCurrent = () => true, bridge = getAndroidBridge() } = {}) {
    const check = () => { if (!isCurrent()) throw new DOMException('Test signal cancelled', 'AbortError'); };
    check();
    await bridge.request('measurement.noise.begin', { frames: buffer.length, sampleRate: buffer.sampleRate,
        levelDb, outputDeviceId: !outputDeviceId || outputDeviceId === 'default' ? 0 : Number(outputDeviceId) });
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
    for (let start = 0; start < buffer.length; start += 32768) {
        check();
        const frames = Math.min(32768, buffer.length - start);
        const samples = new Float32Array(frames * 2);
        for (let frame = 0; frame < frames; frame++) {
            samples[frame * 2] = ['right', '1'].includes(String(channel)) ? 0 : left[start + frame];
            samples[frame * 2 + 1] = ['left', '0'].includes(String(channel)) ? 0 : right[start + frame];
        }
        await bridge.request('measurement.noise.chunk', { offset: start * 8, data: bytesToBase64(new Uint8Array(samples.buffer)) });
    }
    check();
    await bridge.request('measurement.noise.start');
}

export async function captureAndroidSweep(sweep, { repetitions, levelDb, channel = 'left', signal,
    bridge = getAndroidBridge() } = {}) {
    const plan = createEssCapturePlan(sweep, repetitions);
    const preRoll = Math.round(sweep.sampleRate * 0.5);
    const frames = preRoll * 2 + plan.playbackSamples;
    const excitation = new Float32Array(frames * 2);
    const gain = 10 ** (levelDb / 20);
    for (let repeat = 0; repeat < repetitions; repeat++) {
        const start = preRoll + repeat * plan.intervalSamples;
        for (let frame = 0; frame < sweep.length; frame++) {
            excitation[(start + frame) * 2] = (sweep.channels[0]?.[frame] || 0) * gain;
            excitation[(start + frame) * 2 + 1] = (sweep.channels[1]?.[frame] || 0) * gain;
        }
    }
    const bytes = new Uint8Array(excitation.buffer);
    try {
        signal?.throwIfAborted();
        await bridge.request('measurement.begin', { sampleRate: sweep.sampleRate,
            captureFrames: frames, excitationFrames: frames });
        for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
            signal?.throwIfAborted();
            await bridge.request('measurement.chunk', { offset,
                data: bytesToBase64(bytes.subarray(offset, offset + 256 * 1024)) });
        }
        await bridge.request('measurement.start');
        const deadline = performance.now() + frames / sweep.sampleRate * 1000 + 10000;
        for (;;) {
            signal?.throwIfAborted();
            const state = await bridge.request('measurement.status');
            if (state.status === 'complete') break;
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
                recording[(offset + byte) / 8] = channel === 'right' ? right : channel === 'both' ? (left + right) / 2 : left;
            }
            offset += data.length;
        }
        return { recording, preRoll, sampleRate: sweep.sampleRate };
    } finally {
        await bridge.request('measurement.cancel').catch(error => console.warn('Android measurement cleanup failed:', error));
    }
}
