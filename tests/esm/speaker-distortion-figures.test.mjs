import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bestPossibleTotal,
    classFigure,
    formatDb,
    formatDbRange,
    formatDuration,
    formatLevel,
    formatMeasuredAt,
    hasFit,
    levelFigure,
    measurementTitle,
    nullFigureText
} from '../../features/measurement/speaker-distortion-figures.js';
import { SCALE_ADD, SCALE_MEASURED, SCALE_REDUCE } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

const LEVEL = '{db} dB ({pct} %)';
const dB = (numerator, denominator) => 10 * Math.log10(numerator / denominator);

test('formatLevel shows dB with a percentage whose decimals depend on its size', () => {
    assert.equal(formatLevel(-46.6, LEVEL), '−46.6 dB (0.47 %)');
    assert.equal(formatLevel(-30, LEVEL), '−30.0 dB (3.2 %)');
    assert.equal(formatLevel(-70, LEVEL), '−70.0 dB (0.032 %)');
});

test('formatDb signs values only beyond 0.05 dB and formatDbRange orders its ends', () => {
    assert.equal(formatDb(0.06, '-'), '+0.1 dB');
    assert.equal(formatDb(0.04, '-'), '0.0 dB');
    assert.equal(formatDb(-0.04, '-'), '0.0 dB');
    assert.equal(formatDb(-0.06, '-'), '−0.1 dB');
    assert.equal(formatDb(null, 'too small'), 'too small');
    assert.equal(formatDbRange(-1, -3, '{a} to {b} dB', '-'), '−3.0 to −1.0 dB');
    assert.equal(formatDbRange(2, null, '{a} to {b} dB', 'n/a'), 'n/a');
});

test('classFigure and levelFigure follow the stored power and ref sums', () => {
    const [entry, second] = createSpeakerModel().channels;
    assert.equal(hasFit(entry, 'short'), true);
    assert.equal(hasFit(entry, 'long'), false);

    assert.equal(classFigure(entry, 'short', 'L', 'c1', SCALE_REDUCE), -0.5);
    assert.equal(classFigure(entry, 'short', 'L', 'c3', SCALE_REDUCE), null);
    assert.equal(classFigure(entry, 'short', 'L', 'even8k', SCALE_ADD), -0.5 * (SCALE_ADD + 5));

    for (const set of ['L-6', 'peaks']) {
        const powers = entry.power.short[set];
        const odd = entry.ref[set][101];
        assert.ok(Math.abs(classFigure(entry, 'short', set, 'c2', SCALE_REDUCE) -
            dB(powers[SCALE_REDUCE][51], powers[SCALE_MEASURED][51])) < 1e-9);
        assert.ok(Math.abs(classFigure(entry, 'short', set, 'even8k', SCALE_REDUCE) -
            dB(powers[SCALE_REDUCE][54], powers[SCALE_MEASURED][54])) < 1e-9);
        assert.ok(Math.abs(classFigure(entry, 'short', set, 'total', SCALE_ADD) -
            dB(odd + powers[SCALE_ADD][54], odd + powers[SCALE_MEASURED][54])) < 1e-9);
    }
    assert.equal(classFigure(entry, 'long', 'L-6', 'c1', SCALE_REDUCE), null);

    for (const set of ['L', 'peaks']) {
        const ref = second.ref[set];
        const even = second.power.long[set][SCALE_REDUCE][54];
        const level = levelFigure(second, 'long', set, SCALE_REDUCE);
        assert.ok(Math.abs(level.total - dB(ref[101] + even, ref[50])) < 1e-9);
        assert.ok(Math.abs(level.even - dB(even, ref[50])) < 1e-9);
    }
    assert.deepEqual(levelFigure(entry, 'long', 'L', SCALE_REDUCE), { total: null, even: null });
});

test('bestPossibleTotal removes the even share of the total', () => {
    assert.ok(Math.abs(bestPossibleTotal(-40, -43) - 10 * Math.log10(1 - 10 ** -0.3)) < 1e-12);
    assert.equal(bestPossibleTotal(-40, -40), null);
    assert.equal(bestPossibleTotal(null, -43), null);
});

test('nullFigureText tells a class above the Upper Limit from one too small to measure', () => {
    const text = { aboveLimit: 'above', tooSmall: 'small' };
    assert.equal(nullFigureText('c3', 400, text), 'above');
    assert.equal(nullFigureText('c3', 2000, text), 'small');
});

test('measurementTitle names saved records and dates unsaved ones', () => {
    const speakerModel = { measuredAt: Date.UTC(2026, 10, 13, 9, 30) };
    const when = formatMeasuredAt(speakerModel.measuredAt, 'en-US');
    assert.equal(measurementTitle({ name: 'Desk', savedAt: 1, speakerModel }, 'en-US', 'Untitled'), `Desk — ${when}`);
    assert.equal(measurementTitle({ name: '  ', savedAt: 1, speakerModel }, 'en-US', 'Untitled'),
        `Untitled — ${when}`);
    assert.equal(measurementTitle({ name: 'Desk', speakerModel }, 'en-US', 'Untitled'), when);
});

test('formatDuration switches to whole minutes at 90 seconds', () => {
    const text = { minute: 'about a minute', minutes: 'about {n} minutes' };
    assert.equal(formatDuration(89, text), 'about a minute');
    assert.equal(formatDuration(90, text), 'about 2 minutes');
});
