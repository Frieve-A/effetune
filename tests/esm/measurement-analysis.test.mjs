import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createEssSignal, createEssCapturePlan, analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';
import { analyzeImpulseResponse, analyzeDistortion, analyzeWaterfall, validateHarmonicAnalysis } from '../../js/utils/measurement-dsp/analysis.js';
import AudioProcessing, { SweepCancelledError } from '../../features/measurement/measurement-controller/audio-processing.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';

const sweep = createEssSignal({ length: 32768, sampleRate: 16000, startFrequency: 40, endFrequency: 7000 });

function recordingFor(signal = sweep, { repetitions = 1, delay = 120, gain = 0.5, nonlinear = false } = {}) {
    const plan = createEssCapturePlan(signal, repetitions);
    const offset = Math.round(signal.sampleRate * 0.55);
    const data = new Float32Array(offset + plan.playbackSamples + signal.sampleRate / 2);
    for (let repeat = 0; repeat < repetitions; repeat++) {
        for (let i = 0; i < signal.length; i++) {
            const x = signal.signal[i] * gain;
            data[offset + repeat * plan.intervalSamples + i + delay] = nonlinear ? x + 0.1 * x * x + 0.05 * x * x * x : x;
        }
    }
    return { data, offset };
}

function atFrequency(result, frequency) {
    return result.frequencies.findIndex(value => value >= frequency);
}

test('ESS recovers known delayed linear gain independently of sweep band and duration', () => {
    for (const signal of [sweep, createEssSignal({ length: 16384, sampleRate: 16000, startFrequency: 100, endFrequency: 5000 })]) {
        const { data, offset } = recordingFor(signal, { gain: 0.25, repetitions: 2 });
        const result = analyzeEssRecording(data, signal, {
            playbackOffsetSamples: offset, repetitions: 2, levelDb: -6.020599913279624, outputTimeReference: 'audio-context'
        });
        assert.equal(result.trimStartSamples + result.onsetIndex, 120);
        assert.equal(result.harmonicAnalysis.quality.valid, true);
        assert.equal(validateHarmonicAnalysis(result.harmonicAnalysis), true);
        const band = result.frequencyResponse.filter(([f]) => f > 300 && f < 3000);
        assert.ok(band.every(([, db]) => Math.abs(db + 6.0206) < 0.15));
    }
});

test('finite ESS reference removes published loopback bias and false default-window harmonics, including a non-flat linear path', () => {
    const excitation = createEssSignal();
    for (const filtered of [false, true]) {
        const capture = recordingFor(excitation);
        if (filtered) {
            const original = capture.data.slice();
            for (let i = 8; i < capture.data.length; i++) capture.data[i] = original[i] * 0.5 + original[i - 8] * 0.25;
        }
        const result = analyzeEssRecording(capture.data, excitation, {
            playbackOffsetSamples: capture.offset, levelDb: 20 * Math.log10(0.5)
        });
        for (const [frequency, db] of result.frequencyResponse) {
            const phase = 2 * Math.PI * frequency * 8 / excitation.sampleRate;
            const expected = filtered ? 20 * Math.log10(Math.hypot(0.5 + 0.25 * Math.cos(phase), 0.25 * Math.sin(phase))) : 0;
            assert.ok(Math.abs(db - expected) < (filtered ? 0.01 : 0.0001), `${frequency} Hz: ${db} versus ${expected}`);
        }
        for (const settings of [{}, { beforeSeconds: 0.002, afterSeconds: 0.02 }]) {
            const distortion = analyzeDistortion(result.harmonicAnalysis, settings);
            const ratios = distortion.thd.filter(Number.isFinite);
            assert.ok(ratios.length > 100);
            // Float32 convolution and finite IR support bound the residual for a
            // general filter; no corresponding threshold suppresses production curves.
            const limit = filtered ? (settings.afterSeconds ? 0.000005 : 0.000025) : 0.000001;
            assert.ok(Math.max(...ratios) < limit, `${filtered ? 'FIR' : 'identity'} residual ${Math.max(...ratios)}`);
        }
    }
});

