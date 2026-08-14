import { smoothFrequencyResponse } from '../utils/measurement-dsp/smoothing.js';

const BEFORE_COLOR = '#b0b0b0';
const BEFORE_IMPULSE_COLOR = '#888888';
const AFTER_COLOR = '#00ff00';
const MAX_IMPULSE_POINTS = 4096;
const FREQUENCY_MIN_HZ = 10;
const FREQUENCY_MAX_HZ = 40000;
const FREQUENCY_TICKS_HZ = Object.freeze([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
const FREQUENCY_MAGNITUDE_RANGE_DB = Object.freeze({ minimum: -20, maximum: 20 });
const FREQUENCY_MAGNITUDE_TICKS_DB = Object.freeze([18, 12, 6, 0, -6, -12, -18]);
export const MAGNITUDE_DISPLAY_FLOOR_DB = -120;
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({ smoothingOct: 0.17, impulseRangeMs: 6 });

function normalizedDisplaySettings(settings = {}) {
    const smoothing = Number(settings.smoothingOct);
    const impulseRange = Number(settings.impulseRangeMs);
    return {
        smoothingOct: Number.isFinite(smoothing)
            ? Math.round(Math.min(1, Math.max(0.02, smoothing)) * 100) / 100
            : DEFAULT_DISPLAY_SETTINGS.smoothingOct,
        impulseRangeMs: Number.isFinite(impulseRange)
            ? Math.round(Math.min(50, Math.max(1, impulseRange)) * 10) / 10
            : DEFAULT_DISPLAY_SETTINGS.impulseRangeMs
    };
}

function formatFrequency(value) {
    if (value >= 1000) {
        return `${(value / 1000).toFixed(2)} kHz`;
    }
    return `${Math.round(value)} Hz`;
}

function formatFrequencyTick(value) {
    return value >= 1000 ? `${value / 1000}k` : String(value);
}

function formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) return '';
    const magnitude = value < 0 ? -value : value;
    if (magnitude >= 100) return value.toFixed(0);
    if (magnitude >= 10) return value.toFixed(Math.min(digits, 1));
    return value.toFixed(digits);
}

function niceCeiling(value) {
    if (!(value > 0)) return 1;
    const scale = 10 ** Math.floor(Math.log10(value));
    const fraction = value / scale;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * scale;
}

function finiteExtent(curves, valueForCurve) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const curve of curves) {
        const values = valueForCurve(curve);
        for (let index = 0; index < (values?.length || 0); index += 1) {
            const value = values[index];
            if (!Number.isFinite(value)) continue;
            if (value < minimum) minimum = value;
            if (value > maximum) maximum = value;
        }
    }
    return Number.isFinite(minimum) ? { minimum, maximum } : { minimum: -1, maximum: 1 };
}

function linearTicks(minimum, maximum, formatter) {
    const span = maximum - minimum || 1;
    return Array.from({ length: 5 }, (_, index) => {
        const fraction = index / 4;
        const value = maximum - fraction * span;
        return { position: fraction, label: formatter(value) };
    });
}

function frequencyAxis() {
    const logMinimum = Math.log(FREQUENCY_MIN_HZ);
    const logSpan = Math.log(FREQUENCY_MAX_HZ) - logMinimum;
    const position = value => (Math.log(value) - logMinimum) / logSpan;
    return {
        minimum: FREQUENCY_MIN_HZ,
        maximum: FREQUENCY_MAX_HZ,
        position,
        ticks: FREQUENCY_TICKS_HZ.map(value => ({
            position: position(value),
            label: formatFrequencyTick(value)
        }))
    };
}

function frequencyNormalizationDb(frequencies, magnitudes, sampleRate) {
    const maximumFrequency = Math.min(20000, sampleRate * 0.45);
    let power = 0;
    let count = 0;
    for (let index = 0; index < (frequencies?.length || 0); index += 1) {
        const frequency = frequencies[index];
        const magnitudeDb = magnitudes?.[index];
        if (!(Number.isFinite(frequency) && frequency >= 20 && frequency <= maximumFrequency)) continue;
        if (magnitudeDb === Number.NEGATIVE_INFINITY) {
            count += 1;
            continue;
        }
        if (!Number.isFinite(magnitudeDb)) continue;
        const samplePower = 10 ** (magnitudeDb / 10);
        if (!Number.isFinite(samplePower)) continue;
        power += samplePower;
        count += 1;
    }
    if (!(count > 0 && power > 0 && Number.isFinite(power))) return 0;
    const offsetDb = 10 * Math.log10(power / count);
    return Number.isFinite(offsetDb) ? offsetDb : 0;
}

