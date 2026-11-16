import test from 'node:test';
import assert from 'node:assert/strict';

import {
    N_BANDS,
    REF_LENGTH,
    REF_ODD,
    REF_SET,
    REF_X,
    SETS,
    SWEEP_FREQUENCIES
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import {
    SET_CALLS,
    autoRange,
    chartA,
    chartB,
    chartD,
    chartH,
    chartS,
    chartT,
    chartT3,
    compareOptions,
    factsLine,
    formatHz,
    formatSpan,
    frequencyTicks,
    isMatched,
    levelTicks,
    offReasonText,
    overloadSpan,
    percentTicks,
    rangeBounds,
    rangeDefaults,
    rangedFrame,
    rattleSpan,
    readingList,
    staticMapScale,
    staticScale,
    summaryLines,
    summaryTable,
    summaryTsv
} from '../../features/measurement/distortion-diagnosis.js';
import { sweepH3View, sweepStaticView } from '../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

// English texts the assertions read; any other key resolves to "key(param=value,...)".
const TEXTS = {
    'analysis:levelFormat': '{db} dB ({pct} %)',
    'analysis:diagTooSmall': 'too small to measure',
    'analysis:diagKindSecondOrder': 'Second-order, grows with level (correctable)',
    'analysis:diagKindOdd': 'Mostly odd-order (not reduced by the correction)',
    'analysis:diagKindOddReduced': 'Mostly odd-order (partly reduced by the correction)',
    'analysis:diagKindTooSmall': 'Too small to judge',
    'analysis:diagKindOutside': 'Outside the correction',
    'analysis:diagKindCorrectedUpTo': ' — corrected up to {f}',
    'analysis:diagKindRattle': '; rattle around {range} (not correctable)',
    'analysis:rattleOutside': 'It is already above the Upper Limit.',
    'button:excludeRattle': 'Correct only below {f} (avoids the rattle)'
};

function t(key, params = {}) {
    const text = TEXTS[key];
    if (text !== undefined) return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    const names = Object.keys(params);
    return names.length ? `${key}(${names.map(name => `${name}=${params[name]}`).join(',')})` : key;
}

const MINUS = '−';
const lin = valueDb => 10 ** (valueDb / 10);
// 1/6-octave bands of rule band k (1/3 octave).
const ruleBand = k => [2 * k, 2 * k + 1];
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
const ruleBands = (first, last) => range(first, last).flatMap(ruleBand);
const obsKeys = items => items.map(item => item.obs.replace(/\(.*$/, ''));

/**
 * Model whose `channel` has a controlled diagnosis: one tone per band at 0 dB,
 * nothing above the noise floor, no noise, no hum and no sweep data.
 */
function blankModel(channel = 0) {
    const model = createSpeakerModel(2);
    const entry = model.channels[channel];
    const zeros = () => new Float32Array(N_BANDS);
    const sweep = () => ({
        h: Array.from({ length: 10 }, zeros),
        h1: Array.from({ length: 9 }, () => new Float32Array(N_BANDS).fill(1)),
        z: Array.from({ length: 9 }, zeros)
    });
    entry.diagnosis = {
        nx: new Uint16Array(N_BANDS).fill(1),
        sets: Object.fromEntries(SETS.map(set => [set, { ev: zeros(), evPn: zeros(), odPn: zeros(), noise: zeros() }])),
        silence: zeros(),
        hum50: new Float32Array(20),
        hum60: new Float32Array(16),
        ess: { essL: sweep(), ess6: sweep(), pts: new Uint16Array(N_BANDS) }
    };
    entry.ref = Object.fromEntries(SETS.map(set => {
        const ref = new Float32Array(REF_LENGTH);
        for (let i = 0; i <= REF_SET; i++) ref[REF_X + i] = SET_CALLS[set];
        return [set, ref];
    }));
    return { model, entry };
}

// Tone level (dB per band) and multitone levels of one record set.
function setTone(entry, set, bands, toneDb) {
    for (const i of bands) entry.ref[set][REF_X + i] = SET_CALLS[set] * lin(toneDb);
}
function setEven(entry, set, bands, valueDb, toneDb = 0) {
    for (const i of bands) entry.diagnosis.sets[set].ev[i] = lin(toneDb + valueDb);
}
function setOdd(entry, set, bands, valueDb) {
    for (const i of bands) entry.ref[set][REF_ODD + i] = SET_CALLS[set] * lin(valueDb);
}
// Harmonic ratio of order n in one sweep.
function setSweep(entry, sweep, n, bands, ratioDb) {
    for (const i of bands) entry.diagnosis.ess[sweep].h[n - 1][i] = lin(ratioDb);
}
// Gain difference D (chart D) of rule bands.
function setGain(entry, bands, gainDb) {
    const ess = entry.diagnosis.ess;
    for (const i of bands) {
        ess.pts[i] = 1;
        ess.essL.h[0][i] = lin(gainDb);
        ess.ess6.h[0][i] = 1;
    }
}
function setRattle(entry, bands) {
    const diagnosis = entry.diagnosis;
    diagnosis.silence.fill(1);
    for (const i of bands) {
        diagnosis.sets.L.noise[i] = 10;
        diagnosis.sets['L-6'].noise[i] = 1;
    }
}
// Square-law even-order change of `changeDb` from L to L-6 over rule bands first..last.
function setEvenChange(entry, first, last, changeDb) {
    setEven(entry, 'L', ruleBands(first, last), -40);
    setEven(entry, 'L-6', ruleBands(first, last), -40 + changeDb);
}

test('formats frequencies and spans', () => {
    assert.equal(formatHz(125.9), '126 Hz');
    assert.equal(formatHz(1587), '1.6 kHz');
    assert.equal(formatHz(8000), '8 kHz');
    assert.equal(formatSpan(126, 252), '126 – 252 Hz');
    assert.equal(formatSpan(2000, 8000), '2 – 8 kHz');
    assert.equal(formatSpan(504, 1000), '504 Hz – 1 kHz');
});

test('summary table: rows, level cells, change and likely kind', () => {
    const { model, entry } = blankModel();
    model.upperLimitHz = 1000;
    // Row bands: below 100 Hz = 0..11, 100-400 Hz = 12..23, 400 Hz-2 kHz = 24..37, 2-8 kHz = 38..49.
    setEven(entry, 'L', range(0, 11), -46.6);
    setEven(entry, 'L-6', range(0, 11), -52.6);
    setEven(entry, 'L', range(12, 23), -30);
    setOdd(entry, 'L', range(12, 23), -25);
    setEven(entry, 'L', range(24, 37), -70);
    setRattle(entry, range(12, 15));

    const table = summaryTable(model, entry, 'short', t);
    assert.deepEqual(table.rows.map(row => row.name),
        ['label:bandBelow100', 'label:band100to400', 'label:band400to2k', 'label:band2kto8k']);
    assert.equal(table.heads.length, 6);
    const [below100, low, mid, high] = table.rows;
    assert.equal(below100.cells[0].text, `${MINUS}46.6 dB (0.47 %)`);
    assert.equal(below100.cells[1].text, `${MINUS}52.6 dB (0.23 %)`);
    assert.equal(below100.cells[2].text, 'too small to measure');
    assert.equal(below100.change.text, `${MINUS}6.0 dB`);
    assert.equal(below100.kind, 'Second-order, grows with level (correctable)');
    // Total of both parities; 1 % or more uses one decimal.
    assert.match(low.cells[0].text, /^−23\.8 dB \(6\.5 %\)$/);
    assert.equal(low.change.text, '—');
    assert.equal(low.kind, 'Mostly odd-order (not reduced by the correction); rattle around 100 – 159 Hz (not correctable)');
    // Below 0.1 % uses three decimals; the Upper Limit inside the row adds its suffix.
    assert.equal(mid.cells[0].text, `${MINUS}70.0 dB (0.032 %)`);
    assert.equal(mid.kind, 'Second-order, grows with level (correctable) — corrected up to 1 kHz');
    assert.equal(high.cells[0].text, 'too small to measure');
    assert.equal(high.kind, 'Outside the correction');

    // The odd block reduces odd-order rows below 2 kHz, and only where Auto plays it.
    model.upperLimitHz = 8000;
    setEven(entry, 'L', range(38, 49), -60);
    setOdd(entry, 'L', range(38, 49), -50);
    const oddKinds = () => {
        const rows = summaryTable(model, entry, 'short', t).rows;
        return [rows[1], rows[3]].map(row => row.kind.replace(/;.*$/, ''));
    };
    const notReduced = 'Mostly odd-order (not reduced by the correction)';
    entry.odd = {
        weights: new Float32Array(32), fitReason: null, on: { short: true, long: false, alone: false },
        reason: { short: null, long: 'notChecked', alone: 'notChecked' }
    };
    assert.deepEqual(oddKinds(), ['Mostly odd-order (partly reduced by the correction)', notReduced]);
    entry.on.short = false;
    assert.deepEqual(oddKinds(), [notReduced, notReduced], 'with the even block off, Auto plays the odd block alone');
    entry.on.short = true;
    entry.odd.on.short = false;
    assert.deepEqual(oddKinds(), [notReduced, notReduced]);

    entry.weights.short = null;
    assert.equal(summaryTable(model, entry, 'short', t).rows[0].kind, 'Too small to judge');
    // A row without any tone shows a dash in every cell.
    entry.diagnosis.nx.fill(0, 0, 12);
    const empty = summaryTable(model, entry, 'short', t).rows[0];
    assert.equal(empty.empty, true);
    assert.deepEqual(empty.cells.map(cell => cell.text), ['—', '—', '—']);
    assert.equal(empty.kind, '—');
});

test('summary lines: measured, predicted and none without a fit', () => {
    const model = createSpeakerModel(1);
    const entry = model.channels[0];
    const measured = summaryLines(entry, 'short', t);
    assert.equal(measured.length, 4);
    assert.equal(measured[0], 'analysis:diagSumLine1(length=analysis:diagShort)');
    assert.equal(measured[1], 'analysis:diagSumLine2Measured('
        + `total=${MINUS}46.6 dB (0.47 %) → ${MINUS}52.1 dB (0.25 %),even=${MINUS}45.9 dB (0.51 %) → ${MINUS}55.0 dB (0.18 %))`);
    assert.match(measured[2], /^analysis:diagSumLine3\(pair=.+ → .+\)$/);
    assert.match(measured[3], /^analysis:diagSumLine4\(pair=.+ → .+\)$/);

    entry.checkFig.short = null;
    assert.match(summaryLines(entry, 'short', t)[1], /^analysis:diagSumLine2Predicted\(total=.+ → .+,even=.+ → .+\)$/);
    assert.deepEqual(summaryLines(entry, 'long', t), []);
});

test('facts line: check state and the microphone warning', () => {
    const model = createSpeakerModel(2);
    const [first, second] = model.channels;
    const facts = (entry, length) => factsLine(model, entry, length, t, 'en');
    assert.match(facts(first, 'short'), /check=analysis:diagFactsChecked\)$/);
    assert.match(facts(first, 'short'), /position=label:positionInFront/);
    assert.match(facts(first, 'short'), new RegExp(`level=${MINUS}20\\.0,peak=${MINUS}8\\.0,averaging=×2`));
    assert.match(facts(first, 'long'), /check=analysis:diagFactsNotChecked\)$/);
    model.lastCheck = { at: Date.UTC(2026, 10, 14, 8, 0) };
    assert.match(facts(first, 'short'), /check=analysis:diagFactsCheckedAgain\(when=.+\)\)$/);
    assert.ok(facts(second, 'short').endsWith(' · analysis:diagMicrophoneDistorted'));
    assert.ok(!facts(first, 'short').includes('diagMicrophoneDistorted'));
});