test('ESS separates polynomial harmonic amplitudes and maps harmonic output frequency to fundamental frequency', () => {
    const { data, offset } = recordingFor(sweep, { nonlinear: true });
    const result = analyzeEssRecording(data, sweep, { playbackOffsetSamples: offset, levelDb: 20 * Math.log10(0.5) });
    assert.equal(result.harmonicAnalysis.quality.valid, true);
    const distortion = analyzeDistortion(result.harmonicAnalysis);
    // For x = 0.5 sin(t), x + 0.1x² + 0.05x³ has A1=.5046875, A2=.0125, A3=.0015625.
    const expected = [0.0125 / 0.5046875, 0.0015625 / 0.5046875];
    for (const frequency of [200, 500, 1000]) {
        const i = atFrequency(distortion, frequency);
        distortion.series.forEach((entry, n) => assert.ok(Math.abs(entry.ratios[i] / expected[n] - 1) < 0.025));
        assert.ok(Math.abs(distortion.thd[i] / Math.hypot(...expected) - 1) < 0.025);
    }
    const edge = atFrequency(distortion, 2500);
    assert.equal(distortion.series[1].ratios[edge], null);
    assert.equal(distortion.thd[edge], null);
    const secondOrder = analyzeDistortion(result.harmonicAnalysis, { maxOrder: 2 });
    assert.ok(secondOrder.thd[atFrequency(secondOrder, 2500)] > 0);
    assert.deepEqual(secondOrder.series, distortion.series);
    const shortWindow = analyzeDistortion(result.harmonicAnalysis, { beforeSeconds: 0.002, afterSeconds: 0.02 });
    assert.ok(shortWindow.series.every(entry => entry.ratios[atFrequency(shortWindow, 50)] === null));
    assert.ok(distortion.series.every(entry => Number.isFinite(entry.ratios[atFrequency(distortion, 50)])));
    for (const frequency of [100, 500, 1000]) {
        const i = atFrequency(shortWindow, frequency);
        shortWindow.series.forEach((entry, n) => assert.ok(Math.abs(entry.ratios[i] / expected[n] - 1) < 0.025));
    }
    assert.throws(() => analyzeDistortion(result.harmonicAnalysis, { afterSeconds: 1 }), /Window exceeds/);
});

test('distortion Hann is centered on onset and applies the selected gate without boosting delayed harmonics', () => {
    const payload = { version: 2, method: 'ess', sampleRate: 16000, reference: 'unit-input',
        calibration: 'uncorrected-system', quality: { valid: true, reasons: [] },
        excitation: { startFrequency: 40, endFrequency: 7000, durationSeconds: 2, sweepSamples: 32000, levelDb: 0 },
        orders: [1, 2, 3].map(order => {
            const data = new Float32Array(512), referenceData = new Float32Array(512);
            const harmonicReferenceData = new Float32Array(512);
            if (order === 1) { data[32] = 1; referenceData[32] = 1; }
            else { data[112] = order === 2 ? 0.02 : 0.003; harmonicReferenceData[32] = 1; }
            return { order, data, referenceData, ...(order > 1 ? { harmonicReferenceData } : {}),
                onsetIndex: 32, validMinFrequency: 45, validMaxFrequency: 6800 / order };
        }) };
    // 500 Hz and its harmonics are exact FFT bins: this isolates window gain from interpolation.
    const settings = { afterSeconds: 0.02, minFrequency: 500, maxFrequency: 1000 };
    const taperAtDelay = 0.5 + 0.5 * Math.cos(Math.PI * 80 / 319);
    for (const beforeSeconds of [0.002, 0]) {
        for (const window of ['rectangular', 'hann']) {
            const result = analyzeDistortion(payload, { ...settings, beforeSeconds, window });
            const weight = window === 'hann' ? taperAtDelay : 1;
            const expected = [0.02 * weight, 0.003 * weight];
            assert.equal(result.frequencies[0], 500);
            result.series.forEach((series, i) => assert.ok(Math.abs(series.ratios[0] - expected[i]) < 1e-8));
            assert.ok(Math.abs(result.thd[0] - Math.hypot(...expected)) < 1e-8);
        }
    }
    const capture = recordingFor(sweep, { nonlinear: true });
    const polynomial = analyzeEssRecording(capture.data, sweep, {
        playbackOffsetSamples: capture.offset, levelDb: 20 * Math.log10(0.5)
    });
    const result = analyzeDistortion(polynomial.harmonicAnalysis, {
        ...settings, beforeSeconds: 0.002, window: 'hann'
    });
    const expected = [0.0125 / 0.5046875, 0.0015625 / 0.5046875];
    result.series.forEach((series, i) => assert.ok(Math.abs(series.ratios[0] / expected[i] - 1) < 0.025));
});

