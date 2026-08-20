import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { adaptPipelineAnalysisResult } from '../../js/pipeline-analyzer/result-adapter.js';

function spectrum(magnitudeOffset = 0) {
    return {
        frequencies: new Float32Array([20, 1000, 20000]),
        magnitudeDb: new Float32Array([-6 + magnitudeOffset, magnitudeOffset, -3 + magnitudeOffset]),
        phaseDegrees: new Float32Array([0, -90, 180]),
        groupDelayMs: new Float32Array([1, 2, Number.NaN]),
        minimumGroupDelayMs: new Float32Array([0.25, 0.5, Number.NaN]),
        excessGroupDelayMs: new Float32Array([0.75, 1.5, Number.NaN]),
        valid: new Uint8Array([1, 1, 0])
    };
}

test('adapts Worker Before and After data into five normalized real-unit views', () => {
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        reportedLatency: 64,
        captureLength: 4,
        truncated: false,
        before: {
            impulse: new Float32Array([0, 1, -0.5, 0]),
            spectrum: spectrum(),
            timeOriginSamples: -1
        },
        after: {
            impulse: new Float32Array([0, 2, -1, 0]),
            spectrum: spectrum(6),
            timeOriginSamples: -65
        }
    }, {
        pipelineIdentity: 'B',
        measurementSettings: {
            signalType: 'mls',
            levelDb: -12,
            sequenceLength: 65535,
            stabilizationPeriods: 12,
            averagingPeriods: 2
        },
        outputs: []
    }, {}, () => 'Translated text');

    assert.equal(result.pipelineId, 'B');
    assert.equal(result.measurementSettings.signalType, 'mls');
    assert.deepEqual(Object.keys(result.views), [
        'frequency',
        'phase',
        'minimumGroupDelay',
        'excessGroupDelay',
        'impulse'
    ]);
    assert.match(result.views.frequency.xLabel, /Hz/);
    assert.match(result.views.frequency.yLabel, /dB/);
    assert.match(result.views.minimumGroupDelay.yLabel, /ms/);
    assert.match(result.views.excessGroupDelay.yLabel, /ms/);
    assert.match(result.views.impulse.xLabel, /ms/);
    assert.deepEqual(result.views.frequency.curves.map(curve => curve.label), ['Before', 'After']);
    assert.deepEqual(result.views.frequency.curves.map(curve => curve.color), ['#b0b0b0', '#00ff00']);
    assert.deepEqual(result.views.frequency.curves.map(curve => curve.opacity), [0.7, 1]);
    assert.deepEqual(result.views.phase.curves.map(curve => curve.color), ['#b0b0b0', '#00ff00']);
    assert.deepEqual(result.views.impulse.curves.map(curve => curve.color), ['#888888', '#00ff00']);
    assert.deepEqual(result.views.impulse.curves.map(curve => curve.opacity), [1, 1]);
    assert.deepEqual(result.views.frequency.xTicks.map(tick => tick.label),
        ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k']);
    assert.ok(Math.abs(result.views.frequency.xTicks[0].position - Math.log(2) / Math.log(4000)) < 1e-12);
    assert.ok(Math.abs(result.views.frequency.xTicks.at(-1).position - Math.log(2000) / Math.log(4000)) < 1e-12);
    assert.deepEqual(result.views.frequency.yTicks.map(tick => tick.label),
        ['18dB', '12dB', '6dB', '0dB', '-6dB', '-12dB', '-18dB']);
    assert.equal(result.views.frequency.yTicks[0].position, 0.05);
    assert.equal(result.views.frequency.yTicks.at(-1).position, 0.95);
    const expectedNormalization = 10 * Math.log10((10 ** -0.6 + 1 + 10 ** -0.3) / 3);
    assert.ok(Math.abs(result.displayReference.before.frequencyNormalizationDb - expectedNormalization) < 1e-5);
    assert.ok(Math.abs(
        result.displayReference.after.frequencyNormalizationDb -
        result.displayReference.before.frequencyNormalizationDb - 6
    ) < 1e-5);
    assert.equal(Object.isFrozen(result.displayReference), true);
    assert.equal(Object.isFrozen(result.displayReference.before), true);
    assert.equal(Object.isFrozen(result.displayReference.after), true);
    assert.match(result.views.frequency.curves[0].points[1].yLabel,
        new RegExp(`${(-expectedNormalization).toFixed(1)} dB`));
    assert.match(result.views.frequency.curves[1].points[1].yLabel,
        new RegExp(`${(-expectedNormalization).toFixed(1)} dB`));
    assert.equal(result.views.frequency.curves[0].points[1].xValue, 1000);
    assert.ok(Math.abs(result.views.frequency.curves[0].points[1].yValue + expectedNormalization) < 1e-5);

    for (const [name, view] of Object.entries(result.views)) {
        assert.equal(view.curves.length, 2);
        assert.ok(view.xTicks.length >= 2);
        assert.equal(view.yTicks.length, name === 'frequency' ? 7 : 5);
        for (const curve of view.curves) {
            for (const point of curve.points) {
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                assert.ok(point.x >= 0 && point.x <= 1);
                assert.ok(point.y >= 0 && point.y <= 1);
                assert.ok(point.xLabel);
                assert.ok(point.yLabel);
            }
        }
    }

    assert.equal(result.views.phase.curves[0].points.at(-1).x, Number.NaN);
    assert.match(result.views.impulse.curves[0].points[0].xLabel, /-0\.02 ms/);
    assert.match(result.views.impulse.curves[1].points[0].xLabel, /-1\.35 ms/);
    assert.ok(result.views.impulse.curves[1].points[0].x < result.views.impulse.curves[0].points[0].x);
});