function smoothFiniteRuns(frequencies, values, validity, smoothingOct) {
    const smoothed = Array.from(values || [], value => value);
    let first = 0;
    while (first < smoothed.length) {
        while (first < smoothed.length && !(Number.isFinite(frequencies?.[first]) && frequencies[first] > 0 &&
            Number.isFinite(smoothed[first]) && validity?.[first] !== 0)) first += 1;
        let last = first;
        while (last < smoothed.length && Number.isFinite(frequencies?.[last]) && frequencies[last] > 0 &&
            Number.isFinite(smoothed[last]) && validity?.[last] !== 0) last += 1;
        if (last > first) {
            const run = [];
            for (let index = first; index < last; index += 1) {
                run.push({ frequency: frequencies[index], magnitude: smoothed[index] });
            }
            const filtered = smoothFrequencyResponse(run, smoothingOct);
            for (let index = first; index < last; index += 1) {
                smoothed[index] = filtered[index - first].magnitude;
            }
        }
        first = last + 1;
    }
    return smoothed;
}

function magnitudeDisplayValue(value) {
    if (value === Number.NEGATIVE_INFINITY) return MAGNITUDE_DISPLAY_FLOOR_DB;
    return Number.isFinite(value) && value < MAGNITUDE_DISPLAY_FLOOR_DB
        ? MAGNITUDE_DISPLAY_FLOOR_DB
        : value;
}

function symmetricRange(curves, valueForCurve, minimumLimit) {
    const extent = finiteExtent(curves, valueForCurve);
    const absolute = Math.max(
        extent.minimum < 0 ? -extent.minimum : extent.minimum,
        extent.maximum < 0 ? -extent.maximum : extent.maximum,
        minimumLimit
    );
    const limit = niceCeiling(absolute * 1.05);
    return { minimum: -limit, maximum: limit };
}

function yPosition(value, range) {
    if (!Number.isFinite(value)) return Number.NaN;
    const clamped = value < range.minimum
        ? range.minimum
        : value > range.maximum ? range.maximum : value;
    return (range.maximum - clamped) / (range.maximum - range.minimum || 1);
}

function spectrumPoints(
    curve,
    values,
    xAxis,
    range,
    unit,
    digits,
    validOnly,
    displayValue = value => value
) {
    const frequencies = curve.spectrum?.frequencies;
    const validity = curve.spectrum?.valid;
    const result = [];
    for (let index = 0; index < (frequencies?.length || 0); index += 1) {
        const frequency = frequencies[index];
        const rawValue = values?.[index];
        const value = displayValue(rawValue);
        const valid = frequency >= xAxis.minimum && frequency <= xAxis.maximum &&
            Number.isFinite(value) && (!validOnly || validity?.[index] !== 0 ||
                rawValue === Number.NEGATIVE_INFINITY);
        if (!valid) {
            result.push({
                x: Number.NaN,
                y: Number.NaN,
                xValue: frequency,
                yValue: value,
                xLabel: formatFrequency(frequency),
                yLabel: rawValue === Number.NEGATIVE_INFINITY ? `−∞ ${unit}` : ''
            });
            continue;
        }
        result.push({
            x: xAxis.position(frequency),
            y: yPosition(value, range),
            xValue: frequency,
            yValue: value,
            xLabel: formatFrequency(frequency),
            yLabel: rawValue === Number.NEGATIVE_INFINITY
                ? `−∞ ${unit}`
                : `${value.toFixed(digits)}${unit === '°' ? unit : ` ${unit}`}`
        });
    }
    return result;
}

function impulseSampleIndices(values, firstIndex = 0, lastIndex = values?.length || 0) {
    const length = values?.length || 0;
    const firstSample = Math.max(0, Math.min(length, firstIndex));
    const lastSample = Math.max(firstSample, Math.min(length, lastIndex));
    const visibleLength = lastSample - firstSample;
    if (visibleLength <= MAX_IMPULSE_POINTS) {
        return Array.from({ length: visibleLength }, (_, index) => firstSample + index);
    }
    const bucketSize = Math.ceil(visibleLength / (MAX_IMPULSE_POINTS / 2));
    const indices = [];
    for (let first = firstSample; first < lastSample; first += bucketSize) {
        const last = Math.min(lastSample, first + bucketSize);
        let minimumIndex = first;
        let maximumIndex = first;
        for (let index = first + 1; index < last; index += 1) {
            if (values[index] < values[minimumIndex]) minimumIndex = index;
            if (values[index] > values[maximumIndex]) maximumIndex = index;
        }
        if (minimumIndex < maximumIndex) indices.push(minimumIndex, maximumIndex);
        else if (maximumIndex < minimumIndex) indices.push(maximumIndex, minimumIndex);
        else indices.push(minimumIndex);
    }
    if (indices[indices.length - 1] !== lastSample - 1) indices.push(lastSample - 1);
    return indices;
}

