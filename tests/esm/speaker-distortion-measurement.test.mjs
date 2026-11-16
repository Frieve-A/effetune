import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SpeakerDistortionStepError,
    bandLimitedSettings,
    channelVolumeChange,
    checkAgainInputs,
    isOverloaded,
    lowerByDb,
    overloadExcessDb,
    perChannelSeconds,
    runCheckAgain,
    runSpeakerDistortionMeasurement,
    saveSpeakerDistortionRecord,
    savedMessageKey
} from '../../features/measurement/measurement-controller/speaker-distortion-measurement.js';
import { BAND_EDGES, LENGTHS, LEVEL_CHECK_OVERLOAD, UPPER_LIMIT_RANGE_HZ } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { resolveSweepBand } from '../../features/measurement/measurement-model.js';
import { combLines, isMeasurableBand, syncChirpRange } from '../../js/utils/measurement-dsp/speaker-distortion/signals.js';
import { buildCapturePlan, setExecutorFactory } from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

const RATE = 48000;
const quiet = () => new Float32Array(4).fill(0.1);

function settingsFor(index, label) {
    return { index, label, rateHz: RATE, averaging: 1, sweepLength: 4800, bandwidth: [20, 20000], upperLimitHz: UPPER_LIMIT_RANGE_HZ[1] };
}

function capturePlan() {
    return {
        levelDbfs: -20,
        levelCheck: new Float32Array(8),
        captures: [0, 1, 2].map(() => ({ samples: new Float32Array(48), gapSeconds: 0.01 })),
        check: { samples: new Float32Array(8) }
    };
}

function runDeps(calls) {
    return {
        LENGTHS,
        BAND_EDGES,
        UPPER_LIMIT_RANGE_HZ,
        buildCapturePlan: async settings => {
            calls.push(`plan ${settings.index}`);
            return capturePlan();
        },
        judgeLevelCheck: async () => ({ outcome: 'passed', headroomDb: 10 }),
        identifySpeakerModel: async ({ recordings, settings }) => ({
            index: settings.index, label: settings.label, captures: recordings.length,
            weights: { short: new Float32Array(1), long: null }
        }),
        buildCheckCall: async () => ({ samples: new Float32Array(8) }),
        applyCorrectionCheck: async (entry, passes, { upperLimitHz }) =>
            ({ ...entry, passes: Object.keys(passes), checkedAt: upperLimitHz }),
        loudCheckConfig: () => null,
        recommendLength: () => 'short'
    };
}

function runWithNoiseRetry(options) {
    const plan = capturePlan();
    plan.captures[0].kind = 'call';
    return runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left')], placement: 'listeningPosition', averaging: 1, retryOnNoise: true,
        first: { plan, judged: { outcome: 'passed', headroomDb: 12, noisePower: 1 } },
        pause: async () => {}, signal: new AbortController().signal, ...options
    });
}

// Odd block of a model channel: fit rule passed, Short with odd measured as passing, high-volume check pending.
function oddBlock(fitReason = null) {
    const odd = {
        weights: fitReason ? null : new Float32Array(32), bounds: fitReason ? null : new Float32Array(32).fill(1),
        fitReason, on: { short: false, long: false, alone: false },
        reason: { short: 'notChecked', long: 'notChecked', alone: 'notChecked' },
        checkFig: { short: null, long: null, alone: null }, loud: null, sweepResponse: null
    };
    if (fitReason) odd.reason = { short: fitReason, long: fitReason, alone: fitReason };
    return odd;
}

// Run deps whose fit has an odd block and whose odd calls fit only from t = 8 dB down.
function oddRunDeps(calls, fitReason = null) {
    const deps = runDeps(calls);
    return {
        ...deps,
        identifySpeakerModel: async args => ({ ...await deps.identifySpeakerModel(args), odd: oddBlock(fitReason) }),
        buildCheckCall: async (entry, plan, length, dv, odd = false, t = 0) => {
            calls.push(`call ${length} ${odd} ${t}`);
            return { samples: Float32Array.of(odd && t > 8 ? 1.5 : 0.5) };
        },
        loudCheckConfig: entry => (entry.odd.loud ? null : 'short'),
        applyLoudCheck: async (entry, c, t, recordings, dv) => {
            calls.push(`loud ${c} ${t} ${Object.keys(recordings)} ${dv}`);
            return { ...entry, odd: { ...entry.odd, loud: { dv, t, odd: [0, 0, 0, -2], total: 0 } } };
        }
    };
}