test('impulse display uses the full-response peak and excludes samples outside its fixed range', () => {
    const impulse = new Float32Array(100000);
    impulse[240] = 1;
    impulse[4800] = 2;
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        before: { impulse, spectrum: spectrum(), timeOriginSamples: 0 },
        after: { impulse, spectrum: spectrum(), timeOriginSamples: 0 }
    });
    const points = result.views.impulse.curves[0].points;
    assert.ok(points.every(point => point.xValue >= -2 && point.xValue <= 6));
    assert.ok(points.some(point => point.yLabel === '0.50'));
    assert.equal(result.displayReference.before.impulseDivisor, 2);
});

test('plots mute and exact cancellation at the frequency floor only', () => {
    const zeroSpectrum = {
        frequencies: new Float32Array([20, 1000]),
        magnitudeDb: new Float32Array([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]),
        phaseDegrees: new Float32Array([Number.NaN, Number.NaN]),
        groupDelayMs: new Float32Array([Number.NaN, Number.NaN]),
        minimumGroupDelayMs: new Float32Array([Number.NaN, Number.NaN]),
        excessGroupDelayMs: new Float32Array([Number.NaN, Number.NaN]),
        valid: new Uint8Array([0, 0])
    };
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        before: { impulse: new Float32Array([0]), spectrum: zeroSpectrum, timeOriginSamples: 0 },
        after: { impulse: new Float32Array([0]), spectrum: zeroSpectrum, timeOriginSamples: 0 }
    });

    for (const curve of result.views.frequency.curves) {
        assert.equal(curve.points.length, 2);
        assert.equal(curve.points.every(point => Number.isFinite(point.y) && point.y === 1), true);
        assert.equal(curve.points.every(point => point.yLabel === '−∞ dB'), true);
    }
    assert.equal(result.displayReference.before.frequencyNormalizationDb, 0);
    for (const view of [
        result.views.phase,
        result.views.minimumGroupDelay,
        result.views.excessGroupDelay
    ]) {
        assert.equal(view.curves.every(curve =>
            curve.points.every(point => Number.isNaN(point.x) && Number.isNaN(point.y))
        ), true);
    }
});

test('keeps axis titles in English when a translator is supplied', () => {
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        before: { impulse: new Float32Array([1]), spectrum: spectrum(), timeOriginSamples: 0 },
        after: { impulse: new Float32Array([1]), spectrum: spectrum(), timeOriginSamples: 0 }
    }, {}, key => ({
        'pipelineAnalyzer.axis.frequency': 'Frequenz (Hz)',
        'pipelineAnalyzer.axis.magnitude': 'Pegel (dB)',
        'pipelineAnalyzer.axis.phase': 'Phase (°)',
        'pipelineAnalyzer.axis.groupDelay': 'Gruppenlaufzeit (ms)',
        'pipelineAnalyzer.axis.time': 'Zeit (ms)',
        'pipelineAnalyzer.axis.amplitude': 'Amplitude'
    })[key] || key);
    assert.equal(result.views.frequency.xLabel, 'Frequency (Hz)');
    assert.equal(result.views.frequency.yLabel, 'Magnitude (dB)');
    assert.equal(result.views.minimumGroupDelay.yLabel, 'Min group delay (ms)');
    assert.equal(result.views.excessGroupDelay.yLabel, 'Excess group delay (ms)');
    assert.equal(result.views.impulse.xLabel, 'Time (ms)');
});

