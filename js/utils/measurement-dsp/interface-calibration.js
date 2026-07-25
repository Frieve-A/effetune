import FFT from './fft.js';

const MIN_REFERENCE_SCALE = 1e-8;
const REGULARIZATION_AMPLITUDE = 10 ** (-60 / 20);

function assertImpulseResponse(impulseResponse, label) {
    if (!(impulseResponse?.data instanceof Float32Array) ||
        impulseResponse.data.length === 0 ||
        !Number.isSafeInteger(impulseResponse.onsetIndex) ||
        impulseResponse.onsetIndex < 0 ||
        impulseResponse.onsetIndex >= impulseResponse.data.length) {
        throw new TypeError(`${label} impulse response is invalid`);
    }
}

function referenceScale(impulseResponse) {
    return Number.isFinite(impulseResponse.refScale) &&
        impulseResponse.refScale > MIN_REFERENCE_SCALE
        ? impulseResponse.refScale
        : 1;
}

function nextPowerOfTwo(value) {
    let size = 2;
    while (size < value) size *= 2;
    return size;
}

function placeAtOnsetOrigin(impulseResponse, size) {
    const output = new Float64Array(size);
    const scale = referenceScale(impulseResponse);
    for (let index = 0; index < impulseResponse.data.length; index += 1) {
        const sample = impulseResponse.data[index];
        if (!Number.isFinite(sample)) {
            throw new TypeError('Impulse response contains a non-finite sample');
        }
        output[(index - impulseResponse.onsetIndex + size) % size] = sample / scale;
    }
    return output;
}

function median(values) {
    values.sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 1
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
}

/**
 * Remove an audio interface transfer function from a measured impulse response.
 * Both inputs are aligned to their stored onset before complex spectral division.
 */
export function applyInterfaceCalibration(
    measuredImpulseResponse,
    calibrationImpulseResponse,
    {
        sampleRate,
        minFrequency,
        maxFrequency,
        outputLength = measuredImpulseResponse?.data?.length,
        prerollSamples = measuredImpulseResponse?.prerollSamples ??
            measuredImpulseResponse?.onsetIndex
    }
) {
    assertImpulseResponse(measuredImpulseResponse, 'Measured');
    assertImpulseResponse(calibrationImpulseResponse, 'Calibration');
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
        !Number.isFinite(minFrequency) || minFrequency < 0 ||
        !Number.isFinite(maxFrequency) || maxFrequency <= minFrequency ||
        maxFrequency > sampleRate / 2 ||
        !Number.isSafeInteger(outputLength) || outputLength < 1 ||
        outputLength > measuredImpulseResponse.data.length ||
        !Number.isSafeInteger(prerollSamples) ||
        prerollSamples < 0 || prerollSamples >= outputLength) {
        throw new TypeError('Interface calibration settings are invalid');
    }

    const longestInput = measuredImpulseResponse.data.length >
        calibrationImpulseResponse.data.length
        ? measuredImpulseResponse.data.length
        : calibrationImpulseResponse.data.length;
    const fftSize = nextPowerOfTwo(longestInput * 2);
    const fft = new FFT(fftSize);
    const measuredOrigin = placeAtOnsetOrigin(measuredImpulseResponse, fftSize);
    const calibrationOrigin = placeAtOnsetOrigin(calibrationImpulseResponse, fftSize);
    const measuredReal = new Float64Array(fftSize);
    const measuredImag = new Float64Array(fftSize);
    const calibrationReal = new Float64Array(fftSize);
    const calibrationImag = new Float64Array(fftSize);
    fft.transform(measuredReal, measuredImag, measuredOrigin);
    fft.transform(calibrationReal, calibrationImag, calibrationOrigin);

    const halfSize = fftSize / 2;
    const firstBin = Math.max(1, Math.ceil(minFrequency * fftSize / sampleRate));
    const lastBin = Math.min(halfSize, Math.floor(maxFrequency * fftSize / sampleRate));
    if (firstBin > lastBin) {
        throw new RangeError('Interface calibration band contains no FFT bins');
    }

    const calibrationMagnitudes = new Array(lastBin - firstBin + 1);
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
        calibrationMagnitudes[bin - firstBin] = Math.hypot(
            calibrationReal[bin],
            calibrationImag[bin]
        );
    }
    const calibrationMedian = median(calibrationMagnitudes);
    if (!Number.isFinite(calibrationMedian) || calibrationMedian <= MIN_REFERENCE_SCALE) {
        throw new RangeError('Interface calibration level is too low');
    }

    const outputReal = Float64Array.from(measuredReal);
    const outputImag = Float64Array.from(measuredImag);
    const regularizationPower = REGULARIZATION_AMPLITUDE * REGULARIZATION_AMPLITUDE;
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
        const calibrationBinReal = calibrationReal[bin] / calibrationMedian;
        const calibrationBinImag = calibrationImag[bin] / calibrationMedian;
        const denominator = calibrationBinReal * calibrationBinReal +
            calibrationBinImag * calibrationBinImag + regularizationPower;
        const measuredBinReal = measuredReal[bin];
        const measuredBinImag = measuredImag[bin];
        outputReal[bin] = (
            measuredBinReal * calibrationBinReal +
            measuredBinImag * calibrationBinImag
        ) / denominator;
        outputImag[bin] = (
            measuredBinImag * calibrationBinReal -
            measuredBinReal * calibrationBinImag
        ) / denominator;
    }

    outputImag[0] = 0;
    outputImag[halfSize] = 0;
    for (let bin = 1; bin < halfSize; bin += 1) {
        outputReal[fftSize - bin] = outputReal[bin];
        outputImag[fftSize - bin] = -outputImag[bin];
    }

    const origin = new Float64Array(fftSize);
    const inverseImaginary = new Float64Array(fftSize);
    fft.inverseTransform(origin, inverseImaginary, outputReal, outputImag);
    const data = new Float32Array(outputLength);
    let peak = 0;
    for (let index = 0; index < outputLength; index += 1) {
        const sample = origin[(index - prerollSamples + fftSize) % fftSize];
        if (!Number.isFinite(sample)) {
            throw new RangeError('Interface calibration produced a non-finite sample');
        }
        data[index] = sample;
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > peak) peak = magnitude;
    }

    return {
        data,
        onsetIndex: prerollSamples,
        prerollSamples,
        peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        refScale: 1
    };
}