test('rule 1 fires inside -8 to -4 dB and not just outside', () => {
    for (const [change, fires] of [[-6, true], [-4.1, true], [-7.9, true], [-3.9, false], [-8.1, false]]) {
        const { model, entry } = blankModel();
        setEvenChange(entry, 5, 9, change);
        const keys = obsKeys(readingList(model, entry, t));
        assert.equal(keys.includes('analysis:diagR1Obs'), fires, `change ${change}`);
        // The not-evaluable item appears only when rule 1 did not fire.
        assert.equal(keys.includes('analysis:diagNotEvalObs'), !fires, `change ${change}`);
    }
    const { model, entry } = blankModel();
    setSweep(entry, 'essL', 2, ruleBands(5, 9), -40);
    setSweep(entry, 'ess6', 2, ruleBands(5, 9), -46);
    const [item] = readingList(model, entry, t);
    assert.match(item.obs, /source=analysis:diagR1SourceH2,m=6\.0,span=79 – 252 Hz,chart=analysis:diagTitleA/);
});

test('rule 1 action: length, measured or predicted figure and the off forms', () => {
    const action = (configure) => {
        const { model, entry } = blankModel(1);
        setEvenChange(entry, 5, 9, -6);
        configure(model, entry);
        const [item] = readingList(model, entry, t);
        return item;
    };
    // Channel 1 is fitted for both lengths; only Short has a correction check.
    const onlyShort = action((model, entry) => { entry.on = { short: true, long: false }; });
    assert.equal(onlyShort.tag, 'on');
    assert.match(onlyShort.text, /analysis:diagR1Action\(length=analysis:diagShort,a=2\.5,kind=analysis:diagMeasured,b=/);
    const onlyLong = action((model, entry) => { entry.on = { short: false, long: true }; });
    assert.match(onlyLong.text, /length=analysis:diagLong,a=3\.0,kind=analysis:diagPredicted/);
    const recommendedLong = action((model, entry) => {
        entry.on = { short: true, long: true };
        model.recommendedLength = 'long';
    });
    assert.match(recommendedLong.text, /length=analysis:diagLong/);
    const noL6 = action((model, entry) => {
        entry.on = { short: false, long: true };
        entry.power.long['L-6'] = [entry.power.long['L-6'][0]];
    });
    assert.match(noL6.text, /analysis:diagR1ActionNoL6\(length=analysis:diagLong,a=3\.0,kind=analysis:diagPredicted\)/);
    const nearOnly = action((model, entry) => {
        entry.on = { short: false, long: true };
        const [measured, reduced] = entry.power.long['L-6'];
        reduced[54] = measured[54] * lin(-1);
    });
    assert.match(nearOnly.text, /b=1\.0\)analysis:diagR1NearOnly$/);

    const sameReason = action(() => {});
    assert.equal(sameReason.tag, 'off');
    assert.equal(sameReason.text, 'analysis:diagR1Cause analysis:diagR1NotExpected '
        + 'message:speakerDistortionReasonWorseInCheck(band=message:speakerDistortionBand100to400)');
    const twoReasons = action((model, entry) => { entry.reason.long = 'littleGain'; });
    assert.match(twoReasons.text, /analysis:speakerDistortionShortPrefix\(reason=message:speakerDistortionReasonWorseInCheck.+\) analysis:speakerDistortionLongPrefix\(reason=message:speakerDistortionReasonLittleGain\)$/);
});