test('planned time, overload test and volume change follow the plan formulas', () => {
    // 131072 samples at 48 kHz exceed the minimum sweep length of 20 Hz-20 kHz; each sweep adds a 2.5 s tail.
    const timing = { sweepLength: 131072, rateHz: 48000, bandwidth: [20, 20000] };
    const sweeps = 3 * (131072 / 48000 + 2.5);
    assert.equal(perChannelSeconds({ ...timing, averaging: 2 }), 8.5 + 19 * 16.5 + sweeps + 21 * 0.5 + 20 + 29.5 + 30);
    assert.equal(perChannelSeconds({ ...timing, averaging: 1, fast: true }),
        8.5 + 10 * 9.5 + sweeps + 12 * 0.5 + 20 + 29.5 + 30);
    assert.equal(isOverloaded(Float32Array.of(0.5, -0.9)), false);
    assert.equal(isOverloaded(Float32Array.of(0.5, -0.9995)), true);
    assert.equal(channelVolumeChange(null, -2), -2);
    assert.equal(channelVolumeChange({ accepted: false, db: -5 }, -2), -2);
    assert.equal(channelVolumeChange({ accepted: true, db: -0.6 }, -2), 0);
    assert.equal(channelVolumeChange({ accepted: true, db: -3.3 }, 0), -3.5);
    assert.equal(channelVolumeChange({ accepted: true, db: -30 }, 0), -24);
    assert.equal(savedMessageKey(true), 'message:measurementSavedAndUsed');
    assert.equal(savedMessageKey(false), 'message:measurementSaved');
});

test('the band note lists only the channels whose Sweep Bandwidth cuts into 20 Hz-8 kHz', () => {
    const limited = sweepBand => {
        const config = { sweepBand, acquisitionMethod: 'ess', outputChannelCount: 2 };
        return bandLimitedSettings(['left', 'right'].map(token => {
            const band = resolveSweepBand(config, token, 48000, 65536);
            return { label: token, bandwidth: [band.minFreq, band.maxFreq] };
        })).map(settings => settings.label);
    };
    const common = { minFreq: 20, maxFreq: 20000 };
    assert.deepEqual(limited({ mode: 'off', common: { minFreq: 100, maxFreq: 1000 } }), []);
    assert.deepEqual(limited({ mode: 'common', common }), []);
    assert.deepEqual(limited({ mode: 'common', common: { minFreq: 20, maxFreq: 5000 } }), ['left', 'right']);
    assert.deepEqual(limited({ mode: 'perChannel', common, perChannel: [
        { channel: 'left', minFreq: 20, maxFreq: 1000 }, { channel: 'right', minFreq: 20, maxFreq: 20000 }] }), ['left']);
});

test('a band is measurable when it keeps 8 Hz of 50 Hz-8 kHz', () => {
    for (const band of [[20, 20000], [20, 80], [20, 100], [42, 58], [7991, 20000]]) {
        assert.equal(isMeasurableBand(band), true, band);
    }
    for (const band of [[9000, 20000], [1000, 1005], [20, 57]]) assert.equal(isMeasurableBand(band), false, band);
    // The narrowest measurable band still leaves every seed at least two lines.
    for (let seed = 1; seed <= 10; seed++) {
        assert.ok(combLines(seed, [7991, 20000]).excited.reduce((sum, line) => sum + line, 0) >= 2);
    }
    assert.throws(() => buildCapturePlan({ rateHz: 48000, bandwidth: [9000, 20000], sweepLength: 65536, averaging: 1 }));
});

test('the sync chirp rises within the selected bandwidth, including bands ending at or below 100 Hz', () => {
    assert.deepEqual(syncChirpRange([20, 20000]), [100, 8000]);
    assert.deepEqual(syncChirpRange([20, 80]), [20, 80]);
    assert.deepEqual(syncChirpRange([20, 100]), [20, 100]);
    assert.deepEqual(syncChirpRange([7991, 20000]), [7991, 8000]);
});

test('cancelling capture-plan generation aborts and closes its worker executor', async t => {
    const controller = new AbortController();
    let closed = false;
    setExecutorFactory(signal => {
        assert.equal(signal, controller.signal);
        const cancelled = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return { run: () => cancelled, close() { closed = true; } };
    });
    t.after(() => setExecutorFactory(null));
    const plan = buildCapturePlan(settingsFor(0, 'Left'), { signal: controller.signal });
    controller.abort();
    await assert.rejects(plan, { name: 'AbortError' });
    assert.equal(closed, true);
});

