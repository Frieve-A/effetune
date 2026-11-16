import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { startMicrophoneInput } from '../../features/measurement/audio-utils/devices.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import measurementController from '../../features/measurement/measurement-controller/index.js';
import { confirmSpeakerDistortionLeave, initializeSpeakerDistortionScreens, runLevelCheck, showNewMeasurementScreen,
    showSpeakerDistortionSetupScreen, speakerDistortionAudio, startRun }
    from '../../features/measurement/ui/speaker-distortion-setup.js';
import { SpeakerDistortionPanel } from '../../features/measurement/ui/speaker-distortion-panel.js';
import { UIManager } from '../../features/measurement/ui/ui-manager.js';
import { ANDROID_ORIGIN } from '../../js/android/bridge.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

function createNode(name, connections, options = {}) {
    return {
        name,
        channelCount: options.channelCount,
        gain: { value: 1 },
        port: { onmessage: null },
        connect(target, output = 0, input = 0) {
            connections.push([name, target.name, output, input]);
        },
        disconnect() {}
    };
}

function createInputHarness(channelCount) {
    const connections = [];
    const gains = [];
    const track = {
        getSettings: () => ({ channelCount }),
        stop() {}
    };
    const stream = {
        getAudioTracks: () => [track],
        getTracks: () => [track]
    };
    const splitter = createNode('splitter', connections);
    const microphone = createNode('microphone', connections, { channelCount });
    const analyzer = createNode('analyzer', connections);
    const levelMeter = createNode('level-meter', connections);
    const context = {
        state: 'running',
        destination: createNode('destination', connections),
        createMediaStreamSource: () => microphone,
        createChannelSplitter: () => splitter,
        createGain() {
            const gain = createNode(`gain-${gains.length}`, connections);
            gains.push(gain);
            return gain;
        }
    };
    const audioUtils = {
        audioContext: context,
        analyzer,
        stopMicrophoneInput() {},
        ensureAudioContextRunning: async () => true,
        createLevelMeterWorkletNode: async () => levelMeter
    };
    return { audioUtils, connections, gains, stream };
}

test('Both input averages left and right once before level metering and recording', async () => {
    const harness = createInputHarness(2);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => harness.stream
            }
        }
    }, async () => {
        assert.equal(
            await startMicrophoneInput.call(harness.audioUtils, 'device-1', 'both'),
            true
        );
    });

    assert.equal(harness.gains[1].gain.value, 0.5);
    assert.equal(harness.gains[2].gain.value, 0.5);
    assert.equal(harness.connections.some(connection =>
        connection[0] === 'gain-0' && connection[1] === 'level-meter'), true);

    const processingSource = readFileSync(
        new URL('../../features/measurement/measurement-controller/audio-processing.js', import.meta.url),
        'utf8'
    );
    assert.match(processingSource, /audioUtils\.channelGain\.connect\(recordNode\)/);
    assert.doesNotMatch(processingSource, /audioUtils\.microphone\.connect\(recordNode\)/);
});

test('Both input keeps a mono capture stream at unity gain', async () => {
    const harness = createInputHarness(1);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => harness.stream
            }
        }
    }, async () => {
        assert.equal(
            await startMicrophoneInput.call(harness.audioUtils, 'mono-device', 'both'),
            true
        );
    });

    assert.equal(harness.gains.length, 1);
    assert.equal(harness.gains[0].gain.value, 1);
    assert.equal(harness.connections.some(connection =>
        connection[0] === 'splitter' &&
        connection[1] === 'gain-0' &&
        connection[2] === 0), true);
});

test('Right input requires and validates a stereo capture stream', async () => {
    const stereo = createInputHarness(2);
    let constraints;
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async requested => {
                    constraints = requested;
                    return stereo.stream;
                }
            }
        }
    }, async () => {
        assert.equal(
            await startMicrophoneInput.call(stereo.audioUtils, 'device-2', 'right'),
            true
        );
    });
    assert.deepEqual(constraints.audio.channelCount, { min: 2 });
    assert.equal(stereo.connections.some(connection =>
        connection[0] === 'splitter' &&
        connection[1] === 'gain-0' &&
        connection[2] === 1), true);

    const mono = createInputHarness(1);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => mono.stream
            }
        }
    }, async () => {
        await assert.rejects(
            startMicrophoneInput.call(mono.audioUtils, 'device-3', 'right'),
            /does not provide a right channel/
        );
    });

    const rejected = createInputHarness(1);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => {
                    const error = new Error('constraint failed');
                    error.name = 'OverconstrainedError';
                    throw error;
                }
            }
        }
    }, async () => {
        await assert.rejects(
            startMicrophoneInput.call(rejected.audioUtils, 'device-4', 'right'),
            /does not provide a right channel/
        );
    });
});

