const DEFAULT_VIEW_DURATION_MS = 10;

function isValidImpulseResponse(record) {
    return Boolean(
        record &&
        Number.isFinite(record.sampleRate) &&
        record.sampleRate > 0 &&
        Number.isSafeInteger(record.onsetIndex) &&
        record.onsetIndex >= 0 &&
        record.data instanceof Float32Array &&
        record.onsetIndex < record.data.length
    );
}

function getImpulseTimeBounds(record) {
    if (!isValidImpulseResponse(record)) return null;
    const samplePeriodMs = 1000 / record.sampleRate;
    return {
        minMs: -record.onsetIndex * samplePeriodMs,
        maxMs: (record.data.length - record.onsetIndex) * samplePeriodMs,
        samplePeriodMs
    };
}

function clampImpulseView(startMs, durationMs, bounds) {
    if (!bounds) return null;
    const totalDurationMs = bounds.maxMs - bounds.minMs;
    const minimumDurationMs = Math.min(
        totalDurationMs,
        Math.max(bounds.samplePeriodMs * 2, totalDurationMs / 100000)
    );
    const clampedDurationMs = Math.min(
        totalDurationMs,
        Math.max(minimumDurationMs, durationMs)
    );
    const latestStartMs = bounds.maxMs - clampedDurationMs;
    return {
        startMs: Math.min(latestStartMs, Math.max(bounds.minMs, startMs)),
        durationMs: clampedDurationMs
    };
}

function createDefaultImpulseView(record) {
    const bounds = getImpulseTimeBounds(record);
    if (!bounds) return null;
    return clampImpulseView(
        0,
        Math.min(DEFAULT_VIEW_DURATION_MS, bounds.maxMs - bounds.minMs),
        bounds
    );
}

function findImpulsePeak(samples) {
    let peak = 0;
    for (const value of samples || []) {
        if (!Number.isFinite(value)) continue;
        const magnitude = value < 0 ? -value : value;
        if (magnitude > peak) peak = magnitude;
    }
    return peak > 1e-12 ? peak : 1;
}

function sampleImpulseEnvelope(record, view, columnCount) {
    if (!isValidImpulseResponse(record) || !view || columnCount <= 0) return [];
    const samples = record.data;
    const samplesPerMs = record.sampleRate / 1000;
    const firstIndex = Math.max(
        0,
        Math.floor(record.onsetIndex + view.startMs * samplesPerMs)
    );
    const lastIndex = Math.min(
        samples.length,
        Math.ceil(record.onsetIndex +
            (view.startMs + view.durationMs) * samplesPerMs)
    );
    const sampleCount = lastIndex - firstIndex;
    if (sampleCount <= 0) return [];

    const bucketCount = Math.min(Math.max(1, Math.floor(columnCount)), sampleCount);
    const envelope = [];
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
        const start = firstIndex + Math.floor(bucket * sampleCount / bucketCount);
        const end = Math.max(
            start + 1,
            firstIndex + Math.floor((bucket + 1) * sampleCount / bucketCount)
        );
        let minimum = samples[start];
        let maximum = samples[start];
        let minimumIndex = start;
        let maximumIndex = start;
        for (let index = start + 1; index < end; index += 1) {
            const value = samples[index];
            if (!Number.isFinite(value)) continue;
            if (!Number.isFinite(minimum) || value < minimum) {
                minimum = value;
                minimumIndex = index;
            }
            if (!Number.isFinite(maximum) || value > maximum) {
                maximum = value;
                maximumIndex = index;
            }
        }
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) continue;
        envelope.push({
            minimum,
            maximum,
            minimumIndex,
            maximumIndex
        });
    }
    return envelope;
}

function getNiceTimeTickInterval(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
    const roughInterval = durationMs / 8;
    const magnitude = 10 ** Math.floor(Math.log10(roughInterval));
    const normalized = roughInterval / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return multiplier * magnitude;
}

export {
    DEFAULT_VIEW_DURATION_MS,
    clampImpulseView,
    createDefaultImpulseView,
    findImpulsePeak,
    getImpulseTimeBounds,
    getNiceTimeTickInterval,
    isValidImpulseResponse,
    sampleImpulseEnvelope
};