test('Check again inputs use the recommended length, on channels and the last decided change', () => {
    const model = createSpeakerModel(2);
    assert.deepEqual(checkAgainInputs(model),
        { channels: [0], oddChannels: [], configurations: ['short'], length: 'short', currentDv: 0 });
    model.channels[1].odd = oddBlock();
    assert.deepEqual(checkAgainInputs(model),
        { channels: [0, 1], oddChannels: [1], configurations: ['short', 'alone'], length: 'short', currentDv: 0 },
        'an odd block awaiting its check plays alone where the even block is off');
    model.channels[1].odd = oddBlock('littleGain');
    assert.deepEqual(checkAgainInputs(model).channels, [0], 'a failed odd fit rule is not checked');
    model.lastCheck = { at: 1, outcome: 'lower', dv: -2 };
    assert.equal(checkAgainInputs(model).currentDv, -2);
    model.lastCheck.outcome = 'undetermined';
    assert.equal(checkAgainInputs(model).currentDv, 0);
});

test('saving names the record, falls back to the untitled text and stamps savedAt', async () => {
    const model = createSpeakerModel(1);
    const added = [];
    const store = { addMeasurement: async record => { added.push(record); return 'id-1'; } };
    const record = { name: '', timestamp: '', points: [], speakerModel: model };
    assert.equal(await saveSpeakerDistortionRecord(record, { name: '  Desk  ', untitled: 'Untitled', store }), 'id-1');
    await saveSpeakerDistortionRecord(record, { name: '   ', untitled: 'Untitled', store });
    assert.deepEqual(added.map(item => item.name), ['Desk', 'Untitled']);
    assert.equal(added[0].timestamp, new Date(model.measuredAt).toISOString());
    assert.ok(Number.isFinite(added[0].savedAt));
    assert.equal(record.name, '', 'the unsaved record is not changed');
});

test('a run measures every channel, pauses for the microphone and restarts an overloaded channel', async () => {
    const calls = [];
    const pauses = [];
    let restartChannel = null;
    let playCount = 0;
    const play = async buffer => {
        playCount++;
        // The second capture of the first channel overloads once.
        return playCount === 3 ? Float32Array.of(1) : quiet(buffer);
    };
    const statuses = [];
    const record = await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left'), settingsFor(1, 'Right')],
        placement: 'inFront',
        averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play,
        pause: async kind => {
            assert.equal(restartChannel, null, `the active playback restart is unavailable during ${kind}`);
            pauses.push(kind);
        },
        onRestartable: offered => { restartChannel = offered; },
        onStatus: status => statuses.push(`${status.channelIndex} ${status.row}`),
        signal: new AbortController().signal,
        deps: runDeps(calls)
    });
    assert.deepEqual(pauses, ['captureOverload', 'moveMicrophone']);
    assert.deepEqual(calls, ['plan 1'], 'the first channel reuses the level-check plan');
    assert.ok(statuses.includes('0 stopped'));
    assert.ok(statuses.includes('0 checkingLevel'), 'the level check is repeated after an overload');
    assert.deepEqual(statuses.filter(item => item.endsWith('done')), ['0 done', '1 done']);
    const model = record.speakerModel;
    assert.deepEqual(record.points, []);
    assert.equal(record.name, '');
    assert.deepEqual(model.channels.map(entry => [entry.index, entry.captures, entry.passes, entry.checkedAt]),
        [[0, 3, ['plain', 'short'], UPPER_LIMIT_RANGE_HZ[1]], [1, 3, ['plain', 'short'], UPPER_LIMIT_RANGE_HZ[1]]]);
    assert.equal(model.upperLimitHz, UPPER_LIMIT_RANGE_HZ[1]);
    assert.equal(model.peakDbfs, model.levelDbfs + 10);
    assert.equal(model.recommendedLength, 'short');
    assert.equal(model.lastCheck, null);
});

