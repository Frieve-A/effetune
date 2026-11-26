import assert from 'node:assert/strict';
import test from 'node:test';
import { createEssSignal, createEssCapturePlan, analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';
import { analyzeDistortion, validateHarmonicAnalysis } from '../../js/utils/measurement-dsp/analysis.js';
import { DataStorage } from '../../features/measurement/dataStorage.js';
import AudioProcessing from '../../features/measurement/measurement-controller/audio-processing.js';
import { ANDROID_ORIGIN, bytesToBase64 } from '../../js/android/bridge.js';

test('Android sweep preserves overload status when analysis transfers the recording', async () => {
    const previous = { window: globalThis.window, document: globalThis.document, Worker: globalThis.Worker };
    let peak;
    let transfers = 0;
    const transport = { postMessage(raw) {
        const request = JSON.parse(raw);
        let result = {};
        if (request.command === 'measurement.status') result = { status: 'complete' };
        if (request.command === 'measurement.read') {
            const samples = new Float32Array(20);
            samples[8] = samples[9] = peak;
            result = { data: bytesToBase64(new Uint8Array(samples.buffer)), frames: 10, channels: 2, sampleRate: 8 };
        }
        queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: true, result }) }));
    } };
    globalThis.window = { location: { origin: ANDROID_ORIGIN }, effetuneAndroid: transport };
    globalThis.document = { getElementById: () => ({ value: '0' }) };
    globalThis.Worker = class {
        postMessage(message, transfer) {
            const received = structuredClone(message, { transfer });
            assert.equal(message.record.recording.byteLength, 0);
            assert.equal(received.record.recording.length, 10);
            transfers++;
            queueMicrotask(() => this.onmessage({ data: { result: {
                data: new Float32Array([1]), frequencyResponse: { frequencies: [1], magnitudes: [0] }
            } } }));
        }
        terminate() {}
    };
    try {
        const controller = { ...AudioProcessing, startChannelLevelGraph() {}, measurementConfig: { averaging: 1 }, activeSweepElements: {} };
        const sweep = { sampleRate: 8, length: 2, tailSamples: 0,
            channels: [new Float32Array([0.5, -0.5]), new Float32Array([0.5, -0.5])] };
        for (peak of [0.25, 1]) {
            const result = await controller.playAndRecordSweep(sweep);
            assert.equal(result.hasOverload, peak === 1);
            assert.deepEqual(result.impulseResponse, new Float32Array([1]));
            assert.equal(result.sampleRate, 8);
            assert.equal(controller.nativeMeasurementAbort, null);
        }
        assert.equal(transfers, 2);
    } finally {
        globalThis.window = previous.window;
        globalThis.document = previous.document;
        globalThis.Worker = previous.Worker;
    }
});

function harmonicCapture(sweep, repetitions) {
    const plan = createEssCapturePlan(sweep, repetitions);
    const offset = Math.round(0.55 * sweep.sampleRate);
    const recording = new Float32Array(offset + plan.playbackSamples + sweep.sampleRate / 2);
    const samples = Float32Array.from(sweep.signal, (sample, i) => {
        const phase = 2 * Math.PI * sweep.startFrequency * sweep.sweepConstant *
            Math.expm1(i / (sweep.sampleRate * sweep.sweepConstant));
        const frequency = sweep.startFrequency * Math.exp(i / (sweep.sampleRate * sweep.sweepConstant));
        const envelope = i < sweep.fadeSamples ? 0.5 - 0.5 * Math.cos(Math.PI * i / sweep.fadeSamples)
            : i >= sweep.length - sweep.fadeSamples
                ? 0.5 - 0.5 * Math.cos(Math.PI * (sweep.length - 1 - i) / sweep.fadeSamples) : 1;
        for (let order = 2; order <= 10; order++) {
            // The synthetic analog output must not fold ultrasonic harmonics
            // back into the measured band through digital aliasing.
            const transition = (frequency * order - sweep.sampleRate * 0.4) / (sweep.sampleRate * 0.05);
            const band = transition <= 0 ? 1 : transition >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * transition);
            sample += 0.01 * Math.sin(order * phase + (1 - order) * Math.PI / 2) * envelope ** order * band;
        }
        return sample * 0.35;
    });
    for (let repeat = 0; repeat < repetitions; repeat++) {
        recording.set(samples, offset + repeat * plan.intervalSamples + 120);
    }
    return { recording, settings: { playbackOffsetSamples: offset, repetitions, levelDb: 20 * Math.log10(0.35) } };
}

