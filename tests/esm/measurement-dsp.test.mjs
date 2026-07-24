import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import { detectOnset } from '../../js/utils/measurement-dsp/onset.js';
import { trimMeasurementImpulseResponse } from '../../js/utils/measurement-dsp/onset.js';
import { resampleWindowedSinc } from '../../js/utils/measurement-dsp/resample.js';
import {
    createLogFrequencyGrid,
    smoothFrequencyResponse
} from '../../js/utils/measurement-dsp/smoothing.js';

function referenceSmoothFrequencyResponse(frequencyResponse, sigma) {
    return frequencyResponse.map(([frequency, magnitude]) => {
        let weighted = 0;
        let weightTotal = 0;
        for (const [candidateFrequency, candidateMagnitude] of frequencyResponse) {
            const distance = Math.log2(candidateFrequency / frequency);
            const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
            weighted += candidateMagnitude * weight;
            weightTotal += weight;
        }
        return [frequency, weighted / weightTotal];
    });
}

function sineGainDb(sourceRate, targetRate, frequency) {
    const input = Float32Array.from({ length: Math.round(sourceRate * 0.125) }, (_, index) =>
        Math.sin(2 * Math.PI * frequency * index / sourceRate));
    const output = resampleWindowedSinc(input, sourceRate, targetRate);
    const trim = Math.min(1024, Math.floor(output.length / 5));
    const interior = output.subarray(trim, output.length - trim);
    const rms = samples => Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length
    );
    return 20 * Math.log10(rms(interior) / rms(input));
}

test('real FFT matches the compatible complex transform', () => {
    const input = Float64Array.from({ length: 64 }, (_, index) =>
        Math.sin(index * 0.31) + 0.25 * Math.cos(index * 0.07));
    const fft = new FFT(input.length);
    const real = new Float64Array(input.length);
    const imag = new Float64Array(input.length);
    fft.transform(real, imag, input);
    const transformed = fft.realTransform(input);
    for (let index = 0; index <= input.length / 2; index += 1) {
        assert.ok(Math.abs(transformed.real[index] - real[index]) < 1e-5);
        assert.ok(Math.abs(transformed.imag[index] - imag[index]) < 1e-5);
    }
});

test('complex FFT round-trips and smoothing retains the established data shape', () => {
    const input = Float32Array.from([1, -0.5, 0.25, 0, 0.125, 0, 0, 0]);
    const fft = new FFT(input.length);
    const real = new Float32Array(input.length);
    const imag = new Float32Array(input.length);
    fft.transform(real, imag, input);
    const output = new Float32Array(input.length);
    fft.inverseTransform(output, imag, real, imag);
    for (let index = 0; index < input.length; index += 1) {
        assert.ok(Math.abs(output[index] - input[index]) < 1e-5);
    }
    const response = [[100, 0], [200, 6], [400, 0]];
    assert.deepEqual(smoothFrequencyResponse(response, 0), response);
    assert.equal(smoothFrequencyResponse(response, 0.3)[0].length, 2);
});

test('optimized smoothing matches the reference calculation', () => {
    const frequencies = createLogFrequencyGrid(20, 20000, 0.025);
    const response = frequencies.map((frequency, index) => [
        frequency,
        4 * Math.sin(index * 0.11) - 2 * Math.cos(index * 0.037)
    ]);
    const reference = referenceSmoothFrequencyResponse(response, 0.3);
    const smoothed = smoothFrequencyResponse(response, 0.3);
    for (let index = 0; index < smoothed.length; index += 1) {
        assert.ok(Math.abs(smoothed[index][1] - reference[index][1]) < 1e-10);
    }
});

test('onset and stored IR trimming follow the shared window and overlap cap', () => {
    const samples = new Float32Array(20000);
    samples[5000] = 1;
    const onset = detectOnset(samples, 48000);
    assert.ok(onset >= 5000 && onset < 5050);
    const trimmed = trimMeasurementImpulseResponse(samples, 48000, 8192, onset);
    assert.equal(trimmed.data.length, 4096);
    assert.equal(trimmed.onsetIndex, 4096);
    assert.equal(trimmed.sweepLimited, true);
});

test('windowed-sinc resampling preserves DC and expected duration', () => {
    const input = new Float32Array(480).fill(0.25);
    const output = resampleWindowedSinc(input, 48000, 96000);
    assert.equal(output.length, 960);
    for (const sample of output.subarray(80, output.length - 80)) {
        assert.ok(Math.abs(sample - 0.25) < 1e-4);
    }
});

test('cold resampling of four full-size measurement points stays within the design budget', {
    timeout: 10000
}, () => {
    const points = Array.from({ length: 4 }, (_, pointIndex) => {
        const input = new Float32Array(262144);
        input[4096 + pointIndex] = 1;
        return input;
    });
    const startedAt = performance.now();
    const outputs = points.map(input => resampleWindowedSinc(input, 192000, 44100));
    const durationMs = performance.now() - startedAt;

    assert.ok(outputs.every(output => output.length === Math.round(262144 * 44100 / 192000)));
    assert.ok(durationMs < 3000, `four-point cold resampling took ${durationMs.toFixed(1)} ms`);
});

for (const [sourceRate, targetRate, passbandFrequency, stopbandFrequency] of [
    [96000, 48000, 20000, 30000],
    [192000, 44100, 18000, 30000]
]) {
    test(`windowed-sinc ${sourceRate} to ${targetRate} meets passband and alias rejection`, () => {
        const referenceGain = sineGainDb(sourceRate, targetRate, 1000);
        const passbandGain = sineGainDb(sourceRate, targetRate, passbandFrequency);
        const stopbandGain = sineGainDb(sourceRate, targetRate, stopbandFrequency);

        assert.ok(Math.abs(referenceGain) < 0.02, `reference gain was ${referenceGain} dB`);
        assert.ok(Math.abs(passbandGain - referenceGain) < 0.1,
            `passband ripple was ${passbandGain - referenceGain} dB`);
        assert.ok(stopbandGain <= -90, `alias rejection was only ${stopbandGain} dB`);
    });
}