test('an overloaded capture stops a second after its first clipped chunk and pauses with the figure', async () => {
    // 128-sample recorder chunks: a quiet second, then a 997 Hz sine 6 dB over full scale, hard-clipped.
    const clipped = new Float32Array(3 * RATE);
    for (let i = RATE; i < clipped.length; i++) {
        const x = 2 * Math.sin(2 * Math.PI * 997 * i / RATE);
        clipped[i] = x > 1 ? 1 : x < -1 ? -1 : x;
    }
    let playCount = 0;
    let stoppedAt = null;
    const play = async (buffer, settings, stopWhen) => {
        playCount++;
        if (playCount !== 2) return quiet();
        const recording = clipped.slice();
        for (let start = 0; start < recording.length && stoppedAt === null; start += 128) {
            if (stopWhen(recording.subarray(start, start + 128))) stoppedAt = start + 128;
        }
        recording.fill(0, stoppedAt);
        return recording;
    };
    const pauses = [];
    await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left')], placement: 'listeningPosition', averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play, pause: async (kind, info) => { pauses.push([kind, info.lowerDb]); },
        signal: new AbortController().signal, deps: runDeps([])
    });
    assert.equal(stoppedAt, 2 * RATE + 128, 'one second after the chunk with the first clipped sample');
    assert.equal(pauses.length, 1);
    assert.equal(pauses[0][0], 'captureOverload');
    // 6 dB over full scale plus the 3 dB the level check keeps below it.
    assert.ok(Math.abs(pauses[0][1] - (20 * Math.log10(2) - 20 * Math.log10(LEVEL_CHECK_OVERLOAD))) < 0.5,
        `lower by ${pauses[0][1]} dB`);
});

test('clipping alone proves full scale, so the advice is at least the level-check margin', () => {
    // Every block almost all clipped: no estimate beyond full scale itself.
    assert.equal(overloadExcessDb(new Float32Array(RATE).fill(1), RATE), 0);
    // Barely clipped peaks that read as a quieter sinusoid do not count as below full scale.
    const peaky = new Float32Array(RATE);
    for (let i = 0; i < RATE; i += 100) peaky[i] = 1;
    assert.equal(overloadExcessDb(peaky, RATE), 0);
    assert.ok(Math.abs(lowerByDb(0) + 20 * Math.log10(LEVEL_CHECK_OVERLOAD)) < 1e-12);
});

test('a failed level check in the run pauses with how far to lower the input', async () => {
    const deps = runDeps([]);
    let judgeCount = 0;
    deps.judgeLevelCheck = async () => (++judgeCount === 1
        ? { outcome: 'overloaded', headroomDb: 1 } : { outcome: 'passed', headroomDb: 10 });
    const pauses = [];
    await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left'), settingsFor(1, 'Right')], placement: 'listeningPosition', averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play: async () => quiet(), pause: async (kind, info) => { pauses.push([kind, info.lowerDb]); },
        signal: new AbortController().signal, deps
    });
    assert.deepEqual(pauses.map(([kind]) => kind), ['levelOverload']);
    assert.ok(Math.abs(pauses[0][1] - (-1 - 20 * Math.log10(LEVEL_CHECK_OVERLOAD))) < 1e-9);
});

test('channel progress advances through every step and stays monotonic during analysis', async () => {
    const deps = runDeps([]);
    const identify = deps.identifySpeakerModel;
    deps.identifySpeakerModel = async args => {
        args.onProgress(0.5);
        args.onProgress(1);
        return identify(args);
    };
    const statuses = [];
    await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left'), settingsFor(1, 'Right')], placement: 'listeningPosition', averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play: async () => quiet(), pause: async () => {}, onStatus: status => statuses.push(status),
        signal: new AbortController().signal, deps
    });
    const captures = 3 * (48 / RATE + 0.01);
    const total = 8.5 + captures + 20 + 59.5;
    for (const channelIndex of [0, 1]) {
        const steps = statuses.filter(status => status.channelIndex === channelIndex && status.progress);
        assert.ok(steps.every(status => Math.abs(status.progress.total - total) < 1e-9));
        assert.ok(steps.every((status, i) => i === 0 || status.progress.done >= steps[i - 1].progress.done));
        const analyzing = steps.filter(status => status.row === 'analyzing').map(status => status.progress.done);
        assert.deepEqual(analyzing.map(done => Math.round((done - 8.5 - captures) * 1e6) / 1e6), [0, 10, 20]);
        const last = steps.at(-1);
        assert.equal(last.row, 'correctionCheck');
        assert.ok(Math.abs(last.progress.done + last.progress.stepSeconds - total) < 1e-9, 'the last step ends the bar');
        assert.equal(statuses.filter(status => status.channelIndex === channelIndex).at(-1).row, 'done');
    }
    const levelCheck = statuses.find(status => status.channelIndex === 1 && status.row === 'checkingLevel');
    assert.deepEqual(levelCheck.progress, { done: 0, total, stepSeconds: 8.5 });
    assert.ok(Math.abs(statuses[0].progress.done - 8.5) < 1e-9, 'the first channel starts after its level check');
});

