function readPoint(point) {
    return Array.isArray(point)
        ? { frequency: point[0], magnitude: point[1] }
        : { frequency: point.frequency, magnitude: point.magnitude };
}

export function smoothFrequencyResponse(frequencyResponse, sigma = 0.3) {
    if (!Array.isArray(frequencyResponse) || frequencyResponse.length < 3 || sigma <= 0) {
        return frequencyResponse || [];
    }
    const objectFormat = !Array.isArray(frequencyResponse[0]);
    const frequencies = new Float64Array(frequencyResponse.length);
    const magnitudes = new Float64Array(frequencyResponse.length);
    const logFrequencies = new Float64Array(frequencyResponse.length);
    for (let index = 0; index < frequencyResponse.length; index += 1) {
        const point = readPoint(frequencyResponse[index]);
        frequencies[index] = point.frequency;
        magnitudes[index] = point.magnitude;
        logFrequencies[index] = Math.log2(point.frequency);
    }
    const spacing = (logFrequencies.at(-1) - logFrequencies[0]) /
        (logFrequencies.length - 1);
    let uniform = Number.isFinite(spacing) && spacing > 0;
    for (let index = 1; uniform && index < logFrequencies.length - 1; index += 1) {
        const expected = logFrequencies[0] + index * spacing;
        uniform = Math.abs(logFrequencies[index] - expected) <= 1e-10;
    }
    let offsetWeights = null;
    if (uniform) {
        offsetWeights = new Float64Array(frequencyResponse.length);
        const denominator = 2 * sigma * sigma;
        for (let offset = 0; offset < offsetWeights.length; offset += 1) {
            const distance = offset * spacing;
            offsetWeights[offset] = Math.exp(-(distance * distance) / denominator);
        }
    }
    return frequencyResponse.map((point, pointIndex) => {
        const frequency = frequencies[pointIndex];
        let weighted = 0;
        let weightTotal = 0;
        for (let candidateIndex = 0; candidateIndex < frequencyResponse.length; candidateIndex += 1) {
            const distance = logFrequencies[candidateIndex] - logFrequencies[pointIndex];
            const weight = offsetWeights
                ? offsetWeights[Math.abs(candidateIndex - pointIndex)]
                : Math.exp(-(distance * distance) / (2 * sigma * sigma));
            weighted += magnitudes[candidateIndex] * weight;
            weightTotal += weight;
        }
        const magnitude = weighted / weightTotal;
        return objectFormat ? { frequency, magnitude } : [frequency, magnitude];
    });
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