function rawBytes(record) {
    return record.data.byteLength + record.harmonicAnalysis.orders.reduce((sum, order) => sum +
        order.data.byteLength + order.referenceData.byteLength + (order.harmonicReferenceData?.byteLength || 0), 0);
}

async function verifyStereoCodec(record) {
    const channels = ['left', 'right'];
    const measurement = {
        id: 'higher-order-stereo', name: 'Higher orders', outputChannel: 'multi', outputChannels: channels,
        points: [{ pointId: 0, channels: channels.map((channel, index) => ({ channel, irId: index + 1,
            frequencyResponse: record.frequencyResponse, ir: { stored: true } })) }],
        channelResponses: channels.map(channel => ({ channel, averageFrequencyResponse: record.frequencyResponse }))
    };
    const source = new DataStorage({ backupBridge: null });
    source.measurements = [measurement];
    const records = channels.map((channel, index) => ({ ...record, channel, measurementId: measurement.id, pointId: index + 1 }));
    source.getImpulseResponses = async () => records;
    const json = await source.exportMeasurementToJSON(measurement.id);
    const target = new DataStorage({ backupBridge: null });
    target.generateId = () => 'higher-order-import';
    let restored;
    target.addMeasurement = async (metadata, decoded) => { restored = decoded; return metadata.id; };
    assert.equal(await target.importMeasurementFromJSON(json), 'higher-order-import');
    assert.equal(restored.length, 2);
    for (const imported of restored) {
        assert.deepEqual(imported.data, record.data);
        assert.deepEqual(imported.harmonicAnalysis, record.harmonicAnalysis);
        assert.equal(validateHarmonicAnalysis(imported.harmonicAnalysis), true);
    }
    // Two default 96 kHz channels remain below 5 MB raw / 7 MB JSON,
    // including every measured and normalization reference array.
    assert.ok(2 * rawBytes(record) < 5_000_000);
    assert.ok(Buffer.byteLength(json) < 7_000_000);
}

test('ESS captures H2-H10 without extending playback or changing existing H1-H3 data', async () => {
    for (const sampleRate of [48000, 96000]) {
        const sweep = createEssSignal({ sampleRate });
        assert.equal(sweep.maxOrder, 10);
        assert.equal(sweep.length, sampleRate === 48000 ? 131072 : 163552);
        assert.equal(createEssCapturePlan(sweep, 4).playbackSamples,
            4 * (sweep.length + Math.ceil(2.5 * sampleRate)));
        const capture = harmonicCapture(sweep, sampleRate === 96000 ? 4 : 1);
        const result = analyzeEssRecording(capture.recording, sweep, capture.settings);
        assert.equal(validateHarmonicAnalysis(result.harmonicAnalysis), true);
        assert.deepEqual(result.harmonicAnalysis.quality, { valid: true, reasons: [] });
        const legacy = analyzeEssRecording(capture.recording, { ...sweep, maxOrder: 3 }, capture.settings);
        assert.deepEqual(result.data, legacy.data);
        assert.deepEqual(result.harmonicAnalysis.orders.slice(0, 3), legacy.harmonicAnalysis.orders);
        assert.deepEqual(analyzeDistortion(result.harmonicAnalysis), analyzeDistortion(legacy.harmonicAnalysis));

        const curves = analyzeDistortion(result.harmonicAnalysis, {
            harmonicLimit: 10, maxOrder: 10, beforeSeconds: 0.002, afterSeconds: 0.02
        });
        assert.equal(curves.series.length, 9);
        for (const frequency of [100, 300, 500, 1000, 1500]) {
            const i = curves.frequencies.findIndex(f => f >= frequency);
            for (const series of curves.series) {
                assert.ok(Math.abs(series.ratios[i] / 0.01 - 1) < 0.005,
                    `${sampleRate} Hz H${series.order} at ${curves.frequencies[i]} Hz: ${series.ratios[i]}`);
            }
            assert.ok(Math.abs(curves.thd[i] / 0.03 - 1) < 0.005);
        }
        const tenth = result.harmonicAnalysis.orders[9];
        assert.equal(tenth.onsetIndex / sampleRate, 0.002);
        assert.ok((tenth.data.length - tenth.onsetIndex) / sampleRate >= 0.02);
        assert.ok(curves.series[8].ratios[curves.frequencies.findIndex(f => f >= 2100)] === null);
        assert.ok(curves.series[8].ratios.some(value => value === null));
        if (sampleRate === 96000) await verifyStereoCodec(result);
    }
});