test('Retry on Noise plays a noisy test signal again and keeps the quietest of three as the new reference', async () => {
    const deps = runDeps([]);
    const plan = capturePlan();
    plan.captures = plan.captures.map(capture => ({ ...capture, kind: 'call', seed: 1, K: 7, chirp: null }));
    const check = { seed: 10, K: 7, chirp: Float32Array.of(0.25) };
    Object.assign(plan.check, check);
    deps.buildCheckCall = async () => plan.check;
    // Reference 1, so a noise above 10 is too much: the first capture passes on its second play, the
    // second keeps its quietest play (20) as the new reference, so 150 passes on the third capture.
    const noises = [50, 2, 30, 20, 40, 150, 1, 1];
    const judgedCalls = [];
    deps.callSignalNoise = async (recording, call) => {
        judgedCalls.push(call);
        return { signal: 1e4, noise: noises.shift() };
    };
    let recorded = null;
    const identify = deps.identifySpeakerModel;
    deps.identifySpeakerModel = async args => {
        recorded = args.recordings.map(recording => Math.round(recording[0] * 1000));
        return identify(args);
    };
    let playCount = 0;
    const phases = [];
    await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left')], placement: 'listeningPosition', averaging: 1, retryOnNoise: true,
        first: { plan, judged: { outcome: 'passed', headroomDb: 12, noisePower: 1 } },
        play: async () => Float32Array.of(++playCount / 1000), pause: async () => {},
        onStatus: status => phases.push(status.phase), signal: new AbortController().signal, deps
    });
    assert.equal(playCount, 8);
    assert.deepEqual(recorded, [2, 4, 6]);
    assert.equal(phases.filter(phase => phase === 'noiseRetry').length, 3);
    assert.deepEqual(judgedCalls.slice(6), [check, check], 'the correction-check passes are judged too');
});

test('Retry on Noise skips a silent recording and keeps the next usable take', async () => {
    const deps = runDeps([]);
    deps.callSignalNoise = async recording => ({ signal: recording[0], noise: 0 });
    const identify = deps.identifySpeakerModel;
    let firstRecording;
    deps.identifySpeakerModel = async args => {
        firstRecording = args.recordings[0];
        return identify(args);
    };
    const usable = quiet();
    let plays = 0;
    await runWithNoiseRetry({ deps, play: async () => ++plays === 1 ? Float32Array.of(0) : usable });
    assert.equal(plays, 6);
    assert.equal(firstRecording, usable);
});

test('Retry on Noise fails the analysis if every take is unusable', async () => {
    const deps = runDeps([]);
    const unusable = [{ signal: 0, noise: 0 }, { signal: 1, noise: Infinity }];
    const workerError = new Error('Incomplete recording');
    deps.callSignalNoise = async () => {
        if (!unusable.length) throw workerError;
        return unusable.shift();
    };
    let fitted = false;
    deps.identifySpeakerModel = async () => { fitted = true; };
    let plays = 0;
    await assert.rejects(runWithNoiseRetry({ deps, play: async () => { plays++; return quiet(); } }),
        error => error instanceof SpeakerDistortionStepError && error.kind === 'analysis' && error.cause === workerError);
    assert.equal(plays, 3);
    assert.equal(fitted, false);
});

test('cancelling during asynchronous noise judgement keeps the run abort reason and does not replay', async () => {
    const deps = runDeps([]);
    const controller = new AbortController();
    const reason = new DOMException('Measurement cancelled', 'AbortError');
    const received = [];
    const phases = [];
    deps.callSignalNoise = async (recording, call, settings, { signal }) => {
        await Promise.resolve();
        controller.abort(reason);
        received.push(signal.reason);
        throw new Error('Noise analysis worker closed');
    };
    let plays = 0;
    await assert.rejects(runWithNoiseRetry({ deps, signal: controller.signal,
        play: async () => { plays++; return quiet(); }, onStatus: status => phases.push(status.phase) }),
    error => error === reason);
    assert.equal(plays, 1);
    assert.deepEqual(received, [reason]);
    assert.deepEqual(phases, ['playingTestSignal']);
});

