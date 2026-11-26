function sinc(value) {
    return value === 0 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
}

function besselI0(value) {
    let sum = 1;
    let term = 1;
    const scaled = value * value / 4;
    for (let index = 1; index < 20; index += 1) {
        term *= scaled / (index * index);
        sum += term;
        if (term < sum * 1e-12) break;
    }
    return sum;
}

// Kaiser-windowed sinc for a band limit (fraction of Nyquist) and a 100 dB stopband.
function kaiserKernel(bandLimit, transition = bandLimit * 0.1) {
    const attenuationDb = 100;
    return {
        cutoff: bandLimit - transition / 2,
        beta: 0.1102 * (attenuationDb - 8.7),
        radius: Math.ceil((attenuationDb - 8) / (4.57 * Math.PI * transition))
    };
}

const coefficientTableCache = new Map();

function greatestCommonDivisor(left, right) {
    while (right !== 0) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }
    return left;
}

function createPhaseCoefficients(fraction, cutoff, radius, beta, normalizer) {
    const coefficients = new Float64Array(radius * 2);
    let total = 0;
    for (let tap = 0; tap < coefficients.length; tap += 1) {
        const offset = tap - radius + 1;
        const distance = fraction - offset;
        const normalized = distance / radius;
        if (normalized <= -1 || normalized >= 1) continue;
        const window = besselI0(beta * Math.sqrt(1 - normalized * normalized)) / normalizer;
        const weight = cutoff * sinc(distance * cutoff) * window;
        coefficients[tap] = weight;
        total += weight;
    }
    if (total !== 0) {
        for (let tap = 0; tap < coefficients.length; tap += 1) coefficients[tap] /= total;
    }
    return coefficients;
}

function getCoefficientTable(sourceRate, targetRate, cutoff, radius, beta, normalizer) {
    const divisor = greatestCommonDivisor(sourceRate, targetRate);
    const sourceStep = sourceRate / divisor;
    const phaseCount = targetRate / divisor;
    const key = `${sourceRate}:${targetRate}:${cutoff}:${radius}:${beta}`;
    let table = coefficientTableCache.get(key);
    if (!table) {
        const phases = new Array(phaseCount);
        table = { sourceStep, phaseCount, phases };
        coefficientTableCache.set(key, table);
    }
    return table;
}

export function resampleWindowedSinc(input, sourceRate, targetRate, options = {}) {
    if (!(input instanceof Float32Array) && !(input instanceof Float64Array)) {
        throw new TypeError('Resampler input must be a floating-point array');
    }
    if (!(sourceRate > 0) || !(targetRate > 0)) throw new TypeError('Sample rates must be positive');
    if (sourceRate === targetRate) return Float32Array.from(input);
    const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
    const output = new Float32Array(outputLength);
    const ratio = sourceRate / targetRate;
    const kernel = kaiserKernel(targetRate < sourceRate ? targetRate / sourceRate : 1);
    const cutoff = kernel.cutoff;
    const beta = options.beta ?? kernel.beta;
    const radius = options.radius ?? kernel.radius;
    if (!Number.isSafeInteger(radius) || radius < 1 || !Number.isFinite(beta) || beta < 0) {
        throw new TypeError('Resampler radius and beta must be valid');
    }
    const normalizer = besselI0(beta);
    const integerRates = Number.isSafeInteger(sourceRate) && Number.isSafeInteger(targetRate);
    const table = integerRates
        ? getCoefficientTable(sourceRate, targetRate, cutoff, radius, beta, normalizer)
        : null;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const position = table ? null : outputIndex * ratio;
        const center = table
            ? Math.floor(outputIndex * table.sourceStep / table.phaseCount)
            : Math.floor(position);
        const phaseIndex = table ? (outputIndex * table.sourceStep) % table.phaseCount : 0;
        let coefficients = table?.phases[phaseIndex];
        if (!coefficients) {
            const fraction = table ? phaseIndex / table.phaseCount : position - center;
            coefficients = createPhaseCoefficients(fraction, cutoff, radius, beta, normalizer);
            if (table) table.phases[phaseIndex] = coefficients;
        }
        const firstInputIndex = center - radius + 1;
        let weighted = 0;
        if (firstInputIndex >= 0 && firstInputIndex + coefficients.length <= input.length) {
            for (let tap = 0; tap < coefficients.length; tap += 1) {
                weighted += input[firstInputIndex + tap] * coefficients[tap];
            }
            output[outputIndex] = weighted;
            continue;
        }

        let weightTotal = 0;
        for (let tap = 0; tap < coefficients.length; tap += 1) {
            const inputIndex = firstInputIndex + tap;
            if (inputIndex < 0 || inputIndex >= input.length) continue;
            const weight = coefficients[tap];
            weighted += input[inputIndex] * weight;
            weightTotal += weight;
        }
        output[outputIndex] = weightTotal === 0 ? 0 : weighted / weightTotal;
    }
    return output;
}

// Fractional positions between RATIO_PHASES table phases interpolate linearly between neighbouring phases.
const RATIO_PHASES = 1024;
const ratioTables = new Map();

function getRatioTable(wideband) {
    let table = ratioTables.get(wideband);
    if (!table) {
        // Preserve the 98% ESS band with up to 0.5% clock error in either direction.
        const { cutoff, beta, radius } = wideband ? kaiserKernel(0.995, 0.01) : kaiserKernel(1);
        const normalizer = besselI0(beta);
        const taps = radius * 2;
        const coefficients = new Float64Array((RATIO_PHASES + 1) * taps);
        for (let phase = 0; phase <= RATIO_PHASES; phase += 1) {
            coefficients.set(createPhaseCoefficients(phase / RATIO_PHASES, cutoff, radius, beta, normalizer), phase * taps);
        }
        table = { radius, taps, coefficients };
        ratioTables.set(wideband, table);
    }
    return table;
}

/**
 * `input` on a time axis scaled by `ratio` around `origin`: output[n] = input(origin + (n − origin)·ratio),
 * band-limited interpolation with zeros outside the input. For ratios close to 1, such as a clock
 * mismatch between devices; the output has the input's length.
 */
export function resampleByRatio(input, ratio, origin = 0, { wideband = false } = {}) {
    if (!(input instanceof Float32Array) && !(input instanceof Float64Array)) {
        throw new TypeError('Resampler input must be a floating-point array');
    }
    if (!(ratio > 0) || !Number.isFinite(origin)) throw new TypeError('Resampling ratio and origin must be valid');
    const { radius, taps, coefficients } = getRatioTable(wideband);
    const output = new Float32Array(input.length);
    for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
        const position = origin + (outputIndex - origin) * ratio;
        const center = Math.floor(position);
        const scaled = (position - center) * RATIO_PHASES;
        const phase = Math.floor(scaled);
        const blend = scaled - phase;
        const lower = phase * taps;
        const first = center - radius + 1;
        const end = first + taps > input.length ? input.length - first : taps;
        let weighted = 0;
        for (let tap = first < 0 ? -first : 0; tap < end; tap += 1) {
            const coefficient = coefficients[lower + tap];
            weighted += input[first + tap] * (coefficient + blend * (coefficients[lower + taps + tap] - coefficient));
        }
        output[outputIndex] = weighted;
    }
    return output;
}
