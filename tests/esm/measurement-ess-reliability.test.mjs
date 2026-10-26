import assert from 'node:assert/strict';
import test from 'node:test';
import { createEssSignal, createEssCapturePlan, analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';
import { analyzeDistortion, validateHarmonicAnalysis } from '../../js/utils/measurement-dsp/analysis.js';
import { DataStorage } from '../../features/measurement/dataStorage.js';

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
