function readPoint(point) {
    return Array.isArray(point)
        ? { frequency: point[0], magnitude: point[1] }
        : { frequency: point.frequency, magnitude: point.magnitude };
}

let previousUniformKernel = null;
const MINIMUM_SIGNIFICANT_WEIGHT = Number.EPSILON * Number.EPSILON;

export function smoothFrequencyResponse(frequencyResponse, sigma = 0.3) {
    if (!Array.isArray(frequencyResponse) || frequencyResponse.length < 3 || sigma <= 0) {
        return frequencyResponse || [];
    }
    const objectFormat = !Array.isArray(frequencyResponse[0]);
    const frequencies = new Float64Array(frequencyResponse.length);
    const magnitudes = new Float64Array(frequencyResponse.length);
    const logFrequencies = new Float64Array(frequencyResponse.length);
    let ascending = true;
    for (let index = 0; index < frequencyResponse.length; index += 1) {
        const point = readPoint(frequencyResponse[index]);
        frequencies[index] = point.frequency;
        magnitudes[index] = point.magnitude;
        logFrequencies[index] = Math.log2(point.frequency);
        if (index > 0 && !(logFrequencies[index] >= logFrequencies[index - 1])) {
            ascending = false;
        }
    }
    const spacing = (logFrequencies.at(-1) - logFrequencies[0]) /
        (logFrequencies.length - 1);
    let uniform = Number.isFinite(spacing) && spacing > 0;
    for (let index = 1; uniform && index < logFrequencies.length - 1; index += 1) {
        const expected = logFrequencies[0] + index * spacing;
        uniform = Math.abs(logFrequencies[index] - expected) <= 1e-10;
    }
    let offsetWeights = null;
    let weightRadius = frequencyResponse.length - 1;
    let firstCandidates = null;
    let lastCandidates = null;
    if (uniform) {
        if (previousUniformKernel?.length === frequencyResponse.length &&
            previousUniformKernel.spacing === spacing &&
            previousUniformKernel.sigma === sigma) {
            offsetWeights = previousUniformKernel.weights;
            weightRadius = previousUniformKernel.radius;
        } else {
            offsetWeights = new Float64Array(frequencyResponse.length);
            const denominator = 2 * sigma * sigma;
            for (let offset = 0; offset < offsetWeights.length; offset += 1) {
                const distance = offset * spacing;
                offsetWeights[offset] = Math.exp(-(distance * distance) / denominator);
            }
            // Squared binary64 epsilon is far below the accumulator precision.
            // Excluding that tail avoids empty work on dense grids while retaining
            // bit-identical Room EQ output.
            while (weightRadius > 0 &&
                offsetWeights[weightRadius] <= MINIMUM_SIGNIFICANT_WEIGHT) {
                weightRadius -= 1;
            }
            previousUniformKernel = {
                length: frequencyResponse.length,
                spacing,
                sigma,
                weights: offsetWeights,
                radius: weightRadius
            };
        }
    } else if (ascending) {
        // Apply the same binary64 significance boundary to ordered nonuniform
        // grids without changing the fallback behavior for unsorted inputs.
        const significantDistance = sigma * Math.sqrt(
            -2 * Math.log(MINIMUM_SIGNIFICANT_WEIGHT)
        );
        firstCandidates = new Int32Array(frequencyResponse.length);
        lastCandidates = new Int32Array(frequencyResponse.length);
        let firstCandidate = 0;
        let lastCandidate = 0;
        for (let pointIndex = 0; pointIndex < frequencyResponse.length; pointIndex += 1) {
            const center = logFrequencies[pointIndex];
            while (logFrequencies[firstCandidate] < center - significantDistance) {
                firstCandidate += 1;
            }
            if (lastCandidate < firstCandidate) lastCandidate = firstCandidate;
            while (lastCandidate < frequencyResponse.length &&
                logFrequencies[lastCandidate] <= center + significantDistance) {
                lastCandidate += 1;
            }
            firstCandidates[pointIndex] = firstCandidate;
            lastCandidates[pointIndex] = lastCandidate;
        }
    }
    const smoothed = new Array(frequencyResponse.length);
    for (let pointIndex = 0; pointIndex < frequencyResponse.length; pointIndex += 1) {
        const frequency = frequencies[pointIndex];
        let weighted = 0;
        let weightTotal = 0;
        if (offsetWeights) {
            const firstCandidate = Math.max(0, pointIndex - weightRadius);
            const lastCandidate = Math.min(
                frequencyResponse.length,
                pointIndex + weightRadius + 1
            );
            for (let candidateIndex = firstCandidate;
                candidateIndex < pointIndex;
                candidateIndex += 1) {
                const weight = offsetWeights[pointIndex - candidateIndex];
                weighted += magnitudes[candidateIndex] * weight;
                weightTotal += weight;
            }
            weighted += magnitudes[pointIndex] * offsetWeights[0];
            weightTotal += offsetWeights[0];
            for (let candidateIndex = pointIndex + 1;
                candidateIndex < lastCandidate;
                candidateIndex += 1) {
                const weight = offsetWeights[candidateIndex - pointIndex];
                weighted += magnitudes[candidateIndex] * weight;
                weightTotal += weight;
            }
        } else {
            const firstCandidate = firstCandidates?.[pointIndex] ?? 0;
            const lastCandidate = lastCandidates?.[pointIndex] ?? frequencyResponse.length;
            const denominator = 2 * sigma * sigma;
            for (let candidateIndex = firstCandidate;
                candidateIndex < lastCandidate;
                candidateIndex += 1) {
                const distance = logFrequencies[candidateIndex] - logFrequencies[pointIndex];
                const weight = Math.exp(-(distance * distance) / denominator);
                weighted += magnitudes[candidateIndex] * weight;
                weightTotal += weight;
            }
        }
        const magnitude = weighted / weightTotal;
        smoothed[pointIndex] = objectFormat ? { frequency, magnitude } : [frequency, magnitude];
    }
    return smoothed;
}

export function createLogFrequencyGrid(minFrequency, maxFrequency, spacingOctaves = 0.01) {
    if (!(minFrequency > 0) || !(maxFrequency > minFrequency) || !(spacingOctaves > 0)) return [];
    const steps = Math.ceil(Math.log2(maxFrequency / minFrequency) / spacingOctaves);
    return Array.from({ length: steps + 1 }, (_, index) =>
        minFrequency * 2 ** (index / steps * Math.log2(maxFrequency / minFrequency)));
}

export function interpolateLogResponse(response, frequencies) {
    if (!response?.length) return frequencies.map(frequency => [frequency, 0]);
    const points = response.map(readPoint).sort((a, b) => a.frequency - b.frequency);
    let upper = 1;
    return frequencies.map(frequency => {
        while (upper < points.length && points[upper].frequency < frequency) upper += 1;
        if (upper >= points.length) return [frequency, points.at(-1).magnitude];
        if (upper === 0 || frequency <= points[0].frequency) return [frequency, points[0].magnitude];
        const low = points[upper - 1];
        const high = points[upper];
        const fraction = Math.log(frequency / low.frequency) / Math.log(high.frequency / low.frequency);
        return [frequency, low.magnitude + fraction * (high.magnitude - low.magnitude)];
    });
}