test('higher harmonic limits use available captured orders while preserving the independent THD ceiling', () => {
    const payload = { version: 2, method: 'ess', sampleRate: 16000, reference: 'unit-input',
        calibration: 'uncorrected-system', quality: { valid: true, reasons: [] },
        excitation: { startFrequency: 40, endFrequency: 7000, durationSeconds: 2, sweepSamples: 32000, levelDb: 0 },
        orders: Array.from({ length: 10 }, (_, index) => {
            const order = index + 1;
            const data = new Float32Array(order > 3 ? 128 : 512), referenceData = new Float32Array(data.length);
            const harmonicReferenceData = new Float32Array(data.length);
            data[16] = order === 1 ? 1 : 0.01 / order;
            if (order === 1) referenceData[16] = 1;
            else harmonicReferenceData[16] = 1;
            return { order, data, referenceData, ...(order > 1 ? { harmonicReferenceData } : {}),
                onsetIndex: 16, validMinFrequency: 45, validMaxFrequency: 6800 / order };
        }) };
    assert.equal(validateHarmonicAnalysis(payload), true);
    const settings = { window: 'rectangular', minFrequency: 500, maxFrequency: 1000 };
    const defaults = analyzeDistortion(payload, settings);
    assert.equal(defaults.harmonicLimit, 3);
    assert.deepEqual(defaults.series.map(series => series.order), [2, 3]);
    assert.equal(defaults.availableAfterSeconds, (512 - 16) / 16000);
    const result = analyzeDistortion(payload, { ...settings, harmonicLimit: 10, maxOrder: 5 });
    assert.deepEqual(result.series.map(series => series.order), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
    result.series.forEach(series => assert.ok(Math.abs(series.ratios[0] - 0.01 / series.order) < 1e-9));
    assert.ok(Math.abs(result.thd[0] - Math.hypot(...[2, 3, 4, 5].map(order => 0.01 / order))) < 1e-9);
    assert.equal(result.availableAfterSeconds, (128 - 16) / 16000);
    const two = analyzeDistortion({ ...payload, orders: payload.orders.slice(0, 2) }, settings);
    assert.equal(two.harmonicLimit, 2); assert.equal(two.maxOrder, 2);
    assert.throws(() => analyzeDistortion(payload, { harmonicLimit: 11 }), /Invalid harmonic limit/);
    assert.throws(() => analyzeDistortion(payload, { harmonicLimit: 3, maxOrder: 4 }), /Invalid maximum order/);
    assert.equal(validateHarmonicAnalysis({ ...payload, orders: payload.orders.filter(entry => entry.order !== 5) }), false);
    assert.equal(validateHarmonicAnalysis({ ...payload, orders: [...payload.orders, { ...payload.orders[9], order: 11 }] }), false);
});

test('fixed-clock LR4 low-pass group delay is not mistaken for inconsistent capture or clock drift', () => {
    const excitation = createEssSignal();
    const capture = recordingFor(excitation, { repetitions: 2 });
    const frequency = 2 * Math.PI * 80 / excitation.sampleRate;
    const cosine = Math.cos(frequency);
    const alpha = Math.sin(frequency) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    const b0 = (1 - cosine) / (2 * a0);
    const b1 = (1 - cosine) / a0;
    const a1 = -2 * cosine / a0;
    const a2 = (1 - alpha) / a0;
    const delays = new Float64Array(4);
    for (let i = 0; i < capture.data.length; i++) {
        let sample = capture.data[i];
        for (let stage = 0; stage < 2; stage++) {
            const output = b0 * sample + delays[2 * stage];
            delays[2 * stage] = b1 * sample - a1 * output + delays[2 * stage + 1];
            delays[2 * stage + 1] = b0 * sample - a2 * output;
            sample = output;
        }
        capture.data[i] = sample;
    }
    for (const repetitions of [1, 2]) {
        const result = analyzeEssRecording(capture.data, excitation, {
            playbackOffsetSamples: capture.offset, repetitions, levelDb: 20 * Math.log10(0.5)
        });
        assert.ok(!result.harmonicAnalysis.quality.reasons.includes('clock-drift'));
        assert.ok(!result.harmonicAnalysis.quality.reasons.includes('inconsistent-capture'));
        assert.deepEqual(result.harmonicAnalysis.quality.reasons, ['overlapping-tail']);
        assert.ok(analyzeDistortion(result.harmonicAnalysis).series.length > 0);
    }
});

test('clock mismatch across repeated ESS captures remains detectable', () => {
    const capture = recordingFor(sweep, { repetitions: 2 });
    const ratio = 1.001;
    const stretched = Float32Array.from(capture.data, (_, i) => {
        const source = i / ratio;
        const index = Math.floor(source);
        const fraction = source - index;
        return capture.data[index] * (1 - fraction) + (capture.data[index + 1] || 0) * fraction;
    });
    const result = analyzeEssRecording(stretched, sweep, { playbackOffsetSamples: capture.offset, repetitions: 2 });
    assert.equal(result.harmonicAnalysis.quality.valid, false);
    assert.ok(result.harmonicAnalysis.quality.reasons.includes('clock-drift'));
});

test('linear interface calibration does not change complete-path harmonic ratios or their uncorrected provenance', () => {
    const { data, offset } = recordingFor(sweep, { nonlinear: true });
    const calibration = { data: new Float32Array(1024), onsetIndex: 16, prerollSamples: 16, refScale: 1 };
    calibration.data[16] = 0.5;
    calibration.data[17] = 0.25;
    const options = { playbackOffsetSamples: offset, levelDb: 20 * Math.log10(0.5) };
    const raw = analyzeEssRecording(data, sweep, options);
    const calibrated = analyzeEssRecording(data, sweep, { ...options, calibration });
    assert.equal(calibrated.harmonicAnalysis.calibration, 'uncorrected-system');
    assert.deepEqual(analyzeDistortion(raw.harmonicAnalysis), analyzeDistortion(calibrated.harmonicAnalysis));
    const rawPoint = raw.frequencyResponse.find(([f]) => f > 500);
    const calibratedPoint = calibrated.frequencyResponse.find(([f]) => f > 500);
    assert.ok(Math.abs(calibratedPoint[1] - rawPoint[1]) > 1);
});

test('invalid and incomplete acquisition is rejected while clipped data retains its warning and faithful ratios', () => {
    const { data, offset } = recordingFor();
    assert.throws(() => analyzeEssRecording(data.subarray(0, offset + sweep.length), sweep, { playbackOffsetSamples: offset }), /Incomplete/);
    const bad = data.slice(); bad[10000] = NaN;
    assert.throws(() => analyzeEssRecording(bad, sweep, { playbackOffsetSamples: offset }), /Invalid/);
    const clipped = analyzeEssRecording(data, sweep, { playbackOffsetSamples: offset, overloaded: true });
    assert.equal(clipped.irValid, true);
    assert.deepEqual(clipped.harmonicAnalysis.quality.reasons, ['clipping']);
    const reference = analyzeDistortion({ ...clipped.harmonicAnalysis, quality: { valid: true, reasons: [] } });
    assert.deepEqual(analyzeDistortion(clipped.harmonicAnalysis), reference);
    assert.ok(reference.thd.some(Number.isFinite));
    assert.deepEqual(clipped.harmonicAnalysis.quality, { valid: false, reasons: ['clipping'] });
    const zeroHarmonics = structuredClone(clipped.harmonicAnalysis);
    for (const order of zeroHarmonics.orders.slice(1)) order.data.set(order.referenceData);
    const zeros = analyzeDistortion(zeroHarmonics).thd.filter(Number.isFinite);
    assert.ok(zeros.length > 0);
    assert.ok(zeros.every(value => value === 0));
    assert.equal(validateHarmonicAnalysis({ ...clipped.harmonicAnalysis, orders: [null, null, null] }), false);
    assert.throws(() => analyzeDistortion(null), /unavailable/);
    const drift = recordingFor(sweep, { repetitions: 2 });
    const interval = createEssCapturePlan(sweep, 2).intervalSamples;
    const second = drift.data.slice(drift.offset + interval);
    drift.data.fill(0, drift.offset + interval);
    drift.data.set(second.subarray(0, second.length - 10), drift.offset + interval + 10);
    const drifting = analyzeEssRecording(drift.data, sweep, { playbackOffsetSamples: drift.offset, repetitions: 2 });
    assert.equal(drifting.harmonicAnalysis.quality.valid, false);
    assert.ok(drifting.harmonicAnalysis.quality.reasons.includes('clock-drift'));
});

test('insufficient harmonic band or separation preserves the independently usable linear response', () => {
    const narrow = createEssSignal({ length: 16384, sampleRate: 16000, startFrequency: 5000, endFrequency: 6000 });
    const capture = recordingFor(narrow);
    const limited = analyzeEssRecording(capture.data, narrow, { playbackOffsetSamples: capture.offset });
    assert.equal(limited.irValid, true);
    assert.ok(limited.data.length > 16000);
    assert.equal(validateHarmonicAnalysis(limited.harmonicAnalysis), true);
    assert.equal(limited.harmonicAnalysis.quality.valid, false);
    assert.ok(limited.harmonicAnalysis.quality.reasons.includes('insufficient-harmonic-band'));
    assert.throws(() => analyzeDistortion(limited.harmonicAnalysis), /No observed harmonic ratios/);
    const partial = createEssSignal({ length: 16384, sampleRate: 16000, startFrequency: 1000, endFrequency: 2500 });
    const partialCapture = recordingFor(partial, { nonlinear: true });
    const partialResult = analyzeEssRecording(partialCapture.data, partial, { playbackOffsetSamples: partialCapture.offset });
    const curves = analyzeDistortion(partialResult.harmonicAnalysis);
    assert.ok(curves.series[0].ratios.some(Number.isFinite));
    assert.ok(curves.series[1].ratios.every(value => value === null));
    assert.ok(curves.thd.every(value => value === null));
    const reverberant = recordingFor();
    for (let i = 0; i < sweep.signal.length; i++) reverberant.data[reverberant.offset + 120 + 4800 + i] += sweep.signal[i] * 0.15;
    const longTail = analyzeEssRecording(reverberant.data, sweep, { playbackOffsetSamples: reverberant.offset });
    assert.equal(longTail.irValid, true);
    assert.ok(longTail.harmonicAnalysis.quality.reasons.includes('overlapping-tail'));
});

test('windowed impulse spectrum follows a known two-tap FIR, and windows report actual observed support', () => {
    const record = { data: new Float32Array(1024), sampleRate: 16000, onsetIndex: 64, refScale: 1 };
    record.data[64] = 1; record.data[72] = 0.5;
    const result = analyzeImpulseResponse(record, { window: 'rectangular', beforeSeconds: 1, afterSeconds: 1 });
    assert.deepEqual(result.window, { startIndex: 0, endIndex: 1024 });
    for (const [frequency, db] of result.frequencyResponse) {
        const expected = 20 * Math.log10(Math.sqrt(1.25 + Math.cos(2 * Math.PI * frequency * 8 / 16000)));
        assert.ok(Math.abs(db - expected) < 0.03);
    }
    const shorter = analyzeImpulseResponse(record, { beforeSeconds: 0.001, afterSeconds: 0.01 });
    assert.ok(shorter.resolutionHz > result.resolutionHz);
    assert.throws(() => analyzeImpulseResponse({ ...record, data: Float32Array.of(1, Infinity) }), /Invalid/);
});

test('Fourier waterfall retains common amplitude reference and rejects unobserved windows', () => {
    const rate = 16000;
    const data = Float32Array.from({ length: rate }, (_, i) => Math.exp(-i / rate / 0.2) * Math.cos(2 * Math.PI * 1000 * i / rate));
    const record = { data, sampleRate: rate, onsetIndex: 0, refScale: 1 };
    const result = analyzeWaterfall(record, { startSeconds: 0, endSeconds: 0.7, windowSeconds: 0.1, riseSeconds: 0, window: 'rectangular', maxSlices: 8 });
    const i = atFrequency(result, 1000);
    const first = result.slices[0]; const last = result.slices.at(-1);
    const expectedDrop = -20 * Math.LOG10E * (last.time - first.time) / 0.2;
    assert.ok(Math.abs(last.levels[i] - first.levels[i] - expectedDrop) < 0.01);
    assert.equal(result.resolutionHz, 10);
    assert.throws(() => analyzeWaterfall(record, { startSeconds: 0.95, endSeconds: 1, windowSeconds: 0.1 }), /No complete/);
    assert.throws(() => analyzeWaterfall(record, { endSeconds: 1.1 }), /No complete/);
});

test('module worker uses the same numerical functions off the UI thread', async t => {
    const moduleUrl = new URL('../../js/utils/measurement-dsp/analysis-worker.js', import.meta.url).href;
    const worker = new NodeWorker(`const {parentPort}=require('node:worker_threads'); global.self={postMessage:value=>parentPort.postMessage(value)}; import(${JSON.stringify(moduleUrl)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`, { eval: true });
    t.after(() => worker.terminate());
    const record = { data: Float32Array.from({ length: 1024 }, (_, i) => i === 10 ? 1 : 0), sampleRate: 16000, onsetIndex: 10 };
    const response = await new Promise((resolve, reject) => {
        const guard = setTimeout(() => reject(new Error('Worker analysis timeout')), 10000);
        worker.once('message', value => { clearTimeout(guard); resolve(value); });
        worker.once('error', error => { clearTimeout(guard); reject(error); });
        worker.postMessage({ id: 7, type: 'frequency', record, settings: { window: 'rectangular' } });
    });
    assert.equal(response.id, 7);
    assert.deepEqual(response.result, analyzeImpulseResponse(record, { window: 'rectangular' }));
});

for (const mode of ['direct', 'media-element']) {
    test(`normal ${mode} acquisition uses isolated ESS, shared analysis, and a truthful time reference`, async t => {
        const originals = { ...audioUtils };
        const globals = new Map(['document', 'Audio', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Worker'].map(key => [key, globalThis[key]]));
        t.after(() => { Object.assign(audioUtils, originals); for (const [key, value] of globals) globalThis[key] = value; });
        const timers = new Map(); let nextTimer = 1;
        globalThis.setTimeout = (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; };
        globalThis.clearTimeout = id => timers.delete(id);
        globalThis.setInterval = (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay, interval: true }); return id; };
        globalThis.clearInterval = id => timers.delete(id);
        globalThis.document = { getElementById: () => ({ value: '-6.020599913279624' }) };
        let mediaPaused = false;
        globalThis.Audio = class { async setSinkId() {} async play() {} pause() { mediaPaused = true; } };
        const recorder = { connect() {}, disconnect() {}, port: { onmessage: null, postMessage(message) {
            if (message.command === 'start') {
                this.onmessage({ data: { status: 'started' } });
                this.onmessage({ data: { status: 'capture-frame', startFrame: 0 } });
            }
        } } };
        let played;
        const context = {
            state: 'running', sampleRate: 16000, currentTime: 0,
            destination: { maxChannelCount: 2, channelCount: 2 },
            createBuffer(count, length) {
                const channels = Array.from({ length: count }, () => new Float32Array(length));
                return { getChannelData: i => channels[i], length };
            },
            createMediaStreamDestination: () => ({ stream: {}, disconnect() {} }),
            createAnalyser: () => ({ frequencyBinCount: 4, getByteTimeDomainData: data => data.fill(128), disconnect() {} }),
            createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
            createBufferSource() {
                return { connect() {}, disconnect() {}, stop() {}, start(time) {
                    played = this.buffer;
                    const recording = new Float32Array(Math.round(time * 16000) + played.length + 8000);
                    recording.set(Float32Array.from(played.getChannelData(0), x => x * 0.5), Math.round(time * 16000) + 120);
                    recorder.port.onmessage({ data: { buffer: recording } });
                    context.currentTime = time + played.length / 16000 + 1;
                } };
            }
        };
        class AnalysisWorker {
            postMessage({ record, settings }) { queueMicrotask(() => this.onmessage({ data: { result: analyzeEssRecording(record.recording, record.sweep, settings) } })); }
            terminate() {}
        }
        globalThis.Worker = AnalysisWorker;
        Object.assign(audioUtils, { audioContext: context, microphone: {}, channelGain: { connect() {} }, audioWorkletSupported: true,
            createRecorderWorkletNode: async () => recorder, getInputLevel: () => -6 });
        const controller = { ...AudioProcessing, startChannelLevelGraph() {},
            measurementConfig: { averaging: '1', audioOutputId: mode === 'direct' ? null : 'selected', outputChannel: 'left' }, activeSweepElements: null };
        const signal = { ...sweep, channels: [sweep.signal, new Float32Array(sweep.length)] };
        const pending = controller.playAndRecordSweep(signal);
        await new Promise(resolve => setImmediate(resolve));
        context.currentTime = 0.5;
        const preRoll = [...timers.values()].find(timer => timer.delay === 500);
        preRoll.fn();
        const poll = [...timers.values()].find(timer => timer.interval);
        poll.fn();
        const finish = [...timers.values()].filter(timer => timer.delay === 500).at(-1);
        finish.fn();
        const result = await pending;
        assert.equal(played.length, sweep.length + sweep.tailSamples);
        assert.ok(played.getChannelData(0).subarray(sweep.length).every(value => value === 0));
        assert.equal(result.acquisitionMethod, 'ess');
        assert.equal(result.irValid, true);
        assert.equal(result.harmonicAnalysis.quality.valid, true);
        assert.equal(result.outputTimeReference, mode === 'direct' ? 'audio-context' : 'media-element');
        if (mode === 'direct') assert.equal(result.trimStartSamples + result.onsetIndex, 120);
        else { assert.equal(result.trimStartSamples, null); assert.equal(mediaPaused, true); }
        assert.equal(timers.size, 0);
    });
}

test('cancelling analysis terminates its worker and rejects the pending acquisition', async t => {
    const original = globalThis.Worker;
    t.after(() => { globalThis.Worker = original; });
    let terminated = false;
    globalThis.Worker = class { postMessage() {} terminate() { terminated = true; } };
    const operation = { settled: false, reject() {} };
    const controller = { ...AudioProcessing, activeSweepOperation: operation, activeSweepElements: { operation } };
    const { data, offset } = recordingFor();
    const pending = controller.processRecordedBuffer(data, sweep, 1, 16000, {
        outputRoute: { mode: 'direct' }, captureStartFrame: 0, scheduledPlaybackFrame: offset
    });
    controller.cancelActiveSweep();
    await assert.rejects(pending, SweepCancelledError);
    assert.equal(terminated, true);
});
