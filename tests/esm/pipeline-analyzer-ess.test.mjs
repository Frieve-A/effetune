import assert from 'node:assert/strict';
import test from 'node:test';
import { runAnalysisRequest } from '../../js/pipeline-analyzer/analysis-worker.js';
import { normalizeMeasurementSettings } from '../../js/pipeline-analyzer/mls.js';
import { createEssSignal, createEssCapturePlan, analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';

function request(processor = 'return data;', { channels = 1, speakers, levelDb = -12, averages = 1 } = {}) {
    return {
        type: 'analyze', activationEpoch: 1, runGeneration: 1,
        snapshot: {
            sampleRate: 8000, channelCount: channels, inputChannel: 0,
            outputChannels: Array.from({ length: channels }, (_, i) => i),
            plugins: [{ id: 1, type: 'EssTestPlugin', enabled: true, parameters: {},
                inputBus: 0, outputBus: 0, channel: null }],
            processors: [{ pluginType: 'EssTestPlugin', processor }], masterBypass: false,
            measurementSettings: { signalType: 'ess', sequenceLength: 32768,
                levelDb, stabilizationPeriods: 12, averagingPeriods: averages }, warmupSamples: 0
        },
        speakerResponses: speakers ?? Array(channels).fill(null)
    };
}

function nearestIndex(values, frequency) {
    return values.reduce((best, value, i) => Math.abs(value - frequency) <
        Math.abs(values[best] - frequency) ? i : best, 0);
}

test('ESS is the default signal and keeps explicit legacy signal settings', () => {
    assert.equal(normalizeMeasurementSettings().signalType, 'ess');
    assert.equal(normalizeMeasurementSettings().sequenceLength, 131072);
    assert.equal(normalizeMeasurementSettings({ signalType: 'mls' }).sequenceLength, 65535);
    assert.equal(normalizeMeasurementSettings({ signalType: 'tsp' }).sequenceLength, 65536);
});

test('ESS worker recovers linear gain, observes repetitions, and supplies waterfall without ADC clipping', async () => {
    const progress = [];
    const result = await runAnalysisRequest(request(
        'for (let i = 0; i < data.length; i++) data[i] *= 2; return data;',
        { levelDb: 0, averages: 2 }), message => progress.push(message));
    const spectrum = result.after.spectrum;
    const index = nearestIndex(spectrum.frequencies, 500);
    assert.ok(Math.abs(spectrum.magnitudeDb[index] - 20 * Math.log10(2)) < 0.03);
    assert.equal(result.after.timeOriginSamples + result.after.onsetIndex, 0);
    assert.equal(result.truncated, false);
    assert.ok(spectrum.frequencies.some((frequency, i) => frequency > 3920 && Number.isNaN(spectrum.magnitudeDb[i])));
    assert.equal(result.measurement.sweepSamples, 32768);
    assert.equal(result.measurement.stabilizationSeconds, 0);
    assert.equal(result.measurement.totalStimulusSeconds, 2 * (32768 + 20000) / 8000);
    assert.equal(progress.at(-1).processedSamples, 2 * (32768 + 20000));
    assert.equal(result.after.distortion.series.length, 9);
    const distortionIndex = nearestIndex(result.after.distortion.frequencies, 300);
    assert.ok(result.after.distortion.thd[distortionIndex] < 0.0001);
    assert.equal(result.after.distortionQuality.reasons.includes('clipping'), false);
    assert.ok(result.after.waterfall.slices.length > 1);
    assert.ok(result.before.waterfall.slices.length > 1);
});

test('ESS worker reports the actual extended sweep at a normal playback sample rate', async () => {
    const analysisRequest = request();
    analysisRequest.snapshot.sampleRate = 48000;
    const result = await runAnalysisRequest(analysisRequest);
    const expected = createEssSignal({ length: 32768, sampleRate: 48000 });
    assert.equal(result.measurement.sweepSamples, expected.length);
    assert.ok(result.measurement.sweepSamples > analysisRequest.snapshot.measurementSettings.sequenceLength);
    assert.equal(result.measurement.durationSeconds, expected.durationSeconds);
    assert.equal(result.measurement.totalStimulusSeconds, (expected.length + expected.tailSamples) / 48000);
    assert.equal(result.truncated, false);
});

test('ESS distortion follows nonlinear output summation and speaker phase and gain', async () => {
    const result = await runAnalysisRequest(request(`
        for (let i = 0; i < parameters.blockSize; i++) {
            const x = data[i];
            data[i] = x + 0.2 * x * x;
            data[parameters.blockSize + i] = x - 0.2 * x * x;
        }
        return data;
    `, { channels: 2, speakers: [null, {
        samples: new Float32Array([0, 0.5]), sampleRate: 8000, onsetIndex: 0, refScale: 1
    }] }));
    const distortion = result.after.distortion;
    const index = nearestIndex(distortion.frequencies, 300);
    const phase = 2 * Math.PI * distortion.frequencies[index] / 8000;
    const fundamental = Math.hypot(1 + 0.5 * Math.cos(phase), 0.5 * Math.sin(phase));
    const harmonic = Math.hypot(1 - 0.5 * Math.cos(2 * phase), 0.5 * Math.sin(2 * phase));
    const expected = 0.1 * 10 ** (-12 / 20) * harmonic / fundamental;
    assert.ok(Math.abs(distortion.series[0].ratios[index] / expected - 1) < 0.03,
        `H2 ${distortion.series[0].ratios[index]} / ${expected}`);
    assert.equal(result.before.impulse[0], 1);
    assert.equal(result.before.impulse[1], 0.5);
    assert.ok(Math.abs(result.after.spectrum.magnitudeDb[
        nearestIndex(result.after.spectrum.frequencies, 300)] - 20 * Math.log10(fundamental)) < 0.05);
});

test('ESS exact output cancellation produces a silent response with unavailable distortion', async () => {
    const result = await runAnalysisRequest(request(`
        for (let i = 0; i < parameters.blockSize; i++) data[parameters.blockSize + i] = -data[i];
        return data;
    `, { channels: 2 }));
    assert.equal(result.after.impulse.every(value => value === 0), true);
    assert.equal(result.after.distortion, null);
    assert.equal(result.after.distortionUnavailableReason, 'no-response');
    assert.equal(result.after.waterfall, undefined);
    assert.ok(result.before.waterfall.slices.length > 1);
});

test('Waterfall preserves the direct arrival at zero time for every signal and both sources', async () => {
    const speaker = new Float32Array(8000);
    speaker[16] = 1;
    for (const signalType of ['ess', 'mls', 'tsp', 'impulse']) {
        for (const speakers of [[null], [{ samples: speaker, sampleRate: 8000, onsetIndex: 16, refScale: 1 }]]) {
            const analysisRequest = request('return data;', { speakers });
            Object.assign(analysisRequest.snapshot.measurementSettings, {
                signalType, sequenceLength: signalType === 'mls' ? 32767 : 32768, stabilizationPeriods: 1
            });
            const result = await runAnalysisRequest(analysisRequest);
            for (const source of ['before', 'after']) {
                const waterfall = result[source].waterfall;
                const first = waterfall.slices[0];
                const label = `${signalType} ${source} speaker preroll ${speakers[0]?.onsetIndex ?? 0}`;
                assert.ok(Math.abs(first.time) < 1e-12, `${label}: first slice ${first.time}`);
                const level = first.levels[nearestIndex(waterfall.frequencies, 500)];
                assert.ok(Math.abs(level) < 0.04, `${label}: direct level ${level} dB`);
            }
        }
    }
});

test('ESS muted output has no Waterfall while its Before response remains available', async () => {
    const result = await runAnalysisRequest(request('data.fill(0); return data;'));
    assert.equal(result.after.impulse.every(value => value === 0), true);
    assert.equal(result.after.waterfall, undefined);
    assert.ok(result.before.waterfall);
});

test('ESS flags an observed echo beyond the saved response window', async () => {
    const result = await runAnalysisRequest(request(`
        if (!context.delay) { context.delay = new Float32Array(16000); context.position = 0; }
        for (let i = 0; i < data.length; i++) {
            const x = data[i];
            data[i] += 0.5 * context.delay[context.position];
            context.delay[context.position] = x;
            context.position = (context.position + 1) % context.delay.length;
        }
        return data;
    `));
    assert.equal(result.truncated, true);
});

test('shared ESS keeps ADC clipping detection by default and accepts explicit offline floating-point captures', () => {
    const sweep = createEssSignal({ length: 16384, sampleRate: 8000, endFrequency: 3000 });
    const plan = createEssCapturePlan(sweep, 1);
    const recording = new Float32Array(plan.playbackSamples);
    recording.set(Float32Array.from(sweep.signal, value => value * 2));
    const options = { playbackOffsetSamples: 0 };
    const measured = analyzeEssRecording(recording, sweep, options);
    const offline = analyzeEssRecording(recording, sweep, { ...options, detectClipping: false });
    assert.equal(measured.harmonicAnalysis.quality.reasons.includes('clipping'), true);
    assert.equal(offline.harmonicAnalysis.quality.reasons.includes('clipping'), false);
    assert.deepEqual(measured.data, offline.data);
});
