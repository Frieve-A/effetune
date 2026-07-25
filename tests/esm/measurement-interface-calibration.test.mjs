import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
    applyInterfaceCalibration
} from '../../js/utils/measurement-dsp/interface-calibration.js';

function storedImpulse(origin, length, onsetIndex, extra = {}) {
    const data = new Float32Array(length);
    for (let index = 0; index < origin.length && onsetIndex + index < length; index += 1) {
        data[onsetIndex + index] = origin[index];
    }
    return {
        data,
        onsetIndex,
        prerollSamples: onsetIndex,
        refScale: 1,
        ...extra
    };
}

function convolve(left, right) {
    const output = new Float64Array(left.length + right.length - 1);
    for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
        for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
            output[leftIndex + rightIndex] += left[leftIndex] * right[rightIndex];
        }
    }
    return output;
}

function medianSpectrumMagnitude(origin, fftSize, firstBin, lastBin) {
    const fft = new FFT(fftSize);
    const input = new Float64Array(fftSize);
    input.set(origin);
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);
    fft.transform(real, imag, input);
    const magnitudes = [];
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
        magnitudes.push(Math.hypot(real[bin], imag[bin]));
    }
    magnitudes.sort((left, right) => left - right);
    const middle = Math.floor(magnitudes.length / 2);
    return magnitudes.length % 2
        ? magnitudes[middle]
        : (magnitudes[middle - 1] + magnitudes[middle]) / 2;
}

function assertSamplesClose(actual, expected, tolerance = 2e-4) {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index += 1) {
        assert.ok(
            Math.abs(actual[index] - expected[index]) <= tolerance,
            `sample ${index}: expected ${expected[index]}, received ${actual[index]}`
        );
    }
}

test('unit interface calibration preserves normalized IR samples and real preroll', () => {
    const measured = storedImpulse([1, 0.4, -0.2], 32, 6, { refScale: 0.5 });
    measured.data[4] = 0.15;
    const calibration = storedImpulse([1], 16, 3);
    const result = applyInterfaceCalibration(measured, calibration, {
        sampleRate: 64,
        minFrequency: 1,
        maxFrequency: 31
    });

    const expected = Float32Array.from(measured.data, sample => sample / 0.5);
    assertSamplesClose(result.data, expected);
    assert.equal(result.onsetIndex, 6);
    assert.equal(result.prerollSamples, 6);
    assert.equal(result.refScale, 1);
});

test('complex division recovers a known transfer function in amplitude and phase', () => {
    const length = 64;
    const sampleRate = 128;
    const targetOrigin = Float64Array.from([0.8, -0.25, 0, 0, 0.1]);
    const allPassCoefficient = 0.4;
    const interfaceShape = new Float64Array(24);
    interfaceShape[0] = -allPassCoefficient;
    for (let index = 1; index < interfaceShape.length; index += 1) {
        interfaceShape[index] = (1 - allPassCoefficient * allPassCoefficient) *
            allPassCoefficient ** (index - 1);
    }
    const interfaceMedian = medianSpectrumMagnitude(interfaceShape, 128, 1, 63);
    const normalizedInterface = Float64Array.from(
        interfaceShape,
        sample => sample / interfaceMedian
    );
    const measuredOrigin = convolve(targetOrigin, normalizedInterface);
    const measured = storedImpulse(measuredOrigin, length, 10);
    const calibration = storedImpulse(normalizedInterface, length, 4);
    const result = applyInterfaceCalibration(measured, calibration, {
        sampleRate,
        minFrequency: 1,
        maxFrequency: 64
    });
    const expected = storedImpulse(targetOrigin, length, 10).data;

    assertSamplesClose(result.data, expected, 5e-4);
    assert.equal(result.onsetIndex, 10);
});

test('calibration gain is normalized without changing the corrected shape or level', () => {
    const measured = storedImpulse([0.8, 0.2, -0.1], 64, 8);
    const calibration = storedImpulse([1, 0.25], 64, 5);
    const louderCalibration = {
        ...calibration,
        data: Float32Array.from(calibration.data, sample => sample * 12)
    };
    const options = { sampleRate: 128, minFrequency: 1, maxFrequency: 63 };
    const reference = applyInterfaceCalibration(measured, calibration, options);
    const louder = applyInterfaceCalibration(measured, louderCalibration, options);

    assertSamplesClose(louder.data, reference.data, 2e-5);
});

test('regularization bounds a deep calibration notch and keeps every output finite', () => {
    const measured = storedImpulse([1, 0.5, -0.25], 128, 12);
    const calibration = storedImpulse([1, -1], 128, 7);
    const result = applyInterfaceCalibration(measured, calibration, {
        sampleRate: 256,
        minFrequency: 1,
        maxFrequency: 127
    });

    let peak = 0;
    for (const sample of result.data) {
        assert.equal(Number.isFinite(sample), true);
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > peak) peak = magnitude;
    }
    assert.ok(peak < 100);
    assert.equal(Number.isFinite(result.peakDb), true);
});

test('invalid onset and empty calibration records are rejected', () => {
    const measured = storedImpulse([1], 8, 2);
    assert.throws(() => applyInterfaceCalibration(measured, {
        data: new Float32Array(),
        onsetIndex: 0
    }, {
        sampleRate: 48000,
        minFrequency: 20,
        maxFrequency: 20000
    }), /calibration impulse response is invalid/i);
    assert.throws(() => applyInterfaceCalibration({
        data: Float32Array.from([1]),
        onsetIndex: 2
    }, storedImpulse([1], 8, 2), {
        sampleRate: 48000,
        minFrequency: 20,
        maxFrequency: 20000
    }), /measured impulse response is invalid/i);
});