test('rules 2 to 9 fire on their conditions and not just outside', () => {
    const fired = (configure, key) => {
        const { model, entry } = blankModel();
        configure(model, entry);
        return obsKeys(readingList(model, entry, t)).includes(key);
    };
    const sweepChange = change => (model, entry) => {
        setSweep(entry, 'essL', 3, ruleBands(10, 12), -50);
        setSweep(entry, 'ess6', 3, ruleBands(10, 12), -50 + change);
    };
    assert.ok(fired(sweepChange(-1.5), 'analysis:diagR2Obs'));
    assert.ok(fired(sweepChange(1.9), 'analysis:diagR2Obs'));
    assert.ok(!fired(sweepChange(2.1), 'analysis:diagR2Obs'));
    assert.ok(!fired(sweepChange(-2.1), 'analysis:diagR2Obs'));
    assert.ok(fired(sweepChange(2.1), 'analysis:diagR3Obs'));
    assert.ok(!fired(sweepChange(1.9), 'analysis:diagR3Obs'));

    const onset = orders => (model, entry) => {
        for (const n of orders) {
            setSweep(entry, 'essL', n, ruleBands(15, 16), -40);
            setSweep(entry, 'ess6', n, ruleBands(15, 16), -55);
        }
    };
    assert.ok(fired(onset([2, 3, 4]), 'analysis:diagR4Obs'));
    assert.ok(!fired(onset([2, 3]), 'analysis:diagR4Obs'));
    const highOrder = blankModel();
    onset([2, 3, 4])(highOrder.model, highOrder.entry);
    assert.equal(readingList(highOrder.model, highOrder.entry, t)
        .find(item => item.obs.startsWith('analysis:diagR4Obs')).tab, 'diagnosisHarmonics');

    assert.ok(fired((model, entry) => setRattle(entry, ruleBand(13)), 'analysis:diagR5Obs'));
    assert.ok(!fired((model, entry) => {
        setRattle(entry, ruleBand(13));
        entry.diagnosis.sets['L-6'].noise.fill(4);
    }, 'analysis:diagR5Obs'));

    assert.ok(fired((model, entry) => { entry.diagnosis.hum50[0] = 10; }, 'analysis:diagR6Obs'));
    assert.ok(!fired((model, entry) => { entry.diagnosis.hum60[2] = 9.9; }, 'analysis:diagR6Obs'));

    assert.ok(fired((model, entry) => setGain(entry, ruleBands(10, 12), -0.5), 'analysis:diagR7Obs'));
    assert.ok(!fired((model, entry) => {
        setGain(entry, ruleBands(10, 12), -0.5);
        setGain(entry, ruleBand(13), -0.2);
    }, 'analysis:diagR7Obs'));

    // Bass compression only when rule 7 did not fire.
    assert.ok(fired((model, entry) => setGain(entry, ruleBands(2, 3), -1), 'analysis:diagR8Obs'));
    assert.ok(!fired((model, entry) => setGain(entry, ruleBands(2, 3), -0.4), 'analysis:diagR8Obs'));
    assert.ok(!fired((model, entry) => {
        setGain(entry, ruleBands(2, 3), -1);
        setGain(entry, ruleBands(10, 12), -0.5);
    }, 'analysis:diagR8Obs'));

    const asymmetry = oddDb => (model, entry) => {
        setEven(entry, 'L', ruleBands(10, 12), -40);
        setOdd(entry, 'L', ruleBands(10, 12), oddDb);
    };
    assert.ok(fired(asymmetry(-50), 'analysis:diagR9Obs'));
    assert.ok(!fired(asymmetry(-45), 'analysis:diagR9Obs'));
});

