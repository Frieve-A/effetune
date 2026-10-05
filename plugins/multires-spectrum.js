/* Shared, DOM-independent two-window analysis for Spectrum Analyzer and Spectrogram. */
(function () {
    'use strict';

    // Spectrum Tap timing contract v1. Capture positions are exclusive sample
    // ends on the producer timeline, with the HQ FIR delay already removed.
    const SpectrumTapContract = Object.freeze({
        version: 1,
        profile(quality, sampleRate) {
            return quality === 'hq'
                ? { windowAgeFrames: 8192,
                    completionFrames: 48 + Math.floor(Math.max(2048, Math.ceil(sampleRate / 30)) / 16) * 16 }
                : { windowAgeFrames: 2048, completionFrames: 0 };
        },
        timing(quality, sampleRate, generation, frameIndex, captureEndFrame, tapDelayFrames = 0) {
            return { version: 1, generation, frameIndex, captureEndFrame,
                ...this.profile(quality, sampleRate), tapDelayFrames };
        },
        valid(timing) {
            return timing?.version === 1 &&
                ['generation', 'frameIndex', 'captureEndFrame', 'windowAgeFrames',
                    'completionFrames', 'tapDelayFrames'].every(key =>
                    Number.isSafeInteger(timing[key]) && timing[key] >= 0);
        },
        audibleFrame(timing, outputDelayFrames = 0) {
            return timing.captureEndFrame - timing.windowAgeFrames + timing.tapDelayFrames + outputDelayFrames;
        },
        requiredOutputDelay(timing, existingDelayFrames = 0, deviceDelayFrames = 0, maxFrames = Infinity,
            deliveryBudgetFrames = 0) {
            return Math.ceil(Math.min(maxFrames, Math.max(0,
                timing.windowAgeFrames + timing.completionFrames + deliveryBudgetFrames - timing.tapDelayFrames -
                existingDelayFrames - deviceDelayFrames)));
        }
    });
    globalThis.SpectrumTapContract = SpectrumTapContract;

    const HEADER_BYTES = 48;
    const FIR_LENGTH = 97;
    const FIR_DELAY = 48;
    const MAX_N = 16384;
    const measurementOwners = new WeakMap();

    function besselI0(x) {
        let sum = 1;
        let term = 1;
        for (let k = 1; k < 100; k++) {
            term *= x * x / (4 * k * k);
            sum += term;
            if (term < sum * 1e-17) break;
        }
        return sum;
    }

    function makeFilter() {
        const coefficients = new Float64Array(FIR_LENGTH);
        const denominator = besselI0(18);
        let sum = 0;
        for (let i = 0; i < FIR_LENGTH; i++) {
            const offset = i - FIR_DELAY;
            const sinc = offset === 0 ? 0.25 : Math.sin(Math.PI * 0.25 * offset) / (Math.PI * offset);
            const position = offset / FIR_DELAY;
            coefficients[i] = sinc * besselI0(18 * Math.sqrt(1 - position * position)) / denominator;
            sum += coefficients[i];
        }
        for (let i = 0; i < FIR_LENGTH; i++) coefficients[i] /= sum;
        return coefficients;
    }

    const coefficients = makeFilter();

    class FrameReceiver {
        constructor() {
            this.producer = null;
            this.generation = -1;
            this.frameIndex = -1;
            this.streamChanged = false;
        }

        accept(snapshot, producer) {
            const newProducer = producer !== this.producer;
            if (!newProducer && (snapshot.generation < this.generation ||
                (snapshot.generation === this.generation && snapshot.frameIndex <= this.frameIndex))) return false;
            this.streamChanged = newProducer || snapshot.generation !== this.generation;
            this.producer = producer;
            this.generation = snapshot.generation;
            this.frameIndex = snapshot.frameIndex;
            return true;
        }
    }

    function decode(frame, type) {
        if (frame?.frameType !== type || frame.formatVersion !== 2) return null;
        const payload = frame.payload;
        const count = type === 4 ? 2048 : 256;
        const bytes = HEADER_BYTES + count * (type === 4 ? 8 : 1);
        if (!payload || payload.byteLength !== bytes || typeof payload.getUint32 !== 'function') return null;
        const sampleRate = payload.getFloat32(0, true);
        const points = payload.getUint16(4, true);
        const hopSamples = payload.getUint32(8, true);
        const generation = payload.getUint32(12, true);
        const captureEndSample = payload.getUint32(16, true) + payload.getUint32(20, true) * 4294967296;
        const frameIndex = payload.getUint32(24, true);
        const firstValidIndex = payload.getUint32(40, true);
        const validCellCount = payload.getUint32(44, true);
        const expectedHop = type === 4 ? Math.max((1 << points) / 2, Math.ceil(sampleRate / 30)) : (1 << points) / 2;
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 || points < 8 || points > 14 ||
            payload.getUint16(6, true) !== 0 || hopSamples !== expectedHop ||
            !Number.isSafeInteger(captureEndSample) || payload.getUint32(28, true) !== count ||
            payload.getFloat32(32, true) !== 20 || payload.getFloat32(36, true) !== 40000 ||
            firstValidIndex + validCellCount > count) return null;
        let first = count;
        let valid = 0;
        for (let i = 0; i < count; i++) {
            const ascending = type === 4 ? i : count - 1 - i;
            const frequency = ascending === count - 1 ? 40000 : 20 * Math.exp(ascending * Math.log(2000) / (count - 1));
            if (frequency <= sampleRate / 2) {
                if (first === count) first = i;
                valid++;
            }
        }
        if (firstValidIndex !== (valid ? first : 0) || validCellCount !== valid) return null;
        const snapshot = {
            highQuality: true, sampleRate, points, hopSamples, generation, captureEndSample, frameIndex,
            firstValidIndex, validCellCount, minFrequency: 20, maxFrequency: 40000,
            binCount: count, cellCount: count, flags: 0, timeSeconds: captureEndSample / sampleRate
        };
        if (type === 4) {
            snapshot.current = new Float32Array(count);
            snapshot.peaks = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const current = payload.getFloat32(HEADER_BYTES + i * 4, true);
                const peak = payload.getFloat32(HEADER_BYTES + (count + i) * 4, true);
                if (!Number.isFinite(current) || !Number.isFinite(peak) || peak > 0 || peak < -240) return null;
                snapshot.current[i] = current;
                snapshot.peaks[i] = peak;
            }
        } else {
            snapshot.intensities = new Uint8Array(count);
            for (let i = 0; i < count; i++) snapshot.intensities[i] = payload.getUint8(HEADER_BYTES + i);
        }
        return snapshot;
    }

    class MultiresSpectrum {
        constructor(sampleRate, type) {
            this.sampleRate = sampleRate;
            this.type = type;
            this.count = type === 4 ? 2048 : 256;
            this.plans = [];
            for (let points = 8; points <= 14; points++) {
                const n = 1 << points;
                const window = new Float32Array(n);
                const cos = new Float64Array(n / 2);
                const sin = new Float64Array(n / 2);
                const reverse = new Uint16Array(n);
                let windowSum = 0;
                for (let i = 0; i < n; i++) {
                    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
                    windowSum += window[i];
                    let x = i;
                    let reversed = 0;
                    for (let bit = 0; bit < points; bit++) {
                        reversed = (reversed << 1) | (x & 1);
                        x >>= 1;
                    }
                    reverse[i] = reversed;
                    if (i < n / 2) {
                        cos[i] = Math.cos(2 * Math.PI * i / n);
                        sin[i] = -Math.sin(2 * Math.PI * i / n);
                    }
                }
                const hop = type === 4 && Math.ceil(sampleRate / 30) > n / 2 ? Math.ceil(sampleRate / 30) : n / 2;
                // Pack, two FFTs, power and display mapping all receive bounded slots.
                const operations = 2 * n + points * n + n + 2 + this.count;
                const lower = 32 * sampleRate / n < sampleRate / 32 ? 32 * sampleRate / n : sampleRate / 32;
                const upper = 64 * sampleRate / n < sampleRate / 16 ? 64 * sampleRate / n : sampleRate / 16;
                this.plans[points] = { n, points, window, cos, sin, reverse, hop, normalization: 1 / (windowSum * windowSum),
                    blendLower: lower, blendUpper: upper,
                    slotWork: Math.ceil(operations / Math.floor(hop / 16)) + 1 };
            }
            // Retain capture history throughout pack, including rate-limited small windows.
            this.shortRing = new Float32Array(MAX_N * 2 + Math.ceil(sampleRate / 30) + FIR_LENGTH + 32);
            this.longRing = new Float32Array(MAX_N * 2 + Math.ceil(sampleRate / 120) + 32);
            this.fir = new Float64Array(FIR_LENGTH);
            this.real = [new Float64Array(MAX_N), new Float64Array(MAX_N)];
            this.imag = [new Float64Array(MAX_N), new Float64Array(MAX_N)];
            this.power = [new Float32Array(MAX_N / 2 + 1), new Float32Array(MAX_N / 2 + 1)];
            this.peaks = new Float32Array(this.count);
            this.frequencies = new Float64Array(this.count);
            this.cellRatio = Math.exp(0.5 * Math.log(2000) / (this.count - 1));
            this.firstValidIndex = this.count;
            this.validCellCount = 0;
            for (let i = 0; i < this.count; i++) {
                const ascending = type === 4 ? i : this.count - 1 - i;
                this.frequencies[i] = ascending === this.count - 1 ? 40000 : 20 * Math.exp(ascending * Math.log(2000) / (this.count - 1));
                if (this.frequencies[i] <= sampleRate / 2) {
                    if (!this.validCellCount) this.firstValidIndex = i;
                    this.validCellCount++;
                }
            }
            if (!this.validCellCount) this.firstValidIndex = 0;
            // Three immutable-until-consumed slots bound worklet notification ownership.
            this.frames = Array.from({ length: 3 }, () => {
                const payload = new DataView(new ArrayBuffer(HEADER_BYTES + this.count * (type === 4 ? 8 : 1)));
                const frame = { frameType: type, formatVersion: 2, payload,
                    bytes: new Uint8Array(payload.buffer), busy: false };
                frame.measurements = { hqFrame: { frameType: type, formatVersion: 2, payload } };
                measurementOwners.set(frame.measurements, frame);
                return frame;
            });
            this.generation = 0;
            this.enabled = false;
            this.points = 0;
            this.completed = null;
            this.job = false;
            this.legacyPlans = [];
            for (let points = 8; points <= 14; points++) {
                const n = 1 << points;
                const slots = Array.from({ length: 3 }, () => {
                    const slot = { busy: false,
                        measurements: { buffer: [new Float32Array(n)], bufferPosition: 0, time: 0, sampleRate } };
                    measurementOwners.set(slot.measurements, slot);
                    return slot;
                });
                this.legacyPlans[points] = { buffer: new Float32Array(n), slots };
            }
            this.legacyPoints = 0;
        }

        configure(points, enabled) {
            if (this.points === points && this.enabled === enabled) return;
            this.points = points;
            this.enabled = enabled;
            this.plan = this.plans[points];
            if (enabled) {
                this.generation++;
                this.legacyPoints = 0;
            }
            this.inputCount = 0;
            this.longCount = 0;
            this.frameIndex = 0;
            this.nextJob = this.type === 4 && this.plan.n < this.plan.hop ? this.plan.n : this.plan.hop;
            if (this.job) this.release(this.output);
            this.release(this.completed);
            this.job = false;
            this.completed = null;
            this.validPeaks = false;
            this.firSum = 0;
        }

        release(frame) {
            if (frame) frame.busy = false;
        }

        captureLegacy(data, parameters, time) {
            this.configure(parameters.pt, false);
            if (this.legacyPoints !== parameters.pt) {
                this.legacyPoints = parameters.pt;
                this.legacyPosition = 0;
                this.legacyValid = 0;
            }
            const plan = this.legacyPlans[parameters.pt];
            const n = plan.buffer.length;
            const block = parameters.blockSize;
            for (let i = 0; i < block; i++) {
                const left = data[i] || 0;
                const right = parameters.channelCount > 1 ? data[block + i] : left;
                plan.buffer[this.legacyPosition] = (left + right) * 0.5;
                this.legacyPosition = (this.legacyPosition + 1) & (n - 1);
                if (this.legacyValid < n) this.legacyValid++;
            }
            if (this.legacyPosition % (n / 2) !== 0) return null;
            for (let i = 0; i < plan.slots.length; i++) {
                const slot = plan.slots[i];
                if (slot.busy) continue;
                slot.busy = true;
                const output = slot.measurements.buffer[0];
                for (let index = 0; index < n; index++) output[index] = index < this.legacyValid ? plan.buffer[index] : 0;
                slot.measurements.bufferPosition = this.legacyPosition;
                slot.measurements.time = time;
                return slot;
            }
            return null;
        }

        startJob() {
            if (this.longCount < this.plan.n) return;
            this.captureEnd = this.latestEnd;
            this.captureLongEnd = this.longCount;
            this.jobDbRange = this.dbRange;
            this.stage = 0;
            this.position = 0;
            this.fftStage = 1;
            this.job = true;
            this.output = null;
            for (let i = 0; i < this.frames.length; i++) {
                if (!this.frames[i].busy) {
                    this.output = this.frames[i];
                    this.output.busy = true;
                    break;
                }
            }
            this.jobFrameIndex = this.frameIndex++;
            this.nextSlot = this.inputCount + 16;
        }

        mapPower(which, frequency, lower, upper) {
            const step = this.sampleRate / this.plan.n / (which === 1 ? 4 : 1);
            const bin = frequency / step;
            const maximum = this.plan.n / 2;
            const values = this.power[which];
            if (bin > maximum) return 0;
            if ((upper - lower) / step < 1) return this.interpolate(values, bin, maximum);
            let value = this.interpolate(values, lower / step, maximum);
            const edge = this.interpolate(values, upper / step < maximum ? upper / step : maximum, maximum);
            if (edge > value) value = edge;
            const start = Math.ceil(lower / step);
            const end = Math.floor(upper / step);
            for (let i = start; i <= end && i <= maximum; i++) {
                if (values[i] > value) value = values[i];
            }
            return value;
        }

        interpolate(values, position, maximum) {
            if (position < 0 || position > maximum) return 0;
            const low = Math.floor(position);
            const high = low < maximum ? low + 1 : low;
            return values[low] + (values[high] - values[low]) * (position - low);
        }

        step() {
            const plan = this.plan;
            const n = plan.n;
            for (let work = 0; work < plan.slotWork && this.job; work++) {
                const position = this.position;
                if (this.stage < 2) {
                    const which = this.stage;
                    const ring = which === 0 ? this.shortRing : this.longRing;
                    const end = which === 0 ? this.captureEnd : this.captureLongEnd;
                    const source = end - n + position;
                    this.real[which][plan.reverse[position]] = Math.fround(ring[source % ring.length] * plan.window[position]);
                    this.imag[which][plan.reverse[position]] = 0;
                    if (++this.position === n) { this.position = 0; this.stage++; }
                } else if (this.stage < 4) {
                    const which = this.stage - 2;
                    const half = 1 << (this.fftStage - 1);
                    const offset = position % half;
                    const left = Math.floor(position / half) * half * 2 + offset;
                    const right = left + half;
                    const twiddle = offset * n / (half * 2);
                    const real = this.real[which];
                    const imag = this.imag[which];
                    const tr = real[right] * plan.cos[twiddle] - imag[right] * plan.sin[twiddle];
                    const ti = real[right] * plan.sin[twiddle] + imag[right] * plan.cos[twiddle];
                    real[right] = real[left] - tr;
                    imag[right] = imag[left] - ti;
                    real[left] += tr;
                    imag[left] += ti;
                    if (++this.position === n / 2) {
                        this.position = 0;
                        if (++this.fftStage > plan.points) { this.fftStage = 1; this.stage++; }
                    }
                } else if (this.stage < 6) {
                    const which = this.stage - 4;
                    const re = this.real[which][position];
                    const im = this.imag[which][position];
                    const scale = position === 0 || position === n / 2 ? 1 : 4;
                    this.power[which][position] = (re * re + im * im) * scale * plan.normalization;
                    if (++this.position > n / 2) { this.position = 0; this.stage++; }
                } else {
                    const f = this.frequencies[position];
                    const valid = f <= this.sampleRate / 2;
                    let db = -240;
                    if (valid) {
                        const ratio = this.cellRatio;
                        const lower = f === 20 ? f : f / ratio;
                        const upper = f === 40000 ? f : f * ratio;
                        const blendLow = plan.blendLower;
                        const blendHigh = plan.blendUpper;
                        const weight = f <= blendLow ? 1 : f >= blendHigh ? 0 : (blendHigh - f) / (blendHigh - blendLow);
                        let power = 0;
                        if (weight > 0) power += weight * this.mapPower(1, f, lower, upper);
                        if (weight < 1) power += (1 - weight) * this.mapPower(0, f, lower, upper);
                        db = Math.fround(10 * Math.log10(power > 1e-24 ? power : 1e-24));
                    }
                    const decay = Math.fround(20 * plan.hop / this.sampleRate);
                    let peak = Math.fround((this.validPeaks ? this.peaks[position] : -145) - decay);
                    if (db > peak) peak = db;
                    peak = !valid ? -240 : peak > 0 ? 0 : peak < -145 ? -145 : peak;
                    this.peaks[position] = peak;
                    if (this.output) {
                        if (this.type === 4) {
                            this.output.payload.setFloat32(HEADER_BYTES + position * 4, db, true);
                            this.output.payload.setFloat32(HEADER_BYTES + (this.count + position) * 4, peak, true);
                        } else {
                            let intensity = valid ? (db - this.jobDbRange) / -this.jobDbRange : 0;
                            intensity = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
                            this.output.payload.setUint8(HEADER_BYTES + position, Math.round(intensity * 255));
                        }
                    }
                    if (++this.position === this.count) this.finishJob();
                }
            }
        }

        finishJob() {
            this.job = false;
            this.validPeaks = true;
            if (!this.output) return;
            const payload = this.output.payload;
            payload.setFloat32(0, this.sampleRate, true);
            payload.setUint16(4, this.points, true);
            payload.setUint16(6, 0, true);
            payload.setUint32(8, this.plan.hop, true);
            payload.setUint32(12, this.generation, true);
            payload.setUint32(16, this.captureEnd >>> 0, true);
            payload.setUint32(20, Math.floor(this.captureEnd / 4294967296), true);
            payload.setUint32(24, this.jobFrameIndex, true);
            payload.setUint32(28, this.count, true);
            payload.setFloat32(32, 20, true);
            payload.setFloat32(36, 40000, true);
            payload.setUint32(40, this.firstValidIndex, true);
            payload.setUint32(44, this.validCellCount, true);
            if (this.completed) this.release(this.completed);
            this.completed = this.output;
        }

        process(data, parameters) {
            this.configure(parameters.pt, parameters.hq === true || parameters.sc === 'log-hq');
            if (!this.enabled) return null;
            this.dbRange = parameters.dr;
            const block = parameters.blockSize;
            for (let i = 0; i < block; i++) {
                const input = Math.fround((data[i] + (parameters.channelCount > 1 ? data[block + i] : data[i])) * 0.5);
                const index = this.inputCount++;
                this.shortRing[index % this.shortRing.length] = input;
                this.fir[index % FIR_LENGTH] = input;
                // Accumulate one polyphase branch per input sample, not all taps at output time.
                const phase = index & 3;
                if (phase === 0) this.firSum = 0;
                const end = index + (3 - phase);
                for (let tap = 3 - phase; tap < FIR_LENGTH; tap += 4) {
                    const source = end - tap;
                    if (source >= 0 && source <= index) this.firSum += coefficients[tap] * this.fir[source % FIR_LENGTH];
                }
                if (phase === 3 && this.inputCount >= FIR_LENGTH) {
                    this.longRing[this.longCount++ % this.longRing.length] = this.firSum;
                    this.latestEnd = this.inputCount - FIR_DELAY;
                }
                if (this.job && this.inputCount === this.nextSlot) {
                    this.step();
                    this.nextSlot += 16;
                }
                if (this.inputCount === this.nextJob) {
                    this.nextJob += this.plan.hop;
                    this.startJob();
                }
            }
            const completed = this.completed;
            this.completed = null;
            return completed;
        }
    }

    MultiresSpectrum.decode = decode;
    MultiresSpectrum.FrameReceiver = FrameReceiver;
    MultiresSpectrum.releaseMeasurements = measurements => {
        const slot = measurementOwners.get(measurements);
        if (slot) slot.busy = false;
    };
    MultiresSpectrum.prepare = (context, sampleRate, type) => {
        if (!context.multiresSpectrum || context.multiresSpectrum.sampleRate !== sampleRate) {
            context.multiresSpectrum = new MultiresSpectrum(sampleRate, type);
        }
        return context.multiresSpectrum;
    };
    globalThis.MultiresSpectrum = MultiresSpectrum;
})();