test('measuring a channel again restarts it from its first test signal without a level check', async () => {
    const deps = runDeps([]);
    let judgeCount = 0;
    deps.judgeLevelCheck = async () => { judgeCount++; return { outcome: 'passed', headroomDb: 10 }; };
    let restart = null;
    const offers = [];
    const statuses = [];
    let stoppedSignal = null;
    const play = async (buffer, settings, stopWhen, signal) => {
        const capture = statuses.at(-1);
        // The user asks during the second test signal of the second channel, once.
        if (settings.index === 1 && capture.capture === 2 && !stoppedSignal) {
            stoppedSignal = signal;
            restart();
        }
        return quiet();
    };
    const record = await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left'), settingsFor(1, 'Right')], placement: 'listeningPosition', averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play, pause: async () => {},
        onStatus: status => statuses.push(status),
        onRestartable: offered => { restart = offered; offers.push(Boolean(offered)); },
        signal: new AbortController().signal, deps
    });
    assert.equal(stoppedSignal.aborted, true, 'the playing test signal is stopped');
    assert.equal(judgeCount, 1, 'only the level check of the second channel');
    assert.deepEqual(offers, [true, false, true, false, true, false]);
    assert.deepEqual(statuses.filter(status => status.channelIndex === 1 && status.row === 'testSignalOf')
        .map(status => status.capture), [1, 2, 1, 2, 3]);
    assert.deepEqual(record.speakerModel.channels.map(entry => [entry.index, entry.captures]), [[0, 3], [1, 3]]);
});

test('a run rejects with the failing step kind or the abort reason', async () => {
    const base = {
        settingsList: [settingsFor(0, 'Left')],
        placement: 'listeningPosition',
        averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        pause: async () => {}
    };
    await assert.rejects(runSpeakerDistortionMeasurement({ ...base, signal: new AbortController().signal,
        play: async () => { throw new Error('device lost'); }, deps: runDeps([]) }),
    error => error instanceof SpeakerDistortionStepError && error.kind === 'playback');
    const deps = { ...runDeps([]), identifySpeakerModel: async () => { throw new Error('bad fit'); } };
    await assert.rejects(runSpeakerDistortionMeasurement({ ...base, signal: new AbortController().signal,
        play: async () => quiet(), deps }),
    error => error instanceof SpeakerDistortionStepError && error.kind === 'analysis');
    const controller = new AbortController();
    await assert.rejects(runSpeakerDistortionMeasurement({ ...base, signal: controller.signal, deps: runDeps([]),
        play: async () => { controller.abort(); return quiet(); } }),
    error => error.name === 'AbortError');
});

test('Check again updates the checked channels and records the decided change', async () => {
    const model = createSpeakerModel(2);
    const pauses = [];
    const deps = {
        checkPlanFromModel: async () => capturePlan(),
        judgeLevelCheck: async () => (pauses.length === 1
            ? { outcome: 'overloaded', headroomDb: 2 } : { outcome: 'passed', headroomDb: 10 }),
        estimateAmplifierChange: async () => ({ accepted: true, db: -3.2 }),
        buildCheckCall: async (entry, plan, length, dv) => ({ samples: new Float32Array(8), dv }),
        applyCheckAgain: async (entry, length, { plain, corrected }, dv, { upperLimitHz }) => {
            assert.ok(plain instanceof Float32Array && corrected instanceof Float32Array);
            assert.equal(upperLimitHz, model.upperLimitHz);
            return { ...entry, checkFig: { ...entry.checkFig, [length]: { ...entry.checkFig[length], dv } } };
        },
        combineAmplifierChange: (estimates, currentDv) => ({ dv: currentDv - 3, outcome: 'lower' }),
        playedCheckFig: (entry, length) => (length ? entry.checkFig[length] : null),
        recommendLength: () => 'short'
    };
    const result = await runCheckAgain({
        model, channels: [0], length: 'short', currentDv: 0,
        play: async () => quiet(), pause: async (kind, info) => { pauses.push([kind, info.lowerDb]); },
        signal: new AbortController().signal, deps
    });
    assert.deepEqual(pauses.map(([kind]) => kind), ['checkTarget', 'checkLevelOverload']);
    assert.ok(Math.abs(pauses[1][1] - (-2 - 20 * Math.log10(LEVEL_CHECK_OVERLOAD))) < 1e-9, 'how far to lower the input');
    assert.equal(result.outcome, 'lower');
    assert.equal(result.model.lastCheck.dv, -3);
    assert.equal(result.model.revision, model.revision, 'Check again keeps the revision');
    assert.equal(result.model.channels[0].checkFig.short.dv, -3, 'the estimate rounded to 0.5 dB');
    assert.equal(result.model.channels[1], model.channels[1]);
    assert.deepEqual(result.results.map(item => [item.checked, item.accepted, item.v]),
        [[true, true, -3.2], [false, false, null]]);
});