function createSpeakerScreenHarness() {
    const elements = new Map();
    const createElement = () => {
        const listeners = new Map();
        const node = {
            style: {}, dataset: {}, children: [], classList: { toggle() {} }, before() {}, setAttribute() {}, focus() {},
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            querySelector: () => createElement(),
            nextElementSibling: { before() {} }, closest: () => node,
            addEventListener: (type, listener) => listeners.set(type, listener),
            click: () => listeners.get('click')()
        };
        return node;
    };
    const byId = id => {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };
    byId('outputChannelCount').value = '2';
    byId('sampleRate').value = '48000';
    const manager = { currentScreen: 'resultsDisplayScreen', showScreen(id) { this.currentScreen = id; } };
    const document = { getElementById: byId, createElement, createComment: () => ({ replaceWith() {} }),
        querySelector: createElement, querySelectorAll: () => [], documentElement: { lang: 'en' } };
    const window = { addEventListener() {}, app: { initializeAudio: async () => {}, populateAudioDevices: async () => {},
        selectSavedAudioDevices() {}, syncSweepBandChannelChoices() {}, saveUserSettings() {} } };
    return { byId, manager, document, window };
}

test('after Back and Next, a pending microphone and level check cannot replace the current ones', async t => {
    const settings = { audioInputId: 'first', inputChannel: 'left', sweepLength: 65536 };
    const first = createInputHarness(1);
    const current = createInputHarness(1);
    const stopFirst = t.mock.method(first.stream.getTracks()[0], 'stop');
    const stopCurrent = t.mock.method(current.stream.getTracks()[0], 'stop');
    const acquisitions = [];
    const { byId, manager, document, window } = createSpeakerScreenHarness();
    t.mock.property(audioUtils, 'audioContext', { ...current.audioUtils.audioContext, sampleRate: 48000 });
    t.mock.property(audioUtils, 'analyzer', current.audioUtils.analyzer);
    t.mock.method(audioUtils, 'createLevelMeterWorkletNode', current.audioUtils.createLevelMeterWorkletNode);
    t.mock.method(dataStorage, 'loadUserSettings', () => settings);
    t.mock.method(measurementController, 'cleanup', () => audioUtils.stopMicrophoneInput());
    const startMeter = t.mock.method(measurementController, 'startLevelMeter', () => {});

    await withGlobals({
        navigator: { mediaDevices: { getUserMedia(constraints) {
            const pending = Promise.withResolvers();
            acquisitions.push({ ...pending, deviceId: constraints.audio.deviceId.exact });
            return pending.promise;
        } } },
        document, window
    }, async () => {
        initializeSpeakerDistortionScreens(manager);
        showSpeakerDistortionSetupScreen();
        const next = byId('speakerDistortionSetupNext');
        const back = byId('speakerDistortionCheckBack');
        const levelCheck = byId('speakerDistortionLevelCheckBtn');
        next.click();
        await setImmediate();
        const previousCheck = levelCheck.click();
        back.click();
        settings.audioInputId = 'current';
        next.click();
        await setImmediate();
        assert.deepEqual(acquisitions.map(({ deviceId }) => deviceId), ['first', 'current']);

        acquisitions[1].resolve(current.stream);
        await setImmediate();
        assert.equal(audioUtils.inputStream, current.stream);
        assert.equal(startMeter.mock.callCount(), 1);

        levelCheck.disabled = true;
        acquisitions[0].resolve(first.stream);
        await previousCheck;
        assert.equal(levelCheck.disabled, true, 'the previous check does not change the current button state');
        assert.equal(startMeter.mock.callCount(), 1);
        assert.equal(audioUtils.inputStream, current.stream);
        assert.equal(stopFirst.mock.callCount(), 1);
        assert.equal(stopCurrent.mock.callCount(), 0);
        back.click();
    });
});

