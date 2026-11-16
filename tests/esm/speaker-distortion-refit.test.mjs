import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyRefitResults,
    cancelRefit,
    clearRefitState,
    getRefitState,
    isValidUpperLimit,
    onRefitChange,
    saveSpeakerResult,
    startRefit
} from '../../features/measurement/ui/speaker-distortion-refit.js';
import { ODD_CONFIGS, UPPER_LIMIT_RANGE_HZ } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { evaluateOddChecks } from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

const [LOWEST, HIGHEST] = UPPER_LIMIT_RANGE_HZ;

// Refit results (the field objects refitSpeakerModel returns) that switch every channel on, so the
// replacement is visible.
const resultsFor = model => model.channels.map(entry => ({
    weights: entry.weights, on: { short: true, long: true }, reason: { short: null, long: null },
    worst: entry.worst, power: entry.power, figL: entry.figL, ref: entry.ref, report: entry.report,
    micDistortionWarning: entry.micDistortionWarning, ampRef: entry.ampRef, checkFig: entry.checkFig,
    sweepResponse: entry.sweepResponse
}));

function stubDeps(refit) {
    return { UPPER_LIMIT_RANGE_HZ, recommendLength: () => 'long', refitSpeakerModel: refit };
}

function stubStore(record, saved = true) {
    const updates = [];
    return {
        updates,
        getMeasurementById: id => (id === record.id ? record : null),
        updateMeasurement: async (id, data) => {
            updates.push({ id, data });
            return saved;
        }
    };
}

// An odd block whose every configuration passed its checks, the high-volume one included.
function checkedOddBlock() {
    const fig = { dv: 0, odd: [null, null, null, -3], total: -1 };
    return evaluateOddChecks({
        weights: new Float32Array(32), bounds: new Float32Array(32), fitReason: null, sweepResponse: null,
        on: {}, reason: {}, checkFig: Object.fromEntries(ODD_CONFIGS.map(c => [c, fig])),
        loud: { dv: 0, t: 6, odd: [null, null, null, -2], total: 0.2 }
    });
}

test('upper limit must be a whole number in range', () => {
    assert.equal(isValidUpperLimit(LOWEST), true);
    assert.equal(isValidUpperLimit(HIGHEST), true);
    assert.equal(isValidUpperLimit(LOWEST - 1), false);
    assert.equal(isValidUpperLimit(HIGHEST + 1), false);
    assert.equal(isValidUpperLimit(LOWEST + 0.5), false);
    assert.equal(isValidUpperLimit(Number.NaN), false);
});

test('applied results replace the fitted fields and keep the last check', () => {
    const model = createSpeakerModel(2);
    model.lastCheck = { at: 1, outcome: 'same', dv: 0 };
    const next = applyRefitResults(model, resultsFor(model), LOWEST, stubDeps());
    assert.notEqual(next, model);
    assert.equal(next.upperLimitHz, LOWEST);
    assert.equal(next.recommendedLength, 'long');
    assert.ok(next.revision > model.revision);
    assert.deepEqual(next.lastCheck, model.lastCheck);
    assert.deepEqual(next.channels.map(entry => entry.on.short), [true, true]);
    assert.equal(next.channels[1].calls, model.channels[1].calls, 'stored captures are kept');
    assert.equal(next.channels[1].diagnosis, model.channels[1].diagnosis, 'the diagnosis is kept');
    assert.equal(next.channels[0].sweep, model.channels[0].sweep, 'the sweep record is kept');
    assert.equal(model.channels[1].on.short, false, 'the input model is not changed');
});

test('a saved record is updated and listeners see running then done', async t => {
    t.after(clearRefitState);
    const record = { id: 'm1', speakerModel: createSpeakerModel(2) };
    const store = stubStore(record);
    const seen = [];
    t.after(onRefitChange(state => seen.push(state.status)));
    const deps = stubDeps(async (model, upperLimitHz, { onChannelProgress }) => {
        assert.equal(upperLimitHz, 4000);
        onChannelProgress(0, 0.5);
        assert.deepEqual(getRefitState().progress.map(row => row.status), ['percent', 'waiting']);
        onChannelProgress(1, 1);
        return resultsFor(model);
    });
    const final = await startRefit(record, 4000, { store, deps });
    assert.equal(final.status, 'done');
    assert.equal(final.previousUpperLimitHz, 8000);
    assert.equal(seen[0], 'running');
    assert.equal(seen.at(-1), 'done');
    assert.equal(store.updates.length, 1);
    assert.equal(store.updates[0].data.speakerModel.upperLimitHz, 4000);
});