test('ESS retains an earlier linear arrival when a later echo is stronger', () => {
    const sweep = createEssSignal();
    const repetitions = 2;
    const plan = createEssCapturePlan(sweep, repetitions);
    const offset = Math.round(0.55 * sweep.sampleRate);
    const delay = 120;
    const echoDelay = 2400;
    const recording = new Float32Array(offset + plan.playbackSamples + sweep.sampleRate / 2);
    for (let repeat = 0; repeat < repetitions; repeat++) {
        const start = offset + repeat * plan.intervalSamples + delay;
        for (let i = 0; i < sweep.length; i++) {
            recording[start + i] += 0.2 * sweep.signal[i];
            recording[start + echoDelay + i] += 0.4 * sweep.signal[i];
        }
    }
    const result = analyzeEssRecording(recording, sweep, {
        repetitions, playbackOffsetSamples: offset, outputTimeReference: 'audio-context',
        levelDb: 20 * Math.log10(0.4)
    });
    assert.equal(result.trimStartSamples + result.onsetIndex, delay + echoDelay);
    assert.equal(result.prerollSamples, result.onsetIndex);
    const [linear, second] = result.harmonicAnalysis.orders;
    const harmonicGap = Math.round(sweep.sweepConstant * Math.log(2) * sweep.sampleRate);
    assert.equal(linear.onsetIndex, Math.floor(harmonicGap / 2));
    assert.equal(-harmonicGap + second.data.length - second.onsetIndex, -linear.onsetIndex);
    assert.equal(result.irValid, true);
    assert.deepEqual(result.harmonicAnalysis.quality.reasons, ['overlapping-tail']);
    // Both paths survive with the stronger, later tap as the time origin.
    // Finite bandwidth broadens each tap, so compare their measured peak ratio.
    const tapRatio = result.data[result.onsetIndex - echoDelay] / result.data[result.onsetIndex];
    assert.ok(Math.abs(tapRatio - 0.5) < 0.1, `Retained tap ratio: ${tapRatio}`);
    // The finite separation window must retain the two-path comb response.
    // The old peak crop discarded the earlier path and yielded unity here.
    for (const frequency of [100, 1010, 1020, 3000]) {
        let real = 0;
        let imaginary = 0;
        for (let i = 0; i < result.data.length; i++) {
            const phase = 2 * Math.PI * frequency * (i - result.onsetIndex) / sweep.sampleRate;
            real += result.data[i] * Math.cos(phase);
            imaginary -= result.data[i] * Math.sin(phase);
        }
        const phase = 2 * Math.PI * frequency * echoDelay / sweep.sampleRate;
        const expected = Math.hypot(1 + 0.5 * Math.cos(phase), 0.5 * Math.sin(phase));
        const errorDb = 20 * Math.log10(Math.hypot(real, imaginary) / expected);
        assert.ok(Math.abs(errorDb) < 0.1, `${frequency} Hz error: ${errorDb} dB`);
    }
    // This flagged overlapping response has a finite-separation residual;
    // bound linear leakage below -60 dB without claiming zero distortion.
    const distortion = analyzeDistortion(result.harmonicAnalysis, {
        harmonicLimit: 10, maxOrder: 10, beforeSeconds: 0.002, afterSeconds: 0.02
    });
    assert.ok(Math.max(...distortion.thd.filter(Number.isFinite)) < 0.001);
});