test('Stop and Leave releases Check again before a pending microphone permission prompt returns', { timeout: 5000 }, async t => {
    const input = createInputHarness(1);
    const lateInput = createInputHarness(1);
    const stopLate = t.mock.method(lateInput.stream.getTracks()[0], 'stop');
    const pending = Promise.withResolvers();
    const requested = Promise.withResolvers();
    const { byId, manager, document, window } = createSpeakerScreenHarness();
    t.mock.property(audioUtils, 'audioContext', { ...input.audioUtils.audioContext, sampleRate: 48000 });
    t.mock.property(audioUtils, 'analyzer', input.audioUtils.analyzer);
    t.mock.method(audioUtils, 'createLevelMeterWorkletNode', input.audioUtils.createLevelMeterWorkletNode);
    t.mock.method(dataStorage, 'loadUserSettings', () => ({ audioInputId: 'microphone' }));
    const cleanup = t.mock.method(measurementController, 'cleanup', () => audioUtils.stopMicrophoneInput());

    let requests = 0;
    await withGlobals({ document, window, navigator: { mediaDevices: { getUserMedia() {
        if (++requests > 1) return Promise.resolve(input.stream);
        requested.resolve();
        return pending.promise;
    } } } }, async () => {
        initializeSpeakerDistortionScreens(manager);
        const measurement = { id: 'saved-measurement', speakerModel: createSpeakerModel(1) };
        const panel = new SpeakerDistortionPanel(null, { onChanged() {}, audio: speakerDistortionAudio });
        panel.openCheckAgain(measurement, { channels: [0], length: 'short' });
        const check = panel.runCheck(measurement);
        await requested.promise;

        const leave = confirmSpeakerDistortionLeave();
        byId('speakerDistortionDialogButtons').children[0].click();
        assert.equal(await leave, true);
        await check;
        assert.equal(cleanup.mock.callCount(), 1);

        await speakerDistortionAudio.prepare(48000, { channels: [0] });
        pending.resolve(lateInput.stream);
        await setImmediate();
        assert.equal(stopLate.mock.callCount(), 1);
        assert.equal(audioUtils.inputStream, input.stream);
        await speakerDistortionAudio.release();
    });
});

test('discarding a speaker draft and returning from the chooser shows saved results or the empty view', async t => {
    const savedMeasurement = { id: 'saved-measurement' };
    const draft = { speakerModel: createSpeakerModel(1) };
    let latest = savedMeasurement;
    t.mock.method(dataStorage, 'getLatestMeasurement', () => latest);
    t.mock.method(dataStorage, 'loadUserSettings', () => ({ sweepLength: 65536 }));

    for (const expected of [savedMeasurement.id, null]) {
        const { byId, document, window } = createSpeakerScreenHarness();
        const manager = new UIManager();
        manager.unsavedSpeakerResult = draft;
        manager.showScreen = id => { manager.currentScreen = id; };
        manager.correctionHandler.requestCorrectionUpdate = () => {};
        manager.measurementDisplay.displayMeasurementDetails = id => { byId('resultTitle').textContent = id; };
        const refresh = t.mock.method(manager, 'updateResultsGraph', () => {});
        byId('measurementResults').style.display = 'block';
        byId('resultTitle').textContent = 'Unsaved draft';

        await withGlobals({ document, window }, async () => {
            initializeSpeakerDistortionScreens(manager);
            const leave = confirmSpeakerDistortionLeave().then(allowed => {
                assert.equal(allowed, true);
                showNewMeasurementScreen();
            });
            byId('speakerDistortionDialogButtons').children[1].click();
            await leave;
            byId('newMeasurementBack').click();
            assert.equal(manager.currentScreen, 'resultsDisplayScreen');
            assert.equal(manager.unsavedSpeakerResult, null);
            assert.equal(manager.selectedMeasurementId, expected);
            if (expected) {
                assert.equal(byId('resultTitle').textContent, expected);
            } else {
                assert.equal(byId('noMeasurementMessage').style.display, 'block');
                assert.equal(byId('measurementResults').style.display, 'none');
                assert.equal(refresh.mock.callCount(), 1);
            }
        });
        latest = null;
    }
});