test('overload: one octave at 1 dB down comes first and replaces rules 7, 8 and the rattle', () => {
    const { model, entry } = blankModel();
    setGain(entry, ruleBands(10, 12), -1.5);
    setGain(entry, ruleBand(11), -2.5);
    setGain(entry, ruleBands(2, 3), -1);
    setRattle(entry, ruleBand(13));
    const overload = overloadSpan(model, entry);
    assert.equal(formatSpan(overload.lo, overload.hi), '252 – 504 Hz');
    assert.ok(Math.abs(overload.drop - 2.5) < 1e-3);
    assert.equal(rattleSpan(model, entry), null);
    assert.equal(chartB(model, entry, 'third', t).note, 'analysis:diagRattleNotChecked');
    const shaded = items => items.filter(item => item.kind === 'area' || item.text === 'analysis:diagOverloadRange');
    for (const [chart, key] of [[chartA(model, entry, t), 'A'], [chartD(model, entry, t), 'D']]) {
        const [area, overloadLegend] = shaded(chart.items);
        assert.deepEqual(area.points.map(point => formatHz(point.x)), [formatHz(overload.lo), formatHz(overload.hi)]);
        assert.equal(overloadLegend.kind, 'legend');
        assert.equal(chart.note, `analysis:diagOverloadNote${key}(span=252 – 504 Hz)`);
        assert.equal(chart.warning, true);
    }
    const items = readingList(model, entry, t);
    assert.deepEqual(obsKeys(items), ['analysis:diagOverloadObs', 'analysis:diagNotEvalObs']);
    assert.equal(items[0].tag, 'off');
    assert.match(items[0].obs, /m=2\.5,span=252 – 504 Hz,chart=analysis:diagTitleD/);

    // Two bands, or three split by a band without data, are not an overload.
    const short = blankModel();
    setGain(short.entry, ruleBands(10, 12), -1.5);
    setGain(short.entry, ruleBand(11), -0.9);
    setRattle(short.entry, ruleBand(13));
    assert.equal(overloadSpan(short.model, short.entry), null);
    assert.match(chartB(short.model, short.entry, 'third', t).note, /^analysis:diagRattleRise/);
    for (const chart of [chartA(short.model, short.entry, t), chartD(short.model, short.entry, t)]) {
        assert.deepEqual(shaded(chart.items), []);
        assert.equal(chart.note, null);
    }
    assert.deepEqual(obsKeys(readingList(short.model, short.entry, t)), ['analysis:diagR5Obs', 'analysis:diagR7Obs',
        'analysis:diagNotEvalObs']);
    const split = blankModel();
    setGain(split.entry, ruleBands(10, 14), -1.5);
    split.entry.diagnosis.ess.pts.fill(0, 24, 26);
    assert.equal(overloadSpan(split.model, split.entry), null);
});

test('rule 9 is correctable only with a correctable rule 1', () => {
    const { model, entry } = blankModel();
    setEvenChange(entry, 5, 9, -6);
    setOdd(entry, 'L', ruleBands(5, 9), -50);
    const items = readingList(model, entry, t);
    const rule9 = items.find(item => item.obs.startsWith('analysis:diagR9Obs'));
    assert.equal(items[0].tag, 'on');
    assert.equal(rule9.tag, 'on');
    assert.match(rule9.text, /analysis:diagR9ActionOn$/);
});

test('rule 5 button depends on the rattle start and the Upper Limit', () => {
    const rattle = (k, upperLimitHz) => {
        const { model, entry } = blankModel();
        model.upperLimitHz = upperLimitHz;
        setRattle(entry, ruleBand(k));
        return readingList(model, entry, t).find(item => item.obs.startsWith('analysis:diagR5Obs'));
    };
    const inside = rattle(13, 8000);
    assert.deepEqual(inside.button, { text: 'Correct only below 504 Hz (avoids the rattle)', hz: 504 });
    assert.equal(inside.muted, null);
    const outside = rattle(13, 500);
    assert.equal(outside.button, null);
    assert.equal(outside.muted, 'It is already above the Upper Limit.');
    const low = rattle(12, 8000);
    assert.equal(low.button, null);
    assert.equal(low.muted, null);
});

test('reading list: at most five rule items in rule order, then nothing-found', () => {
    const { model, entry } = blankModel();
    setSweep(entry, 'essL', 3, ruleBands(10, 12), -50);
    setSweep(entry, 'ess6', 3, ruleBands(10, 12), -49);
    setSweep(entry, 'essL', 5, ruleBands(10, 12), -50);
    setSweep(entry, 'ess6', 5, ruleBands(10, 12), -47);
    setRattle(entry, ruleBand(20));
    entry.diagnosis.hum50[0] = 20;
    setGain(entry, ruleBands(10, 12), -0.5);
    setEven(entry, 'L', ruleBands(18, 20), -40);
    const items = readingList(model, entry, t);
    assert.deepEqual(obsKeys(items), ['analysis:diagR2Obs', 'analysis:diagR3Obs', 'analysis:diagR5Obs',
        'analysis:diagR6Obs', 'analysis:diagR7Obs', 'analysis:diagNotEvalObs']);
    // Each finding links to the result tab that shows its chart; "Not evaluable" has no chart.
    assert.deepEqual(items.map(item => item.tab), [...Array(5).fill('diagnosisLevel'), null]);

    const quiet = blankModel();
    setEvenChange(quiet.entry, 0, 24, -10);
    assert.deepEqual(readingList(quiet.model, quiet.entry, t),
        [{ obs: 'analysis:diagNothingFound', tab: null, tag: null, text: null, button: null, muted: null }]);
});