function impulseDivisor(values) {
    let maximum = 0;
    for (let index = 0; index < (values?.length || 0); index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) continue;
        const absolute = value < 0 ? -value : value;
        if (absolute > maximum) maximum = absolute;
    }
    return maximum > 0 ? maximum : 1;
}

function impulsePoints(curve, sampleRate, timeRange, divisor) {
    const result = [];
    const firstIndex = Math.max(0, Math.ceil(timeRange.minimum / 1000 * sampleRate - curve.timeOriginSamples));
    const lastIndex = Math.min(
        curve.impulse?.length || 0,
        Math.floor(timeRange.maximum / 1000 * sampleRate - curve.timeOriginSamples) + 1
    );
    for (const index of impulseSampleIndices(curve.impulse, firstIndex, lastIndex)) {
        const timeMs = (index + curve.timeOriginSamples) / sampleRate * 1000;
        if (timeMs < timeRange.minimum || timeMs > timeRange.maximum) continue;
        const amplitude = curve.impulse[index] / divisor;
        result.push({
            x: (timeMs - timeRange.minimum) / (timeRange.maximum - timeRange.minimum || 1),
            y: (1 - amplitude) / 2,
            xValue: timeMs,
            yValue: amplitude,
            xLabel: `${timeMs.toFixed(2)} ms`,
            yLabel: amplitude.toFixed(2)
        });
    }
    return result;
}

function viewCurves(curves, makePoints) {
    return curves.map(curve => ({
        id: curve.id,
        label: curve.label,
        shortLabel: curve.shortLabel,
        color: curve.color,
        opacity: curve.opacity,
        points: makePoints(curve)
    }));
}