test('ESS timing rejects deterministic narrow-band pre-ringing before a delayed linear path', () => {
    for (const endFrequency of [50, 100, 200]) {
        const sweep = createEssSignal({ endFrequency });
        const offset = Math.round(0.55 * sweep.sampleRate);
        const delay = 4800;
        const gain = 0.4;
        const recording = new Float32Array(offset + sweep.length + sweep.tailSamples + sweep.sampleRate / 2);
        recording.set(Float32Array.from(sweep.signal, value => value * gain), offset + delay);
        const result = analyzeEssRecording(recording, sweep, {
            playbackOffsetSamples: offset, outputTimeReference: 'audio-context', levelDb: 20 * Math.log10(gain)
        });
        assert.equal(result.trimStartSamples + result.onsetIndex, delay, `${endFrequency} Hz timing`);
        for (const [frequency, db] of result.frequencyResponse) {
            assert.ok(Math.abs(db) < 0.001, `${endFrequency} Hz sweep at ${frequency} Hz: ${db} dB`);
        }
    }
});


test('ESS preserves peak timing and flat gain with ordinary low-level recording noise', () => {
    const sweep = createEssSignal();
    const offset = Math.round(0.55 * sweep.sampleRate);
    const delay = 4800;
    const gain = 0.4;
    let seed = 123456789;
    const recording = Float32Array.from({ length: offset + sweep.length + sweep.tailSamples + sweep.sampleRate / 2 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 2 ** 32 * 2 - 1) * 0.0001;
    });
    for (let i = 0; i < sweep.length; i++) recording[offset + delay + i] += sweep.signal[i] * gain;
    const result = analyzeEssRecording(recording, sweep, {
        playbackOffsetSamples: offset, outputTimeReference: 'audio-context', levelDb: 20 * Math.log10(gain)
    });
    assert.equal(result.trimStartSamples + result.onsetIndex, delay);
    for (const [frequency, db] of result.frequencyResponse) {
        assert.ok(Math.abs(db) < 0.006, `${frequency} Hz: ${db} dB`);
    }
});

function analyzeClockCapture(sweep, { ratio = 1, delay = 120, inserted = 0, repetitions = 2, reflection = 0 } = {}) {
    const plan = createEssCapturePlan(sweep, repetitions);
    const offset = Math.round(0.55 * sweep.sampleRate);
    const recording = new Float32Array(offset + plan.playbackSamples + sweep.sampleRate / 2);
    for (let repeat = 0; repeat < repetitions; repeat++) {
        const start = repeat * plan.intervalSamples + delay;
        for (let i = Math.ceil(start * ratio); i < (start + sweep.length - 1) * ratio; i++) {
            // Sample the analytic sweep directly on the recording clock to preserve the fixture's upper band.
            const t = i / ratio - start;
            const phase = 2 * Math.PI * sweep.startFrequency * sweep.sweepConstant *
                Math.expm1(t / (sweep.sampleRate * sweep.sweepConstant));
            const fade = Math.min(t, sweep.length - 1 - t, sweep.fadeSamples);
            const index = offset + i + repeat * inserted;
            const sample = 0.25 * (1 - Math.cos(Math.PI * fade / sweep.fadeSamples)) * Math.sin(phase);
            recording[index] += sample;
            recording[index + 1] += reflection * sample;
        }
    }
    return analyzeEssRecording(recording, sweep, {
        repetitions, playbackOffsetSamples: offset, outputTimeReference: 'audio-context', levelDb: 20 * Math.log10(0.5)
    });
}