test('chart T: measured and expected single-tone H2 per fitted length, breaks at unobserved points', () => {
    const { model, entry } = blankModel();
    entry.sweep = null;
    assert.equal(chartT(model, entry, t).items.at(-1).text, 'analysis:diagChannelFailed');
    const count = SWEEP_FREQUENCIES.length;
    const record = () => new Float32Array(count).fill(NaN);
    entry.sweep = { levelDbfs: -20, teRe: record(), teIm: record(), noise: record(), gRatio: record(),
        t3Re: record(), t3Im: record(), noise3: record(), gRatio3: record() };
    entry.sweepResponse = { short: null, long: null };
    assert.equal(chartT(model, entry, t).items.at(-1).text, 'analysis:diagNotEnoughSignal');
    for (const k of [10, 11]) {
        entry.sweep.teRe[k] = 0.01;
        entry.sweep.teIm[k] = 0;
        entry.sweep.noise[k] = 0.001;
        entry.sweep.gRatio[k] = 2;
    }
    const noFit = chartT(model, entry, t);
    assert.equal(noFit.note, 'analysis:diagNoFit');
    assert.equal(noFit.items.filter(item => item.kind === 'curve').length, 1);
    entry.sweepResponse.short = new Float32Array(2 * count);
    entry.sweepResponse.short[20] = 0.005;
    const chart = chartT(model, entry, t);
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} vs ${expected}`);
    const [measured, short] = chart.items.filter(item => item.kind === 'curve').map(item => item.points);
    near(measured[10].y, 20 * Math.log10(0.02));
    near(short[10].y, 20 * Math.log10(0.01));
    near(short[11].y, 20 * Math.log10(0.02));
    assert.equal(measured[9], null);
    assert.equal(measured[10].x, SWEEP_FREQUENCIES[10]);
    near(chart.items[0].points[10].top, 20 * Math.log10(0.002));
    assert.deepEqual(chart.items.filter(item => item.kind === 'legend').map(item => item.text), [
        'analysis:diagLegendSingleToneMeasured',
        'analysis:diagLegendSingleToneExpected(length=analysis:diagShort)',
        'analysis:diagLegendNoiseFloor'
    ]);
    assert.equal(chart.note, null);
    assert.equal(chart.frame.yTickLabel(-40), '1 %');
});

test('chart T3: measured single-tone H3 and one expected line whenever an odd fit exists', () => {
    const { model, entry } = blankModel();
    entry.sweep = null;
    assert.equal(chartT3(model, entry, t).items.at(-1).text, 'analysis:diagChannelFailed');
    const count = SWEEP_FREQUENCIES.length;
    const record = () => new Float32Array(count).fill(NaN);
    entry.sweep = { levelDbfs: -20, teRe: record(), teIm: record(), noise: record(), gRatio: record(),
        t3Re: record(), t3Im: record(), noise3: record(), gRatio3: record() };
    entry.odd = null;
    assert.equal(chartT3(model, entry, t).items.at(-1).text, 'analysis:diagNotEnoughSignal');
    for (const k of [30, 31]) {
        entry.sweep.t3Re[k] = 0.01;
        entry.sweep.t3Im[k] = 0;
        entry.sweep.noise3[k] = 0.001;
        entry.sweep.gRatio3[k] = 2;
    }
    const noFit = chartT3(model, entry, t);
    assert.equal(noFit.note, 'analysis:diagNoOddFit');
    assert.equal(noFit.items.filter(item => item.kind === 'curve').length, 1);
    // The expected line shows also when the odd block stays off.
    entry.odd = { fitReason: 'worseForSingleTones', sweepResponse: new Float32Array(2 * count) };
    entry.odd.sweepResponse[60] = -0.01;
    const chart = chartT3(model, entry, t);
    const view = sweepH3View(entry.sweep, entry.odd.sweepResponse);
    const curves = chart.items.filter(item => item.kind === 'curve');
    assert.deepEqual(curves.map(item => item.color), ['--sdc-h3', '--sdc-odd']);
    const [measured, expected] = curves.map(item => item.points);
    assert.equal(measured[30].y, view.measured[30]);
    assert.equal(expected[30].y, view.expected[30]);
    assert.equal(measured[29], null);
    assert.deepEqual(chart.items.filter(item => item.kind === 'legend').map(item => item.text), [
        'analysis:diagLegendSingleToneMeasured',
        'analysis:diagLegendSingleToneExpectedOdd',
        'analysis:diagLegendNoiseFloor'
    ]);
    assert.equal(chart.note, null);
});

test('chart S: peak gains, dotted static bounds, the noise band and the map in an adaptive frame', () => {
    const { model, entry } = blankModel();
    entry.sweep = null;
    assert.equal(chartS(model, entry, t).items.at(-1).text, 'analysis:diagChannelFailed');
    const count = SWEEP_FREQUENCIES.length;
    const record = () => new Float32Array(count).fill(NaN);
    entry.sweep = { levelDbfs: -20, teRe: record(), teIm: record(), noise: record(), gRatio: record(),
        t3Re: record(), t3Im: record(), noise3: record(), gRatio3: record() };
    assert.equal(chartS(model, entry, t).items.at(-1).text, 'analysis:diagNotEnoughSignal');
    for (const k of [30, 31]) {
        for (const [re, im, noise] of [['teRe', 'teIm', 'noise'], ['t3Re', 't3Im', 'noise3']]) {
            entry.sweep[re][k] = 0.02;
            entry.sweep[im][k] = 0;
            entry.sweep[noise][k] = 0.001;
        }
    }
    const chart = chartS(model, entry, t);
    const view = sweepStaticView(entry.sweep, chart.map.levels);
    // Peak gains of about +1.04 and +0.36 dB: the range is 2 dB, ticks every 0.5 dB.
    assert.deepEqual([chart.frame.yMin, chart.frame.yMax, chart.frame.yTicks],
        [-2, 2, [2, 1.5, 1, 0.5, 0, -0.5, -1, -1.5, -2]]);
    assert.equal(chart.frame.yTickLabel(-1.5), '−1.5');
    assert.equal(chart.frame.yTitle, 'analysis:diagAxisPeakGain');
    assert.deepEqual(chart.items.filter(item => item.kind !== 'legend').map(item => [item.kind, item.color ?? null, item.dash]), [
        ['area', '--sdc-lim', undefined], ['hline', null, '6 4'], ['curve', '--sdc-nf', '2 3'], ['curve', '--sdc-nf', '2 3'],
        ['curve', '--sdc-l0', null], ['curve', '--sdc-l6', null]
    ]);
    const [area, , upper, lower, positive, negative] = chart.items;
    assert.equal(positive.points[30].y, view.positive[30]);
    assert.equal(negative.points[30].y, view.negative[30]);
    assert.equal(upper.points[30].y, view.upper[30]);
    assert.equal(lower.points[30].y, view.lower[30]);
    assert.deepEqual([area.points[30].top, area.points[30].bottom], [view.noise[30], -view.noise[30]]);
    assert.equal(positive.points[29], null);
    assert.deepEqual(chart.items.filter(item => item.kind === 'legend').map(item => item.text), [
        'analysis:diagLegendPositivePeak',
        'analysis:diagLegendNegativePeak',
        'analysis:diagLegendAllStatic',
        'analysis:diagLegendNoiseFloor'
    ]);
    assert.ok(!chart.items.some(item => item.kind === 'note'));
    assert.equal(chart.frame.formatValue(0.2), '+0.2 dB');

    // The map: −100 % to +100 % in 5 % steps, a column per drawn point, its edges equal to the peaks.
    const { levels, columns, scale } = chart.map;
    assert.deepEqual([levels.length, levels[0], levels[20], levels[40]], [41, -1, 0, 1]);
    assert.equal(scale.range, 2);
    assert.equal(columns.length, 2);
    assert.deepEqual([columns[0].lo, columns[0].hi], [positive.points[30].lo, positive.points[30].hi]);
    // Columns reach halfway (geometric mean) to the neighbouring sweep points, so neighbours share an edge.
    assert.equal(columns[0].lo, Math.sqrt(SWEEP_FREQUENCIES[29] * SWEEP_FREQUENCIES[30]));
    assert.equal(columns[0].hi, columns[1].lo);
    assert.equal(columns[0].gains[40], view.positive[30]);
    assert.equal(columns[0].gains[0], view.negative[30]);
    assert.ok(Math.abs(columns[0].gains[20]) < 1e-12);
    // A point whose peaks are inside its noise band keeps its column without cells and does not set the range.
    for (const [re, noise] of [['teRe', 'noise'], ['t3Re', 'noise3']]) {
        entry.sweep[re][31] = 0.1;
        entry.sweep[noise][31] = 0.3;
    }
    const masked = chartS(model, entry, t).map;
    assert.equal(masked.columns[1].gains, null);
    assert.equal(masked.scale.range, 2);
});

test('chart S range: the 1-2-5 step at or above the largest peak gain, its ticks and readout decimals', () => {
    const range = max => staticScale(max).range;
    assert.deepEqual([0.013, 0.13, 3.4, 0.5, 1, 12].map(range), [0.02, 0.2, 5, 0.5, 1, 20]);
    // No peak gain (or none above zero): 0.1 dB.
    assert.equal(range(0), 0.1);
    const fine = staticScale(0.0015);
    assert.deepEqual([fine.range, fine.ticks.slice(0, 3)], [0.002, [0.002, 0.0015, 0.001]]);
    assert.deepEqual([fine.label(-0.0015), fine.barTicks.map(([, text]) => text)],
        ['−0.0015', ['0.0020', '0.0010', '0.0000', '−0.0010', '−0.0020']]);
    const five = staticScale(3.4);
    assert.deepEqual([five.ticks.slice(0, 3), five.label(2), five.barTicks[1]], [[5, 4, 3], '2', [2.5, '2.5']]);
    assert.deepEqual([5, 1, 0.5, 0.02, 0.002].map(max => staticScale(max).readDecimals), [1, 1, 2, 3, 4]);
});

test('off reason: single tones name the band by fundamental, the widest class as above 2 kHz', () => {
    const entry = { reason: { short: 'worseForSingleTones', long: null }, worst: { short: { set: 'sweep', class: 'c3' }, long: null } };
    assert.equal(offReasonText(entry, 'short', t),
        'message:speakerDistortionReasonWorseForSingleTones(band=message:speakerDistortionBand400to2k)');
    entry.worst.short.class = 'even8k';
    assert.equal(offReasonText(entry, 'short', t),
        'message:speakerDistortionReasonWorseForSingleTones(band=message:speakerDistortionBandAbove2k)');
    assert.equal(offReasonText(entry, 'long', t), null);
});

test('chart H: THD sums the harmonic power ratios, single orders and THD 6 dB lower, percent ticks', () => {
    const { model, entry } = blankModel();
    const empty = chartH(model, entry, 'third', t);
    assert.equal(empty.items.at(-1).text, 'analysis:diagNotEnoughSignal');
    setSweep(entry, 'essL', 2, ruleBand(11), -40);
    setSweep(entry, 'essL', 3, ruleBand(11), -50);
    setSweep(entry, 'ess6', 2, ruleBand(11), -46);
    for (const n of [2, 3]) entry.diagnosis.ess.essL.z[n - 2].fill(lin(-90));
    const chart = chartH(model, entry, 'third', t);
    const curveOf = (color, width) => chart.items.find(item => item.kind === 'curve' && item.color === color &&
        item.width === width).points;
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} vs ${expected}`);
    near(curveOf('--sdc-pk', 2.4)[11].y, 10 * Math.log10(lin(-40) + lin(-50)));
    near(curveOf('--sdc-pk', 1.3)[11].y, -46);
    near(curveOf('--sdc-h2', 1.6)[11].y, -40);
    near(curveOf('--sdc-h3', 1.6)[11].y, -50);
    assert.equal(curveOf('--sdc-h5', 1.6)[11], null);
    assert.equal(curveOf('--sdc-pk', 2.4)[10], null);
    // The noise floor is the noise ratios summed over the orders like THD.
    near(chart.items[0].points[11].top, 10 * Math.log10(2 * lin(-90)));
    assert.equal(chart.items.some(item => item.kind === 'note'), false);
    assert.deepEqual(chart.frame.yTicks.map(chart.frame.yTickLabel), ['100 %', '10 %', '1 %', '0.1 %', '0.01 %']);
    assert.equal(chart.frame.formatValue(-40), `${MINUS}40.0 dB (1.0 %)`);
});