async function runOneChannel(deps) {
    let played = 0;
    const record = await runSpeakerDistortionMeasurement({
        settingsList: [settingsFor(0, 'Left')],
        placement: 'listeningPosition',
        averaging: 1,
        first: { plan: capturePlan(), judged: { outcome: 'passed', headroomDb: 12 } },
        play: async () => { played++; return quiet(); },
        pause: async () => {},
        signal: new AbortController().signal,
        deps
    });
    return { entry: record.speakerModel.channels[0], played };
}

test('the correction check adds the odd passes and the high-volume check at the highest fitting level', async () => {
    const calls = [];
    const { entry, played } = await runOneChannel(oddRunDeps(calls));
    assert.deepEqual(entry.passes, ['plain', 'short', 'shortOdd', 'alone'], 'Long has no even weights');
    assert.deepEqual(calls.filter(item => item.startsWith('call') && item.endsWith(' 0')),
        ['call null false 0', 'call short false 0', 'call short true 0', 'call null true 0']);
    assert.deepEqual(calls.filter(item => / [1-9]\d*$/.test(item) && item.startsWith('call')),
        ['call short true 10', 'call short true 9', 'call short true 8', 'call short false 8']);
    assert.ok(calls.includes('loud short 8 reference,odd 0'));
    assert.equal(entry.odd.loud.t, 8);
    assert.equal(played, 3 + 4 + 2, 'captures, four check passes and two high-volume passes');
});

test('Retry on Noise judges high-volume passes with their own chirps and restores correction status after retry', async () => {
    const deps = oddRunDeps([]);
    const plan = capturePlan();
    const normalChirp = Float32Array.of(0.25);
    const referenceChirp = Float32Array.of(0.5);
    const oddChirp = Float32Array.of(0.75);
    Object.assign(plan.check, { seed: 10, K: 7, chirp: normalChirp });
    const buildCheck = deps.buildCheckCall;
    deps.buildCheckCall = async (...args) => ({ ...await buildCheck(...args),
        chirp: args[5] ? (args[4] ? oddChirp : referenceChirp) : normalChirp });
    const judged = new Map();
    deps.callSignalNoise = async (recording, { seed, K, chirp }) => {
        assert.equal(seed, plan.check.seed);
        assert.equal(K, plan.check.K);
        const attempts = (judged.get(chirp) ?? 0) + 1;
        judged.set(chirp, attempts);
        return { signal: 100, noise: attempts === 1 ? 50 : 1 };
    };
    let plays = 0;
    const phases = [];
    const record = await runWithNoiseRetry({
        deps, first: { plan, judged: { outcome: 'passed', headroomDb: 12, noisePower: 1 } },
        play: async () => { plays++; return quiet(); }, onStatus: ({ row, phase }) => {
            if (row === 'correctionCheck') phases.push(phase);
        }
    });
    assert.equal(record.speakerModel.channels[0].odd.loud.t, 8);
    assert.deepEqual([...judged], [[normalChirp, 5], [referenceChirp, 2], [oddChirp, 2]]);
    assert.equal(plays, 3 + 5 + 2 + 2);
    assert.deepEqual(phases, ['checkingCorrection', 'noiseRetry', 'checkingCorrection',
        'noiseRetry', 'checkingCorrection', 'noiseRetry', 'checkingCorrection']);
});

test('the high-volume level also needs the reference call to fit', async () => {
    const calls = [];
    const deps = oddRunDeps(calls);
    deps.buildCheckCall = async (entry, plan, length, dv, odd = false, t = 0) => {
        calls.push(`call ${length} ${odd} ${t}`);
        return { samples: Float32Array.of((odd ? t > 8 : t > 7) ? 1.5 : 0.5) };
    };
    const { entry } = await runOneChannel(deps);
    assert.ok(calls.includes('call short false 8'), 'the reference call at 8 dB is tested');
    assert.ok(calls.includes('loud short 7 reference,odd 0'));
    assert.equal(entry.odd.loud.t, 7);
});

