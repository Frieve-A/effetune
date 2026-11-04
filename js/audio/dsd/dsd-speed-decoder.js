import { createDsdLowpass } from './dsd-decoder.js';
import { dsdError } from './dsd-parser.js';

const PHASES = 512;
const SCRATCH_BYTES = 4 * 1024 * 1024;

// The adapter owns output-time frames. The transport maps them back to the
// original track's time using speed; its AudioBufferSources run at rate one.
export async function createDsdSpeedDecoder(base, { speed = 1, preservePitch = true } = {}) {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
        throw dsdError('DSD_UNSUPPORTED', 'Unsupported DSD playback speed');
    }
    if (speed === 1) return base;
    const { sampleRate, channelCount } = base;
    const totalFrames = Math.ceil(base.totalFrames / speed);
    if (!Number.isSafeInteger(totalFrames)) throw dsdError('DSD_CORRUPT', 'DSD playback duration is too large');
    const hop = Math.round(sampleRate * 0.02);
    const search = Math.round(sampleRate * 0.025);
    let cache = null;
    let cacheStart = 0;
    let disposed = false;
    let reading = false;
    let cursor = -1;
    let nextHop = 0;
    let previousTail = null;
    let pending = null;
    let pendingOffset = 0;
    let weights = preservePitch ? Float32Array.from({ length: hop }, (_, index) =>
        0.5 - 0.5 * Math.cos(Math.PI * (index + 0.5) / hop)) : null;
    let kernels = null;
    let kernelLength = 0;
    let kernelHalf = 0;
    if (!preservePitch) {
        const stop = 0.5 / (speed > 1 ? speed : 1);
        const pass = stop * 0.9;
        kernelLength = 2 * Math.ceil(120 / (2.285 * 2 * Math.PI * (stop - pass)) / 2) + 1;
        kernelHalf = (kernelLength - 1) / 2;
        kernels = new Float32Array((PHASES + 1) * kernelLength);
        for (let phase = 0; phase <= PHASES; phase += 1) {
            createDsdLowpass(kernelLength, (pass + stop) / 2, phase / PHASES,
                kernels.subarray(phase * kernelLength, (phase + 1) * kernelLength));
        }
    }

    async function load(first, end) {
        if (disposed) throw dsdError('DSD_DISPOSED', 'DSD speed decoder was disposed');
        first = first < 0 ? 0 : first;
        end = end > base.totalFrames ? base.totalFrames : end;
        if (cache && first >= cacheStart && end <= cacheStart + cache[0].length) return;
        const needed = end - first;
        const ahead = Math.ceil(sampleRate * 0.25);
        const count = needed > ahead ? needed : ahead;
        let length = count < 65536 ? count : 65536;
        if (length > base.totalFrames - first) length = base.totalFrames - first;
        const overlap = cache && first >= cacheStart && first < cacheStart + cache[0].length ?
            cacheStart + cache[0].length - first : 0;
        let decoded;
        if (overlap > 0) {
            const tail = await base.readFrames(first + overlap, length - overlap);
            if (disposed) throw dsdError('DSD_DISPOSED', 'DSD speed decoder was disposed');
            decoded = cache.map((channel, index) => {
                const plane = new Float32Array(length);
                plane.set(channel.subarray(first - cacheStart));
                plane.set(tail[index], overlap);
                return plane;
            });
        } else {
            decoded = await base.readFrames(first, length);
        }
        if (disposed) throw dsdError('DSD_DISPOSED', 'DSD speed decoder was disposed');
        cache = decoded;
        cacheStart = first;
    }

    function sample(channel, frame) {
        return frame < 0 || frame >= base.totalFrames ? 0 : cache[channel][frame - cacheStart];
    }

    function correlation(start, stride) {
        let dot = 0;
        let power = 0;
        for (let channel = 0; channel < channelCount; channel += 1) {
            for (let index = 0; index < hop; index += stride) {
                const value = sample(channel, start + index);
                dot += previousTail[channel][index] * value;
                power += value * value;
            }
        }
        return power > 1e-20 ? dot / Math.sqrt(power) : 0;
    }

    async function synthesizeHop() {
        const nominal = Math.round(nextHop * hop * speed);
        const first = nominal > search ? nominal - search : 0;
        const last = nominal + search < base.totalFrames ? nominal + search : base.totalFrames - 1;
        await load(first, last + 2 * hop);
        let selected = nominal;
        if (previousTail) {
            let referencePower = 0;
            for (const channel of previousTail) {
                for (let index = 0; index < hop; index += 4) referencePower += channel[index] ** 2;
            }
            if (referencePower > 1e-12) {
                // A common offset for all channels preserves the stereo image.
                // Coarse correlation followed by a short full-resolution search
                // keeps the bounded WSOLA search inexpensive at high sample rates.
                const stride = Math.round(sampleRate / 12000) || 1;
                let best = correlation(selected, stride);
                for (let candidate = first; candidate <= last; candidate += stride) {
                    const score = correlation(candidate, stride);
                    if (score > best) { best = score; selected = candidate; }
                }
                const refineStart = selected - stride > first ? selected - stride : first;
                const refineEnd = selected + stride < last ? selected + stride : last;
                best = correlation(selected, 1);
                for (let candidate = refineStart; candidate <= refineEnd; candidate += 1) {
                    const score = correlation(candidate, 1);
                    if (score > best) { best = score; selected = candidate; }
                }
            }
        }
        const output = Array.from({ length: channelCount }, () => new Float32Array(hop));
        const tail = Array.from({ length: channelCount }, () => new Float32Array(hop));
        for (let channel = 0; channel < channelCount; channel += 1) {
            for (let index = 0; index < hop; index += 1) {
                const current = sample(channel, selected + index);
                output[channel][index] = previousTail ?
                    previousTail[channel][index] * (1 - weights[index]) + current * weights[index] : current;
                tail[channel][index] = sample(channel, selected + hop + index);
            }
        }
        previousTail = tail;
        nextHop += 1;
        pending = output;
        pendingOffset = 0;
    }

    async function copyStretched(count, output = null) {
        let copied = 0;
        while (copied < count) {
            if (!pending || pendingOffset === hop) await synthesizeHop();
            const remaining = count - copied;
            const available = hop - pendingOffset;
            const take = remaining < available ? remaining : available;
            if (output) {
                for (let channel = 0; channel < channelCount; channel += 1) {
                    output[channel].set(pending[channel].subarray(pendingOffset, pendingOffset + take), copied);
                }
            }
            copied += take;
            cursor += take;
            pendingOffset += take;
        }
    }

    async function resample(startFrame, count, output) {
        // Keep each cache interval within the base decoder's bounded read limit.
        const blockFrames = Math.floor(32000 / speed);
        for (let block = 0; block < count; block += blockFrames) {
            const remaining = count - block;
            const length = remaining < blockFrames ? remaining : blockFrames;
            await load(Math.floor((startFrame + block) * speed) - kernelHalf,
                Math.floor((startFrame + block + length - 1) * speed) + kernelHalf + 1);
            for (let frame = block; frame < block + length; frame += 1) {
                const position = (startFrame + frame) * speed;
                const integer = Math.floor(position);
                const phasePosition = (position - integer) * PHASES;
                const phase = Math.floor(phasePosition);
                const blend = phasePosition - phase;
                const offset = phase * kernelLength;
                for (let channel = 0; channel < channelCount; channel += 1) {
                    let sum = 0;
                    for (let tap = 0; tap < kernelLength; tap += 1) {
                        const coefficient = kernels[offset + tap] +
                            (kernels[offset + kernelLength + tap] - kernels[offset + tap]) * blend;
                        sum += sample(channel, integer - kernelHalf + tap) * coefficient;
                    }
                    output[channel][frame] = sum;
                }
            }
        }
    }

    return {
        sampleRate, channelCount, totalFrames, durationSec: base.durationSec,
        get residentByteLength() { return disposed ? 0 : base.residentByteLength + SCRATCH_BYTES; },
        async readFrames(startFrame, frameCount) {
            if (disposed) throw dsdError('DSD_DISPOSED', 'DSD speed decoder was disposed');
            if (reading) throw dsdError('DSD_BUSY', 'DSD speed decoder reads must be serialized');
            if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > totalFrames ||
                !Number.isSafeInteger(frameCount) || frameCount < 0 || frameCount > 65536) {
                throw dsdError('DSD_CORRUPT', 'Invalid DSD speed read range');
            }
            const count = frameCount < totalFrames - startFrame ? frameCount : totalFrames - startFrame;
            const output = Array.from({ length: channelCount }, () => new Float32Array(count));
            if (!count) return output;
            reading = true;
            try {
                if (!preservePitch) {
                    await resample(startFrame, count, output);
                } else {
                    if (startFrame !== cursor) {
                        // Rebuild a bounded amount of overlap history after a seek.
                        // Alignment may differ from uninterrupted playback, while
                        // the nominal source time remains tied to the seek target.
                        nextHop = Math.floor(startFrame / hop) - 4;
                        if (nextHop < 0) nextHop = 0;
                        cursor = nextHop * hop;
                        previousTail = null;
                        pending = null;
                        await copyStretched(startFrame - cursor);
                    }
                    await copyStretched(count, output);
                }
                return output;
            } finally {
                reading = false;
            }
        },
        dispose() {
            disposed = true;
            cache = null;
            kernels = null;
            weights = null;
            previousTail = null;
            pending = null;
            base.dispose();
        }
    };
}