export function adaptPipelineAnalysisResult(result, provenance = {}) {
    const sampleRate = Number(result?.sampleRate);
    if (!(Number.isFinite(sampleRate) && sampleRate > 0) || !result?.before || !result?.after) {
        throw new TypeError('Pipeline Analyzer result is incomplete');
    }
    const beforeLabel = 'Before';
    const afterLabel = 'After';
    const sources = [
        {
            ...result.before,
            id: 'before',
            label: beforeLabel,
            shortLabel: beforeLabel,
            opacity: 0.7,
            timeOriginSamples: Number.isSafeInteger(result.before.timeOriginSamples)
                ? result.before.timeOriginSamples
                : 0
        },
        {
            ...result.after,
            id: 'after',
            label: afterLabel,
            shortLabel: afterLabel,
            opacity: 1,
            timeOriginSamples: Number.isSafeInteger(result.after.timeOriginSamples)
                ? result.after.timeOriginSamples
                : 0
        }
    ];
    const styledSources = (beforeColor, afterColor, beforeOpacity = 0.7) => [
        { ...sources[0], color: beforeColor, opacity: beforeOpacity },
        { ...sources[1], color: afterColor }
    ];

    const displaySettings = normalizedDisplaySettings(provenance.displaySettings);
    const xAxis = frequencyAxis();
    const frequencyRange = FREQUENCY_MAGNITUDE_RANGE_DB;
    const frequencySources = styledSources(BEFORE_COLOR, AFTER_COLOR).map(curve => {
        const magnitudeDb = smoothFiniteRuns(
            curve.spectrum?.frequencies,
            curve.spectrum?.magnitudeDb,
            null,
            displaySettings.smoothingOct
        );
        return {
            ...curve,
            displayMagnitudeDb: magnitudeDb,
            frequencyNormalizationDb: frequencyNormalizationDb(
                curve.spectrum?.frequencies,
                magnitudeDb,
                sampleRate
            )
        };
    });
    const phaseRange = { minimum: -180, maximum: 180 };
    const delaySources = property => styledSources(BEFORE_COLOR, AFTER_COLOR).map(curve => ({
        ...curve,
        displayGroupDelayMs: smoothFiniteRuns(
            curve.spectrum?.frequencies,
            curve.spectrum?.[property] ?? curve.spectrum?.groupDelayMs,
            curve.spectrum?.valid,
            displaySettings.smoothingOct
        )
    }));
    const minimumDelaySources = delaySources('minimumGroupDelayMs');
    const excessDelaySources = delaySources('excessGroupDelayMs');
    const minimumDelayRange = symmetricRange(
        minimumDelaySources,
        curve => curve.displayGroupDelayMs,
        1
    );
    const excessDelayRange = symmetricRange(
        excessDelaySources,
        curve => curve.displayGroupDelayMs,
        1
    );
    const timeRange = { minimum: -2, maximum: displaySettings.impulseRangeMs };
    const impulseSources = styledSources(BEFORE_IMPULSE_COLOR, AFTER_COLOR, 1).map(curve => ({
        ...curve,
        impulseDivisor: impulseDivisor(curve.impulse)
    }));

    const groupDelayView = (label, curves, range) => ({
        xLabel: 'Frequency (Hz)',
        yLabel: label,
        xTicks: xAxis.ticks,
        yTicks: linearTicks(range.minimum, range.maximum, value => `${formatNumber(value, 2)} ms`),
        curves: viewCurves(curves, curve => spectrumPoints(
            curve,
            curve.displayGroupDelayMs,
            xAxis,
            range,
            'ms',
            2,
            true
        ))
    });

    const views = {
        frequency: {
            xLabel: 'Frequency (Hz)',
            yLabel: 'Magnitude (dB)',
            xTicks: xAxis.ticks,
            yTicks: FREQUENCY_MAGNITUDE_TICKS_DB.map(value => ({
                position: yPosition(value, frequencyRange),
                label: `${value}dB`
            })),
            curves: viewCurves(frequencySources, curve => spectrumPoints(
                curve,
                curve.displayMagnitudeDb,
                xAxis,
                frequencyRange,
                'dB',
                1,
                false,
                value => magnitudeDisplayValue(value - curve.frequencyNormalizationDb)
            ))
        },
        phase: {
            xLabel: 'Frequency (Hz)',
            yLabel: 'Phase (°)',
            xTicks: xAxis.ticks,
            yTicks: linearTicks(-180, 180, value => `${formatNumber(value, 0)}°`),
            curves: viewCurves(styledSources(BEFORE_COLOR, AFTER_COLOR), curve => spectrumPoints(
                curve,
                curve.spectrum?.phaseDegrees,
                xAxis,
                phaseRange,
                '°',
                0,
                true
            ))
        },
        minimumGroupDelay: groupDelayView(
            'Min group delay (ms)',
            minimumDelaySources,
            minimumDelayRange
        ),
        excessGroupDelay: groupDelayView(
            'Excess group delay (ms)',
            excessDelaySources,
            excessDelayRange
        ),
        impulse: {
            xLabel: 'Time (ms)',
            yLabel: 'Amplitude',
            xTicks: Array.from({ length: 5 }, (_, index) => {
                const position = index / 4;
                const value = timeRange.minimum + position * (timeRange.maximum - timeRange.minimum);
                return { position, label: `${formatNumber(value, 2)} ms` };
            }),
            yTicks: [
                { position: 0, label: '' },
                { position: 0.25, label: '0.5' },
                { position: 0.5, label: '0' },
                { position: 0.75, label: '-0.5' },
                { position: 1, label: '' }
            ],
            curves: viewCurves(impulseSources, curve => impulsePoints(
                curve,
                sampleRate,
                timeRange,
                curve.impulseDivisor
            ))
        }
    };

    return {
        ...result,
        pipelineId: provenance.pipelineIdentity || null,
        measurementSettings: provenance.measurementSettings ?? null,
        displaySettings: Object.freeze({ ...displaySettings }),
        displayReference: Object.freeze({
            smoothingOct: displaySettings.smoothingOct,
            impulseRangeMs: displaySettings.impulseRangeMs,
            before: Object.freeze({
                frequencyNormalizationDb: frequencySources[0].frequencyNormalizationDb,
                impulseDivisor: impulseSources[0].impulseDivisor
            }),
            after: Object.freeze({
                frequencyNormalizationDb: frequencySources[1].frequencyNormalizationDb,
                impulseDivisor: impulseSources[1].impulseDivisor
            })
        }),
        provenance: { ...provenance },
        views
    };
}