test('confirming a channel restart resets only the active progress bar', async t => {
    const { byId, manager, document, window } = createSpeakerScreenHarness();
    const plan = { levelDbfs: -20, levelCheck: new Float32Array(8), check: { samples: new Float32Array(8) },
        captures: [1, 2].map(marker => {
            const samples = new Float32Array(48000);
            samples[0] = marker;
            return { samples, gapSeconds: 0 };
        }) };
    const deps = {
        LENGTHS: ['short', 'long'], BAND_EDGES: [20], UPPER_LIMIT_RANGE_HZ: [1000, 8000],
        buildCapturePlan: async () => plan,
        judgeLevelCheck: () => ({ outcome: 'passed', headroomDb: 10, snrDb: 50 }),
        identifySpeakerModel: ({ settings }) => ({ ...settings, weights: { short: null, long: null } }),
        buildCheckCall: () => plan.check,
        applyCorrectionCheck: entry => entry,
        loudCheckConfig: () => null,
        recommendLength: () => null
    };
    t.mock.property(audioUtils, 'audioContext', { sampleRate: 48000 });
    t.mock.method(dataStorage, 'loadUserSettings', () => ({ sweepLength: 65536,
        speakerDistortionPlacement: 'listeningPosition', speakerDistortionNoiseRetry: false }));
    t.mock.method(measurementController, 'startLevelMeter', () => {});
    t.mock.method(speakerDistortionAudio, 'prepare', async () => {});
    t.mock.method(speakerDistortionAudio, 'release', async () => {});
    let result, leftBar, rightBar, before, afterDecline, afterConfirm, leftAfterConfirm, firstRestartedProgress;
    let rightAttempts = 0;
    let stopped = false;
    manager.showSpeakerDistortionResult = record => { result = record; };
    t.mock.method(speakerDistortionAudio, 'play', async (samples, settings, signal) => {
        if (settings.index === 1 && samples[0] === 1) {
            rightAttempts++;
            if (rightAttempts === 2) firstRestartedProgress = rightBar.value;
        }
        if (settings.index === 1 && samples[0] === 2 && rightAttempts === 1) {
            before = rightBar.value;
            const restart = byId('speakerDistortionRunRestart');
            const buttons = byId('speakerDistortionDialogButtons');
            const declined = restart.click();
            buttons.children[0].click();
            await declined;
            afterDecline = rightBar.value;
            const confirmed = restart.click();
            buttons.children[1].click();
            await confirmed;
            afterConfirm = rightBar.value;
            leftAfterConfirm = leftBar.value;
            stopped = signal.aborted;
        }
        return new Float32Array(8);
    });

    await withGlobals({ document, window }, async () => {
        initializeSpeakerDistortionScreens(manager);
        showSpeakerDistortionSetupScreen();
        byId('speakerDistortionSetupNext').click();
        await runLevelCheck(deps);
        const run = startRun({ deps });
        const [left, right] = byId('speakerDistortionRunRows').children;
        leftBar = left.children[2];
        rightBar = right.children[2];
        for (const row of [left, right]) {
            t.mock.method(row, 'querySelector', selector => row.children[selector === 'progress' ? 2 : 1]);
        }
        await run;
    });
    assert.equal(rightAttempts, 2);
    assert.ok(before > 0);
    assert.equal(afterDecline, before);
    assert.equal(afterConfirm, 0);
    assert.equal(leftAfterConfirm, 1);
    assert.ok(firstRestartedProgress < before);
    assert.equal(stopped, true);
    assert.equal(result.speakerModel.channels.length, 2);
});

