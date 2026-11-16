import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bandLimitedText,
    buildSpeakerDistortionCopyPayload,
    cancelCheckAgain,
    checkResultLines,
    checkStatusText,
    detailRows,
    detailsAxis,
    detailsTable,
    headlineAxis,
    headlineChart,
    headlineLevels,
    isCorrecting,
    oddLineText,
    onAnywayText,
    overloadWarnings,
    playedFigure,
    recommendedText,
    summaryLine,
    SpeakerDistortionPanel,
    whyText
} from '../../features/measurement/ui/speaker-distortion-panel.js';
import { saveSpeakerResult } from '../../features/measurement/ui/speaker-distortion-refit.js';
import i18n from '../../features/measurement/i18n.js';
import { channelLabel, offReasonText } from '../../features/measurement/distortion-diagnosis.js';
import { formatDb, formatDbfs } from '../../features/measurement/speaker-distortion-figures.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

// Resolves a key to itself plus its parameters, so the tests check keys and parameters only.
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

// A fitted odd block awaiting its correction check.
function oddBlock(fields = {}) {
    return {
        weights: new Float32Array(32), fitReason: null,
        on: { short: false, long: false, alone: false },
        reason: { short: 'notChecked', long: 'notChecked', alone: 'notChecked' },
        checkFig: { short: null, long: null, alone: null }, loud: null, ...fields
    };
}

// An odd pass figure; vsPlain carries the figures of what plays.
const oddFig = (oddAll, total, vsPlain = null) => ({ dv: 0, odd: [0, 0, 0, oddAll], total, vsPlain });

test('Distortion Averaging reads Quick for a model without a second take', () => {
    const model = createSpeakerModel(1);
    const averagingRow = () => detailRows(model, t).find(([label]) => label === 'label:distortionAveraging')[1];
    assert.equal(averagingRow(), '×2');
    model.averaging = 1;
    model.channels[0].calls = model.channels[0].calls.map(call => ({ ...call, take: 'A' }));
    assert.equal(averagingRow(), 'Quick');
    assert.ok(summaryLine(model, t, 'en').includes('analysis:summaryAveraging{"averaging":"Quick"}'));
});

test('copy payload names the measurement and adds the channel mode only beyond the first pair', () => {
    const model = createSpeakerModel(2);
    const [effect] = JSON.parse(buildSpeakerDistortionCopyPayload(
        { id: 'm1', name: 'Desk', savedAt: 1, speakerModel: model }));
    assert.equal(effect.nm, 'Distortion Correction');
    assert.equal(effect.ms, 'm1');
    assert.match(effect.mn, /^Desk — /);
    assert.equal(effect.fl, 'Short');
    assert.equal(effect.ch, undefined);
    const wide = createSpeakerModel(3);
    wide.channels[2].index = 2;
    wide.recommendedLength = 'long';
    const [wideEffect] = JSON.parse(buildSpeakerDistortionCopyPayload({ id: 'm2', name: 'Room', speakerModel: wide }));
    assert.equal(wideEffect.ch, 'A');
    assert.equal(wideEffect.fl, 'Long');
});

test('recommended line lists on and off channels, or says nothing corrects', () => {
    const model = createSpeakerModel(2);
    const [left, right] = model.channels;
    const text = recommendedText(model, t, 'en');
    assert.ok(text.startsWith('analysis:recommendedLength{'));
    const params = JSON.parse(text.slice('analysis:recommendedLength'.length));
    assert.equal(params.length, 'label:filterShort');
    assert.equal(params.on, channelLabel(left));
    assert.equal(params.off, channelLabel(right));
    left.on.short = false;
    assert.equal(recommendedText(model, t, 'en'), 'analysis:noLengthCorrects');
});