test('ESS clock correction preserves the measured band near Nyquist', () => {
    const sweep = createEssSignal({ endFrequency: 23520 });
    const result = analyzeClockCapture(sweep, { ratio: 1.0001 });
    assert.deepEqual(result.harmonicAnalysis.quality, { valid: true, reasons: [] });
    assert.equal(result.trimStartSamples + result.onsetIndex, 120);
    const upperBand = result.frequencyResponse.filter(([frequency]) => frequency > 22800);
    assert.ok(upperBand.length >= 2);
    for (const [frequency, db] of upperBand) assert.ok(Math.abs(db) < 0.02, `${frequency} Hz: ${db} dB`);
});

test('ESS keeps early repetitions when the recording clock runs slow', () => {
    const result = analyzeClockCapture(createEssSignal(), { ratio: 0.9998, delay: 60, repetitions: 4 });
    assert.deepEqual(result.harmonicAnalysis.quality, { valid: true, reasons: [] });
    assert.equal(result.recordingGaps, undefined);
    assert.equal(result.trimStartSamples + result.onsetIndex, 60);
    for (const [frequency, db] of result.frequencyResponse) assert.ok(Math.abs(db) < 0.02, `${frequency} Hz: ${db} dB`);
});

test('ESS keeps the original time scale when a silence insertion shifts the second sweep', () => {
    const sweep = createEssSignal();
    for (const [delay, inserted] of [[120, 240], [120.5, 3]]) {
        const result = analyzeClockCapture(sweep, { delay, inserted });
        assert.ok(Math.abs(result.trimStartSamples + result.onsetIndex - delay) <= 0.5);
        assert.equal(result.recordingGaps, undefined);
        assert.deepEqual(result.harmonicAnalysis.quality.reasons, ['clock-drift']);
        for (const [frequency, db] of result.frequencyResponse) assert.ok(Math.abs(db) < 0.01, `${frequency} Hz: ${db} dB`);
    }
});

test('ESS keeps a reflected response on the original clock after an integer shift between sweeps', () => {
    const sweep = createEssSignal();
    const path = { delay: 115.1, reflection: -5 / 11 };
    const reference = analyzeClockCapture(sweep, { ...path, repetitions: 1 });
    for (const inserted of [3, 5, 8]) {
        const result = analyzeClockCapture(sweep, { ...path, inserted });
        assert.equal(result.trimStartSamples + result.onsetIndex, reference.trimStartSamples + reference.onsetIndex);
        assert.deepEqual(result.harmonicAnalysis.quality, { valid: false, reasons: ['clock-drift'] });
        assert.equal(result.recordingGaps, undefined);
    }
});

test('ESS corrects a measurable small clock difference from two sweeps', () => {
    const sweep = createEssSignal();
    for (const ratio of [0.99999, 1.00001]) {
        const result = analyzeClockCapture(sweep, { ratio });
        assert.deepEqual(result.harmonicAnalysis.quality, { valid: true, reasons: [] });
        assert.equal(result.trimStartSamples + result.onsetIndex, 120);
        for (const [frequency, db] of result.frequencyResponse) assert.ok(Math.abs(db) < 0.02, `${frequency} Hz: ${db} dB`);
    }
});

test('ESS excludes silent repetitions and counts them against the original capture', () => {
    const sweep = createEssSignal({ length: 4096, sampleRate: 8000, startFrequency: 40, endFrequency: 3000 });
    const plan = createEssCapturePlan(sweep, 4);
    const recording = new Float32Array(plan.playbackSamples);
    const analyze = repetitions => analyzeEssRecording(recording, sweep, { repetitions, playbackOffsetSamples: 0 });
    assert.throws(() => analyze(1), /No usable ESS response/);
    assert.throws(() => analyze(4), /No usable ESS response/);

    const played = Float32Array.from(sweep.signal, sample => sample * 0.5);
    for (const repeat of [0, 1, 3]) recording.set(played, repeat * plan.intervalSamples);
    const reference = analyze(1);
    const corrected = analyze(4);
    assert.equal(corrected.recordingGaps, 'corrected');
    assert.deepEqual(corrected.harmonicAnalysis.quality, reference.harmonicAnalysis.quality);
    assert.ok(Math.abs(corrected.peakDb - reference.peakDb) < 0.001);

    recording.fill(0, 3 * plan.intervalSamples);
    assert.equal(analyze(4).recordingGaps, 'interrupted');
});