test('compare: matched interpolation, clamping, levels differ and unmatched values', () => {
    const own = blankModel();
    const other = blankModel();
    const row = range(0, 11);
    // The compared channel: V -40 / -46 / -52 dB at tone levels 0 / -6 / -12 dB.
    [['L', 0, -40], ['L-6', -6, -46], ['L-12', -12, -52]].forEach(([set, tone, value]) => {
        setTone(other.entry, set, row, tone);
        setEven(other.entry, set, row, value, tone);
    });
    const cellsFor = owned => {
        const compare = { model: other.model, entry: other.entry };
        return summaryTable(own.model, own.entry, 'short', t, compare).rows[0].cells.map(cell => cell.compared);
    };
    // This channel: L between two points, L-6 above the highest + 1.5 dB, L-12 clamped below the lowest.
    [['L', -3, -40], ['L-6', 2, -41], ['L-12', -13, -53]].forEach(([set, tone, value]) => {
        setTone(own.entry, set, row, tone);
        setEven(own.entry, set, row, value, tone);
    });
    assert.equal(isMatched(own.model, own.entry, other.model, other.entry), true);
    let [atL, at6, at12] = cellsFor();
    assert.ok(Math.abs(atL.a - -43) < 1e-3);
    assert.equal(atL.cls, 'worse');
    assert.equal(atL.text, `analysis:diagCmpWorse(a=${MINUS}43.0,d=+3.0)`);
    assert.equal(at6.differ, true);
    assert.equal(at6.text, 'analysis:diagCmpLevelsDiffer');
    assert.ok(Math.abs(at12.a - -52) < 1e-3);
    assert.equal(at12.text, `analysis:diagCmpSame(a=${MINUS}52.0,d=${MINUS}1.0)`);
    assert.equal(at12.cls, 'same');

    // Not matched (another microphone): the same column of the other measurement.
    other.entry.inputDeviceId = 'mic-2';
    assert.equal(isMatched(own.model, own.entry, other.model, other.entry), false);
    [atL, at6] = cellsFor();
    assert.ok(Math.abs(atL.a - -40) < 1e-3);
    assert.equal(atL.cls, 'same');
    assert.equal(at6.text, `analysis:diagCmpWorse(a=${MINUS}46.0,d=+5.0)`);
    other.entry.inputDeviceId = 'mic-1';
    other.model.placement = 'listening';
    assert.equal(isMatched(own.model, own.entry, other.model, other.entry), false);
});