test('odd-only Auto correction enables copying, routes surround channels and reports correction on', () => {
    const model = createSpeakerModel(1);
    const entry = model.channels[0];
    entry.index = 2;
    entry.on = { short: false, long: false };
    entry.weights = { short: null, long: null };
    entry.reason = { short: 'noFit', long: 'noFit' };
    entry.odd = oddBlock({ on: { short: false, long: false, alone: true } });
    const measurement = { id: 'odd-only', name: 'Surround', savedAt: 1, speakerModel: model };
    assert.equal(isCorrecting(model), true);
    assert.equal(JSON.parse(buildSpeakerDistortionCopyPayload(measurement))[0].ch, 'A');
    assert.match(recommendedText(model, t, 'en'), /^analysis:recommendedLengthAllOn/);
    assert.equal(whyText(entry, 'short', t), 'analysis:whyOn');

    entry.odd.fitReason = 'littleGain';
    assert.equal(isCorrecting(model), false, 'a failed odd fit must not enable copying');
    assert.equal(JSON.parse(buildSpeakerDistortionCopyPayload(measurement))[0].ch, undefined);
    entry.odd.fitReason = null;
    entry.odd.on = { short: true, long: true, alone: false };
    assert.equal(isCorrecting(model), false, 'the alone decision governs playback when the even block is off');
    assert.equal(recommendedText(model, t, 'en'), 'analysis:noLengthCorrects');
    entry.odd.on.alone = true;
    entry.odd.weights = null;
    assert.equal(isCorrecting(model), false, 'an odd decision without weights cannot play');
});

