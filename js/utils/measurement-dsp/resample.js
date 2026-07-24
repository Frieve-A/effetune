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
    const bandLimit = targetRate < sourceRate ? targetRate / sourceRate : 1;
    const cutoff = bandLimit * 0.95;
    const transitionWidthRadians = Math.PI * bandLimit * 0.1;
    const attenuationDb = 100;
    const beta = options.beta ?? 0.1102 * (attenuationDb - 8.7);
    const radius = options.radius ?? Math.ceil(
        (attenuationDb - 8) / (4.57 * transitionWidthRadians)
    );
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