test('compare display forms below the noise floor', () => {
    const own = blankModel();
    const other = blankModel();
    other.model.placement = 'listening';
    const row = range(0, 11);
    const cell = () => summaryTable(own.model, own.entry, 'short', t,
        { model: other.model, entry: other.entry }).rows[0].cells[0].compared;
    const setFloor = (entry, floorDb) => {
        // Floor of the row = 2·sqrt(Σ var) / calls over x = 12 bands at 0 dB.
        const variance = (10 ** (floorDb / 10) * 12 / 2) ** 2 / 12 * SET_CALLS.L ** 2;
        for (const i of row) entry.ref.L[102 + i] = variance;
    };
    setFloor(own.entry, -60);
    setEven(other.entry, 'L', row, -50);
    assert.deepEqual([cell().text, cell().cls], [`analysis:diagCmpCleanerBy(a=${MINUS}50.0,d=10.0)`, 'better']);
    setEven(other.entry, 'L', row, -65);
    assert.deepEqual([cell().text, cell().cls], [`analysis:diagCmpPlain(a=${MINUS}65.0)`, 'same']);
    setEven(other.entry, 'L', row, -400);
    other.entry.diagnosis.sets.L.ev.fill(0);
    assert.deepEqual([cell().text, cell().cls], ['analysis:diagCmpTooSmall', 'same']);
    setEven(own.entry, 'L', row, -40);
    assert.deepEqual([cell().text, cell().cls], ['analysis:diagCmpTooSmall', 'worse']);
});

test('copied text: header, heads, rows, lines and compare rows', () => {
    const { model, entry } = blankModel();
    setEven(entry, 'L', range(0, 11), -46.6);
    setEven(entry, 'L-6', range(0, 11), -52.6);
    const table = summaryTable(model, entry, 'short', t);
    const lines = summaryTsv(model, entry, table, t, { name: 'Desk', language: 'en' }).split('\n');
    const header = lines[0].split('\t');
    assert.deepEqual(header.slice(0, 5), ['analysis:diagnosis', 'Desk', header[2], 'label:positionInFront',
        'analysis:diagSignalLevel(level=−20.0)']);
    assert.equal(lines[1], table.heads.join('\t'));
    assert.deepEqual(lines[2].split('\t'),
        ['label:bandBelow100', '-46.6', '-52.6', 'too small to measure', '-6.0', table.rows[0].kind]);
    assert.equal(lines.length, 2 + 4 + 4);
    assert.deepEqual(lines.slice(6), table.lines);

    entry.weights.short = null;
    const noFit = summaryTable(model, entry, 'short', t);
    assert.equal(summaryTsv(model, entry, noFit, t, { name: 'Desk', language: 'en' }).split('\n').length, 6);

    const other = blankModel();
    other.model.placement = 'listening';
    setEven(other.entry, 'L', range(0, 11), -46.6);
    setEven(other.entry, 'L-6', range(0, 11), -52.6);
    const compared = summaryTable(model, entry, 'short', t, other);
    const withCompare = summaryTsv(model, entry, compared, t, { name: 'Desk', language: 'en', comparedName: 'Other' })
        .split('\n');
    assert.equal(withCompare.length, 6 + 4);
    assert.deepEqual(withCompare[6].split('\t'),
        ['label:bandBelow100, analysis:diagCopyCompared(name=Other)', '-46.6', '-52.6', 'too small to measure', '', '']);
});

test('copied measurement names stay in their own cells without becoming formulas', () => {
    const { model, entry } = blankModel();
    entry.weights.short = null;
    setEven(entry, 'L', range(0, 11), -46.6);
    const table = summaryTable(model, entry, 'short', t);
    const lines = summaryTsv(model, entry, table, t, {
        name: '  =1+1\t@next\r\n+row', language: 'en', comparedName: 'Other\t=2+2\n-Row'
    }).split('\n');
    const header = lines[0].split('\t');
    assert.equal(header.length, 6);
    assert.equal(header[1], "'  =1+1 @next  +row");
    assert.equal(lines.length, 10);
    assert.equal(lines[2].split('\t')[1], '-46.6');
    const comparison = lines[6].split('\t');
    assert.equal(comparison.length, 6);
    assert.match(comparison[0], /name=Other =2\+2 -Row/);
});