test('copy button reports the clipboard result and preserves the save requirement', async context => {
    const makeElement = tag => ({
        tagName: tag, children: [], attributes: {}, listeners: {},
        append(...nodes) { this.children.push(...nodes); },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, callback) { this.listeners[type] = callback; },
        remove() {}
    });
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    context.after(() => {
        for (const [name, descriptor] of [['document', originalDocument], ['window', originalWindow],
            ['navigator', originalNavigator]]) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });
    const body = makeElement('body');
    Object.defineProperty(globalThis, 'document', { configurable: true,
        value: { body, documentElement: { lang: 'en' }, createElement: makeElement } });
    let clipboardResult = false;
    Object.defineProperty(globalThis, 'window', { configurable: true,
        value: { electronAPI: { writeClipboardText: async () => clipboardResult } } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    context.mock.method(i18n, 't', key => key);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const measurement = { id: 'copy', savedAt: 1, speakerModel: createSpeakerModel(1) };
    const entry = measurement.speakerModel.channels[0];
    entry.on = { short: false, long: false };
    entry.weights = { short: null, long: null };
    entry.odd = oddBlock({ on: { short: false, long: false, alone: true } });
    const channel = SpeakerDistortionPanel.prototype.channelBlock(measurement.speakerModel, entry, false, null, null);
    assert.equal(channel.children[0].children[1].textContent, 'status:correctionOn');
    const copyBlock = () => SpeakerDistortionPanel.prototype.copyBlock(measurement);
    const copy = copyBlock().children.find(node => node.tagName === 'button');
    assert.equal(copy.disabled, false);
    await copy.listeners.click();
    assert.equal(body.children.at(-1).textContent, 'error:speakerDistortionCopyFailed');
    assert.equal(body.children.at(-1).attributes.role, 'alert');
    clipboardResult = true;
    await copy.listeners.click();
    assert.equal(body.children.at(-1).textContent, 'message:copied');
    assert.equal(body.children.at(-1).attributes.role, 'status');
    delete measurement.savedAt;
    assert.equal(copyBlock().children.find(node => node.tagName === 'button').disabled, true);
});

test('channel texts follow the on state and the stored reason', () => {
    const [on, off] = createSpeakerModel(2).channels;
    assert.equal(whyText(on, 'short', t), 'analysis:whyOn');
    assert.equal(whyText(off, 'short', t), 'analysis:whyWorseInCheck');
    assert.equal(offReasonText(off, 'short', t),
        'message:speakerDistortionReasonWorseInCheck{"band":"message:speakerDistortionBand100to400"}');
    off.worst.short.class = 'even8k';
    assert.equal(offReasonText(off, 'short', t),
        'message:speakerDistortionReasonWorseInCheck{"band":"message:speakerDistortionBand50to8k"}');
    off.worst.short.class = 'total';
    assert.equal(offReasonText(off, 'short', t), 'message:speakerDistortionReasonWorseInCheckTotal');
    assert.equal(onAnywayText(off, 'short', t), 'help:onAnywayNotAdvised{"found":"analysis:foundWorseInCheck"}');
    assert.equal(onAnywayText(on, 'long', t), null, 'no hint without a fit');
    off.reason.short = 'worseForSingleTones';
    assert.equal(whyText(off, 'short', t), 'analysis:whyWorseForSingleTones');
    assert.equal(onAnywayText(off, 'short', t),
        'help:onAnywayNotAdvised{"found":"analysis:foundWorseForSingleTones"}');
    off.reason.short = 'littleGain';
    assert.equal(onAnywayText(off, 'short', t), 'help:onAnywayLittleGain');
    off.reason.short = 'belowLimit';
    assert.equal(onAnywayText(off, 'short', t), null);
});

test('headline uses the correction check when present and the prediction otherwise', () => {
    const [left, right] = createSpeakerModel(2).channels;
    assert.deepEqual(headlineLevels(left, 'short'), { levels: left.checkFig.short.level, measured: true });
    assert.equal(headlineLevels(left, 'long'), null);
    const predicted = headlineLevels(right, 'long');
    assert.equal(predicted.measured, false);
    assert.equal(predicted.levels.length, 4);
});

test('an off channel shows the measured check that rejected even-order correction', () => {
    const model = createSpeakerModel(2);
    const entry = model.channels[1];
    const rejected = { dv: 0, fig: [1, 2, 3, 4, 5, 6], level: [-30, -25, -40, -35], bandSums: null };
    entry.checkFig = { short: null, long: rejected };
    const predicted = headlineLevels(entry, 'short');
    assert.equal(predicted.measured, false);
    assert.notDeepEqual(predicted.levels, rejected.level);

    entry.checkFig.short = rejected;
    assert.deepEqual(headlineLevels(entry, 'short'), { levels: rejected.level, measured: true });
    const chart = headlineChart(entry, 'short', t);
    assert.equal(chart.series[1], 'analysis:diagLegendCorrectedMeasured');
    assert.equal(chart.rows[0].cells[1].worse, true);
    const table = detailsTable(model, entry, t);
    assert.deepEqual(table.columns.map(column => column.status), ['status:off', 'status:off']);
    const group = table.sections[0].groups[0];
    assert.equal(group.title, 'analysis:groupMeasured');
    assert.deepEqual(group.rows[0].cells.map(cell => cell.value), [6, 6]);
});

test('headline and Details select the accepted odd-only check rather than rejected even correction', () => {
    const model = createSpeakerModel(2);
    const entry = model.channels[1];
    const rejected = { dv: 0, fig: [1, 2, 3, 4, 5, 6], level: [-30, -25, -40, -35], bandSums: null };
    const accepted = { fig: [-1, -2, -3, -4, -5, -6], level: [-30, -36, -40, -41], bandSums: null };
    entry.checkFig = { short: rejected, long: rejected };
    entry.reason = { short: 'worseInCheck', long: 'worseInCheck' };
    entry.worst = { short: { class: 'even8k' }, long: { class: 'even8k' } };
    entry.odd = oddBlock({
        on: { short: false, long: false, alone: true },
        checkFig: { short: null, long: null, alone: oddFig(-7, -5, accepted) }
    });
    for (const fitted of [true, false]) {
        if (!fitted) {
            entry.weights = { short: null, long: null };
            entry.checkFig = { short: null, long: null };
        }
        assert.deepEqual(playedFigure(entry, 'short').level, accepted.level);
        assert.deepEqual(headlineLevels(entry, 'short'), { levels: accepted.level, measured: true });
        assert.equal(headlineChart(entry, 'short', t).series[1], 'analysis:diagLegendCorrectedMeasured');
        const table = detailsTable(model, entry, t);
        assert.deepEqual(table.columns.map(column => column.status), ['status:passesChecks', 'status:passesChecks']);
        const group = table.sections[0].groups[0];
        assert.equal(group.title, 'analysis:groupMeasured');
        assert.deepEqual(group.rows[0].cells.map(cell => cell.value), [-6, -6]);
        assert.deepEqual(group.rows.at(-1).cells.map(cell => cell.value), [-5, -5]);
        assert.ok(group.rows[0].cells.every(cell => !cell.worse), 'rejected even reasons do not mark the accepted odd check');
        if (!fitted) {
            assert.ok(table.sections[0].groups[1].rows.every(row => row.cells.every(cell => cell.text === '—')),
                'no even-fit prediction is invented for the other levels');
        }
    }
});

test('headline chart draws total, even- and odd-order levels without and with the correction', () => {
    const [left, right] = createSpeakerModel(2).channels;
    // Total -20 dB = 1 % before, even -23 dB, so odd is the remaining power; after, the even part is gone.
    const even = -23;
    const odd = 10 * Math.log10(10 ** -2 - 10 ** (even / 10));
    left.checkFig.short.level = [-20, odd, even, -Infinity];
    const chart = headlineChart(left, 'short', t);
    assert.deepEqual(chart.series, ['analysis:withoutCorrection', 'analysis:diagLegendCorrectedMeasured']);
    assert.deepEqual(chart.rows.map(row => row.label),
        ['label:totalDistortion', 'label:evenOrderDistortion', 'label:oddOrderDistortion']);
    const [total, evenRow, oddRow] = chart.rows;
    assert.ok(Math.abs(total.cells[0].value - 10) < 1e-9, 'percent of the test signal');
    assert.deepEqual(evenRow.cells[1], { text: 'analysis:speakerDistortionTooSmall', value: null, worse: false });
    assert.ok(Math.abs(oddRow.cells[0].value - total.cells[1].value) < 1e-9, 'odd is total less even in power');
    assert.ok(Math.abs(oddRow.cells[1].value - total.cells[1].value) < 1e-9);
    left.checkFig.short.level = [-30, -20, -40, -40];
    assert.deepEqual(headlineChart(left, 'short', t).rows[0].cells.map(cell => cell.worse), [false, true]);
    assert.equal(headlineChart(left, 'long', t), null, 'no chart without a fit');
    assert.equal(headlineChart(right, 'long', t).series[1], 'analysis:diagLegendCorrectedPredicted');
});

test('headline axis starts at 0 % and rounds the largest level up to a 1-2-5 step', () => {
    const chart = (...values) => ({ rows: [{ cells: values.map(value => ({ value })) }] });
    assert.deepEqual(headlineAxis([]), { min: 0, max: 1, step: 0.5 });
    assert.deepEqual(headlineAxis([chart(5.4, null), chart(3.2)]), { min: 0, max: 6, step: 2 },
        'shared by the channels and never clamping a value');
    const small = headlineAxis([chart(0.37)]);
    assert.equal(small.step, 0.1);
    assert.ok(small.max >= 0.37 && small.max < 0.41);
});

test('details table marks the worst band and the stale prediction', () => {
    const model = createSpeakerModel(2);
    model.channels[1].checkFig.short = null;
    const table = detailsTable(model, model.channels[1], t);
    assert.deepEqual(table.columns.map(column => column.status), ['status:off', 'status:off']);
    assert.equal(table.sections.length, 1, 'no odd-order chart without a measured odd-order pass');
    const [checkGroup, otherGroup] = table.sections[0].groups;
    assert.equal(checkGroup.title, 'analysis:groupPredictedStale');
    const band = checkGroup.rows.find(row => row.label === 'analysis:evenRow{"band":"label:band100to400"}');
    assert.deepEqual(band.cells.map(cell => cell.worse), [true, true]);
    assert.ok(checkGroup.rows.at(-1).cells.every(cell => cell.note.startsWith('analysis:bestPossible')
        && 'best' in cell));
    assert.deepEqual(checkGroup.rows[0].cells.map(cell => cell.series), ['short', 'long']);
    assert.ok(checkGroup.rows[0].cells.every(cell => cell.text === formatDb(cell.value, '')));
    assert.equal(otherGroup.rows.length, 3);
    const leftTable = detailsTable(model, model.channels[0], t);
    assert.equal(leftTable.sections[0].groups[0].title, 'analysis:groupMeasured');
    assert.deepEqual(leftTable.sections[0].groups[0].rows[0].cells[1], { text: '—', value: null, worse: false, series: 'long' },
        'an unfitted length shows no value');
});

test('check status is stale while a fitted channel lacks a correction check', () => {
    const model = createSpeakerModel(2);
    assert.deepEqual(checkStatusText(model, t, 'en'), { text: 'status:lastCheckInitial', stale: false });
    model.lastCheck = { at: Date.UTC(2026, 10, 13), outcome: 'same', dv: 0 };
    assert.match(checkStatusText(model, t, 'en').text, /^status:lastCheckAt/);
    model.recommendedLength = 'long';
    assert.deepEqual(checkStatusText(model, t, 'en'), { text: 'status:checkStale', stale: true });
});

test('Check again shows a result line for each outcome and the spread note', () => {
    const level = [-40, -45, -50, -55];
    const item = (index, fields) => ({ index, label: String(index), checked: true, accepted: true, level, ...fields });
    const lines = checkResultLines({
        dv: -3,
        results: [
            item(0, { v: -3.2 }),
            item(1, { v: -0.4 }),
            item(2, { v: 2 }),
            item(3, { accepted: false, v: null }),
            item(4, { checked: false, accepted: false, v: null })
        ]
    }, t);
    assert.equal(lines.length, 7);
    assert.match(lines[0], /message:againLower/);
    assert.match(lines[1], /message:againSame/);
    assert.match(lines[2], /warning:againLouder/);
    assert.match(lines[3], /message:againUndetermined/);
    assert.match(lines[4], /message:againOff/);
    assert.match(lines[5], /^analysis:againSpread/);
    assert.equal(lines[6], 'analysis:checkMeasuredAtMic');
    const large = checkResultLines({ dv: -8, results: [item(0, { v: -8 })] }, t);
    assert.match(large[0], /message:againLowerLarge/);
    assert.equal(large.length, 2, 'one accepted channel has no spread note');
});

test('Check again and Save wait for ownership of the draft through cancellation and audio release', async () => {
    const measurement = { speakerModel: createSpeakerModel(1) };
    const prepare = Promise.withResolvers();
    const releaseStarted = Promise.withResolvers();
    const release = Promise.withResolvers();
    const events = [];
    const panel = new SpeakerDistortionPanel(null, {
        onChanged() {},
        audio: {
            async prepare(rate, { signal }) {
                events.push('prepare');
                await prepare.promise;
                assert.equal(signal.aborted, true);
            },
            play() { assert.fail('cancelled check must not play'); },
            async release() {
                releaseStarted.resolve();
                await release.promise;
                events.push('release');
            }
        }
    });
    panel.openCheckAgain(measurement, { channels: [0], length: 'short' });
    const check = panel.runCheck(measurement);
    await assert.rejects(saveSpeakerResult(measurement, () => assert.fail('save during Check again')), /being updated/);
    cancelCheckAgain();
    prepare.resolve();
    await releaseStarted.promise;
    await assert.rejects(saveSpeakerResult(measurement, () => assert.fail('save before audio release')), /being updated/);
    release.resolve();
    await check;

    panel.openCheckAgain(measurement, { channels: [0], length: 'short' });
    const write = Promise.withResolvers();
    const saving = saveSpeakerResult(measurement, () => {
        events.push('save');
        assert.equal(measurement.speakerModel.lastCheck, null);
        return write.promise;
    });
    await panel.runCheck(measurement);
    write.resolve('stored');
    assert.equal(await saving, 'stored');
    assert.deepEqual(events, ['prepare', 'release', 'save']);
});

test('band line appears only for a channel measured with a limited Sweep Bandwidth', () => {
    const [entry] = createSpeakerModel(1).channels;
    assert.equal(bandLimitedText(entry, t), null);
    entry.bandwidth = [200, 20000];
    assert.equal(bandLimitedText(entry, t), 'analysis:bandLimited{"band":"200 Hz – 20 kHz"}');
});

test('odd line follows what Auto plays and the stored odd reason', () => {
    const [on, off] = createSpeakerModel(2).channels;
    assert.equal(oddLineText(on, 'short', t), 'message:speakerDistortionOddNoFit');
    const vsPlain = { fig: [0, 0, 0, 0, 0, 0], level: [-41, -42, -43, -44], bandSums: null };
    on.odd = oddBlock({
        on: { short: true, long: false, alone: false },
        checkFig: { short: oddFig(-6.2, -40, vsPlain), long: null, alone: null }
    });
    assert.equal(oddLineText(on, 'short', t), 'message:speakerDistortionOddAlso');
    assert.deepEqual(headlineLevels(on, 'short'), { levels: vsPlain.level, measured: true },
        'the headline shows what plays with the odd block');
    on.odd.on.short = false;
    for (const [reason, key] of [['worseOverall', 'OddWorseOverall'], ['worseWhenLoud', 'OddWorseWhenLoud'],
        ['littleGain', 'OddLittleGain']]) {
        on.odd.reason.short = reason;
        assert.equal(oddLineText(on, 'short', t), `message:speakerDistortion${key}`);
    }
    off.odd = oddBlock();
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddNotChecked');
    off.odd.reason.alone = 'worseOverall';
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddWorseOverallAlone');
    off.odd.on.alone = true;
    off.odd.checkFig.alone = oddFig(-3, -35);
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddAlone');
    off.odd = oddBlock({ fitReason: 'worseAtLowerVolume' });
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddFitWorseAtLowerVolume');
    off.odd = oddBlock({ fitReason: 'worseForSingleTones' });
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddFitWorseForSingleTones');
    off.odd = oddBlock({ weights: null, fitReason: 'belowLimit' });
    assert.equal(oddLineText(off, 'short', t), 'message:speakerDistortionOddBelowLimit');
});

test('details odd-order chart has a group per measured odd pass and a fitting high-volume level only', () => {
    const model = createSpeakerModel(2);
    const entry = model.channels[1];
    entry.odd = oddBlock({ checkFig: { short: null, long: null, alone: oddFig(-4, -30) }, loud: { dv: 0, t: null } });
    const [even, odd] = detailsTable(model, entry, t).sections;
    assert.equal(even.head, 'analysis:detailsHeader');
    assert.equal(odd.head, 'analysis:oddDetailsHeader');
    const groups = odd.groups;
    assert.equal(groups.length, 1, 'no high-volume group without a fitting level');
    assert.equal(groups[0].title, 'analysis:configAlone');
    const [oddRow, totalRow] = groups[0].rows;
    assert.deepEqual([oddRow.label, totalRow.label], ['analysis:oddRow', 'label:totalDistortion50to8k']);
    assert.deepEqual(oddRow.cells, [{ text: formatDb(-4, ''), value: -4, worse: false, series: null }]);
    assert.equal(totalRow.cells[0].text, formatDb(-30, ''));
    entry.odd.loud = { dv: 0, t: 3, odd: [0, 0, 0, -2], total: -28 };
    const loud = detailsTable(model, entry, t).sections[1].groups[1];
    assert.match(loud.title, /^analysis:loudRow/);
    assert.ok(loud.title.includes(formatDbfs(model.levelDbfs + 3)));
    assert.equal(loud.rows[0].cells[0].text, formatDb(-2, ''));
    entry.odd.checkFig.short = oddFig(-1, -20);
    assert.equal(detailsTable(model, entry, t).sections[1].groups[0].rows[0].cells[0].series, 'short',
        'Short + odd-order takes the Short colour');
});

test('details axis contains zero and every drawn figure, rounded outward to whole steps', () => {
    const table = (...cells) => ({ sections: [{ groups: [{ rows: [{ cells }] }] }] });
    assert.deepEqual(detailsAxis([]), { min: -10, max: 0, step: 5 }, 'at least 10 dB wide');
    assert.deepEqual(detailsAxis([table({ value: -12.3, best: -16.1 }, { value: null }), table({ value: 2.4 })]),
        { min: -20, max: 5, step: 5 }, 'shared by the channels and never clamping a value or a marker');
    assert.deepEqual(detailsAxis([table({ value: -43 }, { value: 1 })]), { min: -50, max: 10, step: 10 });
});

test('overload warning names the channels that reached their limit, one sentence per span', () => {
    const model = createSpeakerModel(2);
    // Rule bands 10 to 12 (1/6-octave bands 20 to 25) 2 dB lower at the set Signal Level, 9 and 13 unchanged.
    const overload = (entry, last) => {
        const ess = entry.diagnosis.ess;
        for (let i = 18; i <= 27; i++) {
            ess.pts[i] = 1;
            ess.essL.h[0][i] = i >= 20 && i <= last ? 10 ** -0.2 : 1;
            ess.ess6.h[0][i] = 1;
        }
    };
    const [left, right] = model.channels;
    right.diagnosis = structuredClone(left.diagnosis);
    const warning = (ch, span) => `warning:overload${JSON.stringify({ ch, span })}`;
    assert.deepEqual(overloadWarnings(model, t, 'en'), []);
    overload(left, 25);
    assert.deepEqual(overloadWarnings(model, t, 'en'), [warning(channelLabel(left), '252 – 504 Hz')]);
    overload(right, 27);
    assert.deepEqual(overloadWarnings(model, t, 'en'), [warning(channelLabel(left), '252 – 504 Hz'),
        warning(channelLabel(right), '252 – 635 Hz')]);
    overload(right, 25);
    assert.deepEqual(overloadWarnings(model, t, 'en'),
        [warning(`${channelLabel(left)} and ${channelLabel(right)}`, '252 – 504 Hz')]);
});