test('ESS averages only the repetitions whose capture did not slip', () => {
    const sweep = createEssSignal();
    const offset = Math.round(0.55 * sweep.sampleRate);
    const delay = 120;
    const gain = 0.4;
    const played = Float32Array.from(sweep.signal, value => value * gain);
    // The input path drops 10 ms of samples and later inserts 10 ms of silence.
    const lost = Math.round(0.01 * sweep.sampleRate);
    const removeAt = Math.round(0.3 * sweep.length);
    const insertAt = Math.round(0.6 * sweep.length);
    const slipped = new Float32Array(played.length);
    slipped.set(played.subarray(0, removeAt));
    slipped.set(played.subarray(removeAt + lost, insertAt), removeAt);
    slipped.set(played.subarray(insertAt), insertAt);
    // gapBefore: silence inserted into the gap before that repetition shift it and all later ones.
    // hum: a low tone that is not locked to the repetition interval, so it differs between repetitions.
    const analyze = (slippedRepeats, noise, { repetitions = 4, gapBefore = repetitions, hum = 0 } = {}) => {
        const plan = createEssCapturePlan(sweep, repetitions);
        let seed = 987654321;
        const recording = Float32Array.from({ length: offset + plan.playbackSamples + sweep.sampleRate / 2 }, (_, i) => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return (seed / 2 ** 32 * 2 - 1) * noise + hum * Math.sin(2 * Math.PI * 27.3 * i / sweep.sampleRate);
        });
        for (let repeat = 0; repeat < repetitions; repeat++) {
            const source = slippedRepeats.includes(repeat) ? slipped : played;
            const start = offset + repeat * plan.intervalSamples + delay + (repeat >= gapBefore ? lost : 0);
            for (let i = 0; i < source.length; i++) recording[start + i] += source[i];
        }
        return analyzeEssRecording(recording, sweep, {
            repetitions, playbackOffsetSamples: offset, outputTimeReference: 'audio-context', levelDb: 20 * Math.log10(gain)
        });
    };
    const clean = analyze([], 0.0001);
    assert.equal(clean.recordingGaps, undefined);

    const corrected = analyze([2], 0.0001);
    assert.equal(corrected.recordingGaps, 'corrected');
    assert.deepEqual(corrected.harmonicAnalysis.quality, clean.harmonicAnalysis.quality);
    assert.equal(corrected.trimStartSamples, clean.trimStartSamples);
    corrected.frequencyResponse.forEach(([frequency, db], i) => {
        assert.ok(Math.abs(db - clean.frequencyResponse[i][1]) < 0.01, `${frequency} Hz: ${db} dB`);
    });

    // Repetitions that differ only by their noise all count, however loud the noise is.
    const noisy = analyze([], 0.02);
    assert.equal(noisy.recordingGaps, undefined);
    assert.ok(!noisy.harmonicAnalysis.quality.reasons.includes('inconsistent-capture'));

    const interrupted = analyze([1, 2], 0.0001);
    assert.equal(interrupted.recordingGaps, 'interrupted');
    assert.ok(interrupted.harmonicAnalysis.quality.reasons.includes('inconsistent-capture'));

    // A slip in the silent gap moves later repetitions without changing their responses;
    // the delay stays that of the earliest repetition.
    const gapSlip = analyze([], 0.0001, { gapBefore: 2 });
    assert.equal(gapSlip.recordingGaps, undefined);
    assert.equal(gapSlip.trimStartSamples, clean.trimStartSamples);

    // Two repetitions have no noise estimate of their own: hum that differs by about 4 % in the
    // lowest octave, but far below 1 % over the whole band, does not count as a disturbance.
    const twoHum = analyze([], 0.0001, { repetitions: 2, hum: 0.05 });
    assert.equal(twoHum.recordingGaps, undefined);
    assert.ok(!twoHum.harmonicAnalysis.quality.reasons.includes('inconsistent-capture'));
    assert.equal(analyze([1], 0.0001, { repetitions: 2 }).recordingGaps, 'interrupted');
});