test('smooths finite frequency runs without crossing gaps or re-zeroing group delay', () => {
    const responseSpectrum = {
        frequencies: new Float32Array([100, 200, 400, 800, 1000, 2000, 4000]),
        magnitudeDb: new Float32Array([0, 12, 0, Number.NaN, 3, 15, 3]),
        phaseDegrees: new Float32Array([0, 0, 0, 0, 0, 0, 0]),
        groupDelayMs: new Float32Array([2, 14, 2, 9, 5, 17, 5]),
        minimumGroupDelayMs: new Float32Array([1, 7, 1, 4, 2, 8, 2]),
        excessGroupDelayMs: new Float32Array([1, 7, 1, 5, 3, 9, 3]),
        valid: new Uint8Array([1, 1, 1, 0, 1, 1, 1])
    };
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        before: { impulse: new Float32Array([1]), spectrum: responseSpectrum, timeOriginSamples: 0 },
        after: { impulse: new Float32Array([1]), spectrum: responseSpectrum, timeOriginSamples: 0 }
    }, { displaySettings: { smoothingOct: 0.5, impulseRangeMs: 6 } });

    const frequency = result.views.frequency.curves[0].points;
    const minimumGroupDelay = result.views.minimumGroupDelay.curves[0].points;
    const excessGroupDelay = result.views.excessGroupDelay.curves[0].points;
    assert.equal(Number.isNaN(frequency[3].x), true);
    assert.equal(Number.isNaN(minimumGroupDelay[3].x), true);
    assert.equal(Number.isNaN(excessGroupDelay[3].x), true);
    assert.notEqual(frequency[1].yValue, 12 - result.displayReference.before.frequencyNormalizationDb);
    assert.notEqual(minimumGroupDelay[1].yValue, 7);
    assert.notEqual(minimumGroupDelay[4].yValue, 0);
    assert.notEqual(excessGroupDelay[1].yValue, 7);
    assert.notEqual(excessGroupDelay[4].yValue, 0);
});

test('normalizes each impulse by its full peak and uses the selected fixed time window', () => {
    const result = adaptPipelineAnalysisResult({
        sampleRate: 1000,
        before: {
            impulse: new Float32Array([0, 2, -1, 0]),
            spectrum: spectrum(),
            timeOriginSamples: -1
        },
        after: {
            impulse: new Float32Array([0, -4, 2, 0]),
            spectrum: spectrum(),
            timeOriginSamples: -1
        }
    }, { displaySettings: { smoothingOct: 0.17, impulseRangeMs: 1 } });

    const [before, after] = result.views.impulse.curves;
    assert.deepEqual(before.points.map(point => point.yValue), [0, 1, -0.5]);
    assert.deepEqual(after.points.map(point => point.yValue), [0, -1, 0.5]);
    assert.deepEqual(result.views.impulse.yTicks.map(tick => tick.label), ['', '0.5', '0', '-0.5', '']);
    assert.deepEqual(result.views.impulse.xTicks.map(tick => tick.label),
        ['-1.5', '-1.0', '-0.5', '0.0', '0.5 ms']);
    assert.ok(Math.abs(result.views.impulse.xTicks[3].position - 2 / 3) < 1e-12);
    assert.equal(result.displayReference.before.impulseDivisor, 2);
    assert.equal(result.displayReference.after.impulseDivisor, 4);
});

test('application locales retain only the shared menu entry as a runtime requirement', () => {
    const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
    for (const locale of locales) {
        const source = fs.readFileSync(
            new URL(`../../js/locales/${locale}.json5`, import.meta.url),
            'utf8'
        );
        const messages = JSON.parse(source
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, ''));
        assert.equal(messages['menu.view.pipelineAnalyzer'], 'Pipeline Analyzer');
    }
});

test('normalizes each very quiet finite response independently before applying the display floor', () => {
    const responseSpectrum = magnitudeDb => ({
        frequencies: new Float32Array([20, 1000, 20000]),
        magnitudeDb: new Float32Array(magnitudeDb),
        phaseDegrees: new Float32Array([0, 0, 0]),
        groupDelayMs: new Float32Array([0, 0, 0]),
        minimumGroupDelayMs: new Float32Array([0, 0, 0]),
        excessGroupDelayMs: new Float32Array([0, 0, 0]),
        valid: new Uint8Array([1, 1, 1])
    });
    const result = adaptPipelineAnalysisResult({
        sampleRate: 48000,
        before: {
            impulse: new Float32Array([1]),
            spectrum: responseSpectrum([-140, -140, -140]),
            timeOriginSamples: 0
        },
        after: {
            impulse: new Float32Array([1]),
            spectrum: responseSpectrum([-146, -146, -146]),
            timeOriginSamples: 0
        }
    });

    assert.ok(Math.abs(result.displayReference.before.frequencyNormalizationDb + 140) < 1e-9);
    assert.ok(Math.abs(result.displayReference.after.frequencyNormalizationDb + 146) < 1e-9);
    const [before, after] = result.views.frequency.curves;
    assert.deepEqual(
        before.points.map(point => point.yLabel),
        ['0.0 dB', '0.0 dB', '0.0 dB']
    );
    assert.deepEqual(
        after.points.map(point => point.yLabel),
        ['0.0 dB', '0.0 dB', '0.0 dB']
    );
    assert.equal(before.points.every(point => Math.abs(point.y - 0.5) < 1e-9), true);
    assert.equal(after.points.every(point => Math.abs(point.y - 0.5) < 1e-9), true);
});