test('a failed odd fit rule plays no odd pass and no high-volume check', async () => {
    const calls = [];
    const deps = oddRunDeps(calls, 'littleGain');
    deps.loudCheckConfig = entry => (entry.odd.fitReason ? null : 'short');
    const { entry, played } = await runOneChannel(deps);
    assert.deepEqual(entry.passes, ['plain', 'short']);
    assert.ok(!calls.some(item => item.startsWith('loud')));
    assert.equal(played, 3 + 2);
});

test('the high-volume check without a fitting level records no level and plays nothing', async () => {
    const calls = [];
    const deps = oddRunDeps(calls);
    deps.buildCheckCall = async (entry, plan, length, dv, odd = false, t = 0) => {
        calls.push(`call ${length} ${odd} ${t}`);
        return { samples: Float32Array.of(odd && t > 0 ? 1.5 : 0.5) };
    };
    deps.applyLoudCheck = async (entry, c, t, recordings, dv) => {
        calls.push(`loud ${c} ${t} ${recordings} ${dv}`);
        return { ...entry, odd: { ...entry.odd, loud: { dv, t } } };
    };
    const { entry, played } = await runOneChannel(deps);
    assert.equal(calls.filter(item => /^call short true [1-9]/.test(item)).length, 10, 'tries 10 down to 1 dB');
    assert.ok(calls.includes('loud short null null 0'));
    assert.deepEqual(entry.odd.loud, { dv: 0, t: null });
    assert.equal(played, 3 + 4);
});

test('Check again plays the odd pass of odd channels at dv_c and the high-volume check once', async () => {
    const model = createSpeakerModel(2);
    model.channels[1].odd = oddBlock();
    const calls = [];
    let noiseJudgements = 0;
    const deps = {
        checkPlanFromModel: async () => capturePlan(),
        judgeLevelCheck: async () => ({ outcome: 'passed' }),
        estimateAmplifierChange: async entry => ({ accepted: true, db: entry.index ? -6.2 : -3.2 }),
        buildCheckCall: async (entry, plan, length, dv, odd = false, t = 0) => {
            calls.push(`${entry.index} call ${length} ${dv} ${odd} ${t}`);
            return { samples: Float32Array.of(0.5) };
        },
        applyCheckAgain: async (entry, length, recordings, dv) => {
            calls.push(`${entry.index} apply ${Object.keys(recordings)} ${dv}`);
            return entry;
        },
        callSignalNoise: async () => { noiseJudgements++; return { signal: 1, noise: 0 }; },
        loudCheckConfig: entry => (entry.odd?.loud ? null : 'alone'),
        applyLoudCheck: async (entry, c, t, recordings, dv) => {
            calls.push(`${entry.index} loud ${c} ${t} ${dv}`);
            return { ...entry, odd: { ...entry.odd, loud: { dv, t, odd: [null, null, null, -2], total: 0 } } };
        },
        playedCheckFig: (entry, length, oddPlays) => (oddPlays ? null : length ? entry.checkFig[length] : null),
        combineAmplifierChange: (estimates, currentDv) => ({ dv: currentDv, outcome: 'same' }),
        recommendLength: () => 'short'
    };
    const inputs = checkAgainInputs(model);
    let played = 0;
    const result = await runCheckAgain({
        model, ...inputs,
        play: async () => { played++; return quiet(); }, pause: async () => {},
        signal: new AbortController().signal, deps
    });
    assert.deepEqual(calls, [
        '0 call short -3 false 0', '0 apply plain,corrected -3',
        '1 call null -6 true 0', '1 apply plain,odd -6',
        '1 call null -6 true 10', '1 call null -6 false 10', '1 loud alone 10 -6'
    ]);
    assert.equal(played, (1 + 2) + (1 + 2 + 2), 'level check and passes per channel');
    assert.equal(result.model.channels[1].odd.loud.t, 10);
    calls.length = 0;
    await runCheckAgain({
        model: result.model, ...checkAgainInputs(result.model),
        play: async () => quiet(), pause: async () => {}, signal: new AbortController().signal, deps
    });
    assert.ok(!calls.some(item => item.includes('loud')), 'the high-volume check is never replayed');
    assert.equal(noiseJudgements, 0, 'Check again does not use Retry on Noise');
});
