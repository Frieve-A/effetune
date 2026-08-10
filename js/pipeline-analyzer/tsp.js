import FFT from '../utils/measurement-dsp/fft.js';

export const PIPELINE_ANALYZER_TSP_LENGTHS = Object.freeze([
    32768,
    65536,
    131072,
    262144,
    524288
]);

function validateLength(sequenceLength) {
    if (!PIPELINE_ANALYZER_TSP_LENGTHS.includes(sequenceLength)) {
        throw new TypeError('Unsupported TSP sequence length');
    }
}

function buildSpectrum(sequenceLength) {
    const half = sequenceLength / 2;
    const real = new Float64Array(half + 1);
    const imag = new Float64Array(half + 1);
    for (let bin = 1; bin < half; bin += 1) {
        const angle = -2 * Math.PI * ((bin * bin) % sequenceLength) / sequenceLength;
        real[bin] = Math.cos(angle);
        imag[bin] = Math.sin(angle);
    }
    real[half] = 1;
    return { real, imag };
}

export function generateTspSequence(sequenceLength, amplitude = 1) {
    validateLength(sequenceLength);
    if (!(Number.isFinite(amplitude) && amplitude > 0 && amplitude <= 1)) {
        throw new TypeError('TSP amplitude must be finite and in (0, 1]');
    }
    const fft = new FFT(sequenceLength);
    const spectrum = buildSpectrum(sequenceLength);
    const unscaled = fft.inverseRealTransform(spectrum.real, spectrum.imag);
    let peak = 0;
    for (let index = 0; index < unscaled.length; index += 1) {
        const value = unscaled[index];
        const magnitude = value < 0 ? -value : value;
        if (magnitude > peak) peak = magnitude;
    }
    if (!(peak > 0 && Number.isFinite(peak))) {
        throw new Error('TSP generator produced an invalid sequence');
    }
    let signalGain = amplitude / peak;
    const sequence = new Float32Array(sequenceLength);
    let storedPeak = 0;
    for (let index = 0; index < sequence.length; index += 1) {
        const value = unscaled[index] * signalGain;
        sequence[index] = value;
        const stored = sequence[index];
        const magnitude = stored < 0 ? -stored : stored;
        if (magnitude > storedPeak) storedPeak = magnitude;
    }
    if (!(storedPeak > 0 && Number.isFinite(storedPeak))) {
        throw new Error('TSP generator produced an invalid scaled sequence');
    }
    const correction = amplitude / storedPeak;
    if (correction !== 1) {
        signalGain *= correction;
        for (let index = 0; index < sequence.length; index += 1) sequence[index] *= correction;
    }

    const inverseImag = new Float64Array(spectrum.imag.length);
    for (let bin = 0; bin < inverseImag.length; bin += 1) inverseImag[bin] = -spectrum.imag[bin];
    const inverse = fft.inverseRealTransform(spectrum.real, inverseImag);
    return Object.freeze({ sequence, inverse, signalGain });
}