test('compare options: other channels first, then saved measurements newest first', () => {
    const measurement = { id: 'm1', name: 'Now', speakerModel: createSpeakerModel(2) };
    measurement.speakerModel.channels[1].diagnosis = measurement.speakerModel.channels[0].diagnosis;
    const saved = [
        measurement,
        { id: 'old', name: 'Old', savedAt: 1, speakerModel: createSpeakerModel(2) },
        { id: 'new', name: ' ', savedAt: 2, speakerModel: createSpeakerModel(2) },
        { id: 'unsaved', name: 'Draft', speakerModel: createSpeakerModel(2) },
        { id: 'plain', name: 'Sweep', savedAt: 3 }
    ];
    const options = compareOptions(measurement, 0, saved, t, 'en');
    assert.deepEqual(options.map(option => [option.id, option.index]), [['m1', 1], ['new', 0], ['old', 0]]);
    assert.match(options[0].label, /^analysis:diagCompareThis\(channel=/);
    assert.match(options[2].label, /^analysis:diagCompareOther\(name=Old,channel=/);
    // An empty name falls back to the measurement date.
    assert.doesNotMatch(options[1].label, /name=,/);
});

test('channel selection works on an unsaved result and drops a Compare with the newly selected channel', async () => {
    globalThis.ResizeObserver ??= class { disconnect() {} };
    const { default: DistortionDiagnosisView } = await import('../../features/measurement/ui/distortion-diagnosis-view.js');
    const view = new DistortionDiagnosisView({}, {});
    view.measurement = { speakerModel: createSpeakerModel(2) };
    view.selectChannel(1);
    assert.equal(view.channel, 1);
    view.compare = { index: 0 };
    view.selectChannel(0);
    assert.equal(view.compare, null);
});

test('Compare and Filter Length reset for another unsaved measurement and stay for the same one', async () => {
    globalThis.ResizeObserver ??= class { disconnect() {} };
    const { default: DistortionDiagnosisView } = await import('../../features/measurement/ui/distortion-diagnosis-view.js');
    const view = new DistortionDiagnosisView({}, {});
    const first = { speakerModel: createSpeakerModel(2) };
    view.show(first, 'diagnosis');
    view.compare = { index: 1 };
    view.length = 'long';
    view.show(first, 'diagnosis');
    assert.deepEqual([view.compare, view.length], [{ index: 1 }, 'long']);
    view.show({ speakerModel: createSpeakerModel(2) }, 'diagnosis');
    assert.deepEqual([view.compare, view.length], [null, null]);
});

test('display settings: ticks of a set range with its edges, the 4-8 count, the ranged frame, its bounds and Auto range', () => {
    assert.deepEqual(frequencyTicks(100, 1000).map(([, text]) => text), ['100', '200', '500', '1k']);
    assert.deepEqual(frequencyTicks(1000, 1500).map(([, text]) => text), ['1k', '1.1k', '1.2k', '1.3k', '1.4k', '1.5k']);
    assert.deepEqual(levelTicks(-80, -5).map(([value]) => value), [-80, -70, -60, -50, -40, -30, -20, -10]);
    // Chart C's colour bar: its ends are labelled; nine 5 dB values become five 10 dB ones.
    assert.deepEqual(levelTicks(-70, -40).map(([value]) => value), [-70, -65, -60, -55, -50, -45, -40]);
    assert.deepEqual(levelTicks(-60, -20).map(([value]) => value), [-60, -50, -40, -30, -20]);
    assert.deepEqual(levelTicks(-1.3, -1.1).map(([, text]) => text), ['−1.3', '−1.25', '−1.2', '−1.15', '−1.1']);
    assert.deepEqual(percentTicks(0.01, 100).map(([, text]) => text), ['0.01 %', '0.1 %', '1 %', '10 %', '100 %']);
    assert.deepEqual(percentTicks(0.1, 3).map(([value]) => value), [0.1, 0.2, 0.5, 1, 2]);
    assert.deepEqual(percentTicks(0.001, 0.5).map(([value]) => value), [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]);

    // Without a set value the frame is the chart's own; a percent axis is set in percent and drawn in dB.
    const frame = { xMin: 20, xMax: 10000, yMin: -80, yMax: 0, yTicks: [0, -40, -80] };
    assert.equal(rangedFrame(frame, {}, 'percent'), frame);
    assert.deepEqual(rangeDefaults(frame, 'percent'), { xMin: 20, xMax: 10000, yMin: 0.01, yMax: 100 });
    const ranged = rangedFrame(frame, { yMin: 0.1, yMax: 10 }, 'percent');
    assert.deepEqual([ranged.xMin, ranged.xMax, ranged.xTicks, ranged.yMin, ranged.yMax], [20, 10000, undefined, -60, -20]);
    assert.deepEqual(ranged.yTicks.map(ranged.yTickLabel), ['0.1 %', '0.2 %', '0.5 %', '1 %', '2 %', '5 %', '10 %']);
    assert.deepEqual(rangedFrame(frame, { xMin: 100 }, 'db').xTicks[0], [100, '100']);

    // One resolution apart, inside the limits.
    assert.deepEqual(rangeBounds('db', { xMin: 20, xMax: 10000, yMin: -80, yMax: -5 }, 'yMax'), [-79.9, 40]);
    assert.deepEqual(rangeBounds('fine', { xMin: 20, xMax: 10000, yMin: -0.05, yMax: 0.05 }, 'yMin'), [-20, 0.049]);
    assert.deepEqual(rangeBounds('db', { xMin: 20, xMax: 10000, yMin: -80, yMax: -5 }, 'xMin'), [10, 9999]);

    const extent = { xMin: 23.4, xMax: 9876.5, yMin: -63.2, yMax: -12.4 };
    assert.deepEqual(autoRange('db', extent), { xMin: 23, xMax: 9877, yMin: -68.3, yMax: -7.3 });
    assert.deepEqual(autoRange('percent', extent), { xMin: 23, xMax: 9877, yMin: 0.0385, yMax: 43.06 });
    // Chart S's gain returns to its own range.
    assert.deepEqual(autoRange('fine', extent), { xMin: 23, xMax: 9877 });
    assert.deepEqual(staticMapScale({ range: 0.1 }, { yMin: -0.03 }).barTicks.map(([, text]) => text),
        ['0.1', '0.05', '0', '−0.05', '−0.1']);
    assert.equal(staticMapScale(staticScale(0.1), {}).range, 0.1);
});