test('a saved refit stores the odd block re-evaluated for changed even weights', async t => {
    t.after(clearRefitState);
    const record = { id: 'm1', speakerModel: createSpeakerModel(2) };
    for (const entry of record.speakerModel.channels) entry.odd = checkedOddBlock();
    assert.ok(ODD_CONFIGS.every(c => record.speakerModel.channels[0].odd.on[c]), 'Auto plays every odd pass before');
    const store = stubStore(record);
    // As refitSpeakerModel does: the Short weights change, so the odd check that played with them is
    // dropped and Auto is evaluated again.
    const deps = stubDeps(async model => resultsFor(model).map((fields, index) => {
        const odd = structuredClone(model.channels[index].odd);
        odd.checkFig.short = null;
        return { ...fields, odd: evaluateOddChecks(odd) };
    }));
    assert.equal((await startRefit(record, 4000, { store, deps })).status, 'done');
    const { odd } = store.updates[0].data.speakerModel.channels[0];
    assert.equal(odd.checkFig.short, null);
    assert.deepEqual(odd.on, { short: false, long: true, alone: true });
    assert.equal(odd.reason.short, 'notChecked');
});

test('a failed write ends in saveFailed, not done', async t => {
    t.after(clearRefitState);
    t.mock.method(console, 'error', () => {});
    const record = { id: 'm1', speakerModel: createSpeakerModel(2) };
    const store = stubStore(record, false);
    const final = await startRefit(record, 4000, { store, deps: stubDeps(async model => resultsFor(model)) });
    assert.equal(final.status, 'saveFailed');
    assert.equal(store.updates.length, 1);
    assert.equal(record.speakerModel.upperLimitHz, 8000, 'the record keeps the previous result');
});

test('a record changed during the refit is not overwritten', async t => {
    t.after(clearRefitState);
    const record = { id: 'm1', speakerModel: createSpeakerModel(2) };
    const store = stubStore({ id: 'm1', speakerModel: { ...record.speakerModel, revision: 99 } });
    const final = await startRefit(record, 4000, { store, deps: stubDeps(async model => resultsFor(model)) });
    assert.equal(final.status, 'failed');
    assert.equal(store.updates.length, 0);
});

test('an unsaved record is updated in place', async t => {
    t.after(clearRefitState);
    const record = { speakerModel: createSpeakerModel(2) };
    const final = await startRefit(record, 4000, { store: stubStore({}), deps: stubDeps(async model => resultsFor(model)) });
    assert.equal(final.status, 'done');
    assert.equal(record.speakerModel.upperLimitHz, 4000);
});

test('an unsaved refit blocks saving and repeated saves share one write of the updated model', async t => {
    t.after(clearRefitState);
    const record = { speakerModel: createSpeakerModel(2) };
    const fit = Promise.withResolvers();
    const refit = startRefit(record, 4000, { deps: stubDeps(() => fit.promise) });
    await assert.rejects(saveSpeakerResult(record, () => assert.fail('save during a refit')), /being updated/);
    fit.resolve(resultsFor(record.speakerModel));
    await refit;

    const write = Promise.withResolvers();
    const persistedLimits = [];
    const first = saveSpeakerResult(record, () => {
        persistedLimits.push(record.speakerModel.upperLimitHz);
        return write.promise;
    });
    const second = saveSpeakerResult(record, () => assert.fail('duplicate save'));
    assert.equal(first, second);
    await startRefit(record, 5000, { deps: stubDeps(() => assert.fail('refit during a save')) });
    write.resolve('saved-id');
    assert.deepEqual(await Promise.all([first, second]), ['saved-id', 'saved-id']);
    assert.deepEqual(persistedLimits, [4000]);
});

test('cancel and failure end the job without writing', async t => {
    t.after(clearRefitState);
    const record = { id: 'm1', speakerModel: createSpeakerModel(2) };
    const store = stubStore(record);
    const waiting = startRefit(record, 4000, { store, deps: stubDeps((model, hz, { signal }) =>
        new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))) });
    assert.equal(getRefitState().status, 'running');
    const second = await startRefit(record, 5000, { store, deps: stubDeps(async () => assert.fail('second job')) });
    assert.equal(second.status, 'running', 'a second job is refused while one runs');
    cancelRefit();
    assert.equal((await waiting).status, 'cancelled');
    clearRefitState();
    assert.equal(getRefitState().status, 'idle');
    t.mock.method(console, 'error', () => {});
    const failed = await startRefit(record, 4000, { store, deps: stubDeps(async () => { throw new Error('boom'); }) });
    assert.equal(failed.status, 'failed');
    assert.equal(store.updates.length, 0);
});