test('chooser Back returns to the original results after leaving setup or a cancelled run', { timeout: 5000 }, async t => {
    const { byId, manager, document, window } = createSpeakerScreenHarness();
    const workerStarted = Promise.withResolvers();
    const workerFinished = Promise.withResolvers();
    const releaseStarted = Promise.withResolvers();
    const releaseFinished = Promise.withResolvers();
    const events = [];
    const plan = { levelDbfs: -20, levelCheck: new Float32Array(8), captures: [], check: { samples: new Float32Array(8) } };
    const deps = {
        LENGTHS: ['short', 'long'],
        async buildCapturePlan({ index }, { signal }) {
            if (index === 0) return plan;
            workerStarted.resolve(signal);
            await workerFinished.promise;
            signal.throwIfAborted();
        },
        judgeLevelCheck: () => ({ outcome: 'passed', headroomDb: 10, snrDb: 50 }),
        identifySpeakerModel: ({ settings }) => ({ ...settings, weights: { short: null, long: null } }),
        buildCheckCall: () => plan.check,
        applyCorrectionCheck: entry => entry,
        loudCheckConfig: () => null
    };
    t.mock.property(audioUtils, 'audioContext', { sampleRate: 48000 });
    t.mock.method(dataStorage, 'loadUserSettings', () => ({ sweepLength: 65536,
        speakerDistortionPlacement: 'listeningPosition', speakerDistortionNoiseRetry: false }));
    t.mock.method(measurementController, 'startLevelMeter', () => {});
    t.mock.method(speakerDistortionAudio, 'prepare', async () => events.push('acquire'));
    t.mock.method(speakerDistortionAudio, 'play', async () => new Float32Array(8));
    let releases = 0;
    t.mock.method(speakerDistortionAudio, 'release', () => {
        if (++releases !== 2) return;
        releaseStarted.resolve();
        return releaseFinished.promise.then(() => events.push('released old run'));
    });

    await withGlobals({ document, window }, async () => {
        initializeSpeakerDistortionScreens(manager);
        showNewMeasurementScreen();
        await byId('measureSpeakerDistortionBtn').click();
        byId('speakerDistortionSetupBack').click();
        byId('newMeasurementBack').click();
        assert.equal(manager.currentScreen, 'resultsDisplayScreen');

        showNewMeasurementScreen();
        await byId('measureSpeakerDistortionBtn').click();
        byId('speakerDistortionSetupNext').click();
        await runLevelCheck(deps);
        const run = startRun({ deps });
        const signal = await workerStarted.promise;
        const leave = confirmSpeakerDistortionLeave().then(allowed => {
            assert.equal(allowed, true);
            showNewMeasurementScreen();
        });
        byId('speakerDistortionDialogButtons').children[0].click();
        await setImmediate();
        assert.equal(signal.aborted, true);
        assert.equal(manager.currentScreen, 'speakerDistortionRunScreen');
        assert.equal(releases, 1);

        workerFinished.resolve();
        await releaseStarted.promise;
        assert.equal(manager.currentScreen, 'speakerDistortionRunScreen');
        releaseFinished.resolve();
        await Promise.all([run, leave]);
        byId('newMeasurementBack').click();
        assert.equal(manager.currentScreen, 'resultsDisplayScreen');

        showNewMeasurementScreen();
        await byId('measureSpeakerDistortionBtn').click();
        byId('speakerDistortionSetupNext').click();
        await setImmediate();
        assert.deepEqual(events, ['acquire', 'acquire', 'released old run', 'acquire']);
        byId('speakerDistortionCheckBack').click();
        byId('speakerDistortionSetupBack').click();
    });
});

test('Android speaker setup uses the native rate and saved output before preparing capture', async t => {
    const transport = { postMessage(serialized) {
        const { id, command, payload } = JSON.parse(serialized);
        requests.push({ command, payload });
        const result = command === 'audio.devices' ? { unprocessed: true } : { channelCount: 2 };
        queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ id, version: 1, ok: true, result }) }));
    } };
    const requests = [];
    t.mock.property(audioUtils, 'audioContext', { sampleRate: 48000 });
    t.mock.method(audioUtils, 'ensureAudioContextRunning', async () => true);
    const reinitialize = t.mock.method(audioUtils, 'reinitialize', async () => assert.fail('native format is fixed'));
    t.mock.method(measurementController, 'startLevelMeter', () => {});
    t.mock.method(dataStorage, 'loadUserSettings', () => ({
        audioInputId: '3', inputChannel: 'right', audioOutputId: '12', outputChannelCount: 8, sweepLength: 65536
    }));
    const { byId, manager, document, window } = createSpeakerScreenHarness();
    byId('sampleRate').value = '44100';
    window.location = { origin: ANDROID_ORIGIN };
    window.effetuneAndroid = transport;

    await withGlobals({ window, document }, async () => {
        await assert.rejects(speakerDistortionAudio.prepare(48000, { channels: [0, 2] }), /limited to channels 1 and 2/);
        await assert.rejects(speakerDistortionAudio.prepare(44100, { channels: [1] }), /48000 Hz, not 44100 Hz/);
        assert.deepEqual(requests, []);
        assert.equal(reinitialize.mock.callCount(), 0);

        initializeSpeakerDistortionScreens(manager);
        showNewMeasurementScreen();
        await byId('measureSpeakerDistortionBtn').click();
        assert.ok(!byId('speakerDistortionDevices').children.includes(byId('sampleRate')));
        byId('speakerDistortionSetupNext').click();
        await setImmediate();
        assert.deepEqual(requests.slice(0, 2), [
            { command: 'audio.configure', payload: { outputDeviceId: 12, channelCount: 2 } },
            { command: 'audio.input', payload: { deviceId: 3 } }
        ]);
        assert.equal(measurementController.measurementConfig.outputChannelCount, 2);
        byId('speakerDistortionCheckBack').click();
        byId('speakerDistortionSetupBack').click();
        await setImmediate();
    });
});
